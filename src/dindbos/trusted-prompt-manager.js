const DEFAULT_PROMPT_TIMEOUT_MS = 30_000;

export class TrustedPromptManager {
  constructor(os, options = {}) {
    this.os = os;
    this.nextId = 1;
    this.prompts = new Map();
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_PROMPT_TIMEOUT_MS);
    this.setTimeout = options.setTimeout || globalThis.setTimeout?.bind(globalThis);
    this.clearTimeout = options.clearTimeout || globalThis.clearTimeout?.bind(globalThis);
  }

  create(process, args = {}) {
    if (!process?.pid) throw promptError("EINVAL", "trusted prompt: process context is required");
    const now = new Date().toISOString();
    const timeoutMs = normalizeTimeout(args.timeoutMs ?? this.timeoutMs);
    const id = `trusted-prompt-${this.nextId++}`;
    const record = {
      id,
      ownerPid: Number(process.pid),
      appId: process.appId || "",
      packageId: process.manifest?.namespace?.packageId || "",
      user: process.user || this.os.session?.user || "",
      capability: String(args.capability || "").trim(),
      target: String(args.target || args.resource || "").trim(),
      message: String(args.message || ""),
      status: "pending",
      decision: "",
      reason: "",
      createdAt: now,
      decidedAt: "",
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      timeoutMs,
      objectId: "",
      handleId: "",
      requesterHandleId: "",
      timeoutId: null,
    };
    if (!record.capability) throw promptError("EINVAL", "trusted prompt: capability is required");
    this.registerPromptObject(process, record);
    this.prompts.set(id, record);
    if (this.setTimeout) {
      record.timeoutId = this.setTimeout(() => this.expire(id), timeoutMs);
      record.timeoutId?.unref?.();
    }
    this.audit(record, "created");
    this.writeProcfs();
    return publicPrompt(record);
  }

  decide(id, decision, context = {}) {
    const record = this.require(id);
    if (record.status !== "pending") return publicPrompt(record);
    this.os.assertAdminOperation?.("trusted-prompt:decide", {
      principal: context.principal,
      target: record.id,
    });
    const normalized = normalizeDecision(decision);
    this.assertPromptHandle(record, ["decide"]);
    if (record.timeoutId && this.clearTimeout) this.clearTimeout(record.timeoutId);
    record.timeoutId = null;
    record.status = normalized;
    record.decision = normalized;
    record.reason = String(context.reason || "");
    record.decidedAt = new Date().toISOString();
    this.syncPromptObject(record);
    this.revokePromptObject(record, `trusted-prompt-${normalized}`);
    this.audit(record, normalized);
    this.writeProcfs();
    return publicPrompt(record);
  }

  expire(id, reason = "trusted-prompt-timeout") {
    const record = this.prompts.get(String(id || ""));
    if (!record || record.status !== "pending") return null;
    if (record.timeoutId && this.clearTimeout) this.clearTimeout(record.timeoutId);
    record.timeoutId = null;
    record.status = "expired";
    record.decision = "expired";
    record.reason = reason;
    record.decidedAt = new Date().toISOString();
    this.syncPromptObject(record);
    this.revokePromptObject(record, reason);
    this.audit(record, "expired");
    this.writeProcfs();
    return publicPrompt(record);
  }

  cleanupByPid(pid, reason = "process-exit") {
    const ownerPid = Number(pid || 0);
    const cleaned = [];
    this.prompts.forEach((record) => {
      if (record.ownerPid !== ownerPid || record.status !== "pending") return;
      cleaned.push(this.expire(record.id, reason));
    });
    return cleaned.filter(Boolean);
  }

  status(filters = {}) {
    return [...this.prompts.values()]
      .filter((record) => filters.status === undefined || record.status === String(filters.status || ""))
      .filter((record) => filters.ownerPid === undefined || record.ownerPid === Number(filters.ownerPid || 0))
      .map(publicPrompt);
  }

  get(id) {
    const record = this.prompts.get(String(id || ""));
    return record ? publicPrompt(record) : null;
  }

  require(id) {
    const record = this.prompts.get(String(id || ""));
    if (!record) throw promptError("ENOENT", `trusted prompt: ${id}: no such prompt`);
    return record;
  }

  registerPromptObject(process, record) {
    if (!this.os.objects) return null;
    const object = this.os.objects.register("trusted-prompt", {
      ref: `trusted-prompt:${record.id}:pid:${record.ownerPid}:${record.capability}`,
      name: record.id,
      ownerPid: record.ownerPid,
      namespace: process.manifest?.namespace || null,
      user: record.user,
      rights: ["decide", "inspect", "request"],
      expiresAt: record.expiresAt,
      metadata: promptMetadata(record),
    });
    record.objectId = object?.id || "";
    const requester = record.objectId ? this.os.objects.createHandle(record.objectId, {
      ownerPid: record.ownerPid,
      user: record.user,
      uid: process.uid || 0,
      gid: process.gid || 0,
      groups: process.groups || [],
      namespace: process.manifest?.namespace || null,
      rights: ["inspect", "request"],
      expiresAt: record.expiresAt,
      closeOnExec: true,
      transferPolicy: "none",
      metadata: promptRequesterHandleMetadata(record),
    }) : null;
    const control = record.objectId ? this.os.objects.createHandle(record.objectId, {
      ownerPid: 0,
      user: "root",
      groups: ["root"],
      rights: ["decide", "inspect"],
      expiresAt: record.expiresAt,
      closeOnExec: false,
      transferPolicy: "none",
      metadata: promptControlHandleMetadata(record),
    }) : null;
    record.requesterHandleId = requester?.id || "";
    record.handleId = control?.id || "";
    return object;
  }

  syncPromptObject(record) {
    if (!record?.objectId || !this.os.objects) return null;
    const object = this.os.objects.update(record.objectId, {
      metadata: promptMetadata(record),
    });
    if (record.handleId) this.os.objects.updateHandle(record.handleId, { metadata: promptControlHandleMetadata(record) });
    if (record.requesterHandleId) this.os.objects.updateHandle(record.requesterHandleId, { metadata: promptRequesterHandleMetadata(record) });
    return object;
  }

  revokePromptObject(record, reason = "trusted-prompt-revoked") {
    if (!record?.objectId || !this.os.objects) return null;
    return this.os.objects.revoke(record.objectId, reason);
  }

  assertPromptHandle(record, rights = []) {
    if (!record?.handleId || !this.os.objects) return null;
    try {
      return this.os.objects.assertHandle(record.handleId, {
        ownerPid: 0,
        objectType: "trusted-prompt",
        rights,
      });
    } catch (error) {
      throw promptError(error.code || "EACCES", error.message);
    }
  }

  audit(record, action) {
    const system = this.os.permissions.systemPrincipal();
    this.os.ensureSystemDirectory?.("/var", "root", system);
    this.os.ensureSystemDirectory?.("/var/log", "root", system);
    this.os.ensureSystemDirectory?.("/var/log/dindbos", "root", system);
    const line = `${new Date().toISOString()} prompt=${record.id} action=${action} pid=${record.ownerPid} app=${record.appId || "-"} capability=${record.capability} target=${record.target || "-"} status=${record.status}\n`;
    const path = "/var/log/dindbos/trusted-ui.log";
    if (this.os.fs.exists(path)) this.os.fs.appendFile(path, line, "/", system);
    else this.os.fs.writeOrCreateFile(path, line, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }

  writeProcfs() {
    if (!this.os.fs?.exists?.("/proc")) return;
    const system = this.os.permissions.systemPrincipal();
    const prompts = this.status();
    this.os.fs.writeOrCreateFile("/proc/trusted-ui.json", `${JSON.stringify(prompts, null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/trusted-ui", `${formatPrompts(prompts)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }
}

function publicPrompt(record) {
  return {
    id: record.id,
    ownerPid: record.ownerPid,
    appId: record.appId,
    packageId: record.packageId,
    user: record.user,
    capability: record.capability,
    target: record.target,
    message: record.message,
    status: record.status,
    decision: record.decision,
    reason: record.reason,
    createdAt: record.createdAt,
    decidedAt: record.decidedAt,
    expiresAt: record.expiresAt,
    timeoutMs: record.timeoutMs,
    objectId: record.objectId,
    handleId: record.handleId,
    requesterHandleId: record.requesterHandleId,
  };
}

function promptMetadata(record) {
  return {
    promptId: record.id,
    appId: record.appId,
    packageId: record.packageId,
    capability: record.capability,
    target: record.target,
    status: record.status,
    decision: record.decision,
    reason: record.reason,
    expiresAt: record.expiresAt,
  };
}

function promptRequesterHandleMetadata(record) {
  return {
    promptId: record.id,
    role: "requester",
    capability: record.capability,
    target: record.target,
  };
}

function promptControlHandleMetadata(record) {
  return {
    promptId: record.id,
    role: "trusted-ui-control",
    capability: record.capability,
    target: record.target,
    status: record.status,
  };
}

function formatPrompts(prompts = []) {
  if (!prompts.length) return "id pid status capability target";
  return [
    "id pid status capability target",
    ...prompts.map((prompt) => [
      prompt.id,
      String(prompt.ownerPid),
      prompt.status,
      prompt.capability || "-",
      prompt.target || "-",
    ].join(" ")),
  ].join("\n");
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) throw promptError("EINVAL", "trusted prompt: timeoutMs must be positive");
  return Math.floor(timeout);
}

function normalizeDecision(value) {
  const decision = String(value || "").trim().toLowerCase();
  if (["granted", "grant", "allow", "allowed"].includes(decision)) return "granted";
  if (["denied", "deny", "refuse", "refused"].includes(decision)) return "denied";
  throw promptError("EINVAL", `trusted prompt: unsupported decision: ${value || ""}`);
}

function promptError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
