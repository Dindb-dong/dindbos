export class StorageTransactionManager {
  constructor(os) {
    this.os = os;
    this.nextId = 1;
    this.transactions = new Map();
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
      metadata: cloneJson(details.metadata || {}),
    };
    this.registerTransactionObject(record);
    this.transactions.set(record.id, record);
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
    metadata: cloneJson(record.metadata || {}),
  };
}

function transactionMetadata(record) {
  return {
    transactionId: record.id,
    kind: record.kind,
    status: record.status,
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
  };
}

function formatTransactions(transactions = []) {
  if (!transactions.length) return "id kind status object handle";
  return [
    "id kind status object handle",
    ...transactions.map((entry) => [
      entry.id,
      entry.kind,
      entry.status,
      entry.objectId || "-",
      entry.handleId || "-",
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
