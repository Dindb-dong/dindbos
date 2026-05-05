class WasmExit extends Error {
  constructor(code = 0) {
    super(`wasm exited with status ${code}`);
    this.code = Number(code || 0);
  }
}

class WasmAbort extends Error {
  constructor(message) {
    super(message);
    this.code = "EABORT";
  }
}

export class WasmRunner {
  constructor(os) {
    this.os = os;
  }

  async runFile(path, cwd = "/", options = {}) {
    if (typeof WebAssembly === "undefined") throw new Error("wasm: WebAssembly is unavailable in this runtime");
    const normalized = this.os.fs.normalize(path, cwd);
    const bytes = this.os.fs.readFileBytes(normalized, "/", options.principal);
    if (options.executionBackend === "worker" || options.backend === "worker") {
      return this.os.executor.runWasmTask({
        ...options,
        bytes,
        path: normalized,
        cwd: this.os.fs.dirname(normalized),
        appId: options.appId || `wasm:${this.os.fs.basename(normalized)}`,
        name: options.name || this.os.fs.basename(normalized),
        env: this.environment({ ...options, cwd: this.os.fs.dirname(normalized), path: normalized }, { cwd: this.os.fs.dirname(normalized) }),
      });
    }
    return this.runBytes(bytes, {
      ...options,
      path: normalized,
      cwd: this.os.fs.dirname(normalized),
    });
  }

  async runBytes(bytes, options = {}) {
    const app = this.processApp(options);
    const process = this.os.processes.spawn(app, {
      argv: [...(options.argv || [])],
      cwd: options.cwd || this.os.session.home || "/",
      executable: options.path || "",
      parentPid: options.parentPid || 0,
      stdin: options.stdin || "",
      ptySessionId: options.ptySessionId || "",
      preopens: [options.cwd || this.os.session.home || "/"],
      runtime: "wasm",
    });
    const stdout = [];
    const stderr = [];
    let instance = null;
    let crashed = false;
    let crashReportPath = "";
    let descriptorOutput = { stdout: "", stderr: "" };
    const startedAt = Date.now();
    const timeoutMs = Number(options.timeoutMs || 0);
    const deadlineAt = Number.isFinite(Number(options.deadlineAt)) ? Number(options.deadlineAt) : (timeoutMs > 0 ? startedAt + timeoutMs : Infinity);
    const env = this.environment(options, process);
    const context = {
      process,
      principal: options.principal || this.os.permissions.principal({ user: process.user, groups: this.os.session.groups }),
      env,
      assertFileSystem: (path, access) => this.assertFileSystem(path, access, process),
      assertCapability: (capability) => this.assertCapability(capability, process),
    };
    const readMemory = (ptr, length) => {
      const memory = instance?.exports?.memory;
      if (!memory) throw new Error("wasm: module must export memory for DindbOS imports");
      return new Uint8Array(memory.buffer, Number(ptr || 0), Number(length || 0));
    };
    const memoryView = () => {
      const memory = instance?.exports?.memory;
      if (!memory) throw new Error("wasm: module must export memory for DindbOS imports");
      return new DataView(memory.buffer);
    };
    const writeMemory = (ptr, bytes) => readMemory(ptr, bytes.length).set(bytes);
    const writeU16 = (ptr, value) => memoryView().setUint16(Number(ptr || 0), Number(value || 0), true);
    const writeU32 = (ptr, value) => memoryView().setUint32(Number(ptr || 0), Number(value || 0), true);
    const writeU64 = (ptr, value) => {
      const view = memoryView();
      const bigint = BigInt(value || 0);
      if (typeof view.setBigUint64 === "function") view.setBigUint64(Number(ptr || 0), bigint, true);
      else {
        view.setUint32(Number(ptr || 0), Number(bigint & 0xffffffffn), true);
        view.setUint32(Number(ptr || 0) + 4, Number((bigint >> 32n) & 0xffffffffn), true);
      }
    };
    const readString = (ptr, length) => new TextDecoder().decode(readMemory(ptr, length));
    const checkDeadline = () => {
      assertWasmMemoryLimit(instance, options.maxMemoryPages);
      if (options.abortSignal?.aborted || options.aborted) {
        throw new WasmAbort(`wasm: aborted${abortReason(options)}`);
      }
      if (Date.now() > deadlineAt) {
        throw new WasmAbort(`wasm: cooperative timeout after ${timeoutMs || 0}ms`);
      }
      return 0;
    };
    const envEntries = () => Object.entries(env).map(([key, value]) => `${key}=${value}`);
    const writeCStringArray = (pointersPtr, bufferPtr, values) => {
      let cursor = Number(bufferPtr || 0);
      values.forEach((value, index) => {
        const bytes = new TextEncoder().encode(`${value}\0`);
        writeU32(Number(pointersPtr || 0) + index * 4, cursor);
        writeMemory(cursor, bytes);
        cursor += bytes.length;
      });
    };
    const writeFilestat = (resultPtr, stat = {}, path = "") => {
      const base = Number(resultPtr || 0);
      const modified = Date.parse(stat.modified || "");
      const timestamp = Number.isFinite(modified) ? BigInt(modified) * 1_000_000n : 0n;
      writeU64(base, 0n);
      writeU64(base + 8, stableInode(stat.path || path));
      readMemory(base + 16, 1)[0] = wasiFileType(stat.resolvedType || stat.type || stat.kind);
      writeU64(base + 24, BigInt(Math.max(1, Number(stat.linkCount || 1))));
      writeU64(base + 32, BigInt(Math.max(0, Number(stat.size || 0))));
      writeU64(base + 40, timestamp);
      writeU64(base + 48, timestamp);
      writeU64(base + 56, timestamp);
    };
    const writeFdstat = (resultPtr, descriptor = {}) => {
      const base = Number(resultPtr || 0);
      const rights = descriptor.rights || {
        read: Boolean(descriptor.readable),
        write: Boolean(descriptor.writable),
      };
      let rightsBase = 0n;
      if (rights.read) rightsBase |= WASI_RIGHT_FD_READ;
      if (rights.write) rightsBase |= WASI_RIGHT_FD_WRITE;
      readMemory(base, 1)[0] = wasiFileType(descriptor.kind || descriptor.type);
      writeU16(base + 2, wasiFdFlags(descriptor));
      writeU64(base + 8, rightsBase);
      writeU64(base + 16, rightsBase);
    };
    const descriptorStat = (descriptor) => {
      if (String(descriptor.path || "").startsWith("/")) {
        return this.os.fs.stat(descriptor.path, "/", context.principal) || descriptor;
      }
      const streams = this.os.descriptors?.standardStreams?.(process.pid) || {};
      return {
        ...descriptor,
        type: descriptor.kind === "directory" ? "directory" : "file",
        size: descriptor.kind === "stream" ? new TextEncoder().encode(String(streams[descriptor.path] || "")).byteLength : 0,
      };
    };
    const imports = {
      dindbos: {
        write: (ptr, length) => stdout.push(readString(ptr, length)),
        writeErr: (ptr, length) => stderr.push(readString(ptr, length)),
        argc: () => (options.argv || []).length,
        writeArg: (index) => stdout.push(String((options.argv || [])[Number(index)] ?? "")),
        writeEnv: (ptr, length) => stdout.push(String(env[readString(ptr, length)] ?? "")),
        syscall: (ptr, length) => {
          const request = parseSyscallRequest(readString(ptr, length));
          const result = this.os.syscall(request.name, request.args || {}, context);
          return result.ok ? 0 : errnoNumber(result.error?.code);
        },
        checkDeadline,
        exit: (code) => {
          throw new WasmExit(code);
        },
      },
      wasi_snapshot_preview1: {
        args_sizes_get: (argcPtr, argvBufSizePtr) => {
          const argv = options.argv || [];
          writeU32(argcPtr, argv.length);
          writeU32(argvBufSizePtr, cStringBytes(argv));
          return 0;
        },
        args_get: (argvPtr, argvBufPtr) => {
          writeCStringArray(argvPtr, argvBufPtr, options.argv || []);
          return 0;
        },
        environ_sizes_get: (environCountPtr, environBufSizePtr) => {
          const entries = envEntries();
          writeU32(environCountPtr, entries.length);
          writeU32(environBufSizePtr, cStringBytes(entries));
          return 0;
        },
        environ_get: (environPtr, environBufPtr) => {
          writeCStringArray(environPtr, environBufPtr, envEntries());
          return 0;
        },
        fd_write: (fd, iovsPtr, iovsLength, nwrittenPtr) => {
          const descriptor = Number(fd);
          const view = memoryView();
          let written = 0;
          try {
            for (let index = 0; index < Number(iovsLength || 0); index += 1) {
              const base = Number(iovsPtr || 0) + index * 8;
              const ptr = view.getUint32(base, true);
              const length = view.getUint32(base + 4, true);
              const text = readString(ptr, length);
              if (this.os.descriptors?.write) this.os.descriptors.write(process, { fd: descriptor, data: text }, context);
              else if (descriptor === 1) stdout.push(text);
              else if (descriptor === 2) stderr.push(text);
              else return 8;
              written += length;
            }
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
          writeU32(nwrittenPtr, written);
          return 0;
        },
        fd_read: (fd, iovsPtr, iovsLength, nreadPtr) => {
          const descriptor = Number(fd);
          const view = memoryView();
          let read = 0;
          try {
            for (let index = 0; index < Number(iovsLength || 0); index += 1) {
              const base = Number(iovsPtr || 0) + index * 8;
              const ptr = view.getUint32(base, true);
              const length = view.getUint32(base + 4, true);
              const result = this.os.descriptors.read(process, { fd: descriptor, length }, context);
              const bytes = new TextEncoder().encode(String(result.data || ""));
              writeMemory(ptr, bytes);
              read += bytes.length;
              if (bytes.length < length) break;
            }
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
          writeU32(nreadPtr, read);
          return 0;
        },
        fd_close: (fd) => {
          try {
            this.os.descriptors.close(process, { fd }, context);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        fd_filestat_get: (fd, resultPtr) => {
          try {
            const descriptor = this.os.descriptors.stat(process, { fd }, context);
            writeFilestat(resultPtr, descriptorStat(descriptor), descriptor.path);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        fd_fdstat_get: (fd, resultPtr) => {
          try {
            const descriptor = this.os.descriptors.stat(process, { fd }, context);
            writeFdstat(resultPtr, descriptor);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        fd_readdir: (fd, bufferPtr, bufferLength, cookie, nreadPtr) => {
          try {
            const entries = this.os.descriptors.readDirectory(process, { fd, cookie: Number(cookie || 0) }, context);
            let written = 0;
            const limit = Number(bufferLength || 0);
            for (const entry of entries) {
              const name = new TextEncoder().encode(entry.name);
              const recordLength = 24 + name.length;
              if (written + recordLength > limit) break;
              const base = Number(bufferPtr || 0) + written;
              writeU64(base, BigInt(entry.cookie));
              writeU64(base + 8, BigInt(entry.cookie));
              writeU32(base + 16, name.length);
              readMemory(base + 20, 1)[0] = wasiFileType(entry.type);
              writeMemory(base + 24, name);
              written += recordLength;
            }
            writeU32(nreadPtr, written);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        path_create_directory: (dirfd, pathPtr, pathLength) => {
          try {
            const directory = this.os.descriptors.stat(process, { fd: Number(dirfd) }, context);
            if (directory.kind !== "directory") return errnoNumber("ENOTDIR");
            const path = readString(pathPtr, pathLength);
            const target = this.os.fs.normalize(path, directory.path);
            context.assertFileSystem(target, "write");
            this.os.fs.createDirectory(target, "/", {}, context.principal);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || (String(error.message || "").includes("file exists") ? "EEXIST" : "EIO"));
          }
        },
        path_unlink_file: (dirfd, pathPtr, pathLength) => {
          try {
            const target = this.scopedDirectoryTarget(process, context, Number(dirfd), readString(pathPtr, pathLength));
            const stat = this.os.fs.stat(target, "/", context.principal);
            if (stat?.type === "directory") return errnoNumber("EISDIR");
            this.os.fs.remove(target, "/", {}, context.principal);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        path_remove_directory: (dirfd, pathPtr, pathLength) => {
          try {
            const target = this.scopedDirectoryTarget(process, context, Number(dirfd), readString(pathPtr, pathLength));
            const stat = this.os.fs.stat(target, "/", context.principal);
            if (stat?.type !== "directory") return errnoNumber("ENOTDIR");
            this.os.fs.remove(target, "/", {}, context.principal);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        path_rename: (oldDirfd, oldPathPtr, oldPathLength, newDirfd, newPathPtr, newPathLength) => {
          try {
            const source = this.scopedDirectoryTarget(process, context, Number(oldDirfd), readString(oldPathPtr, oldPathLength));
            const destination = this.scopedDirectoryTarget(process, context, Number(newDirfd), readString(newPathPtr, newPathLength));
            this.os.fs.move(source, destination, "/", context.principal);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || errnoCodeFromMessage(error.message) || "EIO");
          }
        },
        path_symlink: (targetPtr, targetLength, dirfd, pathPtr, pathLength) => {
          try {
            const target = readString(targetPtr, targetLength);
            const linkPath = this.scopedDirectoryTarget(process, context, Number(dirfd), readString(pathPtr, pathLength));
            this.os.fs.createSymlink(target, linkPath, "/", {}, context.principal);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || errnoCodeFromMessage(error.message) || "EIO");
          }
        },
        path_readlink: (dirfd, pathPtr, pathLength, bufferPtr, bufferLength, nreadPtr) => {
          try {
            const linkPath = this.scopedDirectoryTarget(process, context, Number(dirfd), readString(pathPtr, pathLength), "read");
            const target = this.os.fs.readlink(linkPath, "/", context.principal);
            const bytes = new TextEncoder().encode(target).slice(0, Number(bufferLength || 0));
            writeMemory(bufferPtr, bytes);
            writeU32(nreadPtr, bytes.length);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || errnoCodeFromMessage(error.message) || "EIO");
          }
        },
        path_link: (oldDirfd, oldFlags, oldPathPtr, oldPathLength, newDirfd, newPathPtr, newPathLength) => {
          void oldFlags;
          try {
            const source = this.scopedDirectoryTarget(process, context, Number(oldDirfd), readString(oldPathPtr, oldPathLength), "read");
            const destination = this.scopedDirectoryTarget(process, context, Number(newDirfd), readString(newPathPtr, newPathLength));
            this.os.fs.createHardLink(source, destination, "/", context.principal);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || errnoCodeFromMessage(error.message) || "EIO");
          }
        },
        path_filestat_get: (dirfd, flags, pathPtr, pathLength, resultPtr) => {
          try {
            const target = this.scopedDirectoryTarget(process, context, Number(dirfd), readString(pathPtr, pathLength), "read");
            const stat = Number(flags || 0) & 1
              ? this.os.fs.stat(target, "/", context.principal)
              : this.os.fs.lstat(target, "/", context.principal);
            if (!stat) return errnoNumber("ENOENT");
            writeFilestat(resultPtr, stat, target);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || errnoCodeFromMessage(error.message) || "EIO");
          }
        },
        path_open: (dirfd, dirflags, pathPtr, pathLength, oflags, rightsBase, rightsInheriting, fdflags, openedFdPtr) => {
          void dirflags;
          try {
            const path = readString(pathPtr, pathLength);
            const options = wasiOpenOptions(Number(oflags || 0), BigInt(rightsBase || 0), BigInt(rightsInheriting || 0), Number(fdflags || 0));
            const descriptor = this.os.descriptors.openAt(process, Number(dirfd), path, {
              flags: options.flags,
              rights: options.rights,
              wasi: options.wasi,
            }, context);
            writeU32(openedFdPtr, descriptor.fd);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        fd_prestat_get: (fd, resultPtr) => {
          try {
            const descriptor = this.os.descriptors.stat(process, { fd }, context);
            if (!descriptor.preopen) return errnoNumber("EBADF");
            writeU32(resultPtr, 0);
            writeU32(Number(resultPtr || 0) + 4, new TextEncoder().encode(descriptor.path).length);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        fd_prestat_dir_name: (fd, pathPtr, pathLength) => {
          try {
            const descriptor = this.os.descriptors.stat(process, { fd }, context);
            if (!descriptor.preopen) return errnoNumber("EBADF");
            const bytes = new TextEncoder().encode(descriptor.path).slice(0, Number(pathLength || 0));
            writeMemory(pathPtr, bytes);
            return 0;
          } catch (error) {
            return errnoNumber(error.code || "EIO");
          }
        },
        proc_exit: (code) => {
          throw new WasmExit(code);
        },
        random_get: (ptr, length) => {
          const bytes = readMemory(ptr, length);
          if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
          else {
            for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
          }
          return 0;
        },
        clock_time_get: (id, precision, resultPtr) => {
          void id;
          void precision;
          writeU64(resultPtr, BigInt(Date.now()) * 1_000_000n);
          return 0;
        },
      },
    };
    let status = 0;
    try {
      const compiled = await WebAssembly.instantiate(toUint8Array(bytes), imports);
      instance = compiled.instance || compiled;
      assertWasmMemoryLimit(instance, options.maxMemoryPages);
      const start = instance.exports?._start || instance.exports?.main;
      if (typeof start !== "function") throw new Error("wasm: module must export _start or main");
      const returned = start();
      if (Number.isFinite(returned)) status = Number(returned);
      this.os.processes.markReady(process.pid);
      this.os.processes.log(process.pid, `wasm exit ${status}`);
    } catch (error) {
      if (error instanceof WasmExit) {
        status = error.code;
        this.os.processes.markReady(process.pid);
        this.os.processes.log(process.pid, `wasm exit ${status}`);
      } else {
        status = 1;
        crashed = true;
        descriptorOutput = this.os.descriptors?.standardStreams?.(process.pid) || descriptorOutput;
        stderr.push(error.message || String(error));
        this.os.processes.crash(process.pid, error);
        crashReportPath = process.crashReportPath || "";
      }
    } finally {
      descriptorOutput = this.os.descriptors?.standardStreams?.(process.pid) || descriptorOutput;
      if (this.os.processes.get(process.pid)) this.os.processes.kill(process.pid, status === 0 ? "exited" : `exited-${status}`);
    }
    return {
      pid: process.pid,
      path: options.path || "",
      argv: [...(options.argv || [])],
      env,
      stdout: `${stdout.join("")}${descriptorOutput.stdout}`,
      stderr: `${stderr.join("")}${descriptorOutput.stderr}`,
      status,
      crashed,
      crashReportPath,
    };
  }

  processApp(options = {}) {
    const basename = this.os.fs.basename(options.path || "wasm");
    const cwd = options.cwd || this.os.session.home || "/";
    const manifest = options.manifest || {};
    const fileSystem = manifest.fileSystem || {};
    const optionFileSystem = options.fileSystem || {};
    const readScopes = scopedList(fileSystem.read, optionFileSystem.read, [cwd, options.path || ""]);
    const writeScopes = scopedList(fileSystem.write, optionFileSystem.write, [cwd]);
    return {
      id: options.appId || `wasm:${basename}`,
      name: options.name || basename,
      manifest: {
        version: manifest.version || "0.1.0",
        entry: manifest.entry || options.path || "wasm",
        capabilities: unique([...(manifest.capabilities || []), ...(options.capabilities || []), "process.read"]),
        fileSystem: {
          read: readScopes,
          write: writeScopes,
        },
      },
    };
  }

  environment(options, process) {
    return {
      USER: this.os.session.user || "guest",
      HOME: this.os.session.home || "/home/guest",
      SHELL: "/bin/dindbsh",
      PATH: "/bin:/usr/bin",
      PWD: options.cwd || process.cwd || this.os.session.home || "/",
      WASM_FILE: options.path || "",
    };
  }

  assertFileSystem(path, access, process) {
    if (access === "read" && process.manifest.fileSystem.read.some((scope) => path === scope || path.startsWith(`${scope}/`))) return;
    if (access === "write" && process.manifest.fileSystem.write.some((scope) => path === scope || path.startsWith(`${scope}/`))) return;
    throw new Error(`wasm: ${access}: ${path}: sandbox denied`);
  }

  assertCapability(capability, process) {
    if ((process.manifest.capabilities || []).includes(capability)) return;
    throw new Error(`wasm: capability denied: ${capability}`);
  }

  scopedDirectoryTarget(process, context, dirfd, path, access = "write") {
    const directory = this.os.descriptors.stat(process, { fd: dirfd }, context);
    if (directory.kind !== "directory") {
      const error = new Error(`wasi: fd ${dirfd}: descriptor is not a directory`);
      error.code = "ENOTDIR";
      throw error;
    }
    const target = this.os.fs.normalize(path, directory.path);
    context.assertFileSystem(target, access);
    return target;
  }
}

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  return new Uint8Array(bytes || []);
}

function assertWasmMemoryLimit(instance, maxMemoryPages) {
  const limit = Number(maxMemoryPages);
  if (!Number.isFinite(limit) || limit < 0) return;
  const memory = instance?.exports?.memory;
  if (!memory?.buffer) return;
  const pages = Math.ceil(memory.buffer.byteLength / 65536);
  if (pages <= limit) return;
  const error = new Error(`wasm: memory pages ${pages} exceed limit ${limit}`);
  error.code = "ENOMEM";
  throw error;
}

function abortReason(options = {}) {
  const reason = options.abortReason || options.abortSignal?.reason || "";
  return reason ? `: ${String(reason)}` : "";
}

function scopedList(manifestScopes, optionScopes, fallback) {
  if (Array.isArray(manifestScopes) || Array.isArray(optionScopes)) {
    return unique([...(manifestScopes || []), ...(optionScopes || [])]);
  }
  return unique(fallback);
}

function parseSyscallRequest(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.name) throw new Error("missing name");
    return parsed;
  } catch (error) {
    throw new Error(`wasm: invalid syscall request: ${error.message}`);
  }
}

function errnoNumber(code) {
  const values = { EINVAL: 22, ENOSYS: 38, ENOENT: 2, ESRCH: 3, EACCES: 13, EBADF: 8, EEXIST: 20, EISDIR: 31, ELOOP: 62, ENOTDIR: 54, EIO: 5 };
  return values[code] || 1;
}

function errnoCodeFromMessage(message = "") {
  const text = String(message || "");
  if (text.includes("permission denied") || text.includes("sandbox denied")) return "EACCES";
  if (text.includes("no such file or directory") || text.includes("File not found")) return "ENOENT";
  if (text.includes("file exists")) return "EEXIST";
  if (text.includes("is a directory")) return "EISDIR";
  if (text.includes("not a directory")) return "ENOTDIR";
  if (text.includes("not a regular file")) return "EINVAL";
  if (text.includes("Too many symbolic links")) return "ELOOP";
  if (text.includes("symbolic link")) return "EINVAL";
  return "";
}

const WASI_RIGHT_FD_READ = 1n << 1n;
const WASI_RIGHT_FD_WRITE = 1n << 6n;

function wasiOpenOptions(oflags, rightsBase, rightsInheriting, fdflags) {
  const rightsProvided = rightsBase !== 0n || rightsInheriting !== 0n;
  const inferred = inferredWasiRights(oflags, fdflags);
  const rights = rightsProvided
    ? {
      read: Boolean(rightsBase & WASI_RIGHT_FD_READ),
      write: Boolean(rightsBase & WASI_RIGHT_FD_WRITE),
    }
    : inferred;
  return {
    flags: wasiOpenFlags(oflags, fdflags, rights),
    rights,
    wasi: {
      oflags,
      fdflags,
      rightsBase: rightsBase.toString(),
      rightsInheriting: rightsInheriting.toString(),
    },
  };
}

function inferredWasiRights(oflags, fdflags) {
  const create = Boolean(oflags & 1);
  const truncate = Boolean(oflags & 8);
  const append = Boolean(fdflags & 1);
  if (create || truncate || append) return { read: true, write: true };
  return { read: true, write: false };
}

function wasiOpenFlags(oflags, fdflags, rights) {
  const create = Boolean(oflags & 1);
  const truncate = Boolean(oflags & 8);
  const append = Boolean(fdflags & 1);
  if (append) return rights.read ? "a+" : "a";
  if (create || truncate) return rights.read ? "w+" : "w";
  if (rights.write && !rights.read) throw wasiError("EINVAL", "wasi path_open: write-only descriptors require create, truncate, or append flags");
  return "r";
}

function wasiError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function wasiFileType(type) {
  if (type === "directory") return 3;
  if (type === "file") return 4;
  if (type === "stream" || type === "device") return 2;
  if (type === "pipe") return 6;
  if (type === "link") return 7;
  return 0;
}

function wasiFdFlags(descriptor = {}) {
  let flags = 0;
  if (descriptor.append || String(descriptor.flags || "").includes("a")) flags |= 1;
  return flags;
}

function stableInode(path = "") {
  let hash = 2166136261;
  for (const char of String(path || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return BigInt(hash >>> 0);
}

function cStringBytes(values) {
  return values.reduce((total, value) => total + new TextEncoder().encode(`${value}\0`).length, 0);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
