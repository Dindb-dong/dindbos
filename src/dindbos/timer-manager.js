const DEFAULT_MAX_DELAY_MS = 60_000;

export class TimerManager {
  constructor(os, options = {}) {
    this.os = os;
    this.nextId = 1;
    this.timers = new Map();
    this.maxDelayMs = Number(options.maxDelayMs || DEFAULT_MAX_DELAY_MS);
    this.setTimeout = options.setTimeout || globalThis.setTimeout?.bind(globalThis);
    this.clearTimeout = options.clearTimeout || globalThis.clearTimeout?.bind(globalThis);
  }

  create(process, args = {}) {
    if (!process?.pid) throw timerError("EINVAL", "timer: process context is required");
    const delayMs = normalizeDelay(args.delayMs ?? args.ms ?? args.timeoutMs ?? 0, this.maxDelayMs);
    const now = Date.now();
    const id = `timer-${this.nextId++}`;
    const record = {
      id,
      ownerPid: Number(process.pid),
      appId: process.appId || "",
      user: process.user || this.os.session?.user || "",
      delayMs,
      createdAt: new Date(now).toISOString(),
      dueAt: new Date(now + delayMs).toISOString(),
      firedAt: "",
      canceledAt: "",
      status: "pending",
      reason: "",
      degraded: !this.setTimeout,
      objectId: "",
      handleId: "",
      timeoutId: null,
      resolve: null,
      reject: null,
    };
    this.registerTimerObject(process, record);
    this.timers.set(id, record);
    if (this.setTimeout) {
      record.timeoutId = this.setTimeout(() => this.fire(id), delayMs);
      record.timeoutId?.unref?.();
    } else {
      this.cancel(id, process, { reason: "timer-unavailable", force: true });
    }
    this.writeProcfs();
    return publicTimer(record);
  }

  sleep(process, args = {}) {
    const timer = this.create(process, args);
    const record = this.timers.get(timer.id);
    if (!record || record.status !== "pending") return Promise.resolve(timer);
    return new Promise((resolve, reject) => {
      record.resolve = resolve;
      record.reject = reject;
    });
  }

  cancel(identifier, process = null, options = {}) {
    const record = this.find(identifier);
    if (!record) throw timerError("ENOENT", `timer: ${identifier}: no such timer`);
    if (!options.force) this.assertTimerHandle(process, record, ["cancel"]);
    if (record.status !== "pending") return publicTimer(record);
    if (record.timeoutId && this.clearTimeout) this.clearTimeout(record.timeoutId);
    record.timeoutId = null;
    record.status = "canceled";
    record.reason = options.reason || "timer-canceled";
    record.canceledAt = new Date().toISOString();
    this.revokeTimerObject(record, record.reason);
    if (record.reject) record.reject(timerError("ECANCELED", `timer: ${record.id}: canceled`));
    record.resolve = null;
    record.reject = null;
    this.writeProcfs();
    return publicTimer(record);
  }

  fire(id) {
    const record = this.timers.get(String(id || ""));
    if (!record || record.status !== "pending") return null;
    record.timeoutId = null;
    record.status = "fired";
    record.firedAt = new Date().toISOString();
    this.syncTimerObject(record);
    const result = publicTimer(record);
    this.revokeTimerObject(record, "timer-fired");
    if (record.resolve) record.resolve(result);
    record.resolve = null;
    record.reject = null;
    this.os.bus?.emit?.("timer:fire", result);
    this.writeProcfs();
    return result;
  }

  cleanupByPid(pid, reason = "process-exit") {
    const ownerPid = Number(pid || 0);
    const cleaned = [];
    this.timers.forEach((record) => {
      if (record.ownerPid !== ownerPid || record.status !== "pending") return;
      cleaned.push(this.cancel(record.id, null, { reason, force: true }));
    });
    return cleaned;
  }

  status(filters = {}) {
    return [...this.timers.values()]
      .filter((record) => filters.ownerPid === undefined || record.ownerPid === Number(filters.ownerPid || 0))
      .filter((record) => filters.status === undefined || record.status === String(filters.status || ""))
      .map(publicTimer);
  }

  get(identifier) {
    const record = this.find(identifier);
    return record ? publicTimer(record) : null;
  }

  find(identifier) {
    const id = String(identifier || "");
    if (this.timers.has(id)) return this.timers.get(id);
    return [...this.timers.values()].find((record) => record.handleId === id || record.objectId === id) || null;
  }

  registerTimerObject(process, record) {
    if (!this.os.objects) return null;
    const object = this.os.objects.register("timer", {
      ref: `timer:${record.id}:pid:${record.ownerPid}`,
      name: record.id,
      ownerPid: record.ownerPid,
      namespace: process.manifest?.namespace || null,
      user: record.user,
      rights: ["cancel", "inspect", "wait"],
      expiresAt: record.dueAt,
      metadata: timerMetadata(record),
    });
    record.objectId = object?.id || "";
    const handle = record.objectId ? this.os.objects.createHandle(record.objectId, {
      ownerPid: record.ownerPid,
      user: record.user,
      uid: process.uid || 0,
      gid: process.gid || 0,
      groups: process.groups || [],
      namespace: process.manifest?.namespace || null,
      rights: ["cancel", "inspect", "wait"],
      expiresAt: record.dueAt,
      closeOnExec: true,
      transferPolicy: "no-duplicate",
      metadata: timerHandleMetadata(record),
    }) : null;
    record.handleId = handle?.id || "";
    return object;
  }

  syncTimerObject(record) {
    if (!record?.objectId || !this.os.objects) return null;
    const object = this.os.objects.update(record.objectId, {
      metadata: timerMetadata(record),
    });
    if (record.handleId) {
      this.os.objects.updateHandle(record.handleId, {
        metadata: timerHandleMetadata(record),
      });
    }
    return object;
  }

  revokeTimerObject(record, reason = "timer-revoked") {
    if (!record?.objectId || !this.os.objects) return null;
    return this.os.objects.revoke(record.objectId, reason);
  }

  assertTimerHandle(process, record, rights = []) {
    if (!record?.handleId || !this.os.objects) return null;
    try {
      return this.os.objects.assertHandle(record.handleId, {
        ownerPid: process?.pid,
        objectType: "timer",
        rights,
      });
    } catch (error) {
      throw timerError(error.code || "EACCES", error.message);
    }
  }

  writeProcfs() {
    if (!this.os.fs?.exists?.("/proc")) return;
    const system = this.os.permissions.systemPrincipal();
    const timers = this.status();
    this.os.fs.writeOrCreateFile("/proc/timers.json", `${JSON.stringify(timers, null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/timers", `${formatTimers(timers)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }
}

function publicTimer(record) {
  return {
    id: record.id,
    ownerPid: record.ownerPid,
    appId: record.appId,
    user: record.user,
    delayMs: record.delayMs,
    createdAt: record.createdAt,
    dueAt: record.dueAt,
    firedAt: record.firedAt,
    canceledAt: record.canceledAt,
    status: record.status,
    reason: record.reason,
    degraded: Boolean(record.degraded),
    objectId: record.objectId,
    handleId: record.handleId,
  };
}

function timerMetadata(record) {
  return {
    timerId: record.id,
    appId: record.appId,
    delayMs: record.delayMs,
    dueAt: record.dueAt,
    firedAt: record.firedAt,
    canceledAt: record.canceledAt,
    status: record.status,
    reason: record.reason,
    degraded: Boolean(record.degraded),
  };
}

function timerHandleMetadata(record) {
  return {
    timerId: record.id,
    dueAt: record.dueAt,
    delayMs: record.delayMs,
  };
}

function formatTimers(timers = []) {
  if (!timers.length) return "id pid status delay dueAt handle";
  return [
    "id pid status delay dueAt handle",
    ...timers.map((timer) => [
      timer.id,
      String(timer.ownerPid),
      timer.status,
      `${timer.delayMs}ms`,
      timer.dueAt || "-",
      timer.handleId || "-",
    ].join(" ")),
  ].join("\n");
}

function normalizeDelay(value, maxDelayMs) {
  const delayMs = Number(value);
  if (!Number.isFinite(delayMs) || delayMs < 0) throw timerError("EINVAL", "timer: delayMs must be a non-negative number");
  if (delayMs > maxDelayMs) throw timerError("EINVAL", `timer: delayMs must be <= ${maxDelayMs}`);
  return Math.floor(delayMs);
}

function timerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
