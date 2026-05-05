export const KERNEL_OBJECT_TYPES = [
  "process",
  "descriptor",
  "file",
  "mount",
  "window",
  "service",
  "device",
  "socket",
  "ipc",
  "timer",
  "keychain-grant",
  "package-namespace",
  "companion-session",
];

export class KernelObjectRegistry {
  constructor(os) {
    this.os = os;
    this.nextId = 1;
    this.objects = new Map();
  }

  register(type, details = {}) {
    const objectType = normalizeKernelObjectType(type);
    const now = new Date().toISOString();
    const id = details.id || `ko-${objectType}-${this.nextId++}`;
    const object = {
      id,
      type: objectType,
      ref: String(details.ref || ""),
      name: String(details.name || id),
      ownerPid: Number(details.ownerPid || 0),
      namespace: cloneJson(details.namespace || null),
      user: String(details.user || ""),
      rights: normalizeRights(details.rights),
      status: String(details.status || "active"),
      createdAt: now,
      updatedAt: now,
      expiresAt: String(details.expiresAt || ""),
      closeOnExec: Boolean(details.closeOnExec),
      revokedAt: "",
      revocationReason: "",
      metadata: cloneJson(details.metadata || {}),
    };
    this.objects.set(id, object);
    this.writeProcfs();
    return { ...object };
  }

  update(id, patch = {}) {
    const object = this.objects.get(String(id || ""));
    if (!object) return null;
    if (patch.name !== undefined) object.name = String(patch.name || object.name);
    if (patch.ref !== undefined) object.ref = String(patch.ref || "");
    if (patch.namespace !== undefined) object.namespace = cloneJson(patch.namespace || null);
    if (patch.user !== undefined) object.user = String(patch.user || "");
    if (patch.rights !== undefined) object.rights = normalizeRights(patch.rights);
    if (patch.status !== undefined) object.status = String(patch.status || object.status);
    if (patch.expiresAt !== undefined) object.expiresAt = String(patch.expiresAt || "");
    if (patch.closeOnExec !== undefined) object.closeOnExec = Boolean(patch.closeOnExec);
    if (patch.metadata !== undefined) object.metadata = cloneJson(patch.metadata || {});
    object.updatedAt = new Date().toISOString();
    this.writeProcfs();
    return { ...object };
  }

  revoke(id, reason = "revoked") {
    const object = this.objects.get(String(id || ""));
    if (!object || object.status === "revoked") return object ? { ...object } : null;
    object.status = "revoked";
    object.revokedAt = new Date().toISOString();
    object.revocationReason = String(reason || "revoked");
    object.updatedAt = object.revokedAt;
    this.writeProcfs();
    return { ...object };
  }

  revokeOwnedByPid(pid, reason = "process-exit") {
    const ownerPid = Number(pid || 0);
    const revoked = [];
    this.objects.forEach((object) => {
      if (object.ownerPid !== ownerPid || object.status === "revoked") return;
      object.status = "revoked";
      object.revokedAt = new Date().toISOString();
      object.revocationReason = String(reason || "process-exit");
      object.updatedAt = object.revokedAt;
      revoked.push({ ...object });
    });
    if (revoked.length) this.writeProcfs();
    return revoked;
  }

  get(id) {
    const object = this.objects.get(String(id || ""));
    return object ? { ...object } : null;
  }

  list(filters = {}) {
    return [...this.objects.values()]
      .filter((object) => !filters.type || object.type === filters.type)
      .filter((object) => filters.ownerPid === undefined || object.ownerPid === Number(filters.ownerPid || 0))
      .filter((object) => filters.status === undefined || object.status === String(filters.status || ""))
      .map((object) => ({ ...object }));
  }

  status() {
    const totals = {};
    this.objects.forEach((object) => {
      totals[object.type] = (totals[object.type] || 0) + 1;
    });
    return {
      objects: this.objects.size,
      types: totals,
      active: this.list({ status: "active" }).length,
      revoked: this.list({ status: "revoked" }).length,
    };
  }

  writeProcfs() {
    if (!this.os?.fs || !this.os?.permissions) return;
    const system = this.os.permissions.systemPrincipal();
    if (!this.os.fs.exists("/proc")) this.os.fs.createDirectory("/proc", "/", { owner: "root", group: "root" }, system);
    this.os.fs.writeOrCreateFile("/proc/objects", `${formatKernelObjects(this.list())}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/objects.json", `${JSON.stringify(this.list(), null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }
}

function normalizeKernelObjectType(type) {
  const value = String(type || "").trim();
  if (KERNEL_OBJECT_TYPES.includes(value)) return value;
  throw new Error(`kernel object: unsupported type: ${value || "unknown"}`);
}

function normalizeRights(rights = []) {
  return [...new Set((Array.isArray(rights) ? rights : [rights]).map((right) => String(right || "").trim()).filter(Boolean))].sort();
}

function formatKernelObjects(objects = []) {
  if (!objects.length) return "id type owner status rights ref";
  return [
    "id type owner status rights ref",
    ...objects.map((object) => [
      object.id,
      object.type,
      object.ownerPid || 0,
      object.status,
      object.rights.join(",") || "-",
      object.ref || "-",
    ].join(" ")),
  ].join("\n");
}

function cloneJson(value) {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value));
}
