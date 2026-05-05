class WasmExit extends Error {
  constructor(code = 0) {
    super(`wasm exited with status ${code}`);
    this.code = Number(code || 0);
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
      runtime: "wasm",
    });
    const stdout = [];
    const stderr = [];
    let instance = null;
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
    const readString = (ptr, length) => new TextDecoder().decode(readMemory(ptr, length));
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
        exit: (code) => {
          throw new WasmExit(code);
        },
      },
    };
    let status = 0;
    try {
      const compiled = await WebAssembly.instantiate(toUint8Array(bytes), imports);
      instance = compiled.instance || compiled;
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
        stderr.push(error.message || String(error));
        this.os.processes.crash(process.pid, error);
      }
    } finally {
      if (this.os.processes.get(process.pid)) this.os.processes.kill(process.pid, status === 0 ? "exited" : `exited-${status}`);
    }
    return {
      pid: process.pid,
      path: options.path || "",
      argv: [...(options.argv || [])],
      env,
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      status,
    };
  }

  processApp(options = {}) {
    const basename = this.os.fs.basename(options.path || "wasm");
    const cwd = options.cwd || this.os.session.home || "/";
    return {
      id: `wasm:${basename}`,
      name: basename,
      manifest: {
        version: "0.1.0",
        entry: options.path || "wasm",
        capabilities: ["process.read"],
        fileSystem: {
          read: unique([cwd, options.path || ""]),
          write: unique([cwd]),
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
}

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  return new Uint8Array(bytes || []);
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
  const values = { EINVAL: 22, ENOSYS: 38, ENOENT: 2, ESRCH: 3, EACCES: 13, EIO: 5 };
  return values[code] || 1;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
