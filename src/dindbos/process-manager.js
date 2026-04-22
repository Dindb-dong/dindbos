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
    const process = {
      pid: this.nextPid++,
      appId: app.id,
      name: app.name || app.id,
      state: "running",
      user: this.os.session.user || "guest",
      cwd: this.os.session.home || "/",
      manifest: app.manifest,
      context,
      startedAt: now,
      endedAt: "",
      lastActiveAt: now,
      windowId: "",
      windowState: "starting",
    };
    this.processes.set(process.pid, process);
    this.history.push({ ...process });
    this.logs.set(process.pid, []);
    this.log(process.pid, `spawn ${process.appId}`);
    this.syncProcfs();
    this.os.bus.emit("process:spawn", process);
    return process;
  }

  attachWindow(pid, windowId) {
    const process = this.processes.get(Number(pid));
    if (!process) return;
    process.windowId = windowId;
    process.windowState = "attached";
    process.lastActiveAt = new Date().toISOString();
    this.log(process.pid, `attach-window ${windowId}`);
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
    this.syncProcfs();
    this.os.bus.emit("process:update", process);
    return { ...this.withRuntimeMetrics(process) };
  }

  markReady(pid) {
    const process = this.processes.get(Number(pid));
    if (!process) return null;
    process.state = "running";
    process.windowState = "ready";
    process.lastActiveAt = new Date().toISOString();
    this.log(process.pid, "ready");
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
    this.syncProcfs();
    this.os.bus.emit("process:crash", process);
    return { ...this.withRuntimeMetrics(process) };
  }

  list() {
    return [...this.processes.values()].map((process) => this.withRuntimeMetrics(process));
  }

  get(pid) {
    const process = this.processes.get(Number(pid));
    return process ? this.withRuntimeMetrics(process) : null;
  }

  log(pid, message, level = "info") {
    const normalizedPid = Number(pid);
    const entries = this.logs.get(normalizedPid) || [];
    entries.push({
      at: new Date().toISOString(),
      level,
      message,
    });
    this.logs.set(normalizedPid, entries.slice(-200));
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
    this.processes.delete(process.pid);
    this.history.push({ ...this.withRuntimeMetrics(process) });
    this.syncProcfs();
    if (process.windowId && this.os.windows.has(process.windowId)) {
      this.os.windows.close(process.windowId, { skipOnClose: true });
    }
    this.os.bus.emit("process:exit", process);
    return { ...process };
  }

  formatTable() {
    const rows = this.list();
    if (!rows.length) return "PID USER     STATE    APP          WINDOW     UPTIME";
    return [
      "PID USER     STATE    APP          WINDOW     UPTIME",
      ...rows.map((process) => [
        String(process.pid).padEnd(3),
        process.user.padEnd(8),
        process.state.padEnd(8),
        process.appId.padEnd(12),
        (process.windowId || "-").padEnd(10),
        formatDuration(process.uptimeMs),
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
      appId: process.appId,
      state: process.state,
      user: process.user,
      windowId: process.windowId,
      windowState: process.windowState,
      startedAt: process.startedAt,
      lastActiveAt: process.lastActiveAt,
      uptimeMs: process.uptimeMs,
      runtimeBytes: process.runtimeBytes,
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
    this.os.fs.writeOrCreateFile(`${path}/log`, `${this.readLog(process.pid)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }

  withRuntimeMetrics(process) {
    const uptimeMs = process.endedAt
      ? new Date(process.endedAt).getTime() - new Date(process.startedAt).getTime()
      : Date.now() - new Date(process.startedAt).getTime();
    const runtimeBytes = estimateRuntimeBytes(process, this.logs.get(process.pid) || []);
    return {
      ...process,
      uptimeMs: Math.max(0, uptimeMs),
      runtimeBytes,
      logLines: this.logs.get(process.pid)?.length || 0,
    };
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
    `User:\t${process.user}`,
    `State:\t${process.state}`,
    `App:\t${process.appId}`,
    `Window:\t${process.windowId || "-"}`,
    `WindowState:\t${process.windowState || "-"}`,
    `Started:\t${process.startedAt}`,
    `LastActive:\t${process.lastActiveAt}`,
    `Uptime:\t${formatDuration(process.uptimeMs)}`,
    `RuntimeBytes:\t${process.runtimeBytes}`,
    `LogLines:\t${process.logLines}`,
  ].join("\n");
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

function byteLength(value) {
  return new TextEncoder().encode(String(value)).byteLength;
}
