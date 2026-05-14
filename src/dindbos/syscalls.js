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

  async callAsync(name, args = {}, context = {}) {
    const syscall = String(name || "").trim();
    const startedAt = Date.now();
    try {
      if (!syscall) throw syscallError("EINVAL", "syscall: missing name");
      const value = await this.dispatchAsync(syscall, args || {}, context);
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
    if (name === "clipboard.read") return this.clipboardRead(context);
    if (name === "clipboard.write") return this.clipboardWrite(args, context);
    if (name === "privacy.ledger") return this.privacyLedger(args);
    if (name === "browser.status") return this.browserStatus();
    if (name === "browser.request") return this.browserRequest(args, context);
    if (name === "browser.revoke") return this.browserRevoke(args, context);
    if (name === "fs.exists") return this.fsExists(args, context);
    if (name === "fs.stat") return this.fsStat(args, context);
    if (name === "fs.readText") return this.fsReadText(args, context);
    if (name === "fs.writeText") return this.fsWriteText(args, context);
    if (name === "fd.list") return this.fdList(context);
    if (name === "fd.open") return this.fdOpen(args, context);
    if (name === "fd.read") return this.fdRead(args, context);
    if (name === "fd.write") return this.fdWrite(args, context);
    if (name === "fd.seek") return this.fdSeek(args, context);
    if (name === "fd.stat") return this.fdStat(args, context);
    if (name === "fd.sync") throw syscallError("EAGAIN", "syscall: fd.sync requires async syscall dispatch");
    if (name === "fd.ioctl") return this.fdIoctl(args, context);
    if (name === "fd.close") return this.fdClose(args, context);
    if (name === "env.get") return this.envGet(args, context);
    if (name === "env.list") return this.envList(context);
    if (name === "app.list") return this.appList();
    if (name === "app.manifest") return this.appManifest(args);
    if (name === "package.list") return this.packageList(context);
    if (name === "package.info") return this.packageInfo(args, context);
    if (name === "storage.status") return this.storageStatus(context);
    if (name === "storage.transactions") return this.storageTransactions(context);
    if (name === "storage.sync") throw syscallError("EAGAIN", "syscall: storage.sync requires async syscall dispatch");
    if (name === "timer.status") return this.timerStatus(args, context);
    if (name === "timer.create") return this.timerCreate(args, context);
    if (name === "timer.cancel") return this.timerCancel(args, context);
    if (name === "timer.sleep") throw syscallError("EAGAIN", "syscall: timer.sleep requires async syscall dispatch");
    if (name === "trustedPrompt.status") return this.trustedPromptStatus(args, context);
    if (name === "trustedPrompt.create") return this.trustedPromptCreate(args, context);
    if (name === "trustedPrompt.decide") return this.trustedPromptDecide(args, context);
    if (name === "localMount.status") return this.localMountStatus(context);
    if (name === "mount.list") return this.mountList(context);
    if (name === "mount.mount") return this.mount(args, context);
    if (name === "mount.unmount") return this.unmount(args, context);
    if (name === "net.status") return this.netStatus(context);
    if (name === "net.policy") return this.netPolicy(args, context);
    if (name === "net.dns") return this.netDns(args, context);
    if (name === "process.list") return this.processList(context);
    if (name === "process.get") return this.processGet(args, context);
    if (name === "process.log") return this.processLog(args, context);
    if (name === "app.launch") return this.appLaunch(args, context);
    throw syscallError("ENOSYS", `syscall: ${name}: not implemented`);
  }

  async dispatchAsync(name, args, context) {
    if (name === "fd.sync") return this.fdSync(args, context);
    if (name === "storage.sync") return this.storageSync(context);
    if (name === "timer.sleep") return this.timerSleep(args, context);
    return this.dispatch(name, args, context);
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

  clipboardRead(context) {
    const process = this.requireProcess(context);
    return this.os.readClipboard(process, { source: "syscall", target: "/dev/browser/clipboard" });
  }

  clipboardWrite(args, context) {
    const process = this.requireProcess(context);
    return this.os.writeClipboard(process, String(args.text ?? args.value ?? ""), { source: "syscall", target: "/dev/browser/clipboard" });
  }

  privacyLedger(args = {}) {
    return this.os.privacyLedgerStatus?.({
      capability: args.capability,
      pid: args.pid,
      limit: args.limit,
    }) || [];
  }

  browserStatus() {
    return this.os.browserBrokerStatus?.() || { capabilities: [] };
  }

  browserRequest(args, context) {
    const process = this.requireProcess(context);
    return this.os.requestBrowserAccess(process, String(args.capability || ""), {
      operation: args.operation,
      source: "syscall",
      target: args.target,
      bytes: args.bytes,
      expiresAt: args.expiresAt,
    });
  }

  browserRevoke(args, context) {
    const process = context.process || null;
    return this.os.revokeBrowserGrant(String(args.capability || ""), {
      process,
      pid: args.pid,
      appId: args.appId,
      principal: context.principal,
      reason: args.reason || "syscall",
    });
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
    reserveStorageBytes(this.os, byteLength(content), {
      scope: "syscall-fs-write",
      syscall: "fs.writeText",
      appId: context.process?.appId || context.appId || "",
      pid: context.process?.pid || context.pid || 0,
      path,
      operation: "writeText",
    });
    this.os.fs.writeOrCreateFile(path, content, "/", args.options || {}, context.principal);
    return { path, bytes: byteLength(content) };
  }

  fdList(context) {
    return this.os.descriptors.list(this.requireProcess(context).pid);
  }

  fdOpen(args, context) {
    const process = this.requireProcess(context);
    const path = this.normalizedPath(args, context);
    const flags = String(args.flags || "r");
    if (!path.startsWith("/dev/")) {
      if (flags.includes("r") || flags.includes("+")) this.assertFileSystem(path, "read", context);
      if (flags.includes("w") || flags.includes("a") || flags.includes("+")) this.assertFileSystem(path, "write", context);
    }
    return this.os.descriptors.open(process, { ...args, path }, context);
  }

  fdRead(args, context) {
    return this.os.descriptors.read(this.requireProcess(context), args, context);
  }

  fdWrite(args, context) {
    return this.os.descriptors.write(this.requireProcess(context), args, context);
  }

  fdSeek(args, context) {
    return this.os.descriptors.seek(this.requireProcess(context), args, context);
  }

  fdStat(args, context) {
    return this.os.descriptors.stat(this.requireProcess(context), args, context);
  }

  fdSync(args, context) {
    return this.os.descriptors.sync(this.requireProcess(context), args, context);
  }

  fdIoctl(args, context) {
    return this.os.descriptors.ioctl(this.requireProcess(context), args, context);
  }

  fdClose(args, context) {
    return this.os.descriptors.close(this.requireProcess(context), args, context);
  }

  envGet(args, context) {
    const key = String(args.key || "").trim();
    if (!key) throw syscallError("EINVAL", "syscall: env.get needs key");
    return this.environment(context)[key] ?? "";
  }

  envList(context) {
    return this.environment(context);
  }

  environment(context) {
    return Object.freeze({
      USER: context.env?.USER || this.os.session?.user || "guest",
      HOME: context.env?.HOME || this.os.session?.home || "/home/guest",
      SHELL: context.env?.SHELL || "/bin/dindbsh",
      PATH: context.env?.PATH || "/bin:/usr/bin",
      PWD: context.env?.PWD || context.process?.cwd || this.os.session?.home || "/",
    });
  }

  appList() {
    return this.os.apps.list().map((app) => ({
      id: app.id,
      name: app.name,
      icon: app.icon,
      pinned: Boolean(app.pinned),
      accepts: [...(app.accepts || [])],
    }));
  }

  appManifest(args) {
    const appId = String(args.appId || "").trim();
    if (!appId) throw syscallError("EINVAL", "syscall: app.manifest needs appId");
    const manifest = this.os.apps.getManifest(appId);
    if (!manifest) throw syscallError("ENOENT", `syscall: app.manifest: ${appId}: no such app`);
    return manifest;
  }

  packageList(context) {
    this.assertCapability("package.read", context);
    return this.os.packages.list().map((record) => packageSummary(record));
  }

  packageInfo(args, context) {
    const packageId = String(args.packageId || args.id || "").trim();
    if (!packageId) throw syscallError("EINVAL", "syscall: package.info needs packageId");
    this.assertCapability("package.read", context);
    const record = this.os.packages.info(packageId);
    if (!record) throw syscallError("ENOENT", `syscall: package.info: ${packageId}: package not installed`);
    return packageSummary(record, true);
  }

  storageStatus(context) {
    this.assertCapability("storage.read", context);
    return {
      ...safeRead(() => this.os.storage.status(), {}),
      ...safeRead(() => this.os.persistenceStatus?.(), {}),
      bucketPolicy: safeRead(() => this.os.storageBucketPolicy?.(), null),
    };
  }

  storageTransactions(context) {
    this.assertCapability("storage.read", context);
    return this.os.storageTransactions?.status?.() || [];
  }

  async storageSync(context) {
    this.assertCapability("storage.read", context);
    const flush = typeof this.os.flushPersistentFileSystem === "function"
      ? await this.os.flushPersistentFileSystem()
      : await this.os.storage.flush?.();
    return {
      synced: true,
      flush: flush || null,
      ...safeRead(() => this.os.storage.status(), {}),
      ...safeRead(() => this.os.persistenceStatus?.(), {}),
      bucketPolicy: safeRead(() => this.os.storageBucketPolicy?.(), null),
    };
  }

  timerStatus(args, context) {
    const process = context.process || null;
    const pid = args.pid === undefined ? undefined : numberArg(args.pid, "pid");
    if (pid !== undefined && (!process || Number(process.pid) !== pid)) this.assertCapability("process.read", context);
    return this.os.timers.status(pid === undefined ? {} : { ownerPid: pid });
  }

  timerCreate(args, context) {
    return this.os.timers.create(this.requireProcess(context), args);
  }

  timerCancel(args, context) {
    const id = String(args.id || args.timerId || args.handleId || "").trim();
    if (!id) throw syscallError("EINVAL", "syscall: timer.cancel needs id or handleId");
    return this.os.timers.cancel(id, this.requireProcess(context), { reason: "timer-cancel-syscall" });
  }

  async timerSleep(args, context) {
    return this.os.timers.sleep(this.requireProcess(context), args);
  }

  trustedPromptStatus(args, context) {
    const process = context.process || null;
    const pid = args.pid === undefined ? undefined : numberArg(args.pid, "pid");
    if (pid !== undefined && (!process || Number(process.pid) !== pid)) this.assertCapability("process.read", context);
    return this.os.trustedPrompts.status(pid === undefined ? {} : { ownerPid: pid });
  }

  trustedPromptCreate(args, context) {
    return this.os.trustedPrompts.create(this.requireProcess(context), args);
  }

  trustedPromptDecide(args, context) {
    const id = String(args.id || args.promptId || "").trim();
    if (!id) throw syscallError("EINVAL", "syscall: trustedPrompt.decide needs id");
    return this.os.trustedPrompts.decide(id, args.decision || args.action, context);
  }

  localMountStatus(context) {
    this.assertCapability("localMount.read", context);
    const mounts = safeRead(() => this.os.localMounts.listMounts?.(), []);
    return {
      supported: Boolean(safeRead(() => this.os.localMounts.supported?.(), false)),
      mounted: Array.isArray(mounts) ? mounts : [],
      helper: safeRead(() => this.os.localMounts.nativeHelperStatus?.(), { status: "unavailable" }),
      copyPolicy: safeRead(() => this.os.localMounts.copyPolicy?.(), null),
    };
  }

  mountList(context) {
    this.assertCapability("mount.read", context);
    return safeRead(() => this.os.mountTable?.(), []);
  }

  mount(args, context) {
    this.assertCapability("mount.manage", context);
    const path = this.normalizedPath(args, context);
    return this.os.mountVirtual(path, {
      driver: args.driver || args.type || "memfs",
      readonly: Boolean(args.readonly),
      lower: args.lower,
      upper: args.upper,
      archive: args.archive,
      source: args.source || "syscall",
    }, context.principal);
  }

  unmount(args, context) {
    this.assertCapability("mount.manage", context);
    const path = this.normalizedPath(args, context);
    return this.os.unmountVirtual(path, context.principal);
  }

  netStatus(context) {
    this.assertCapability("net.fetch", context);
    return this.os.network.status();
  }

  netPolicy(args, context) {
    const url = String(args.url || "");
    if (!url) throw syscallError("EINVAL", "syscall: net.policy needs url");
    return this.os.network.policyProbe(url, context, args.capability || "net.fetch");
  }

  netDns(args, context) {
    const host = String(args.host || args.url || "");
    if (!host) throw syscallError("EINVAL", "syscall: net.dns needs host");
    return this.os.network.dnsProbe(host, context);
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

  requireProcess(context) {
    if (context.process?.pid) return context.process;
    throw syscallError("EINVAL", "syscall: descriptor operations require a process context");
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
  if (text.includes("permission denied") || text.includes("sandbox denied") || text.includes("capability denied") || text.includes("administrator required")) return "EACCES";
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

function packageSummary(record, detailed = false) {
  const summary = {
    id: record.id,
    name: record.name,
    version: record.version,
    description: record.description || "",
    installPath: record.installPath || "",
    sourcePath: record.sourcePath || "",
    compatibility: record.compatibility || { tier: "A", status: "supported" },
  };
  if (!detailed) return summary;
  return {
    ...summary,
    app: record.app ? {
      id: record.app.id,
      title: record.app.title,
      entry: record.app.entry,
      entryPath: record.app.entryPath,
      runtime: record.app.runtime || "javascript",
      capabilities: [...(record.app.capabilities || [])],
      fileSystem: {
        read: [...(record.app.fileSystem?.read || [])],
        write: [...(record.app.fileSystem?.write || [])],
      },
    } : null,
    trust: record.trust || {},
    dependencies: record.dependencies || {},
  };
}

function ensureDirectory(os, path, principal) {
  if (!os.fs.exists(path)) os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, principal);
}

function safeRead(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function byteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function reserveStorageBytes(os, bytes, details = {}) {
  if (typeof os.storage?.reserveStorageBytes !== "function") return;
  os.storage.reserveStorageBytes(bytes, details);
}
