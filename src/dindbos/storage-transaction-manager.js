export class StorageTransactionManager {
  constructor(os) {
    this.os = os;
    this.nextId = 1;
    this.nextGroupId = 1;
    this.transactions = new Map();
    this.groups = new Map();
  }

  begin(kind = "storage-flush", details = {}) {
    const now = new Date().toISOString();
    const record = {
      id: `storage-runtime-tx-${this.nextId++}`,
      kind: String(kind || "storage-flush"),
      ownerPid: Number(details.ownerPid || 0),
      user: String(details.user || "root"),
      status: "pending",
      startedAt: now,
      completedAt: "",
      failedAt: "",
      reason: "",
      objectId: "",
      handleId: "",
      groupId: String(details.groupId || ""),
      metadata: cloneJson(details.metadata || {}),
    };
    this.registerTransactionObject(record);
    this.transactions.set(record.id, record);
    this.attachTransactionToGroup(record);
    this.writeProcfs();
    return publicTransaction(record);
  }

  commit(id, details = {}) {
    const record = this.require(id);
    if (record.status !== "pending") return publicTransaction(record);
    this.assertTransactionHandle(record, ["commit"]);
    record.status = "committed";
    record.completedAt = new Date().toISOString();
    record.metadata = { ...record.metadata, ...cloneJson(details.metadata || {}) };
    this.syncTransactionObject(record);
    this.revokeTransactionObject(record, details.reason || "storage-transaction-committed");
    this.writeProcfs();
    return publicTransaction(record);
  }

  fail(id, error, details = {}) {
    const record = this.require(id);
    if (record.status !== "pending") return publicTransaction(record);
    this.assertTransactionHandle(record, ["rollback"]);
    record.status = "failed";
    record.failedAt = new Date().toISOString();
    record.reason = error?.message || String(error || details.reason || "storage-transaction-failed");
    record.metadata = { ...record.metadata, ...cloneJson(details.metadata || {}) };
    this.syncTransactionObject(record);
    this.revokeTransactionObject(record, details.reason || "storage-transaction-failed");
    this.writeProcfs();
    return publicTransaction(record);
  }

  beginGroup(kind = "storage-group", details = {}) {
    const now = new Date().toISOString();
    const record = {
      id: `storage-runtime-group-${this.nextGroupId++}`,
      kind: String(kind || "storage-group"),
      ownerPid: Number(details.ownerPid || 0),
      user: String(details.user || "root"),
      status: "pending",
      startedAt: now,
      completedAt: "",
      failedAt: "",
      reason: "",
      transactionIds: [],
      metadata: cloneJson(details.metadata || {}),
    };
    this.groups.set(record.id, record);
    this.writeProcfs();
    return publicGroup(record);
  }

  commitGroup(id, details = {}) {
    const record = this.requireGroup(id);
    if (record.status !== "pending") return publicGroup(record);
    record.status = "committed";
    record.completedAt = new Date().toISOString();
    record.metadata = { ...record.metadata, ...cloneJson(details.metadata || {}) };
    this.writeProcfs();
    return publicGroup(record);
  }

  failGroup(id, error, details = {}) {
    const record = this.requireGroup(id);
    if (record.status !== "pending") return publicGroup(record);
    record.status = "failed";
    record.failedAt = new Date().toISOString();
    record.reason = error?.message || String(error || details.reason || "storage-transaction-group-failed");
    record.metadata = { ...record.metadata, ...cloneJson(details.metadata || {}) };
    this.writeProcfs();
    return publicGroup(record);
  }

  groupStatus(filters = {}) {
    return [...this.groups.values()]
      .filter((record) => filters.status === undefined || record.status === String(filters.status || ""))
      .filter((record) => filters.ownerPid === undefined || record.ownerPid === Number(filters.ownerPid || 0))
      .map(publicGroup);
  }

  getGroup(id) {
    const record = this.groups.get(String(id || ""));
    return record ? publicGroup(record) : null;
  }

  requireGroup(id) {
    const record = this.groups.get(String(id || ""));
    if (!record) throw transactionError("ENOENT", `storage transaction group: ${id}: no such group`);
    return record;
  }

  attachTransactionToGroup(record) {
    if (!record.groupId) return null;
    const group = this.groups.get(record.groupId);
    if (!group) return null;
    if (!group.transactionIds.includes(record.id)) group.transactionIds.push(record.id);
    return group;
  }

  status(filters = {}) {
    return [...this.transactions.values()]
      .filter((record) => filters.status === undefined || record.status === String(filters.status || ""))
      .filter((record) => filters.ownerPid === undefined || record.ownerPid === Number(filters.ownerPid || 0))
      .map(publicTransaction);
  }

  get(id) {
    const record = this.transactions.get(String(id || ""));
    return record ? publicTransaction(record) : null;
  }

  require(id) {
    const record = this.transactions.get(String(id || ""));
    if (!record) throw transactionError("ENOENT", `storage transaction: ${id}: no such transaction`);
    return record;
  }

  registerTransactionObject(record) {
    if (!this.os.objects) return null;
    const object = this.os.objects.register("storage-transaction", {
      ref: `storage:${record.id}:${record.kind}`,
      name: record.id,
      ownerPid: record.ownerPid,
      user: record.user,
      rights: ["commit", "inspect", "rollback"],
      metadata: transactionMetadata(record),
    });
    record.objectId = object?.id || "";
    const handle = record.objectId ? this.os.objects.createHandle(record.objectId, {
      ownerPid: record.ownerPid,
      user: record.user,
      groups: ["root"],
      rights: ["commit", "inspect", "rollback"],
      closeOnExec: false,
      transferPolicy: "none",
      metadata: transactionHandleMetadata(record),
    }) : null;
    record.handleId = handle?.id || "";
    return object;
  }

  syncTransactionObject(record) {
    if (!record?.objectId || !this.os.objects) return null;
    const object = this.os.objects.update(record.objectId, {
      metadata: transactionMetadata(record),
    });
    if (record.handleId) {
      this.os.objects.updateHandle(record.handleId, {
        metadata: transactionHandleMetadata(record),
      });
    }
    return object;
  }

  revokeTransactionObject(record, reason = "storage-transaction-revoked") {
    if (!record?.objectId || !this.os.objects) return null;
    return this.os.objects.revoke(record.objectId, reason);
  }

  assertTransactionHandle(record, rights = []) {
    if (!record?.handleId || !this.os.objects) return null;
    try {
      return this.os.objects.assertHandle(record.handleId, {
        ownerPid: record.ownerPid,
        objectType: "storage-transaction",
        rights,
      });
    } catch (error) {
      throw transactionError(error.code || "EACCES", error.message);
    }
  }

  writeProcfs() {
    if (!this.os.fs?.exists?.("/proc")) return;
    const system = this.os.permissions.systemPrincipal();
    const transactions = this.status();
    const groups = this.groupStatus();
    this.os.fs.writeOrCreateFile("/proc/storage-transactions.json", `${JSON.stringify(transactions, null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/storage-transactions", `${formatTransactions(transactions)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/storage-transaction-groups.json", `${JSON.stringify(groups, null, 2)}\n`, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/storage-transaction-groups", `${formatGroups(groups)}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }
}

function publicTransaction(record) {
  return {
    id: record.id,
    kind: record.kind,
    ownerPid: record.ownerPid,
    user: record.user,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    failedAt: record.failedAt,
    reason: record.reason,
    objectId: record.objectId,
    handleId: record.handleId,
    groupId: record.groupId,
    metadata: cloneJson(record.metadata || {}),
  };
}

function publicGroup(record) {
  return {
    id: record.id,
    kind: record.kind,
    ownerPid: record.ownerPid,
    user: record.user,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    failedAt: record.failedAt,
    reason: record.reason,
    transactionIds: [...(record.transactionIds || [])],
    metadata: cloneJson(record.metadata || {}),
  };
}

function transactionMetadata(record) {
  return {
    transactionId: record.id,
    kind: record.kind,
    status: record.status,
    groupId: record.groupId || "",
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    failedAt: record.failedAt,
    reason: record.reason,
    ...cloneJson(record.metadata || {}),
  };
}

function transactionHandleMetadata(record) {
  return {
    transactionId: record.id,
    kind: record.kind,
    status: record.status,
    groupId: record.groupId || "",
  };
}

function formatTransactions(transactions = []) {
  if (!transactions.length) return "id kind status group object handle";
  return [
    "id kind status group object handle",
    ...transactions.map((entry) => [
      entry.id,
      entry.kind,
      entry.status,
      entry.groupId || "-",
      entry.objectId || "-",
      entry.handleId || "-",
    ].join(" ")),
  ].join("\n");
}

function formatGroups(groups = []) {
  if (!groups.length) return "id kind status transactions";
  return [
    "id kind status transactions",
    ...groups.map((entry) => [
      entry.id,
      entry.kind,
      entry.status,
      entry.transactionIds.join(",") || "-",
    ].join(" ")),
  ].join("\n");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function transactionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
