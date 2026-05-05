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
    this.nextHandleId = 1;
    this.objects = new Map();
    this.handles = new Map();
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
    if (patch.ownerPid !== undefined) object.ownerPid = Number(patch.ownerPid || 0);
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
    this.revokeHandlesForObject(object.id, reason);
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
      this.revokeHandlesForObject(object.id, reason, { write: false });
      revoked.push({ ...object });
    });
    if (revoked.length) this.writeProcfs();
    return revoked;
  }

  createHandle(objectId, details = {}) {
    const object = this.objects.get(String(objectId || ""));
    if (!object) throw kernelObjectError("ENOENT", `handle: ${objectId}: no such kernel object`);
    const now = new Date().toISOString();
    const id = details.id || `kh-${object.type}-${this.nextHandleId++}`;
    const handle = {
      id,
      objectId: object.id,
      objectType: object.type,
      ownerPid: Number(details.ownerPid ?? object.ownerPid ?? 0),
      user: String(details.user ?? object.user ?? ""),
      uid: Number(details.uid ?? 0),
      gid: Number(details.gid ?? 0),
      groups: normalizeRights(details.groups || []),
      namespace: cloneJson(details.namespace ?? object.namespace ?? null),
      rights: normalizeRights(details.rights || object.rights),
      status: String(details.status || "active"),
      createdAt: now,
      updatedAt: now,
      expiresAt: String(details.expiresAt || object.expiresAt || ""),
      closeOnExec: Boolean(details.closeOnExec ?? object.closeOnExec),
      transferPolicy: normalizeTransferPolicy(details.transferPolicy),
      duplicatedFrom: String(details.duplicatedFrom || ""),
      revokedAt: "",
      revocationReason: "",
      metadata: cloneJson(details.metadata || {}),
    };
    this.handles.set(id, handle);
    this.writeProcfs();
    this.writeProcessHandlesProcfs(handle.ownerPid);
    return cloneHandle(handle);
  }

  duplicateHandle(id, details = {}) {
    const source = this.assertHandle(id, {
      ownerPid: details.fromPid,
      rights: details.requiredRights || [],
      objectType: details.objectType,
    });
    if (source.transferPolicy === "no-duplicate") {
      throw kernelObjectError("EPERM", `handle: ${id}: duplicate denied`);
    }
    return this.createHandle(source.objectId, {
      ...source,
      ...details,
      id: details.id || "",
      ownerPid: Number(details.ownerPid ?? source.ownerPid),
      rights: details.rights || source.rights,
      duplicatedFrom: source.id,
      metadata: {
        ...source.metadata,
        ...(details.metadata || {}),
      },
    });
  }

  transferHandle(id, targetPid, details = {}) {
    const source = this.assertHandle(id, {
      ownerPid: details.fromPid,
      rights: details.requiredRights || [],
      objectType: details.objectType,
    });
    if (!["duplicate", "transfer"].includes(source.transferPolicy)) {
      throw kernelObjectError("EPERM", `handle: ${id}: transfer denied`);
    }
    const target = this.createHandle(source.objectId, {
      ...source,
      ...details,
      id: details.id || "",
      ownerPid: Number(targetPid || 0),
      user: String(details.user ?? source.user ?? ""),
      uid: Number(details.uid ?? source.uid ?? 0),
      gid: Number(details.gid ?? source.gid ?? 0),
      groups: details.groups || source.groups,
      rights: details.rights || source.rights,
      duplicatedFrom: source.id,
      metadata: {
        ...source.metadata,
        ...(details.metadata || {}),
        transferredFromPid: source.ownerPid,
      },
    });
    const revoked = this.revokeHandle(source.id, details.reason || "handle-transfer");
    return { source: revoked, target };
  }

  updateHandle(id, patch = {}) {
    const handle = this.handles.get(String(id || ""));
    if (!handle) return null;
    if (patch.user !== undefined) handle.user = String(patch.user || "");
    if (patch.uid !== undefined) handle.uid = Number(patch.uid || 0);
    if (patch.gid !== undefined) handle.gid = Number(patch.gid || 0);
    if (patch.groups !== undefined) handle.groups = normalizeRights(patch.groups);
    if (patch.namespace !== undefined) handle.namespace = cloneJson(patch.namespace || null);
    if (patch.rights !== undefined) handle.rights = normalizeRights(patch.rights);
    if (patch.status !== undefined) handle.status = String(patch.status || handle.status);
    if (patch.expiresAt !== undefined) handle.expiresAt = String(patch.expiresAt || "");
    if (patch.closeOnExec !== undefined) handle.closeOnExec = Boolean(patch.closeOnExec);
    if (patch.transferPolicy !== undefined) handle.transferPolicy = normalizeTransferPolicy(patch.transferPolicy);
    if (patch.metadata !== undefined) handle.metadata = cloneJson(patch.metadata || {});
    handle.updatedAt = new Date().toISOString();
    this.writeProcfs();
    this.writeProcessHandlesProcfs(handle.ownerPid);
    return cloneHandle(handle);
  }

  getHandle(id) {
    const handle = this.handles.get(String(id || ""));
    return handle ? cloneHandle(handle) : null;
  }

  listHandles(filters = {}) {
    return [...this.handles.values()]
      .filter((handle) => filters.ownerPid === undefined || handle.ownerPid === Number(filters.ownerPid || 0))
      .filter((handle) => filters.objectType === undefined || handle.objectType === String(filters.objectType || ""))
      .filter((handle) => filters.objectId === undefined || handle.objectId === String(filters.objectId || ""))
      .filter((handle) => filters.status === undefined || handle.status === String(filters.status || ""))
      .map(cloneHandle);
  }

  assertHandle(id, requirements = {}) {
    const handle = this.handles.get(String(id || ""));
    if (!handle) throw kernelObjectError("EBADF", `handle: ${id}: unknown handle`);
    if (handle.status !== "active") throw kernelObjectError("ESTALE", `handle: ${id}: stale handle`);
    if (handle.expiresAt && new Date(handle.expiresAt).getTime() <= Date.now()) {
      this.revokeHandle(handle.id, "expired");
      throw kernelObjectError("ESTALE", `handle: ${id}: expired handle`);
    }
    const object = this.objects.get(handle.objectId);
    if (!object || object.status !== "active") throw kernelObjectError("ESTALE", `handle: ${id}: kernel object is not active`);
    if (requirements.ownerPid !== undefined && handle.ownerPid !== Number(requirements.ownerPid || 0)) {
      throw kernelObjectError("EACCES", `handle: ${id}: owner pid mismatch`);
    }
    if (requirements.objectType && handle.objectType !== String(requirements.objectType)) {
      throw kernelObjectError("EINVAL", `handle: ${id}: wrong object type`);
    }
    normalizeRights(requirements.rights || requirements.right || []).forEach((right) => {
      if (!handle.rights.includes(right)) throw kernelObjectError("EACCES", `handle: ${id}: missing ${right} right`);
    });
    return cloneHandle(handle);
  }

  revokeHandle(id, reason = "handle-revoked", options = {}) {
    const handle = this.handles.get(String(id || ""));
    if (!handle || handle.status === "revoked") return handle ? cloneHandle(handle) : null;
    handle.status = "revoked";
    handle.revokedAt = new Date().toISOString();
    handle.revocationReason = String(reason || "handle-revoked");
    handle.updatedAt = handle.revokedAt;
    if (options.write !== false) {
      this.writeProcfs();
      this.writeProcessHandlesProcfs(handle.ownerPid);
    }
    return cloneHandle(handle);
  }

  revokeHandlesForObject(objectId, reason = "object-revoked", options = {}) {
    const revoked = [];
    this.handles.forEach((handle) => {
      if (handle.objectId !== String(objectId || "") || handle.status === "revoked") return;
      const revokedHandle = this.revokeHandle(handle.id, reason, { write: false });
      if (revokedHandle) revoked.push(revokedHandle);
    });
    if (revoked.length && options.write !== false) this.writeProcfs();
    return revoked;
  }

  revokeHandlesByPid(pid, reason = "process-exit", options = {}) {
    const ownerPid = Number(pid || 0);
    const revoked = [];
    this.handles.forEach((handle) => {
      if (handle.ownerPid !== ownerPid || handle.status === "revoked") return;
      const revokedHandle = this.revokeHandle(handle.id, reason, { write: false });
      if (revokedHandle) revoked.push(revokedHandle);
    });
    if (revoked.length && options.write !== false) this.writeProcfs();
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
      handles: this.handles.size,
      types: totals,
      active: this.list({ status: "active" }).length,
      revoked: this.list({ status: "revoked" }).length,
      activeHandles: this.listHandles({ status: "active" }).length,
      revokedHandles: this.listHandles({ status: "revoked" }).length,
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
    this.os.fs.writeOrCreateFile("/proc/handles", `${formatKernelHandles(this.listHandles())}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/handles.json", `${JSON.stringify(this.listHandles(), null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }

  writeProcessHandlesProcfs(pid) {
    if (!this.os?.fs || !this.os?.permissions) return;
    const normalizedPid = Number(pid || 0);
    const processPath = `/proc/${normalizedPid}`;
    if (!normalizedPid || !this.os.fs.exists(processPath)) return;
    this.os.fs.writeOrCreateFile(`${processPath}/handles.json`, `${JSON.stringify(this.listHandles({ ownerPid: normalizedPid }), null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, this.os.permissions.systemPrincipal());
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

function normalizeTransferPolicy(value) {
  const policy = String(value || "duplicate").trim();
  return ["duplicate", "transfer", "no-duplicate", "none"].includes(policy) ? policy : "duplicate";
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

function formatKernelHandles(handles = []) {
  if (!handles.length) return "id object type owner status rights";
  return [
    "id object type owner status rights",
    ...handles.map((handle) => [
      handle.id,
      handle.objectId,
      handle.objectType,
      handle.ownerPid || 0,
      handle.status,
      handle.rights.join(",") || "-",
    ].join(" ")),
  ].join("\n");
}

function cloneHandle(handle) {
  return {
    ...handle,
    groups: [...(handle.groups || [])],
    namespace: cloneJson(handle.namespace || null),
    rights: [...(handle.rights || [])],
    metadata: cloneJson(handle.metadata || {}),
  };
}

function cloneJson(value) {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function kernelObjectError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
