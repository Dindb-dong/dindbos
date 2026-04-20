import { fileContentByteLength, parseFileContentRecord, serializeFileContentRecord } from "./file-data.js?v=20260421-native-bytes";

const STORAGE_VERSION = 2;
const STORE_NAME = "kv";
const FILE_RECORD_FORMAT = "opfs-file-records";
const INODE_RECORD_FORMAT = "opfs-inode-records";

export class PersistentStorage {
  constructor(options = {}) {
    this.key = options.key || "dindbos:vfs";
    this.dbName = options.dbName || "dindbos";
    this.adapter = options.adapter || safeLocalStorage();
    this.indexedDB = options.indexedDB || safeIndexedDB();
    this.opfsProvider = options.opfsProvider || (options.opfsRoot ? async () => options.opfsRoot : safeOpfsProvider());
    this.opfsRootPromise = null;
    this.savedInodeHashes = new Map();
    this.savedContentHashes = new Map();
    this.memory = new Map();
    this.dbPromise = null;
    this.writeQueue = Promise.resolve();
    this.lastStatus = {
      key: this.key,
      backend: this.opfsProvider ? "opfs" : this.indexedDB ? "indexedDB" : this.adapter ? "localStorage" : "memory",
      structuredBackend: this.indexedDB ? "indexedDB" : "memory",
      enabled: Boolean(this.opfsProvider || this.indexedDB || this.adapter),
      bytes: 0,
      persisted: false,
    };
  }

  async loadFileSystem() {
    const raw = await this.read(this.key);
    this.updateStatus(raw);
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw);
      if (payload.version !== STORAGE_VERSION) return null;
      if (payload.format === INODE_RECORD_FORMAT) {
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
      this.updateStatus(recordPayload.manifest, {
        storageFormat: INODE_RECORD_FORMAT,
        inodeRecords: recordPayload.inodeRecords.length,
        fileRecords: recordPayload.fileRecords.length,
        contentBytes: recordPayload.contentBytes,
        dirtyInodes: recordPayload.dirtyInodeRecords.length,
        dirtyFiles: recordPayload.dirtyFileRecords.length,
      });
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.writeInodeRecordPayload(recordPayload))
        .catch(() => this.writeSnapshotFallback(root));
      return;
    }
    const payload = JSON.stringify({
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      root: this.serializeSnapshotTree(root),
    });
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
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.idbSet(key, value))
        .catch(() => {
          this.memory.set(key, value);
        });
      return;
    }
    this.memory.set(key, value);
  }

  removeValue(key) {
    if (this.indexedDB) {
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.idbDelete(key))
        .catch(() => {
          this.memory.delete(key);
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
    if (this.opfsProvider) {
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.opfsSet(key, value))
        .catch(() => this.writeDurableFallback(key, value));
      return;
    }
    if (this.indexedDB) {
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.idbSet(key, value))
        .catch(() => this.writeFallback(key, value));
      return;
    }
    this.writeFallback(key, value);
  }

  remove(key) {
    if (this.opfsProvider) {
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
        .catch(() => this.removeDurableFallback(key));
      return;
    }
    if (this.indexedDB) {
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.idbDelete(key))
        .catch(() => this.removeFallback(key));
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

  async writeInodeRecordPayload(payload) {
    for (const record of payload.dirtyFileRecords) {
      await this.opfsSet(record.key, record.content);
    }
    for (const record of payload.dirtyInodeRecords) {
      await this.opfsSet(record.key, record.metadata);
    }
    await this.opfsSet(this.key, payload.manifest);
    await this.cleanupOpfsFileRecords(new Set(payload.fileRecords.map((record) => opfsFileName(record.key))));
    await this.cleanupOpfsInodeRecords(new Set(payload.inodeRecords.map((record) => opfsFileName(record.key))));
    this.savedInodeHashes = new Map(payload.inodeRecords.map((record) => [record.ref, record.hash]));
    this.savedContentHashes = new Map(payload.fileRecords.map((record) => [record.ref, record.hash]));
  }

  rememberRecordHashes(payload) {
    this.savedInodeHashes = new Map((payload.inodeRecords || []).map((record) => [record.ref, record.hash]));
    this.savedContentHashes = new Map((payload.fileRecords || []).map((record) => [record.ref, record.hash]));
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

  async writeSnapshotFallback(root) {
    const payload = JSON.stringify({
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      root: this.serializeSnapshotTree(root),
    });
    this.updateStatus(payload, { storageFormat: "snapshot-fallback", inodeRecords: 0, fileRecords: 0, contentBytes: 0, dirtyInodes: 0, dirtyFiles: 0 });
    try {
      await this.opfsDelete(this.key);
    } catch {}
    await this.writeDurableFallback(this.key, payload);
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
