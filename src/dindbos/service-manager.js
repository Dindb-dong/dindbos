const SERVICE_STATE_PATH = "/var/run/dindbos/services.json";
const SERVICE_LOG_PATH = "/var/log/dindbos/services.log";

export class ServiceManager {
  constructor(os) {
    this.os = os;
    this.definitions = new Map();
    this.records = new Map();
    this.logs = new Map();
  }

  register(definition) {
    const service = normalizeService(definition);
    this.definitions.set(service.id, service);
    if (!this.records.has(service.id)) {
      this.records.set(service.id, {
        id: service.id,
        name: service.name,
        state: service.enabled ? "stopped" : "disabled",
        enabled: service.enabled,
        pid: 0,
        schedule: service.schedule,
        startedAt: "",
        stoppedAt: "",
        lastRunAt: "",
        runCount: 0,
        lastError: "",
      });
    }
    this.writeState();
    return this.get(service.id);
  }

  list() {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  get(serviceId) {
    const record = this.records.get(serviceId);
    return record ? { ...record } : null;
  }

  readLog(serviceId) {
    return [...(this.logs.get(serviceId) || [])];
  }

  enable(serviceId, context = {}) {
    this.assertManage(context);
    const record = this.requireRecord(serviceId);
    record.enabled = true;
    if (record.state === "disabled") record.state = "stopped";
    this.log(serviceId, "enabled");
    this.writeState();
    return this.get(serviceId);
  }

  disable(serviceId, context = {}) {
    this.assertManage(context);
    const record = this.requireRecord(serviceId);
    if (record.pid) this.stop(serviceId, context);
    record.enabled = false;
    record.state = "disabled";
    this.log(serviceId, "disabled");
    this.writeState();
    return this.get(serviceId);
  }

  async start(serviceId, context = {}) {
    this.assertManage(context);
    const service = this.requireDefinition(serviceId);
    const record = this.requireRecord(serviceId);
    if (!record.enabled) throw new Error(`service: ${serviceId}: disabled`);
    if (record.state === "running") return this.get(serviceId);
    record.state = "starting";
    record.lastError = "";
    this.log(serviceId, "starting");
    this.writeState();
    const process = this.os.processes.spawn({
      id: `service:${service.id}`,
      name: service.name,
      manifest: { capabilities: service.capabilities, fileSystem: service.fileSystem, runtime: "service" },
    }, { runtime: "service", source: "service-manager", executorKind: "service" });
    record.pid = process.pid;
    try {
      if (typeof service.start === "function") await service.start(this.serviceContext(service, record));
      record.state = "running";
      record.startedAt = new Date().toISOString();
      this.os.processes.markReady(process.pid);
      this.log(serviceId, "running");
      this.emit("start", record);
      this.writeState();
      return this.get(serviceId);
    } catch (error) {
      this.crash(serviceId, error, context);
      throw error;
    }
  }

  stop(serviceId, context = {}) {
    this.assertManage(context);
    const service = this.requireDefinition(serviceId);
    const record = this.requireRecord(serviceId);
    if (record.pid && this.os.processes.get(record.pid)) this.os.processes.kill(record.pid, "service-stopped");
    record.pid = 0;
    record.state = record.enabled ? "stopped" : "disabled";
    record.stoppedAt = new Date().toISOString();
    this.log(serviceId, "stopped");
    this.emit("stop", record);
    if (typeof service.stop === "function") service.stop(this.serviceContext(service, record));
    this.writeState();
    return this.get(serviceId);
  }

  async restart(serviceId, context = {}) {
    this.assertManage(context);
    const record = this.requireRecord(serviceId);
    if (record.pid) this.stop(serviceId, context);
    this.log(serviceId, "restarting");
    return this.start(serviceId, context);
  }

  crash(serviceId, error, context = {}) {
    this.assertManage(context);
    const record = this.requireRecord(serviceId);
    record.state = "crashed";
    record.lastError = error?.message || String(error);
    if (record.pid && this.os.processes.get(record.pid)) this.os.processes.crash(record.pid, error);
    this.log(serviceId, `crashed ${record.lastError}`, "error");
    this.emit("crash", record);
    this.writeState();
    return this.get(serviceId);
  }

  async runScheduled(serviceId, context = {}) {
    this.assertManage(context);
    const service = this.requireDefinition(serviceId);
    const record = this.requireRecord(serviceId);
    if (!record.enabled) throw new Error(`service: ${serviceId}: disabled`);
    record.lastRunAt = new Date().toISOString();
    record.runCount += 1;
    this.log(serviceId, `scheduled-run ${record.runCount}`);
    try {
      if (typeof service.run === "function") await service.run(this.serviceContext(service, record));
      if (record.state === "degraded") record.state = record.pid ? "running" : "stopped";
      this.emit("scheduled-run", record);
      this.writeState();
      return this.get(serviceId);
    } catch (error) {
      record.state = "degraded";
      record.lastError = error?.message || String(error);
      this.log(serviceId, `degraded ${record.lastError}`, "error");
      this.emit("degraded", record);
      this.writeState();
      return this.get(serviceId);
    }
  }

  suspend(reason = "page-hidden") {
    this.records.forEach((record) => {
      if (record.state !== "running") return;
      record.previousState = "running";
      record.state = "suspended";
      this.log(record.id, `suspended ${reason}`);
      this.emit("suspend", record);
    });
    this.writeState();
    return this.list();
  }

  resume(reason = "page-visible") {
    this.records.forEach((record) => {
      if (record.state !== "suspended") return;
      record.state = record.previousState || "running";
      delete record.previousState;
      this.log(record.id, `resumed ${reason}`);
      this.emit("resume", record);
    });
    this.writeState();
    return this.list();
  }

  serviceContext(service, record) {
    return {
      os: this.os,
      service: { ...service },
      record: { ...record },
      log: (message, level = "info") => this.log(service.id, message, level),
    };
  }

  log(serviceId, message, level = "info") {
    const entry = { at: new Date().toISOString(), level, message: String(message || "") };
    const entries = this.logs.get(serviceId) || [];
    entries.push(entry);
    this.logs.set(serviceId, entries.slice(-200));
    this.writeLog(serviceId, entry);
  }

  assertManage(context = {}) {
    const principal = context.principal || this.os.permissions?.systemPrincipal?.() || { system: true };
    if (principal.system || principal.user === "root") return;
    throw new Error("service: manage denied");
  }

  requireDefinition(serviceId) {
    const service = this.definitions.get(serviceId);
    if (!service) throw new Error(`service: ${serviceId}: not registered`);
    return service;
  }

  requireRecord(serviceId) {
    const record = this.records.get(serviceId);
    if (!record) throw new Error(`service: ${serviceId}: not registered`);
    return record;
  }

  emit(type, record) {
    this.os.bus?.emit?.(`service:${type}`, { type, service: { ...record } });
  }

  writeState() {
    const system = this.os.permissions.systemPrincipal();
    ensureDirectory(this.os, "/var", system);
    ensureDirectory(this.os, "/var/run", system);
    ensureDirectory(this.os, "/var/run/dindbos", system);
    this.os.fs.writeOrCreateFile(SERVICE_STATE_PATH, `${JSON.stringify(this.list(), null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }

  writeLog(serviceId, entry) {
    const system = this.os.permissions.systemPrincipal();
    ensureDirectory(this.os, "/var", system);
    ensureDirectory(this.os, "/var/log", system);
    ensureDirectory(this.os, "/var/log/dindbos", system);
    const line = `${entry.at} ${entry.level.toUpperCase()} ${serviceId} ${entry.message}\n`;
    if (this.os.fs.exists(SERVICE_LOG_PATH)) this.os.fs.appendFile(SERVICE_LOG_PATH, line, "/", system);
    else this.os.fs.writeOrCreateFile(SERVICE_LOG_PATH, line, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }
}

function normalizeService(definition = {}) {
  const id = String(definition.id || "").trim();
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new Error(`service: invalid id: ${definition.id || ""}`);
  return {
    id,
    name: String(definition.name || id),
    enabled: definition.enabled !== false,
    schedule: definition.schedule || null,
    capabilities: [...(definition.capabilities || [])],
    fileSystem: {
      read: [...(definition.fileSystem?.read || ["/"])],
      write: [...(definition.fileSystem?.write || [])],
    },
    start: definition.start || null,
    stop: definition.stop || null,
    run: definition.run || null,
  };
}

function ensureDirectory(os, path, principal) {
  if (!os.fs.exists(path)) os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, principal);
}
