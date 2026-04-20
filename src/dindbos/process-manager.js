export class ProcessManager {
  constructor(os) {
    this.os = os;
    this.nextPid = 100;
    this.processes = new Map();
    this.history = [];
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
      windowId: "",
    };
    this.processes.set(process.pid, process);
    this.history.push({ ...process });
    this.syncProcfs();
    this.os.bus.emit("process:spawn", process);
    return process;
  }

  attachWindow(pid, windowId) {
    const process = this.processes.get(Number(pid));
    if (!process) return;
    process.windowId = windowId;
    this.syncProcfs();
    this.os.bus.emit("process:update", process);
  }

  list() {
    return [...this.processes.values()].map((process) => ({ ...process }));
  }

  get(pid) {
    const process = this.processes.get(Number(pid));
    return process ? { ...process } : null;
  }

  kill(pid, reason = "terminated") {
    const process = this.processes.get(Number(pid));
    if (!process) throw new Error(`kill: ${pid}: no such process`);
    process.state = reason;
    process.endedAt = new Date().toISOString();
    this.processes.delete(process.pid);
    this.history.push({ ...process });
    this.syncProcfs();
    if (process.windowId && this.os.windows.has(process.windowId)) {
      this.os.windows.close(process.windowId, { skipOnClose: true });
    }
    this.os.bus.emit("process:exit", process);
    return { ...process };
  }

  formatTable() {
    const rows = this.list();
    if (!rows.length) return "PID USER     STATE    APP          WINDOW";
    return [
      "PID USER     STATE    APP          WINDOW",
      ...rows.map((process) => [
        String(process.pid).padEnd(3),
        process.user.padEnd(8),
        process.state.padEnd(8),
        process.appId.padEnd(12),
        process.windowId || "-",
      ].join(" ")),
    ].join("\n");
  }

  syncProcfs() {
    if (!this.os.fs.exists("/proc")) return;
    const payload = JSON.stringify(this.list().map((process) => ({
      pid: process.pid,
      appId: process.appId,
      state: process.state,
      user: process.user,
      windowId: process.windowId,
      startedAt: process.startedAt,
    })), null, 2);
    this.os.fs.writeOrCreateFile("/proc/processes.json", `${payload}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, this.os.permissions.systemPrincipal());
  }
}
