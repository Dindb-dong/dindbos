const STDIN_FD = 0;
const STDOUT_FD = 1;
const STDERR_FD = 2;
const DEFAULT_READ_SIZE = 4096;
let nextPipeId = 1;

export class DescriptorManager {
  constructor(os) {
    this.os = os;
    this.tables = new Map();
    this.pipes = new Map();
  }

  initProcess(process, options = {}) {
    const table = {
      nextFd: 3,
      descriptors: new Map(),
    };
    const pty = this.os.pty?.getSession?.(options.ptySessionId);
    const ptyInput = pty ? this.os.pty?.peekInput?.(pty.id) : "";
    table.descriptors.set(STDIN_FD, streamDescriptor(STDIN_FD, "stdin", "stdin", { readable: true, buffer: String(options.stdin || ptyInput || ""), tty: pty }));
    table.descriptors.set(STDOUT_FD, streamDescriptor(STDOUT_FD, "stdout", "stdout", { writable: true, tty: pty }));
    table.descriptors.set(STDERR_FD, streamDescriptor(STDERR_FD, "stderr", "stderr", { writable: true, tty: pty }));
    this.tables.set(Number(process.pid), table);
    table.descriptors.forEach((descriptor) => this.registerDescriptorObject(process, descriptor));
    (options.preopens || []).forEach((path) => this.preopen(process.pid, path));
    this.writeProcfs(process.pid);
    return this.list(process.pid);
  }

  closeProcess(pid, reason = "process-close") {
    const normalizedPid = Number(pid);
    const table = this.tables.get(normalizedPid);
    const pipeIds = table ? pipeIdsForTable(table) : [];
    if (table) {
      table.descriptors.forEach((descriptor) => this.revokeDescriptorObject(descriptor, reason));
    }
    this.tables.delete(normalizedPid);
    pipeIds.forEach((pipeId) => this.cleanupPipe(pipeId));
    const path = `/proc/${normalizedPid}/fd.json`;
    if (this.os.fs.exists(path)) {
      this.os.fs.remove(path, "/", {}, this.os.permissions.systemPrincipal());
    }
  }

  standardStreams(pid) {
    const table = this.tables.get(Number(pid));
    if (!table) return null;
    return {
      stdin: String(table.descriptors.get(STDIN_FD)?.buffer || ""),
      stdout: String(table.descriptors.get(STDOUT_FD)?.buffer || ""),
      stderr: String(table.descriptors.get(STDERR_FD)?.buffer || ""),
    };
  }

  list(pid) {
    const table = this.tableFor(pid);
    return [...table.descriptors.values()].map(publicDescriptor);
  }

  open(process, args = {}, context = {}) {
    const table = this.tableFor(process.pid);
    const path = normalizedPath(this.os, args.path, args.cwd || process.cwd);
    const flags = normalizeFlags(args.flags || "r");
    const descriptor = path.startsWith("/dev/")
      ? this.openDevice(path, flags, process)
      : this.openFile(path, flags, context);
    const fd = table.nextFd;
    table.nextFd += 1;
    descriptor.fd = fd;
    descriptor.rights = normalizeDescriptorRights(args.rights, descriptor);
    descriptor.wasi = args.wasi || null;
    table.descriptors.set(fd, descriptor);
    this.registerDescriptorObject(process, descriptor);
    this.writeProcfs(process.pid);
    return publicDescriptor(descriptor);
  }

  openAt(process, dirFd, path, args = {}, context = {}) {
    const directory = this.descriptorFor(process.pid, dirFd);
    this.assertDescriptorHandle(process, directory, ["list"]);
    if (directory.kind !== "directory") throw descriptorError("ENOTDIR", `fd.openAt: ${dirFd}: descriptor is not a directory`);
    return this.open(process, { ...args, path, cwd: directory.path }, context);
  }

  pipe(process, input = "") {
    const table = this.tableFor(process.pid);
    const pipe = { id: nextPipeId++, buffer: String(input || "") };
    this.pipes.set(pipe.id, pipe);
    const readFd = table.nextFd;
    const writeFd = table.nextFd + 1;
    table.nextFd += 2;
    const readDescriptor = pipeDescriptor(readFd, pipe, "read");
    const writeDescriptor = pipeDescriptor(writeFd, pipe, "write");
    table.descriptors.set(readFd, readDescriptor);
    table.descriptors.set(writeFd, writeDescriptor);
    this.registerDescriptorObject(process, readDescriptor);
    this.registerDescriptorObject(process, writeDescriptor);
    this.writeProcfs(process.pid);
    return { readFd, writeFd, pipeId: pipe.id };
  }

  attachPipe(process, args = {}) {
    const pipe = this.pipes.get(numberArg(args.pipeId, "pipeId"));
    if (!pipe) throw descriptorError("ENOENT", `fd.pipe: ${args.pipeId}: no such pipe`);
    const mode = String(args.mode || "read");
    if (!["read", "write"].includes(mode)) throw descriptorError("EINVAL", `fd.pipe: unsupported mode: ${mode}`);
    const table = this.tableFor(process.pid);
    const fd = table.nextFd;
    table.nextFd += 1;
    const descriptor = pipeDescriptor(fd, pipe, mode);
    table.descriptors.set(fd, descriptor);
    this.registerDescriptorObject(process, descriptor);
    this.writeProcfs(process.pid);
    return publicDescriptor(table.descriptors.get(fd));
  }

  cleanupPipe(pipeId) {
    const id = Number(pipeId);
    const active = [...this.tables.values()].some((table) => (
      [...table.descriptors.values()].some((descriptor) => descriptor.kind === "pipe" && Number(descriptor.pipe?.id) === id)
    ));
    if (!active) this.pipes.delete(id);
  }

  read(process, args = {}) {
    const descriptor = this.descriptorFor(process.pid, args.fd);
    if (!descriptor.readable) throw descriptorError("EBADF", `fd.read: ${descriptor.fd}: descriptor is not readable`);
    if (descriptor.rights && !descriptor.rights.read) throw descriptorError("EBADF", `fd.read: ${descriptor.fd}: descriptor lacks read rights`);
    this.assertDescriptorHandle(process, descriptor, ["read"]);
    const length = readLength(args.length);
    let data = "";
    if (descriptor.kind === "file") data = this.readFileDescriptor(descriptor, length);
    else if (descriptor.kind === "stream") data = readBufferedDescriptor(descriptor, length);
    else if (descriptor.kind === "device") {
      this.assertDeviceHandle(process, descriptor, ["read"]);
      data = this.readDeviceDescriptor(process, descriptor, length);
    }
    else if (descriptor.kind === "pipe") data = readPipeDescriptor(descriptor, length);
    else throw descriptorError("EINVAL", `fd.read: ${descriptor.fd}: unsupported descriptor kind`);
    const readBytes = Number.isFinite(descriptor.readBytes) ? descriptor.readBytes : byteLength(data);
    delete descriptor.readBytes;
    this.syncDescriptorObject(process, descriptor);
    this.writeProcfs(process.pid);
    return { fd: descriptor.fd, data, bytes: readBytes, offset: descriptor.offset || 0, eof: data.length < length };
  }

  write(process, args = {}, context = {}) {
    const descriptor = this.descriptorFor(process.pid, args.fd);
    if (!descriptor.writable) throw descriptorError("EBADF", `fd.write: ${descriptor.fd}: descriptor is not writable`);
    this.assertDescriptorHandle(process, descriptor, ["write"]);
    if (descriptor.rights && !descriptor.rights.write) throw descriptorError("EBADF", `fd.write: ${descriptor.fd}: descriptor lacks write rights`);
    const data = String(args.data ?? args.content ?? "");
    let bytes = 0;
    if (descriptor.kind === "file") bytes = this.writeFileDescriptor(descriptor, data, context);
    else if (descriptor.kind === "stream") {
      descriptor.buffer = `${descriptor.buffer || ""}${data}`;
      descriptor.offset = byteLength(descriptor.buffer);
      writePtyOutput(this.os, descriptor, data);
      bytes = byteLength(data);
    } else if (descriptor.kind === "device") {
      this.assertDeviceHandle(process, descriptor, ["write"]);
      bytes = this.writeDeviceDescriptor(process, descriptor, data);
    }
    else if (descriptor.kind === "pipe") {
      descriptor.pipe.buffer = `${descriptor.pipe.buffer || ""}${data}`;
      descriptor.offset = byteLength(descriptor.pipe.buffer);
      bytes = byteLength(data);
    }
    else throw descriptorError("EINVAL", `fd.write: ${descriptor.fd}: unsupported descriptor kind`);
    this.syncDescriptorObject(process, descriptor);
    this.writeProcfs(process.pid);
    return { fd: descriptor.fd, bytes, offset: descriptor.offset || 0 };
  }

  seek(process, args = {}) {
    const descriptor = this.descriptorFor(process.pid, args.fd);
    if (!["file", "stream"].includes(descriptor.kind)) throw descriptorError("ESPIPE", `fd.seek: ${descriptor.fd}: descriptor is not seekable`);
    this.assertDescriptorHandle(process, descriptor, ["seek"]);
    const offset = numberArg(args.offset, "offset");
    const whence = String(args.whence || "set");
    const size = descriptor.kind === "file" ? byteLength(safeRead(() => this.os.fs.readFile(descriptor.path, "/", descriptor.principal), "")) : byteLength(descriptor.buffer || "");
    if (whence === "set") descriptor.offset = offset;
    else if (whence === "cur") descriptor.offset = Number(descriptor.offset || 0) + offset;
    else if (whence === "end") descriptor.offset = size + offset;
    else throw descriptorError("EINVAL", `fd.seek: unsupported whence: ${whence}`);
    descriptor.offset = Math.max(0, descriptor.offset);
    this.syncDescriptorObject(process, descriptor);
    this.writeProcfs(process.pid);
    return { fd: descriptor.fd, offset: descriptor.offset };
  }

  stat(process, args = {}) {
    const descriptor = this.descriptorFor(process.pid, args.fd);
    this.assertDescriptorHandle(process, descriptor, ["stat"]);
    return publicDescriptor(descriptor);
  }

  async sync(process, args = {}) {
    const descriptor = this.descriptorFor(process.pid, args.fd);
    if (descriptor.kind !== "file") throw descriptorError("EINVAL", `fd.sync: ${descriptor.fd}: descriptor is not a file`);
    this.assertDescriptorHandle(process, descriptor, ["sync"]);
    const flush = typeof this.os.flushPersistentFileSystem === "function"
      ? await this.os.flushPersistentFileSystem()
      : await this.os.storage?.flush?.();
    return {
      fd: descriptor.fd,
      path: descriptor.path,
      synced: true,
      flush: flush || null,
    };
  }

  readDirectory(process, args = {}, context = {}) {
    const descriptor = this.descriptorFor(process.pid, args.fd);
    if (descriptor.kind !== "directory") throw descriptorError("ENOTDIR", `fd.readdir: ${descriptor.fd}: descriptor is not a directory`);
    this.assertDescriptorHandle(process, descriptor, ["list"]);
    assertFileSystem(descriptor.path, "list", context);
    const cookie = Math.max(0, numberArg(args.cookie || 0, "cookie"));
    const entries = this.os.fs.list(descriptor.path, "/", context.principal)
      .map((entry, index) => ({
        cookie: index + 1,
        name: entry.name,
        path: entry.path,
        type: entry.type,
      }))
      .filter((entry) => entry.cookie > cookie);
    return typeof context.filterDirectoryEntries === "function"
      ? context.filterDirectoryEntries(descriptor.path, entries)
      : entries;
  }

  ioctl(process, args = {}) {
    const descriptor = this.descriptorFor(process.pid, args.fd);
    const request = String(args.request || args.command || "").trim();
    if (!request) throw descriptorError("EINVAL", `fd.ioctl: ${descriptor.fd}: request is required`);
    if (!isTtyDescriptor(descriptor)) throw descriptorError("ENOTTY", `fd.ioctl: ${descriptor.fd}: descriptor is not a tty`);
    this.assertDescriptorHandle(process, descriptor, ["ioctl"]);
    if (descriptor.kind === "device") this.assertDeviceHandle(process, descriptor, ["ioctl"]);
    if (request === "tty.getWindowSize") {
      return {
        fd: descriptor.fd,
        request,
        path: descriptor.path,
        ...ttySize(descriptor),
      };
    }
    if (request === "tty.setWindowSize") {
      const size = ttySize({ tty: args });
      descriptor.tty = descriptor.tty ? { ...descriptor.tty, ...size } : size;
      if (descriptor.tty?.id) descriptor.tty = this.os.pty?.resizeSession?.(descriptor.tty.id, size) || descriptor.tty;
      this.syncDescriptorObject(process, descriptor);
      this.writeProcfs(process.pid);
      return {
        fd: descriptor.fd,
        request,
        path: descriptor.path,
        ...descriptor.tty,
      };
    }
    if (request === "tty.isatty") {
      return { fd: descriptor.fd, request, path: descriptor.path, tty: true };
    }
    throw descriptorError("EINVAL", `fd.ioctl: unsupported request: ${request}`);
  }

  close(process, args = {}) {
    const fd = fdArg(args.fd);
    if (fd < 3) throw descriptorError("EINVAL", `fd.close: ${fd}: cannot close standard descriptor yet`);
    const table = this.tableFor(process.pid);
    if (!table.descriptors.has(fd)) throw descriptorError("EBADF", `fd.close: ${fd}: bad descriptor`);
    if (table.descriptors.get(fd)?.preopen) throw descriptorError("EINVAL", `fd.close: ${fd}: cannot close preopen descriptor yet`);
    const descriptor = table.descriptors.get(fd);
    this.assertDescriptorHandle(process, descriptor, ["close"]);
    const pipeId = descriptor?.pipe?.id;
    this.revokeDescriptorObject(descriptor, "fd-close");
    table.descriptors.delete(fd);
    if (pipeId) this.cleanupPipe(pipeId);
    this.writeProcfs(process.pid);
    return { fd, closed: true };
  }

  preopen(pid, path) {
    const table = this.tableFor(pid);
    const normalized = this.os.fs.normalize(path || this.os.session?.home || "/");
    const fd = table.nextFd;
    table.nextFd += 1;
    const descriptor = {
      fd,
      kind: "directory",
      path: normalized,
      name: this.os.fs.basename(normalized) || "/",
      readable: true,
      writable: true,
      offset: 0,
      flags: "preopen",
      preopen: true,
    };
    table.descriptors.set(fd, descriptor);
    this.registerDescriptorObject(this.processFor(pid), descriptor);
    return fd;
  }

  registerDescriptorObject(process, descriptor) {
    if (!process || descriptor.objectId) return null;
    const object = this.os.objects?.register?.("descriptor", {
      ref: `pid:${process.pid}:fd:${descriptor.fd}`,
      name: `${process.pid}:${descriptor.fd}:${descriptor.kind}`,
      ownerPid: process.pid,
      namespace: process.manifest?.namespace || null,
      user: process.user || this.os.session?.user || "",
      rights: descriptorRightsList(descriptor),
      metadata: descriptorObjectMetadata(descriptor),
    }) || null;
    descriptor.objectId = object?.id || "";
    const handle = descriptor.objectId ? this.os.objects?.createHandle?.(descriptor.objectId, {
      ownerPid: process.pid,
      user: process.user || this.os.session?.user || "",
      uid: process.uid || 0,
      gid: process.gid || 0,
      groups: process.groups || [],
      namespace: process.manifest?.namespace || null,
      rights: descriptorRightsList(descriptor),
      closeOnExec: !descriptor.preopen,
      transferPolicy: descriptor.kind === "stream" ? "no-duplicate" : "duplicate",
      metadata: descriptorHandleMetadata(descriptor),
    }) : null;
    descriptor.handleId = handle?.id || "";
    this.registerDeviceKernelObject(process, descriptor);
    return object;
  }

  syncDescriptorObject(process, descriptor) {
    if (!descriptor?.objectId) return null;
    const object = this.os.objects?.update?.(descriptor.objectId, {
      name: `${process.pid}:${descriptor.fd}:${descriptor.kind}`,
      rights: descriptorRightsList(descriptor),
      metadata: descriptorObjectMetadata(descriptor),
    }) || null;
    if (descriptor.handleId) {
      this.os.objects?.updateHandle?.(descriptor.handleId, {
        rights: descriptorRightsList(descriptor),
        metadata: descriptorHandleMetadata(descriptor),
      });
    }
    this.syncDeviceKernelObject(process, descriptor);
    return object;
  }

  revokeDescriptorObject(descriptor, reason = "fd-close") {
    this.revokeDeviceKernelObject(descriptor, reason);
    if (!descriptor?.objectId) return null;
    return this.os.objects?.revoke?.(descriptor.objectId, reason) || null;
  }

  registerDeviceKernelObject(process, descriptor) {
    if (!process || descriptor?.kind !== "device" || descriptor.deviceObjectId) return null;
    const object = this.os.objects?.register?.("device", {
      ref: `device:${descriptor.path}:pid:${process.pid}:fd:${descriptor.fd}`,
      name: descriptor.path,
      ownerPid: process.pid,
      namespace: process.manifest?.namespace || null,
      user: process.user || this.os.session?.user || "",
      rights: deviceRightsList(descriptor),
      metadata: deviceObjectMetadata(descriptor),
    }) || null;
    descriptor.deviceObjectId = object?.id || "";
    const handle = descriptor.deviceObjectId ? this.os.objects?.createHandle?.(descriptor.deviceObjectId, {
      ownerPid: process.pid,
      user: process.user || this.os.session?.user || "",
      uid: process.uid || 0,
      gid: process.gid || 0,
      groups: process.groups || [],
      namespace: process.manifest?.namespace || null,
      rights: deviceRightsList(descriptor),
      closeOnExec: true,
      transferPolicy: "no-duplicate",
      metadata: deviceHandleMetadata(descriptor),
    }) : null;
    descriptor.deviceHandleId = handle?.id || "";
    return object;
  }

  syncDeviceKernelObject(process, descriptor) {
    if (descriptor?.kind !== "device" || !descriptor.deviceObjectId) return null;
    const object = this.os.objects?.update?.(descriptor.deviceObjectId, {
      name: descriptor.path,
      rights: deviceRightsList(descriptor),
      metadata: deviceObjectMetadata(descriptor),
    }) || null;
    if (descriptor.deviceHandleId) {
      this.os.objects?.updateHandle?.(descriptor.deviceHandleId, {
        rights: deviceRightsList(descriptor),
        metadata: deviceHandleMetadata(descriptor),
      });
    }
    return object;
  }

  revokeDeviceKernelObject(descriptor, reason = "fd-close") {
    if (descriptor?.kind !== "device" || !descriptor.deviceObjectId) return null;
    return this.os.objects?.revoke?.(descriptor.deviceObjectId, reason) || null;
  }

  processFor(pid) {
    return this.os.processes?.processes?.get(Number(pid)) || this.os.processes?.get?.(pid) || null;
  }

  assertDescriptorHandle(process, descriptor, rights = []) {
    if (!descriptor?.handleId) return null;
    try {
      return this.os.objects?.assertHandle?.(descriptor.handleId, {
        ownerPid: process.pid,
        objectType: "descriptor",
        rights,
      }) || null;
    } catch (error) {
      throw descriptorError(error.code || "EACCES", error.message);
    }
  }

  assertDeviceHandle(process, descriptor, rights = []) {
    if (descriptor?.kind !== "device" || !descriptor.deviceHandleId) return null;
    try {
      return this.os.objects?.assertHandle?.(descriptor.deviceHandleId, {
        ownerPid: process.pid,
        objectType: "device",
        rights,
      }) || null;
    } catch (error) {
      throw descriptorError(error.code || "EACCES", error.message);
    }
  }

  tableFor(pid) {
    const table = this.tables.get(Number(pid));
    if (!table) throw descriptorError("ESRCH", `fd: ${pid}: no descriptor table`);
    return table;
  }

  descriptorFor(pid, fdValue) {
    const fd = fdArg(fdValue);
    const descriptor = this.tableFor(pid).descriptors.get(fd);
    if (!descriptor) throw descriptorError("EBADF", `fd: ${fd}: bad descriptor`);
    return descriptor;
  }

  openFile(path, flags, context) {
    const access = flags.writable ? "write" : "read";
    assertFileSystem(path, access, context);
    if (flags.readable) assertFileSystem(path, "read", context);
    const exists = this.os.fs.exists(path, "/", context.principal);
    if (!exists && !flags.create) throw descriptorError("ENOENT", `fd.open: ${path}: no such file`);
    if (!exists) this.os.fs.writeOrCreateFile(path, "", "/", { mime: "text/plain" }, context.principal);
    if (flags.truncate) this.os.fs.writeOrCreateFile(path, "", "/", {}, context.principal);
    const size = byteLength(safeRead(() => this.os.fs.readFile(path, "/", context.principal), ""));
    return {
      kind: "file",
      path,
      readable: flags.readable,
      writable: flags.writable,
      append: flags.append,
      offset: flags.append ? size : 0,
      flags: flags.raw,
      principal: context.principal,
    };
  }

  openDevice(path, flags, process = {}) {
    if (!["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/tty", "/dev/clipboard"].includes(path)) {
      throw descriptorError("ENODEV", `fd.open: ${path}: no such device`);
    }
    return {
      kind: "device",
      path,
      readable: path !== "/dev/null" && flags.readable,
      writable: path === "/dev/clipboard" ? flags.writable : true,
      offset: 0,
      flags: flags.raw,
      tty: path === "/dev/tty" ? this.os.pty?.getSession?.(process.context?.ptySessionId) || null : null,
    };
  }

  readFileDescriptor(descriptor, length) {
    const content = this.os.fs.readFile(descriptor.path, "/", descriptor.principal);
    const offset = Number(descriptor.offset || 0);
    const data = content.slice(offset, offset + length);
    descriptor.offset = offset + data.length;
    return data;
  }

  writeFileDescriptor(descriptor, data, context) {
    assertFileSystem(descriptor.path, "write", context);
    const content = safeRead(() => this.os.fs.readFile(descriptor.path, "/", descriptor.principal), "");
    const offset = descriptor.append ? content.length : Number(descriptor.offset || 0);
    const next = `${content.slice(0, offset)}${data}${content.slice(offset + data.length)}`;
    reserveStorageBytes(this.os, byteLength(data), {
      scope: "fd-write",
      appId: context.process?.appId || context.appId || "",
      pid: context.process?.pid || context.pid || 0,
      path: descriptor.path,
      fd: descriptor.fd,
      operation: descriptor.append ? "append" : "write",
    });
    this.os.fs.writeOrCreateFile(descriptor.path, next, "/", {}, descriptor.principal);
    descriptor.offset = offset + data.length;
    return byteLength(data);
  }

  readDeviceDescriptor(process, descriptor, length) {
    if (descriptor.path === "/dev/clipboard") {
      const content = String(this.os.clipboard?.readText?.() ?? "");
      const offset = Number(descriptor.offset || 0);
      const data = content.slice(offset, offset + length);
      descriptor.offset = offset + data.length;
      descriptor.readBytes = byteLength(data);
      return data;
    }
    if (descriptor.path === "/dev/tty") {
      const stdin = this.descriptorFor(process.pid, STDIN_FD);
      const data = readBufferedDescriptor(stdin, length);
      descriptor.readBytes = byteLength(data);
      return data;
    }
    if (descriptor.path === "/dev/zero") {
      descriptor.readBytes = length;
      return "\0".repeat(length);
    }
    if (descriptor.path === "/dev/random" || descriptor.path === "/dev/urandom") {
      const bytes = new Uint8Array(length);
      if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
      else {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
      }
      descriptor.readBytes = bytes.length;
      return new TextDecoder("latin1").decode(bytes);
    }
    descriptor.readBytes = 0;
    return "";
  }

  writeDeviceDescriptor(process, descriptor, data) {
    if (descriptor.path === "/dev/clipboard") {
      const result = this.os.clipboard?.writeText?.(data) || { bytes: byteLength(data) };
      descriptor.offset = 0;
      return Number(result.bytes || byteLength(data));
    }
    if (descriptor.path === "/dev/tty") {
      const stdout = this.descriptorFor(process.pid, STDOUT_FD);
      stdout.buffer = `${stdout.buffer || ""}${data}`;
      stdout.offset = byteLength(stdout.buffer);
      writePtyOutput(this.os, descriptor, data);
      return byteLength(data);
    }
    if (descriptor.path === "/dev/null") return byteLength(data);
    return byteLength(data);
  }

  writeProcfs(pid) {
    const table = this.tables.get(Number(pid));
    if (!table || !this.os.fs.exists(`/proc/${pid}`)) return;
    this.os.fs.writeOrCreateFile(`/proc/${pid}/fd.json`, `${JSON.stringify(this.list(pid), null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, this.os.permissions.systemPrincipal());
    this.os.objects?.writeProcessHandlesProcfs?.(pid);
  }
}

function streamDescriptor(fd, name, path, options = {}) {
  return {
    fd,
    kind: "stream",
    path,
    name,
    readable: Boolean(options.readable),
    writable: Boolean(options.writable),
    offset: 0,
    buffer: options.buffer || "",
    flags: options.readable ? "r" : "w",
    tty: options.tty || null,
  };
}

function readBufferedDescriptor(descriptor, length) {
  const offset = Number(descriptor.offset || 0);
  const data = String(descriptor.buffer || "").slice(offset, offset + length);
  descriptor.offset = offset + data.length;
  return data;
}

function readPipeDescriptor(descriptor, length) {
  const offset = Number(descriptor.offset || 0);
  const data = String(descriptor.pipe?.buffer || "").slice(offset, offset + length);
  descriptor.offset = offset + data.length;
  return data;
}

function pipeDescriptor(fd, pipe, mode) {
  const readable = mode === "read";
  return {
    fd,
    kind: "pipe",
    path: `pipe:${pipe.id}:${mode}`,
    name: `pipe-${mode}`,
    readable,
    writable: !readable,
    offset: readable ? 0 : byteLength(pipe.buffer),
    flags: readable ? "r" : "w",
    pipe,
  };
}

function pipeIdsForTable(table) {
  return [...new Set([...table.descriptors.values()]
    .filter((descriptor) => descriptor.kind === "pipe" && descriptor.pipe?.id)
    .map((descriptor) => Number(descriptor.pipe.id)))];
}

function publicDescriptor(descriptor) {
  return {
    fd: descriptor.fd,
    objectId: descriptor.objectId || "",
    handleId: descriptor.handleId || "",
    deviceObjectId: descriptor.deviceObjectId || "",
    deviceHandleId: descriptor.deviceHandleId || "",
    kind: descriptor.kind,
    path: descriptor.path,
    name: descriptor.name || "",
    readable: Boolean(descriptor.readable),
    writable: Boolean(descriptor.writable),
    offset: Number(descriptor.offset || 0),
    flags: descriptor.flags || "",
    preopen: Boolean(descriptor.preopen),
    rights: descriptor.rights ? { ...descriptor.rights } : null,
    wasi: descriptor.wasi ? { ...descriptor.wasi } : null,
    tty: descriptor.tty ? { id: descriptor.tty.id || "", columns: descriptor.tty.columns || 80, rows: descriptor.tty.rows || 24 } : null,
  };
}

function descriptorRightsList(descriptor) {
  return [
    descriptorRightsAllow(descriptor, "read") ? "read" : "",
    descriptorRightsAllow(descriptor, "write") ? "write" : "",
    descriptor.kind === "directory" ? "list" : "",
    ["file", "stream"].includes(descriptor.kind) ? "seek" : "",
    descriptor.kind === "file" ? "sync" : "",
    "stat",
    descriptor.fd >= 3 && !descriptor.preopen ? "close" : "",
    isTtyDescriptor(descriptor) ? "ioctl" : "",
  ].filter(Boolean);
}

function descriptorRightsAllow(descriptor, right) {
  if (descriptor.rights) return Boolean(descriptor.rights[right]);
  if (right === "read") return Boolean(descriptor.readable);
  if (right === "write") return Boolean(descriptor.writable);
  return false;
}

function descriptorObjectMetadata(descriptor) {
  return {
    fd: descriptor.fd,
    kind: descriptor.kind,
    path: descriptor.path,
    name: descriptor.name || "",
    readable: Boolean(descriptor.readable),
    writable: Boolean(descriptor.writable),
    offset: Number(descriptor.offset || 0),
    flags: descriptor.flags || "",
    preopen: Boolean(descriptor.preopen),
    wasi: descriptor.wasi ? { ...descriptor.wasi } : null,
    tty: descriptor.tty ? { id: descriptor.tty.id || "", columns: descriptor.tty.columns || 80, rows: descriptor.tty.rows || 24 } : null,
    pipeId: descriptor.pipe?.id ? Number(descriptor.pipe.id) : 0,
  };
}

function descriptorHandleMetadata(descriptor) {
  return {
    fd: descriptor.fd,
    path: descriptor.path,
    kind: descriptor.kind,
    offset: Number(descriptor.offset || 0),
    objectId: descriptor.objectId || "",
    preopen: Boolean(descriptor.preopen),
  };
}

function deviceRightsList(descriptor) {
  return [
    "open",
    descriptorRightsAllow(descriptor, "read") ? "read" : "",
    descriptorRightsAllow(descriptor, "write") ? "write" : "",
    isTtyDescriptor(descriptor) ? "ioctl" : "",
    "stat",
    descriptor.fd >= 3 && !descriptor.preopen ? "close" : "",
  ].filter(Boolean);
}

function deviceObjectMetadata(descriptor) {
  return {
    fd: descriptor.fd,
    path: descriptor.path,
    readable: Boolean(descriptor.readable),
    writable: Boolean(descriptor.writable),
    offset: Number(descriptor.offset || 0),
    flags: descriptor.flags || "",
    tty: descriptor.tty ? { id: descriptor.tty.id || "", columns: descriptor.tty.columns || 80, rows: descriptor.tty.rows || 24 } : null,
    descriptorObjectId: descriptor.objectId || "",
  };
}

function deviceHandleMetadata(descriptor) {
  return {
    fd: descriptor.fd,
    path: descriptor.path,
    descriptorHandleId: descriptor.handleId || "",
    descriptorObjectId: descriptor.objectId || "",
  };
}

function writePtyOutput(os, descriptor, data) {
  if (descriptor.tty?.id) os.pty?.writeOutput?.(descriptor.tty.id, data);
}

function normalizeDescriptorRights(rights, descriptor) {
  if (!rights) return null;
  return {
    read: Boolean(rights.read) && Boolean(descriptor.readable),
    write: Boolean(rights.write) && Boolean(descriptor.writable),
  };
}

function isTtyDescriptor(descriptor) {
  return descriptor.path === "/dev/tty" || ["stdin", "stdout", "stderr"].includes(descriptor.path);
}

function ttySize(descriptor) {
  const source = descriptor.tty || {};
  return {
    columns: boundedInteger(source.columns, 80, 1, 1000),
    rows: boundedInteger(source.rows, 24, 1, 1000),
    pixelWidth: boundedInteger(source.pixelWidth, 0, 0, 100000),
    pixelHeight: boundedInteger(source.pixelHeight, 0, 0, 100000),
  };
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function normalizeFlags(value) {
  const raw = String(value || "r");
  if (!/^(r|r\+|w|w\+|a|a\+)$/.test(raw)) throw descriptorError("EINVAL", `fd.open: unsupported flags: ${raw}`);
  return {
    raw,
    readable: raw.includes("r") || raw.includes("+"),
    writable: raw.includes("w") || raw.includes("a") || raw.includes("+"),
    create: raw.includes("w") || raw.includes("a"),
    truncate: raw.includes("w"),
    append: raw.includes("a"),
  };
}

function normalizedPath(os, path, cwd) {
  const value = String(path || "");
  if (!value) throw descriptorError("EINVAL", "fd.open: path is required");
  return os.fs.normalize(value, cwd || os.session?.home || "/");
}

function assertFileSystem(path, access, context) {
  if (typeof context.assertFileSystem === "function") context.assertFileSystem(path, access);
}

function readLength(value) {
  if (value === undefined) return DEFAULT_READ_SIZE;
  const length = numberArg(value, "length");
  if (length < 0 || length > 1024 * 1024) throw descriptorError("EINVAL", "fd.read: length out of range");
  return length;
}

function fdArg(value) {
  const fd = numberArg(value, "fd");
  if (!Number.isInteger(fd) || fd < 0) throw descriptorError("EINVAL", `fd: invalid descriptor: ${value}`);
  return fd;
}

function numberArg(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw descriptorError("EINVAL", `fd: ${name} must be a number`);
  return number;
}

function descriptorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeRead(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

function reserveStorageBytes(os, bytes, details = {}) {
  if (typeof os.storage?.reserveStorageBytes !== "function") return;
  os.storage.reserveStorageBytes(bytes, details);
}
