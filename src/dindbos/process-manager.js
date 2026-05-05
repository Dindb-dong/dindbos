export class ProcessManager {
  constructor(os) {
    this.os = os;
    this.nextPid = 100;
    this.processes = new Map();
    this.logs = new Map();
    this.history = [];
    this.bootedAt = new Date().toISOString();
  }

  spawn(app, context = {}) {
    const now = new Date().toISOString();
    const parentPid = normalizePid(context.parentPid);
    const parent = parentPid ? this.processes.get(parentPid) : null;
    const manifest = {
      ...(app.manifest || {}),
      namespace: cloneJson(context.namespace || app.manifest?.namespace || parent?.manifest?.namespace || null),
    };
    const process = {
      pid: this.nextPid++,
      parentPid,
      parentAppId: parent?.appId || "",
      appId: app.id,
      name: app.name || app.id,
      state: "running",
      user: this.os.session.user || "guest",
      cwd: context.cwd || this.os.session.home || "/",
      manifest,
      context,
      runtime: context.runtime || app.manifest?.runtime || "javascript",
      executionBackend: context.executionBackend || "main-thread",
      executorState: context.executorState || "attached",
      executorKind: context.executorKind || "",
      executorDetail: context.executorDetail || "",
      startedAt: now,
      endedAt: "",
      lastActiveAt: now,
      activitySamples: [],
      windowId: "",
      windowState: "starting",
      crashReportPath: "",
      crashIndexPath: "",
      lifecycleCallbacks: context.lifecycleCallbacks || app.lifecycleCallbacks || null,
      lifecycleCallbackRuns: [],
      lifecycleLastCallback: "",
      lifecycleLastReason: "",
      lifecycleLastAt: "",
      lifecycleLastResult: "",
      lifecycleLastError: "",
    };
    this.processes.set(process.pid, process);
    this.history.push({ ...process });
    this.logs.set(process.pid, []);
    this.os.descriptors?.initProcess?.(process, context);
    this.log(process.pid, `spawn ${process.appId}`);
    this.sampleActivity(process.pid, "spawn", 2);
    this.syncProcfs();
    this.os.bus.emit("process:spawn", process);
    this.emitAppLifecycle("launch", process);
    return process;
  }

  attachWindow(pid, windowId) {
    const process = this.processes.get(Number(pid));
    if (!process) return;
    process.windowId = windowId;
    process.windowState = "attached";
    process.lastActiveAt = new Date().toISOString();
    this.log(process.pid, `attach-window ${windowId}`);
    this.sampleActivity(process.pid, "attach-window", 1);
    this.syncProcfs();
    this.os.bus.emit("process:update", process);
  }

  updateWindowState(pid, state, details = {}) {
    const process = this.processes.get(Number(pid));
    if (!process) return null;
    process.windowState = state;
    process.state = state === "minimized" ? "sleeping" : "running";
    process.lastActiveAt = new Date().toISOString();
    this.log(process.pid, `window-${state}${details.windowId ? ` ${details.windowId}` : ""}`);
    this.sampleActivity(process.pid, `window-${state}`, state === "focused" || state === "ready" ? 2 : 1);
    this.syncProcfs();
    this.os.bus.emit("process:update", process);
    if (state === "focused") this.emitAppLifecycle("focus", process, details);
    if (state === "minimized") {
      this.os.windows?.releaseProcessCapture?.(process.pid, "process-suspend");
      this.emitAppLifecycle("suspend", process, details);
    }
    if (state === "restored" || state === "maximized") this.emitAppLifecycle("resume", process, details);
    return { ...this.withRuntimeMetrics(process) };
  }

  markReady(pid) {
    const process = this.processes.get(Number(pid));
    if (!process) return null;
    process.state = "running";
    process.windowState = "ready";
    process.lastActiveAt = new Date().toISOString();
    this.log(process.pid, "ready");
    this.sampleActivity(process.pid, "ready", 2);
    this.syncProcfs();
    this.os.bus.emit("process:update", process);
    this.emitAppLifecycle("ready", process);
    return { ...this.withRuntimeMetrics(process) };
  }

  updateExecutorState(pid, details = {}) {
    const process = this.processes.get(Number(pid));
    if (!process) return null;
    if (details.executionBackend) process.executionBackend = details.executionBackend;
    if (details.executorState) process.executorState = details.executorState;
    if (details.executorKind !== undefined) process.executorKind = details.executorKind;
    if (details.executorDetail !== undefined) process.executorDetail = details.executorDetail;
    process.lastActiveAt = new Date().toISOString();
    this.log(process.pid, `executor ${process.executionBackend} ${process.executorState}${process.executorDetail ? ` ${process.executorDetail}` : ""}`);
    this.sampleActivity(process.pid, "executor", 1);
    this.syncProcfs();
    this.os.bus.emit("process:update", process);
    return { ...this.withRuntimeMetrics(process) };
  }

  crash(pid, error) {
    const process = this.processes.get(Number(pid));
    if (!process) return null;
    process.state = "crashed";
    process.windowState = "crashed";
    process.endedAt = new Date().toISOString();
    process.lastActiveAt = process.endedAt;
    this.log(process.pid, `crash ${error?.message || String(error)}`, "error");
    this.sampleActivity(process.pid, "crash", 4);
    const report = this.writeCrashReport(process, error);
    process.crashReportPath = report.path;
    process.crashIndexPath = report.indexPath;
    this.os.windows?.releaseProcessCapture?.(process.pid, "process-crash");
    this.os.descriptors?.closeProcess?.(process.pid);
    this.os.unregisterIpcEndpointsForPid?.(process.pid, "process-crash");
    this.syncProcfs();
    this.os.bus.emit("process:crash", process);
    this.emitAppLifecycle("crash", process, { error: error?.message || String(error) });
    return { ...this.withRuntimeMetrics(process) };
  }

  list() {
    return [...this.processes.values()].map((process) => this.withRuntimeMetrics(process));
  }

  get(pid) {
    const process = this.processes.get(Number(pid));
    return process ? this.withRuntimeMetrics(process) : null;
  }

  current() {
    const process = this.list()[0];
    return process || null;
  }

  log(pid, message, level = "info") {
    if (message === undefined) return this.readLog(pid);
    const normalizedPid = Number(pid);
    const entries = this.logs.get(normalizedPid) || [];
    entries.push({
      at: new Date().toISOString(),
      level,
      message,
    });
    this.logs.set(normalizedPid, entries.slice(-200));
    this.sampleActivity(normalizedPid, `log:${level}`, level === "error" ? 2 : 0.5, { touch: false });
  }

  readLog(pid) {
    const entries = this.logs.get(Number(pid)) || [];
    return entries.map((entry) => `${entry.at} ${entry.level.toUpperCase()} ${entry.message}`).join("\n");
  }

  kill(pid, reason = "terminated") {
    const process = this.processes.get(Number(pid));
    if (!process) throw new Error(`kill: ${pid}: no such process`);
    process.state = reason;
    process.endedAt = new Date().toISOString();
    process.lastActiveAt = process.endedAt;
    this.log(process.pid, `exit ${reason}`);
    this.sampleActivity(process.pid, "exit", 1);
    this.processes.delete(process.pid);
    this.os.descriptors?.closeProcess?.(process.pid);
    this.os.unregisterIpcEndpointsForPid?.(process.pid, reason);
    this.history.push({ ...this.withRuntimeMetrics(process) });
    this.syncProcfs();
    if (process.windowId && this.os.windows.has(process.windowId)) {
      this.os.windows.close(process.windowId, { skipOnClose: true });
    }
    this.os.bus.emit("process:exit", process);
    this.emitAppLifecycle("close", process, { reason });
    return { ...process };
  }

  emitAppLifecycle(type, process, details = {}) {
    this.os.bus?.emit?.(`app:${type}`, {
      type,
      pid: process.pid,
      appId: process.appId,
      name: process.name,
      state: process.state,
      windowState: process.windowState,
      process: this.withRuntimeMetrics(process),
      ...details,
    });
  }

  applyLifecycleTransition(osState, reason = "") {
    const callback = processLifecycleCallbackForState(osState);
    if (!callback) return [];
    const results = [];
    this.processes.forEach((process) => {
      if (process.endedAt || process.state === "crashed") return;
      if (callback.id === "suspend") this.os.windows?.releaseProcessCapture?.(process.pid, "process-suspend");
      const result = this.runLifecycleCallback(process, callback, reason, osState);
      results.push(result);
    });
    if (results.length) this.syncProcfs();
    return results;
  }

  runLifecycleCallback(process, callback, reason, osState) {
    const at = new Date().toISOString();
    const entry = {
      at,
      callback: callback.id,
      reason: String(reason || ""),
      osState,
      status: "recorded",
      result: "",
      error: "",
    };
    const handler = lifecycleHandlerFor(process.lifecycleCallbacks, callback);
    if (handler) {
      try {
        const value = handler({
          process: this.withRuntimeMetrics(process),
          reason: entry.reason,
          osState,
          callback: callback.id,
        });
        entry.status = "handled";
        entry.result = value === undefined ? "" : String(value);
      } catch (error) {
        entry.status = "error";
        entry.error = error?.message || String(error);
      }
    }
    process.lifecycleCallbackRuns = [...(process.lifecycleCallbackRuns || []), entry].slice(-20);
    process.lifecycleLastCallback = entry.callback;
    process.lifecycleLastReason = entry.reason;
    process.lifecycleLastAt = at;
    process.lifecycleLastResult = entry.result;
    process.lifecycleLastError = entry.error;
    this.log(process.pid, `lifecycle ${entry.callback} ${entry.reason}${entry.error ? ` ${entry.error}` : ""}`, entry.error ? "error" : "info");
    this.os.bus.emit("process:lifecycle", { ...entry, pid: process.pid, appId: process.appId });
    return { ...entry, pid: process.pid, appId: process.appId };
  }

  restart(pid) {
    const process = this.get(pid);
    if (!process) throw new Error(`restart: ${pid}: no such process`);
    this.kill(pid, "restarting");
    return this.os.launch(process.appId, { restartedFromPid: process.pid });
  }

  formatTable() {
    const rows = this.list();
    if (!rows.length) return "PID USER     STATE    APP          WINDOW     UPTIME ACTIVITY";
    return [
      "PID USER     STATE    APP          WINDOW     UPTIME ACTIVITY",
      ...rows.map((process) => [
        String(process.pid).padEnd(3),
        process.user.padEnd(8),
        process.state.padEnd(8),
        process.appId.padEnd(12),
        (process.windowId || "-").padEnd(10),
        formatDuration(process.uptimeMs),
        String(process.activityScore || 0).padStart(8),
      ].join(" ")),
    ].join("\n");
  }

  table() {
    return this.formatTable();
  }

  syncProcfs() {
    this.ensureProcfs();
    const processes = this.list();
    const payload = JSON.stringify(processes.map((process) => ({
      pid: process.pid,
      parentPid: process.parentPid,
      parentAppId: process.parentAppId,
      childPids: process.childPids,
      appId: process.appId,
      state: process.state,
      runtime: process.runtime || "",
      namespace: process.manifest?.namespace || null,
      executionBackend: process.executionBackend || "",
      executorState: process.executorState || "",
      executorKind: process.executorKind || "",
      executorDetail: process.executorDetail || "",
      user: process.user,
      windowId: process.windowId,
      windowState: process.windowState,
      startedAt: process.startedAt,
      lastActiveAt: process.lastActiveAt,
      uptimeMs: process.uptimeMs,
      runtimeBytes: process.runtimeBytes,
      activityScore: process.activityScore,
      activitySamples: process.activitySamples,
      activityLastSampleAt: process.activityLastSampleAt,
      crashReportPath: process.crashReportPath || "",
      crashIndexPath: process.crashIndexPath || "",
      lifecycleLastCallback: process.lifecycleLastCallback || "",
      lifecycleLastReason: process.lifecycleLastReason || "",
      lifecycleLastAt: process.lifecycleLastAt || "",
      lifecycleLastResult: process.lifecycleLastResult || "",
      lifecycleLastError: process.lifecycleLastError || "",
      lifecycleCallbackRuns: process.lifecycleCallbackRuns || [],
    })), null, 2);
    this.os.fs.writeOrCreateFile("/proc/processes.json", `${payload}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, this.os.permissions.systemPrincipal());
    this.os.fs.writeOrCreateFile("/proc/processes", `${this.formatTable()}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, this.os.permissions.systemPrincipal());
    this.os.fs.writeOrCreateFile("/proc/uptime", `${formatSeconds(Date.now() - new Date(this.bootedAt).getTime())}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, this.os.permissions.systemPrincipal());
    this.pruneProcessDirectories(new Set(processes.map((process) => String(process.pid))));
    processes.forEach((process) => this.writeProcessDirectory(process));
  }

  ensureProcfs() {
    const system = this.os.permissions.systemPrincipal();
    if (!this.os.fs.exists("/proc")) this.os.fs.createDirectory("/proc", "/", { owner: "root", group: "root" }, system);
  }

  pruneProcessDirectories(activePids) {
    const system = this.os.permissions.systemPrincipal();
    this.os.fs.list("/proc", "/", system)
      .filter((entry) => /^\d+$/.test(entry.name) && !activePids.has(entry.name))
      .forEach((entry) => this.os.fs.remove(entry.path, "/", { recursive: true }, system));
  }

  writeProcessDirectory(process) {
    const system = this.os.permissions.systemPrincipal();
    const path = `/proc/${process.pid}`;
    const existing = this.os.fs.stat(path);
    if (existing && existing.type !== "directory") this.os.fs.remove(path, "/", {}, system);
    if (!this.os.fs.exists(path)) this.os.fs.createDirectory(path, "/", { owner: "root", group: "root" }, system);
    this.os.fs.writeOrCreateFile(`${path}/status`, `${formatProcessStatus(process)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile(`${path}/cmdline`, `${process.appId}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile(`${path}/root`, `${processNamespaceRoot(process)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile(`${path}/cwd`, `${process.cwd || "/"}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile(`${path}/mounts`, `${processMountLines(this.os, process).join("\n")}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile(`${path}/limits`, `${JSON.stringify(processLimits(process), null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile(`${path}/log`, `${this.readLog(process.pid)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.descriptors?.writeProcfs?.(process.pid);
  }

  writeCrashReport(process, error) {
    const system = this.os.permissions.systemPrincipal();
    ensureDirectory(this.os, "/var", system);
    ensureDirectory(this.os, "/var/log", system);
    ensureDirectory(this.os, "/var/log/dindbos", system);
    const report = [
      `At: ${process.endedAt}`,
      `PID: ${process.pid}`,
      `App: ${process.appId}`,
      `Name: ${process.name}`,
      `User: ${process.user}`,
      `Window: ${process.windowId || "-"}`,
      `Message: ${error?.message || String(error)}`,
      error?.stack ? `Stack: ${error.stack}` : "",
      "",
    ].filter((line) => line !== "").join("\n");
    const path = `/var/log/dindbos/crash-${process.pid}.log`;
    this.os.fs.writeOrCreateFile(path, `${report}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    const indexPath = "/var/log/dindbos/crashes.log";
    const line = `${process.endedAt} pid=${process.pid} app=${process.appId} ${error?.message || String(error)}\n`;
    if (this.os.fs.exists(indexPath)) this.os.fs.appendFile(indexPath, line, "/", system);
    else this.os.fs.writeOrCreateFile(indexPath, line, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    return { path, indexPath };
  }

  withRuntimeMetrics(process) {
    const { lifecycleCallbacks, ...publicProcess } = process;
    const uptimeMs = process.endedAt
      ? new Date(process.endedAt).getTime() - new Date(process.startedAt).getTime()
      : Date.now() - new Date(process.startedAt).getTime();
    const runtimeBytes = estimateRuntimeBytes(process, this.logs.get(process.pid) || []);
    const activity = processActivity(process);
    return {
      ...publicProcess,
      uptimeMs: Math.max(0, uptimeMs),
      runtimeBytes,
      logLines: this.logs.get(process.pid)?.length || 0,
      activityScore: activity.score,
      activitySamples: activity.samples,
      activityLastSampleAt: activity.lastSampleAt,
      childPids: this.childPids(process.pid),
    };
  }

  childPids(parentPid) {
    const pid = Number(parentPid);
    return [...this.processes.values()]
      .filter((process) => Number(process.parentPid || 0) === pid)
      .map((process) => process.pid)
      .sort((left, right) => left - right);
  }

  sampleActivity(pid, label = "activity", weight = 1, options = {}) {
    const process = this.processes.get(Number(pid));
    if (!process) return null;
    const now = new Date().toISOString();
    const samples = Array.isArray(process.activitySamples) ? process.activitySamples : [];
    samples.push({ at: now, label: String(label || "activity"), weight: Number(weight || 1) });
    process.activitySamples = pruneActivitySamples(samples);
    if (options.touch !== false) process.lastActiveAt = now;
    this.os.bus.emit("process:activity", this.withRuntimeMetrics(process));
    return this.withRuntimeMetrics(process);
  }
}

function estimateRuntimeBytes(process, logs) {
  return byteLength(JSON.stringify({
    pid: process.pid,
    appId: process.appId,
    context: process.context,
    manifest: process.manifest,
    logs,
  }));
}

function formatProcessStatus(process) {
  return [
    `Name:\t${process.name}`,
    `Pid:\t${process.pid}`,
    `ParentPid:\t${process.parentPid || 0}`,
    `ParentApp:\t${process.parentAppId || "-"}`,
    `ChildPids:\t${process.childPids?.join(",") || "-"}`,
    `User:\t${process.user}`,
    `State:\t${process.state}`,
    `App:\t${process.appId}`,
    `Runtime:\t${process.runtime || "-"}`,
    `Namespace:\t${process.manifest?.namespace?.processGroup || "-"}`,
    `NamespaceRoot:\t${process.manifest?.namespace?.packageRoot || "-"}`,
    `NamespaceState:\t${process.manifest?.namespace?.stateRoot || "-"}`,
    `ExecutionBackend:\t${process.executionBackend || "-"}`,
    `ExecutorState:\t${process.executorState || "-"}`,
    `ExecutorKind:\t${process.executorKind || "-"}`,
    `ExecutorDetail:\t${process.executorDetail || "-"}`,
    `Window:\t${process.windowId || "-"}`,
    `WindowState:\t${process.windowState || "-"}`,
    `Started:\t${process.startedAt}`,
    `LastActive:\t${process.lastActiveAt}`,
    `Uptime:\t${formatDuration(process.uptimeMs)}`,
    `RuntimeBytes:\t${process.runtimeBytes}`,
    `LogLines:\t${process.logLines}`,
    `ActivityScore:\t${process.activityScore}`,
    `ActivitySamples:\t${process.activitySamples}`,
    `ActivityLastSample:\t${process.activityLastSampleAt || "-"}`,
    `CrashReport:\t${process.crashReportPath || "-"}`,
    `LifecycleLastCallback:\t${process.lifecycleLastCallback || "-"}`,
    `LifecycleLastReason:\t${process.lifecycleLastReason || "-"}`,
    `LifecycleLastAt:\t${process.lifecycleLastAt || "-"}`,
    `LifecycleLastResult:\t${process.lifecycleLastResult || "-"}`,
    `LifecycleLastError:\t${process.lifecycleLastError || "-"}`,
  ].join("\n");
}

function processNamespaceRoot(process) {
  return process.manifest?.namespace?.packageRoot || "/";
}

function processLimits(process) {
  const namespace = process.manifest?.namespace || {};
  return {
    processGroup: namespace.processGroup || "",
    childProcessLimit: Number(namespace.childProcessLimit || 0),
    deviceGrants: [...(namespace.deviceGrants || [])],
    networkHosts: [...(namespace.networkHosts || [])],
    ipcEndpoints: [...(namespace.ipcEndpoints || [])],
    rootPolicy: namespace.rootPolicy || "",
    statePolicy: namespace.statePolicy || "",
    cachePolicy: namespace.cachePolicy || "",
    tempPolicy: namespace.tempPolicy || "",
  };
}

function processMountLines(os, process) {
  const namespace = process.manifest?.namespace || null;
  const globalMounts = safeMountTable(os)
    .filter((entry) => !namespace || entry.root === "/" || entry.root === "/proc" || entry.root === "/dev" || entry.root === namespace.packageRoot)
    .map((entry) => processMountLine(entry, namespace?.processGroup || ""));
  const namespaceMounts = namespace ? [
    namespaceMount("namespace:root", namespace.packageRoot, "pkgfs", namespace.rootPolicy, namespace.processGroup, { readonly: true }),
    namespaceMount("namespace:state", namespace.stateRoot, "statefs", namespace.statePolicy, namespace.processGroup),
    namespaceMount("namespace:cache", namespace.cacheRoot, "cachefs", namespace.cachePolicy, namespace.processGroup),
    namespaceMount("namespace:temp", namespace.tempRoot, "tmpfs", namespace.tempPolicy, namespace.processGroup),
    namespaceMount("namespace:deps", namespace.dependencyRoot, "depsfs", "declared-dependencies", namespace.processGroup),
  ].filter(Boolean).map((entry) => processMountLine(entry, namespace.processGroup)) : [];
  return [...globalMounts, ...namespaceMounts];
}

function safeMountTable(os) {
  try {
    return os.mountTable?.() || [];
  } catch {
    return [];
  }
}

function namespaceMount(id, root, driver, policy, processGroup, options = {}) {
  if (!root) return null;
  return {
    id,
    root,
    driver,
    readonly: options.readonly ?? driver === "depsfs",
    owner: processGroup || "namespace",
    durability: driver === "tmpfs" ? "runtime" : "persistent",
    quotaPolicy: policy || "namespace",
    capabilities: [],
    usedBytes: 0,
    support: "namespace-view",
  };
}

function processMountLine(entry, processGroup = "") {
  const flags = entry.readonly ? "ro" : "rw";
  const caps = Array.isArray(entry.capabilities) && entry.capabilities.length ? entry.capabilities.join(",") : "-";
  return [
    entry.id,
    entry.root,
    entry.driver,
    flags,
    `owner=${entry.owner || "root"}`,
    `durability=${entry.durability || "runtime"}`,
    `quota=${entry.quotaPolicy || "unknown"}`,
    `usedBytes=${Number(entry.usedBytes || 0)}`,
    `support=${entry.support || "browser-vfs"}`,
    `caps=${caps}`,
    `namespace=${processGroup || "-"}`,
  ].join(" ");
}

function cloneJson(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function processLifecycleCallbackForState(osState) {
  const map = {
    suspending: { id: "prepare-suspend", camel: "prepareSuspend" },
    suspended: { id: "suspend", camel: "suspend" },
    resuming: { id: "resume", camel: "resume" },
    "shutting-down": { id: "prepare-shutdown", camel: "prepareShutdown" },
    recovered: { id: "recovery-inspection", camel: "recoveryInspection" },
  };
  return map[osState] || null;
}

function lifecycleHandlerFor(callbacks, callback) {
  if (!callbacks || typeof callbacks !== "object") return null;
  const handler = callbacks[callback.id] || callbacks[callback.camel];
  return typeof handler === "function" ? handler : null;
}

function processActivity(process) {
  const samples = pruneActivitySamples(process.activitySamples || []);
  process.activitySamples = samples;
  const cutoff = Date.now() - 60_000;
  const score = samples
    .filter((sample) => new Date(sample.at).getTime() >= cutoff)
    .reduce((total, sample) => total + Number(sample.weight || 0), 0);
  return {
    score: Math.round(score * 10) / 10,
    samples: samples.length,
    lastSampleAt: samples[samples.length - 1]?.at || "",
  };
}

function pruneActivitySamples(samples) {
  const cutoff = Date.now() - 5 * 60_000;
  return samples
    .filter((sample) => new Date(sample.at).getTime() >= cutoff)
    .slice(-120);
}

function formatDuration(ms) {
  const seconds = Math.floor(Number(ms || 0) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function formatSeconds(ms) {
  return (Number(ms || 0) / 1000).toFixed(2);
}

function normalizePid(value) {
  const pid = Number(value || 0);
  return Number.isFinite(pid) && pid > 0 ? pid : 0;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}

function ensureDirectory(os, path, principal) {
  if (!os.fs.exists(path)) {
    os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, principal);
  }
}
