export class DindbOSSDKError extends Error {
  constructor(result, syscall) {
    const error = result?.error || {};
    super(error.message || `sdk: ${syscall}: syscall failed`);
    this.name = "DindbOSSDKError";
    this.code = error.code || "EIO";
    this.syscall = error.syscall || syscall;
    this.result = result || null;
  }
}

export function createDindbOSSDK(target, options = {}) {
  const raw = syscallFunction(target);
  const invoke = (name, args = {}) => unwrap(raw(name, args), name);
  const rawAsync = syscallAsyncFunction(target, raw);
  const invokeAsync = async (name, args = {}) => unwrap(await rawAsync(name, args), name);
  const currentPid = () => Number(options.currentPid || target?.process?.pid || 0);

  return deepFreeze({
    syscall: {
      raw,
      call: invoke,
      rawAsync,
      callAsync: invokeAsync,
    },
    clock: {
      now: () => invoke("clock.now"),
    },
    entropy: {
      randomBytes: (length) => new Uint8Array(invoke("entropy.randomBytes", { length })),
    },
    fs: {
      exists: (path, args = {}) => invoke("fs.exists", { ...args, path }),
      stat: (path, args = {}) => invoke("fs.stat", { ...args, path }),
      readText: (path, args = {}) => invoke("fs.readText", { ...args, path }),
      writeText: (path, content, args = {}) => invoke("fs.writeText", { ...args, path, content }),
    },
    fd: {
      list: () => invoke("fd.list"),
      open: (path, args = {}) => invoke("fd.open", { ...args, path }),
      read: (fd, args = {}) => invoke("fd.read", { ...args, fd }),
      write: (fd, data, args = {}) => invoke("fd.write", { ...args, fd, data }),
      seek: (fd, offset, args = {}) => invoke("fd.seek", { ...args, fd, offset }),
      stat: (fd) => invoke("fd.stat", { fd }),
      sync: (fd) => invokeAsync("fd.sync", { fd }),
      ioctl: (fd, request, args = {}) => invoke("fd.ioctl", { ...args, fd, request }),
      close: (fd) => invoke("fd.close", { fd }),
    },
    env: {
      get: (key) => invoke("env.get", { key }),
      list: () => invoke("env.list"),
    },
    apps: {
      list: () => invoke("app.list"),
      manifest: (appId) => invoke("app.manifest", { appId }),
      launch: (appId, context = {}) => invoke("app.launch", { appId, context }),
    },
    packages: {
      list: () => invoke("package.list"),
      info: (packageId) => invoke("package.info", { packageId }),
    },
    storage: {
      status: () => invoke("storage.status"),
      sync: () => invokeAsync("storage.sync"),
    },
    localMounts: {
      status: () => invoke("localMount.status"),
    },
    processes: {
      current: () => {
        const pid = currentPid();
        if (!pid) throw new DindbOSSDKError({ error: { code: "EINVAL", message: "sdk: process.current requires a process context", syscall: "process.get" } }, "process.get");
        return invoke("process.get", { pid });
      },
      list: () => invoke("process.list"),
      get: (pid) => invoke("process.get", { pid }),
      log: (message, args = {}) => invoke("process.log", { ...args, message }),
    },
  });
}

function syscallFunction(target) {
  if (typeof target === "function") return target;
  if (typeof target?.syscall === "function") return (name, args = {}) => target.syscall(name, args);
  throw new Error("sdk: syscall function is required");
}

function syscallAsyncFunction(target, raw) {
  if (typeof target?.syscallAsync === "function") return (name, args = {}) => target.syscallAsync(name, args);
  return (name, args = {}) => Promise.resolve(raw(name, args));
}

function unwrap(result, syscall) {
  if (result?.ok) return result.value;
  throw new DindbOSSDKError(result, syscall);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}
