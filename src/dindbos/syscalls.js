const MAX_ENTROPY_BYTES = 1024;

export class SyscallDispatcher {
  constructor(os) {
    this.os = os;
    this.traces = new Map();
  }

  call(name, args = {}, context = {}) {
    const syscall = String(name || "").trim();
    const startedAt = Date.now();
    try {
      if (!syscall) throw syscallError("EINVAL", "syscall: missing name");
      const value = this.dispatch(syscall, args || {}, context);
      const result = { ok: true, value };
      this.trace(syscall, args, result, context, startedAt);
      return result;
    } catch (error) {
      const result = {
        ok: false,
        error: {
          code: error.code || errnoForError(error),
          message: error.message || String(error),
          syscall,
        },
      };
      this.trace(syscall || "unknown", args, result, context, startedAt);
      return result;
    }
  }

  dispatch(name, args, context) {
    if (name === "clock.now") return { iso: new Date().toISOString(), ms: Date.now() };
    if (name === "entropy.randomBytes") return this.randomBytes(args);
    if (name === "fs.exists") return this.fsExists(args, context);
    if (name === "fs.stat") return this.fsStat(args, context);
    if (name === "fs.readText") return this.fsReadText(args, context);
    if (name === "fs.writeText") return this.fsWriteText(args, context);
    if (name === "process.list") return this.processList(context);
    if (name === "process.get") return this.processGet(args, context);
    if (name === "process.log") return this.processLog(args, context);
    if (name === "app.launch") return this.appLaunch(args, context);
    throw syscallError("ENOSYS", `syscall: ${name}: not implemented`);
  }

  randomBytes(args) {
    const length = numberArg(args.length, "length");
    if (length < 0 || length > MAX_ENTROPY_BYTES) throw syscallError("EINVAL", `syscall: entropy.randomBytes length must be 0-${MAX_ENTROPY_BYTES}`);
    const bytes = new Uint8Array(length);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    return [...bytes];
  }

  fsExists(args, context) {
    const path = this.normalizedPath(args, context);
    this.assertFileSystem(path, "read", context);
    return this.os.fs.exists(path, "/", context.principal);
  }

  fsStat(args, context) {
    const path = this.normalizedPath(args, context);
    this.assertFileSystem(path, "read", context);
    const stat = this.os.fs.stat(path, "/", context.principal);
    if (!stat) throw syscallError("ENOENT", `syscall: fs.stat: ${path}: no such file or directory`);
    return stat;
  }

  fsReadText(args, context) {
    const path = this.normalizedPath(args, context);
    this.assertFileSystem(path, "read", context);
    return this.os.fs.readFile(path, "/", context.principal);
  }

  fsWriteText(args, context) {
    const path = this.normalizedPath(args, context);
    this.assertFileSystem(path, "write", context);
    const content = String(args.content ?? "");
    this.os.fs.writeOrCreateFile(path, content, "/", args.options || {}, context.principal);
    return { path, bytes: byteLength(content) };
  }

  processList(context) {
    this.assertCapability("process.read", context);
    return this.os.processes.list();
  }

  processGet(args, context) {
    const pid = numberArg(args.pid, "pid");
    if (!context.process || Number(context.process.pid) !== pid) this.assertCapability("process.read", context);
    const process = this.os.processes.get(pid);
    if (!process) throw syscallError("ESRCH", `syscall: process.get: ${pid}: no such process`);
    return process;
  }

  processLog(args, context) {
    const process = context.process || null;
    const pid = args.pid === undefined ? Number(process?.pid || 0) : numberArg(args.pid, "pid");
    if (!pid) throw syscallError("EINVAL", "syscall: process.log needs pid or current process");
    if (!process || Number(process.pid) !== pid) this.assertCapability("process.manage", context);
    this.os.processes.log(pid, String(args.message || ""), args.level || "info");
    return { pid, logged: true };
  }

  appLaunch(args, context) {
    const appId = String(args.appId || "").trim();
    if (!appId) throw syscallError("EINVAL", "syscall: app.launch needs appId");
    this.assertCapability("app.launch", context);
    const window = this.os.launch(appId, { ...(args.context || {}), parentPid: context.process?.pid || 0 });
    return { appId, pid: window?.pid || 0, windowId: window?.id || "" };
  }

  normalizedPath(args, context) {
    const path = String(args.path || "");
    if (!path) throw syscallError("EINVAL", "syscall: path is required");
    return this.os.fs.normalize(path, args.cwd || context.process?.cwd || this.os.session?.home || "/");
  }

  assertCapability(capability, context) {
    if (typeof context.assertCapability === "function") context.assertCapability(capability);
  }

  assertFileSystem(path, access, context) {
    if (typeof context.assertFileSystem === "function") context.assertFileSystem(path, access);
  }

  trace(name, args, result, context, startedAt) {
    const pid = Number(context.process?.pid || 0);
    const entry = {
      at: new Date().toISOString(),
      pid,
      appId: context.process?.appId || "",
      name,
      ok: Boolean(result.ok),
      code: result.ok ? "OK" : result.error?.code || "EIO",
      durationMs: Date.now() - startedAt,
      args: sanitizeArgs(args),
    };
    if (pid) {
      const entries = this.traces.get(pid) || [];
      entries.push(entry);
      this.traces.set(pid, entries.slice(-200));
      this.writeProcessTrace(pid);
    }
    this.writeGlobalTrace(entry);
  }

  writeProcessTrace(pid) {
    const entries = this.traces.get(Number(pid)) || [];
    if (!entries.length || !this.os.fs.exists(`/proc/${pid}`)) return;
    this.os.fs.writeOrCreateFile(`/proc/${pid}/syscalls`, `${entries.map(formatTrace).join("\n")}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, this.os.permissions.systemPrincipal());
  }

  writeGlobalTrace(entry) {
    const system = this.os.permissions.systemPrincipal();
    ensureDirectory(this.os, "/var", system);
    ensureDirectory(this.os, "/var/log", system);
    ensureDirectory(this.os, "/var/log/dindbos", system);
    const line = `${formatTrace(entry)}\n`;
    const path = "/var/log/dindbos/syscall.log";
    if (this.os.fs.exists(path)) this.os.fs.appendFile(path, line, "/", system);
    else this.os.fs.writeOrCreateFile(path, line, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }
}

function syscallError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errnoForError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  if (text.includes("permission denied") || text.includes("sandbox denied") || text.includes("capability denied")) return "EACCES";
  if (text.includes("no such process")) return "ESRCH";
  if (text.includes("not found") || text.includes("no such")) return "ENOENT";
  if (text.includes("invalid") || text.includes("missing")) return "EINVAL";
  return "EIO";
}

function numberArg(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw syscallError("EINVAL", `syscall: ${name} must be a number`);
  return number;
}

function sanitizeArgs(args = {}) {
  const clone = {};
  Object.entries(args || {}).forEach(([key, value]) => {
    if (key.toLowerCase().includes("secret") || key.toLowerCase().includes("token")) clone[key] = "[redacted]";
    else if (typeof value === "string" && value.length > 120) clone[key] = `${value.slice(0, 120)}...`;
    else clone[key] = value;
  });
  return clone;
}

function formatTrace(entry) {
  return `${entry.at} pid=${entry.pid || "-"} app=${entry.appId || "-"} ${entry.name} ${entry.code} ${entry.durationMs}ms`;
}

function ensureDirectory(os, path, principal) {
  if (!os.fs.exists(path)) os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, principal);
}

function byteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}
