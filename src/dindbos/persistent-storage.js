import { fileContentByteLength, parseFileContentRecord, serializeFileContentRecord } from "./file-data.js";

const STORAGE_VERSION = 2;
const STORE_NAME = "kv";
const FILE_RECORD_FORMAT = "opfs-file-records";
const INODE_RECORD_FORMAT = "opfs-inode-records";

export class PersistentStorage {
  constructor(options = {}) {
    this.key = options.key || "dindbos:vfs";
    this.dbName = options.dbName || "dindbos";
    this.adapter = options.memoryOnly ? null : options.adapter || safeLocalStorage();
    this.indexedDB = options.memoryOnly ? null : options.indexedDB || safeIndexedDB();
    this.opfsProvider = options.memoryOnly ? null : options.opfsProvider || (options.opfsRoot ? async () => options.opfsRoot : safeOpfsProvider());
    this.quotaBytes = Math.max(0, Number(options.quotaBytes || 0));
    this.storageClassQuotas = normalizeStorageClassQuotas(options.storageClassQuotas || {});
    this.storageClassUsage = new Map();
    this.opfsRootPromise = null;
    this.savedInodeHashes = new Map();
    this.savedContentHashes = new Map();
    this.memory = new Map();
    this.dbPromise = null;
    this.writeQueue = Promise.resolve();
    this.writeJournal = [];
    this.nextJournalId = 1;
    this.nextTransactionId = 1;
    this.activeWriteJournalId = "";
    this.activeStorageTransactionId = "";
    this.lastStatus = {
      key: this.key,
      backend: this.opfsProvider ? "opfs" : this.indexedDB ? "indexedDB" : this.adapter ? "localStorage" : "memory",
      structuredBackend: this.indexedDB ? "indexedDB" : "memory",
      enabled: Boolean(this.opfsProvider || this.indexedDB || this.adapter),
      bytes: 0,
      persisted: false,
      writePending: false,
      lastWriteQueuedAt: "",
      lastWriteCompletedAt: "",
      lastWriteError: "",
      storageJournalRecords: 0,
      lastStorageJournalAction: "",
      lastStorageTransactionId: "",
      storageRecoveryDecision: null,
      storageIntegrityMismatches: [],
      quotaLimitBytes: this.quotaBytes,
      storageClassQuotas: { ...this.storageClassQuotas },
      storageClassUsage: {},
      lastQuotaReservation: null,
    };
  }

  async loadFileSystem() {
    const interruptedTransaction = await this.readActiveStorageTransaction();
    let raw = await this.read(this.key);
    this.updateStatus(raw);
    if (interruptedTransaction) raw = await this.replayInterruptedStorageTransaction(interruptedTransaction, raw);
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw);
      if (payload.version !== STORAGE_VERSION) return null;
      if (payload.format === INODE_RECORD_FORMAT) {
        await this.validateInodeRecordPayload(payload);
        this.rememberRecordHashes(payload);
        this.lastStatus = {
          ...this.lastStatus,
          storageFormat: INODE_RECORD_FORMAT,
          inodeRecords: payload.inodeRecords?.length || 0,
          fileRecords: payload.fileRecords?.length || 0,
          contentBytes: payload.contentBytes || 0,
          dirtyInodes: 0,
          dirtyFiles: 0,
        };
        return await this.hydrateInodeRecordTree(payload.rootRef || stableInodeRef("/"));
      }
      if (payload.format === FILE_RECORD_FORMAT) {
        this.lastStatus = {
          ...this.lastStatus,
          storageFormat: FILE_RECORD_FORMAT,
          inodeRecords: 0,
          fileRecords: payload.fileRecords?.length || 0,
          contentBytes: payload.contentBytes || 0,
          dirtyInodes: 0,
          dirtyFiles: 0,
        };
        return await this.hydrateFileRecordTree(payload.root || null);
      }
      this.lastStatus = {
        ...this.lastStatus,
        storageFormat: "snapshot",
        inodeRecords: 0,
        fileRecords: 0,
        contentBytes: 0,
        dirtyInodes: 0,
        dirtyFiles: 0,
      };
      return this.hydrateSnapshotTree(payload.root || null);
    } catch {
      return null;
    }
  }

  saveFileSystem(root) {
    if (this.opfsProvider) {
      const recordPayload = this.createInodeRecordPayload(root);
      const transaction = this.createStorageTransaction("filesystem-save", {
        storageFormat: INODE_RECORD_FORMAT,
        inodeRecords: recordPayload.inodeRecords.length,
        fileRecords: recordPayload.fileRecords.length,
        dirtyInodes: recordPayload.dirtyInodeRecords.length,
        dirtyFiles: recordPayload.dirtyFileRecords.length,
      });
      this.reserveStorageBytes(this.estimatedInodePayloadBytes(recordPayload, transaction), transaction);
      this.updateStatus(recordPayload.manifest, {
        storageFormat: INODE_RECORD_FORMAT,
        inodeRecords: recordPayload.inodeRecords.length,
        fileRecords: recordPayload.fileRecords.length,
        contentBytes: recordPayload.contentBytes,
        dirtyInodes: recordPayload.dirtyInodeRecords.length,
        dirtyFiles: recordPayload.dirtyFileRecords.length,
      });
      this.markWriteQueued(transaction);
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.writeInodeRecordPayload(recordPayload, transaction))
        .then(() => this.markWriteComplete(transaction))
        .catch((error) => {
          this.markWriteError(error, transaction);
          return this.writeSnapshotFallback(root, transaction);
        });
      return;
    }
    const payload = JSON.stringify({
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      root: this.serializeSnapshotTree(root),
    });
    this.reserveStorageBytes(byteLength(payload), { storageFormat: "snapshot", key: this.key });
    this.updateStatus(payload, { storageFormat: "snapshot", inodeRecords: 0, fileRecords: 0, contentBytes: 0, dirtyInodes: 0, dirtyFiles: 0 });
    this.write(this.key, payload);
  }

  clearFileSystem() {
    this.updateStatus("", { inodeRecords: 0, fileRecords: 0, contentBytes: 0, dirtyInodes: 0, dirtyFiles: 0 });
    this.savedInodeHashes = new Map();
    this.savedContentHashes = new Map();
    this.remove(this.key);
  }

  resetFileSystem() {
    this.clearFileSystem();
  }

  status() {
    return { ...this.lastStatus };
  }

  journal() {
    return this.writeJournal.map((entry) => ({ ...entry }));
  }

  async checkIntegrity(options = {}) {
    const dryRun = Boolean(options.dryRun);
    const problems = [];
    const repairs = [];
    let checkedStorage = 1;
    if (!this.opfsProvider) {
      return storageFsckResult({ dryRun, checkedStorage, problems, repairs });
    }
    const activeKey = this.activeStorageTransactionKey();
    const activeRaw = await this.safeOpfsGet(activeKey);
    if (!activeRaw) return storageFsckResult({ dryRun, checkedStorage, problems, repairs });
    let transaction = null;
    try {
      const parsed = JSON.parse(activeRaw);
      if (!parsed || typeof parsed !== "object") throw new Error("active transaction is not an object");
      transaction = parsed;
    } catch (error) {
      problems.push(storageFsckProblem("storage-journal-invalid", activeKey, error?.message || "active transaction cannot be parsed", false));
      return storageFsckResult({ dryRun, checkedStorage, problems, repairs });
    }
    const transactionId = String(transaction.transactionId || "");
    const replayKey = String(transaction.replayManifestKey || "");
    checkedStorage += replayKey ? 1 : 0;
    const replayRaw = replayKey ? await this.safeOpfsGet(replayKey) : "";
    if (replayKey && replayRaw) {
      problems.push(storageFsckProblem(
        "storage-journal-pending-replay",
        replayKey,
        `transaction=${transactionId || "unknown"} active=${activeKey}`,
        false,
      ));
    } else {
      problems.push(storageFsckProblem(
        "storage-journal-partial",
        activeKey,
        `transaction=${transactionId || "unknown"} replay=${replayKey || "missing"}`,
        false,
      ));
    }
    return storageFsckResult({ dryRun, checkedStorage, problems, repairs });
  }

  async estimate() {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    const persisted = await globalThis.navigator?.storage?.persisted?.();
    this.lastStatus = {
      ...this.lastStatus,
      usage: estimate?.usage ?? this.lastStatus.bytes,
      quota: estimate?.quota ?? 0,
      persistentPermission: Boolean(persisted),
    };
    return this.status();
  }

  async persist() {
    const granted = await globalThis.navigator?.storage?.persist?.();
    this.lastStatus = {
      ...this.lastStatus,
      persistentPermission: Boolean(granted),
    };
    return this.status();
  }

  async readValue(key) {
    if (this.indexedDB) {
      try {
        return await this.idbGet(key);
      } catch {
        return this.memory.get(key) ?? null;
      }
    }
    return this.memory.get(key) ?? null;
  }

  writeValue(key, value) {
    if (this.indexedDB) {
      this.markWriteQueued();
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.idbSet(key, value))
        .then(() => this.markWriteComplete())
        .catch(() => {
          this.memory.set(key, value);
          this.markWriteComplete();
        });
      return;
    }
    this.memory.set(key, value);
  }

  removeValue(key) {
    if (this.indexedDB) {
      this.markWriteQueued();
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.idbDelete(key))
        .then(() => this.markWriteComplete())
        .catch(() => {
          this.memory.delete(key);
          this.markWriteComplete();
        });
      return;
    }
    this.memory.delete(key);
  }

  async flush() {
    await this.writeQueue;
  }

  async read(key) {
    if (this.opfsProvider) {
      try {
        const value = await this.opfsGet(key);
        if (value) return value;
      } catch {}
    }
    if (this.indexedDB) {
      try {
        return await this.idbGet(key);
      } catch {
        return this.readFallback(key);
      }
    }
    return this.readFallback(key);
  }

  write(key, value) {
    this.reserveStorageBytes(byteLength(value), { key });
    if (this.opfsProvider) {
      this.markWriteQueued();
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.opfsSet(key, value))
        .then(() => this.markWriteComplete())
        .catch((error) => {
          this.markWriteError(error);
          return this.writeDurableFallback(key, value);
        });
      return;
    }
    if (this.indexedDB) {
      this.markWriteQueued();
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.idbSet(key, value))
        .then(() => this.markWriteComplete())
        .catch((error) => {
          this.markWriteError(error);
          this.writeFallback(key, value);
          this.markWriteComplete();
        });
      return;
    }
    this.markWriteQueued({ backend: this.lastStatus.backend, key });
    this.writeFallback(key, value);
    this.markWriteComplete({ backend: this.lastStatus.backend, key });
  }

  remove(key) {
    if (this.opfsProvider) {
      this.markWriteQueued();
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(async () => {
          await this.opfsDelete(key);
          if (key === this.key) {
            await this.cleanupOpfsFileRecords(new Set());
            await this.cleanupOpfsInodeRecords(new Set());
          }
          await this.removeDurableFallback(key);
        })
        .then(() => this.markWriteComplete())
        .catch((error) => {
          this.markWriteError(error);
          return this.removeDurableFallback(key);
        });
      return;
    }
    if (this.indexedDB) {
      this.markWriteQueued();
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.idbDelete(key))
        .then(() => this.markWriteComplete())
        .catch((error) => {
          this.markWriteError(error);
          this.removeFallback(key);
          this.markWriteComplete();
        });
      return;
    }
    this.removeFallback(key);
  }

  readFallback(key) {
    if (!this.adapter) return this.memory.get(key) || "";
    return this.adapter.getItem(key) || "";
  }

  writeFallback(key, value) {
    if (!this.adapter) {
      this.memory.set(key, value);
      return;
    }
    this.adapter.setItem(key, value);
  }

  removeFallback(key) {
    if (!this.adapter) {
      this.memory.delete(key);
      return;
    }
    this.adapter.removeItem(key);
  }

  async writeDurableFallback(key, value) {
    if (this.indexedDB) {
      try {
        await this.idbSet(key, value);
        return;
      } catch {}
    }
    this.writeFallback(key, value);
  }

  async removeDurableFallback(key) {
    if (this.indexedDB) {
      try {
        await this.idbDelete(key);
      } catch {}
    }
    this.removeFallback(key);
  }

  createInodeRecordPayload(root) {
    const inodeRecords = [];
    const fileRecordsByRef = new Map();
    const rootRef = this.serializeInodeRecordNode(root, "/", inodeRecords, fileRecordsByRef);
    const fileRecords = [...fileRecordsByRef.values()];
    const dirtyInodeRecords = inodeRecords.filter((record) => this.savedInodeHashes.get(record.ref) !== record.hash);
    const dirtyFileRecords = fileRecords.filter((record) => this.savedContentHashes.get(record.ref) !== record.hash);
    const manifestPayload = {
      version: STORAGE_VERSION,
      format: INODE_RECORD_FORMAT,
      savedAt: new Date().toISOString(),
      rootRef,
      inodeRecords: inodeRecords.map(({ metadata, ...record }) => record),
      fileRecords: fileRecords.map(({ content, ...record }) => record),
      contentBytes: fileRecords.reduce((total, record) => total + record.size, 0),
    };
    return {
      manifest: JSON.stringify(manifestPayload),
      inodeRecords,
      fileRecords,
      dirtyInodeRecords,
      dirtyFileRecords,
      contentBytes: manifestPayload.contentBytes,
    };
  }

  serializeInodeRecordNode(node, path, inodeRecords, fileRecordsByRef) {
    if (!node) return "";
    const { path: _path, content, children, ...snapshot } = node;
    const nodePath = path === "/" ? "/" : path;
    const ref = stableInodeRef(nodePath);
    let metadata;
    if (node.type === "file") {
      const recordContent = serializeFileContentRecord(content);
      const contentRef = contentRecordRef(recordContent);
      const contentKey = this.fileRecordKey(contentRef);
      const size = fileContentByteLength(content);
      if (!fileRecordsByRef.has(contentRef)) {
        fileRecordsByRef.set(contentRef, {
          ref: contentRef,
          key: contentKey,
          path: nodePath,
          size,
          hash: contentRef,
          content: recordContent,
        });
      }
      metadata = {
        ...snapshot,
        size,
        contentRef,
        contentEncoding: "dindbos-content-record-v1",
      };
    } else {
      metadata = {
        ...snapshot,
        children: children
          ?.filter((child) => !child.transient)
          .map((child) => this.serializeInodeRecordNode(child, joinPath(nodePath, child.name), inodeRecords, fileRecordsByRef))
          .filter(Boolean),
      };
    }
    const serialized = JSON.stringify(metadata);
    inodeRecords.push({
      ref,
      key: this.inodeRecordKey(ref),
      path: nodePath,
      type: node.type,
      hash: hashString(serialized),
      size: byteLength(serialized),
      metadata: serialized,
    });
    return ref;
  }

  async hydrateInodeRecordTree(ref) {
    const raw = await this.opfsGet(this.inodeRecordKey(ref));
    const node = JSON.parse(raw);
    const { children, contentRef, contentEncoding: _encoding, ...snapshot } = node;
    if (node.type === "file") {
      let content = "";
      try {
        content = contentRef ? parseFileContentRecord(await this.opfsGet(this.fileRecordKey(contentRef))) : "";
      } catch {
        content = node.content || "";
      }
      return {
        ...snapshot,
        content,
        size: node.size ?? fileContentByteLength(content),
      };
    }
    return {
      ...snapshot,
      children: children ? await Promise.all(children.map((childRef) => this.hydrateInodeRecordTree(childRef))) : children,
    };
  }

  async writeInodeRecordPayload(payload, transaction = {}) {
    const activeTransaction = {
      ...transaction,
      replayManifestKey: transaction.transactionId ? this.replayStorageTransactionKey(transaction.transactionId) : "",
    };
    await this.writeActiveStorageTransaction(activeTransaction);
    for (const record of payload.dirtyFileRecords) {
      await this.opfsSet(record.key, record.content);
    }
    for (const record of payload.dirtyInodeRecords) {
      await this.opfsSet(record.key, record.metadata);
    }
    if (activeTransaction.replayManifestKey) await this.opfsSet(activeTransaction.replayManifestKey, payload.manifest);
    await this.opfsSet(this.key, payload.manifest);
    await this.cleanupOpfsFileRecords(new Set(payload.fileRecords.map((record) => opfsFileName(record.key))));
    await this.cleanupOpfsInodeRecords(new Set(payload.inodeRecords.map((record) => opfsFileName(record.key))));
    this.savedInodeHashes = new Map(payload.inodeRecords.map((record) => [record.ref, record.hash]));
    this.savedContentHashes = new Map(payload.fileRecords.map((record) => [record.ref, record.hash]));
    await this.clearActiveStorageTransaction(activeTransaction);
  }

  rememberRecordHashes(payload) {
    this.savedInodeHashes = new Map((payload.inodeRecords || []).map((record) => [record.ref, record.hash]));
    this.savedContentHashes = new Map((payload.fileRecords || []).map((record) => [record.ref, record.hash]));
  }

  async validateInodeRecordPayload(payload = {}) {
    const mismatches = [];
    for (const record of payload.inodeRecords || []) {
      try {
        const raw = await this.opfsGet(record.key);
        const actualHash = hashString(raw);
        if (actualHash !== record.hash) {
          mismatches.push({
            kind: "inode-record",
            path: record.path || "",
            ref: record.ref || "",
            expected: record.hash || "",
            actual: actualHash,
          });
        }
      } catch {
        mismatches.push({
          kind: "inode-record-missing",
          path: record.path || "",
          ref: record.ref || "",
          expected: record.hash || "",
          actual: "missing",
        });
      }
    }
    for (const record of payload.fileRecords || []) {
      try {
        const raw = await this.opfsGet(record.key);
        const actualRef = contentRecordRef(raw);
        if (actualRef !== record.hash || actualRef !== record.ref) {
          mismatches.push({
            kind: "file-content-record",
            path: record.path || "",
            ref: record.ref || "",
            expected: record.hash || record.ref || "",
            actual: actualRef,
          });
        }
      } catch {
        mismatches.push({
          kind: "file-content-record-missing",
          path: record.path || "",
          ref: record.ref || "",
          expected: record.hash || record.ref || "",
          actual: "missing",
        });
      }
    }
    if (!mismatches.length) {
      this.lastStatus = { ...this.lastStatus, storageIntegrityMismatches: [] };
      return [];
    }
    this.recordStorageJournal("storage-integrity-mismatch", {
      storageFormat: INODE_RECORD_FORMAT,
      transactionKind: "filesystem-load",
      error: "inode-content-mismatch",
      inodeRecords: mismatches.filter((entry) => entry.kind.startsWith("inode")).length,
      fileRecords: mismatches.filter((entry) => entry.kind.startsWith("file")).length,
    });
    this.lastStatus = {
      ...this.lastStatus,
      storageIntegrityMismatches: mismatches.slice(0, 25),
    };
    return mismatches;
  }

  createFileRecordPayload(root) {
    const records = [];
    const tree = this.serializeFileRecordNode(root, "/", records);
    const manifestPayload = {
      version: STORAGE_VERSION,
      format: FILE_RECORD_FORMAT,
      savedAt: new Date().toISOString(),
      root: tree,
      fileRecords: records.map(({ content, ...record }) => record),
      contentBytes: records.reduce((total, record) => total + record.size, 0),
    };
    return {
      manifest: JSON.stringify(manifestPayload),
      records,
      contentBytes: manifestPayload.contentBytes,
    };
  }

  serializeFileRecordNode(node, path, records) {
    if (!node) return null;
    const { path: _path, content, children, ...snapshot } = node;
    const nodePath = path === "/" ? "/" : path;
    if (node.type === "file") {
      const text = serializeFileContentRecord(content);
      const ref = stableFileRef(nodePath);
      const key = this.fileRecordKey(ref);
      const size = fileContentByteLength(content);
      records.push({
        ref,
        key,
        path: nodePath,
        size,
        modified: node.modified || "",
        content: text,
      });
      return {
        ...snapshot,
        size,
        contentRef: ref,
        contentEncoding: "dindbos-content-record-v1",
      };
    }
    return {
      ...snapshot,
      children: children
        ?.filter((child) => !child.transient)
        .map((child) => this.serializeFileRecordNode(child, joinPath(nodePath, child.name), records))
        .filter(Boolean),
    };
  }

  async hydrateFileRecordTree(node) {
    if (!node) return null;
    const { children, contentRef, contentEncoding: _encoding, ...snapshot } = node;
    if (node.type === "file" && contentRef) {
      let content = "";
      try {
        content = parseFileContentRecord(await this.opfsGet(this.fileRecordKey(contentRef)));
      } catch {
        content = node.content || "";
      }
      return {
        ...snapshot,
        content,
        size: node.size ?? fileContentByteLength(content),
      };
    }
    return {
      ...snapshot,
      children: children ? await Promise.all(children.map((child) => this.hydrateFileRecordTree(child))) : children,
    };
  }

  async writeFileRecordPayload(payload) {
    for (const record of payload.records) {
      await this.opfsSet(record.key, record.content);
    }
    await this.opfsSet(this.key, payload.manifest);
    await this.cleanupOpfsFileRecords(new Set(payload.records.map((record) => opfsFileName(record.key))));
  }

  async writeSnapshotFallback(root, transaction = {}) {
    const payload = JSON.stringify({
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      root: this.serializeSnapshotTree(root),
    });
    const fallbackTransaction = transaction.transactionId ? {
      ...transaction,
      transactionKind: `${transaction.transactionKind || "filesystem-save"}-fallback`,
      storageFormat: "snapshot-fallback",
    } : {};
    this.updateStatus(payload, { storageFormat: "snapshot-fallback", inodeRecords: 0, fileRecords: 0, contentBytes: 0, dirtyInodes: 0, dirtyFiles: 0 });
    try {
      await this.opfsDelete(this.key);
    } catch {}
    await this.writeDurableFallback(this.key, payload);
    await this.clearActiveStorageTransaction().catch(() => {});
    this.markWriteComplete(fallbackTransaction);
  }

  markWriteQueued(details = {}) {
    const entry = this.recordStorageJournal("write-queued", details);
    this.activeWriteJournalId = entry.id;
    this.activeStorageTransactionId = entry.transactionId || details.transactionId || "";
    this.lastStatus = {
      ...this.lastStatus,
      writePending: true,
      lastWriteQueuedAt: new Date().toISOString(),
      lastWriteError: "",
    };
  }

  markWriteComplete(details = {}) {
    this.recordStorageJournal("write-completed", {
      journalId: this.activeWriteJournalId,
      transactionId: this.activeStorageTransactionId,
      ...details,
    });
    this.lastStatus = {
      ...this.lastStatus,
      writePending: false,
      lastWriteCompletedAt: new Date().toISOString(),
    };
  }

  markWriteError(error, details = {}) {
    this.recordStorageJournal("write-error", {
      journalId: this.activeWriteJournalId,
      transactionId: this.activeStorageTransactionId,
      error: error?.message || String(error),
      ...details,
    });
    this.lastStatus = {
      ...this.lastStatus,
      writePending: false,
      lastWriteError: error?.message || String(error),
    };
  }

  createStorageTransaction(kind, details = {}) {
    return {
      transactionId: `storage-tx-${this.nextTransactionId++}`,
      transactionKind: String(kind || "storage-write"),
      ...details,
    };
  }

  estimatedInodePayloadBytes(payload = {}, transaction = {}) {
    return byteLength(payload.manifest)
      + byteLength(JSON.stringify(transaction))
      + (payload.dirtyFileRecords || []).reduce((total, record) => total + byteLength(record.content), 0)
      + (payload.dirtyInodeRecords || []).reduce((total, record) => total + byteLength(record.metadata), 0);
  }

  reserveStorageBytes(requiredBytes, details = {}) {
    const storageClass = storageClassForReservation(details);
    const quota = Math.max(0, Number(details.quotaBytes || this.quotaBytes || this.lastStatus.quota || 0));
    const usage = Math.max(0, Number(details.usageBytes ?? this.lastStatus.usage ?? 0));
    const required = Math.max(0, Number(requiredBytes || 0));
    const classQuota = Math.max(0, Number(details.storageClassQuotaBytes ?? this.storageClassQuotas[storageClass] ?? 0));
    const classUsage = Math.max(0, Number(details.storageClassUsageBytes ?? this.storageClassUsage.get(storageClass) ?? 0));
    if (!quota && !classQuota) {
      this.lastStatus = {
        ...this.lastStatus,
        lastQuotaReservation: null,
      };
      return true;
    }
    const available = Math.max(0, quota - usage);
    const classAvailable = Math.max(0, classQuota - classUsage);
    const globalAllowed = !quota || required <= available;
    const classAllowed = !classQuota || required <= classAvailable;
    const allowed = globalAllowed && classAllowed;
    const reason = allowed ? "" : classAllowed ? "quota-exceeded" : "storage-class-quota-exceeded";
    const reservation = {
      requiredBytes: required,
      usageBytes: usage,
      quotaBytes: quota,
      availableBytes: available,
      storageClass,
      storageClassUsageBytes: classUsage,
      storageClassQuotaBytes: classQuota,
      storageClassAvailableBytes: classAvailable,
      allowed,
      reason,
      at: new Date().toISOString(),
    };
    this.lastStatus = {
      ...this.lastStatus,
      quotaLimitBytes: quota,
      storageClassQuotas: { ...this.storageClassQuotas },
      lastQuotaReservation: reservation,
    };
    if (allowed) {
      if (storageClass && classQuota && details.trackStorageClassUsage !== false) {
        this.storageClassUsage.set(storageClass, classUsage + required);
        this.lastStatus = {
          ...this.lastStatus,
          storageClassUsage: Object.fromEntries(this.storageClassUsage),
          lastQuotaReservation: {
            ...reservation,
            storageClassReservedBytes: classUsage + required,
          },
        };
      }
      this.recordStorageJournal("quota-reserved", { ...details, storageClass });
      return true;
    }
    this.recordStorageJournal("quota-denied", {
      ...details,
      storageClass,
      error: reason,
    });
    if (reason === "storage-class-quota-exceeded") {
      throw new Error(`storage class quota exceeded: class=${storageClass || "global"} required=${required} available=${classAvailable} quota=${classQuota}`);
    }
    throw new Error(`storage quota exceeded: required=${required} available=${available} quota=${quota}`);
  }

  activeStorageTransactionKey() {
    return `${this.key}:journal:active`;
  }

  replayStorageTransactionKey(transactionId) {
    return `${this.key}:journal:replay:${String(transactionId || "pending")}`;
  }

  async writeActiveStorageTransaction(transaction = {}) {
    if (!transaction.transactionId) return;
    await this.opfsSet(this.activeStorageTransactionKey(), JSON.stringify({
      ...transaction,
      state: "active",
      updatedAt: new Date().toISOString(),
    }));
  }

  async clearActiveStorageTransaction(transaction = null) {
    if (!this.opfsProvider) return;
    const active = transaction || await this.readActiveStorageTransaction();
    if (active?.replayManifestKey) {
      try {
        await this.opfsDelete(active.replayManifestKey);
      } catch {}
    }
    await this.opfsDelete(this.activeStorageTransactionKey());
  }

  async readActiveStorageTransaction() {
    if (!this.opfsProvider) return null;
    try {
      const raw = await this.opfsGet(this.activeStorageTransactionKey());
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  async safeOpfsGet(key) {
    try {
      return await this.opfsGet(key);
    } catch {
      return "";
    }
  }

  recordStorageRecoveryDecision(transaction = {}, raw = "") {
    const decision = transaction.decision || (raw ? "load-last-complete-manifest" : "no-complete-manifest");
    const entry = this.recordStorageJournal("write-recovery", {
      ...transaction,
      transactionId: transaction.transactionId || "",
      transactionKind: transaction.transactionKind || "filesystem-save",
      error: "interrupted-write",
    });
    this.lastStatus = {
      ...this.lastStatus,
      storageRecoveryDecision: {
        transactionId: entry.transactionId,
        transactionKind: entry.transactionKind,
        decision,
        reason: "interrupted-write",
        detectedAt: entry.at,
      },
    };
    return this.lastStatus.storageRecoveryDecision;
  }

  async replayInterruptedStorageTransaction(transaction = {}, raw = "") {
    if (!transaction.replayManifestKey) {
      this.recordStorageRecoveryDecision(transaction, raw);
      return raw;
    }
    try {
      const replayRaw = await this.opfsGet(transaction.replayManifestKey);
      const replayPayload = JSON.parse(replayRaw);
      if (replayPayload.version !== STORAGE_VERSION || replayPayload.format !== INODE_RECORD_FORMAT) {
        throw new Error("replay manifest is not an inode-record filesystem payload");
      }
      const mismatches = await this.validateInodeRecordPayload(replayPayload);
      if (mismatches.length) throw new Error("replay manifest records failed integrity validation");
      await this.opfsSet(this.key, replayRaw);
      await this.clearActiveStorageTransaction(transaction);
      this.recordStorageRecoveryDecision({
        ...transaction,
        decision: "replay-pending-manifest",
      }, replayRaw);
      return replayRaw;
    } catch (error) {
      this.recordStorageRecoveryDecision({
        ...transaction,
        decision: raw ? "load-last-complete-manifest" : "no-complete-manifest",
        replayError: error?.message || String(error),
      }, raw);
      return raw;
    }
  }

  recordStorageJournal(action, details = {}) {
    const entry = {
      id: `storage-journal-${this.nextJournalId++}`,
      at: new Date().toISOString(),
      action: String(action || "write"),
      backend: String(details.backend || this.lastStatus.backend || "memory"),
      storageFormat: String(details.storageFormat || this.lastStatus.storageFormat || ""),
      key: String(details.key || this.key || ""),
      journalId: String(details.journalId || ""),
      transactionId: String(details.transactionId || this.activeStorageTransactionId || ""),
      transactionKind: String(details.transactionKind || ""),
      storageClass: String(details.storageClass || ""),
      dirtyFiles: Number(details.dirtyFiles || 0),
      dirtyInodes: Number(details.dirtyInodes || 0),
      fileRecords: Number(details.fileRecords || 0),
      inodeRecords: Number(details.inodeRecords || 0),
      error: String(details.error || ""),
    };
    this.writeJournal.push(entry);
    this.writeJournal = this.writeJournal.slice(-100);
    this.lastStatus = {
      ...this.lastStatus,
      storageJournalRecords: this.writeJournal.length,
      lastStorageJournalAction: entry.action,
      lastStorageTransactionId: entry.transactionId,
    };
    return entry;
  }

  serializeSnapshotTree(node) {
    if (!node) return null;
    const { content, children, ...snapshot } = node;
    if (node.type === "file") {
      return {
        ...snapshot,
        content: serializeFileContentRecord(content),
        contentEncoding: "dindbos-content-record-v1",
        size: fileContentByteLength(content),
      };
    }
    return {
      ...snapshot,
      children: children
        ?.filter((child) => !child.transient)
        .map((child) => this.serializeSnapshotTree(child))
        .filter(Boolean),
    };
  }

  hydrateSnapshotTree(node) {
    if (!node) return null;
    const { children, content, contentEncoding: _encoding, ...snapshot } = node;
    if (node.type === "file") {
      const parsedContent = parseFileContentRecord(content);
      return {
        ...snapshot,
        content: parsedContent,
        size: node.size ?? fileContentByteLength(parsedContent),
      };
    }
    return {
      ...snapshot,
      children: children?.map((child) => this.hydrateSnapshotTree(child)),
    };
  }

  async cleanupOpfsFileRecords(activeNames) {
    await this.cleanupOpfsRecords("file", activeNames);
  }

  async cleanupOpfsInodeRecords(activeNames) {
    await this.cleanupOpfsRecords("inode", activeNames);
  }

  async cleanupOpfsRecords(kind, activeNames) {
    const root = await this.openOpfsRoot();
    if (typeof root.entries !== "function") return;
    const prefix = opfsFileName(this.recordKey(kind, "")).replace(/\.json$/, "");
    for await (const [name] of root.entries()) {
      if (name.startsWith(prefix) && !activeNames.has(name)) {
        try {
          await root.removeEntry(name);
        } catch {}
      }
    }
  }

  fileRecordKey(ref) {
    return this.recordKey("file", ref);
  }

  inodeRecordKey(ref) {
    return this.recordKey("inode", ref);
  }

  recordKey(kind, ref) {
    return `${this.key}:${kind}:${ref}`;
  }

  async opfsGet(key) {
    const root = await this.openOpfsRoot();
    const handle = await root.getFileHandle(opfsFileName(key));
    const file = await handle.getFile();
    return file.text();
  }

  async opfsSet(key, value) {
    const root = await this.openOpfsRoot();
    const handle = await root.getFileHandle(opfsFileName(key), { create: true });
    const writable = await handle.createWritable();
    await writable.write(String(value ?? ""));
    await writable.close();
  }

  async opfsDelete(key) {
    const root = await this.openOpfsRoot();
    try {
      await root.removeEntry(opfsFileName(key));
    } catch {}
  }

  openOpfsRoot() {
    if (!this.opfsProvider) throw new Error("OPFS is not available");
    if (!this.opfsRootPromise) this.opfsRootPromise = this.opfsProvider();
    return this.opfsRootPromise;
  }

  async idbGet(key) {
    const db = await this.openDb();
    return requestToPromise(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key));
  }

  async idbSet(key, value) {
    const db = await this.openDb();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(value, key);
    await transactionDone(transaction);
  }

  async idbDelete(key) {
    const db = await this.openDb();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    await transactionDone(transaction);
  }

  openDb() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  updateStatus(raw, extra = {}) {
    this.lastStatus = {
      ...this.lastStatus,
      bytes: raw ? new TextEncoder().encode(raw).length : 0,
      persisted: Boolean(raw),
      ...extra,
    };
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || "");
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function safeIndexedDB() {
  try {
    return globalThis.indexedDB || null;
  } catch {
    return null;
  }
}

function safeOpfsProvider() {
  try {
    const getDirectory = globalThis.navigator?.storage?.getDirectory;
    return typeof getDirectory === "function" ? getDirectory.bind(globalThis.navigator.storage) : null;
  } catch {
    return null;
  }
}

function opfsFileName(key) {
  return `${String(key || "dindbos").replace(/[^A-Za-z0-9._-]+/g, "_")}.json`;
}

function stableFileRef(path) {
  const value = String(path || "/");
  return `${hashString(value)}-${value.length}`;
}

function stableInodeRef(path) {
  return stableFileRef(path);
}

function contentRecordRef(content) {
  const text = String(content ?? "");
  return `${hashString(text)}-${byteLength(text)}`;
}

function hashString(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function joinPath(base, name) {
  if (!base || base === "/") return `/${name}`;
  return `${base}/${name}`;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).length;
}

function normalizeStorageClassQuotas(value = {}) {
  return Object.fromEntries(Object.entries(value)
    .map(([key, quota]) => [String(key || "").trim(), Math.max(0, Number(quota || 0))])
    .filter(([key, quota]) => key && quota > 0));
}

function storageFsckProblem(code, path, message, repairable = false) {
  return {
    code,
    path,
    message,
    repairable: Boolean(repairable),
  };
}

function storageFsckResult({ dryRun, checkedStorage, problems, repairs }) {
  return {
    ok: problems.length === 0,
    dryRun,
    checkedStorage,
    problemCount: problems.length,
    repairCount: repairs.length,
    problems,
    repairs,
  };
}

function storageClassForReservation(details = {}) {
  if (details.storageClass) return String(details.storageClass);
  const transactionKind = String(details.transactionKind || "");
  const storageFormat = String(details.storageFormat || "");
  const key = String(details.key || "");
  const source = String(details.source || "");
  const path = String(details.path || "");
  if (transactionKind === "package-install" || storageFormat === "package-install" || key.startsWith("package:")) return "package-roots";
  if (path.startsWith("/var/lib/dindbos/packages") || path.startsWith("/var/lib/dindbos/app-state")) return "package-state";
  if (path.startsWith("/var/cache")) return "cache";
  if (path.startsWith("/tmp") || source === "archive") return "temp";
  if (path.startsWith("/var/log")) return "logs";
  if (path.includes("/backup") || key.includes("backup")) return "backups";
  if (path.includes("sync") || key.includes("sync") || transactionKind.includes("sync")) return "sync-staging";
  if (path.includes("recovery") || key.includes("recovery")) return "recovery";
  if (storageFormat === "snapshot" || transactionKind === "filesystem-save") return "snapshots";
  return "user-data";
}

function safeLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    const probe = "__dindbos_probe__";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
