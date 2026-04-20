const STORAGE_VERSION = 2;
const STORE_NAME = "kv";
const FILE_RECORD_FORMAT = "opfs-file-records";

export class PersistentStorage {
  constructor(options = {}) {
    this.key = options.key || "dindbos:vfs";
    this.dbName = options.dbName || "dindbos";
    this.adapter = options.adapter || safeLocalStorage();
    this.indexedDB = options.indexedDB || safeIndexedDB();
    this.opfsProvider = options.opfsProvider || (options.opfsRoot ? async () => options.opfsRoot : safeOpfsProvider());
    this.opfsRootPromise = null;
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
      if (payload.format === FILE_RECORD_FORMAT) {
        this.lastStatus = {
          ...this.lastStatus,
          storageFormat: FILE_RECORD_FORMAT,
          fileRecords: payload.fileRecords?.length || 0,
          contentBytes: payload.contentBytes || 0,
        };
        return await this.hydrateFileRecordTree(payload.root || null);
      }
      return payload.root || null;
    } catch {
      return null;
    }
  }

  saveFileSystem(root) {
    if (this.opfsProvider) {
      const recordPayload = this.createFileRecordPayload(root);
      this.updateStatus(recordPayload.manifest, {
        storageFormat: FILE_RECORD_FORMAT,
        fileRecords: recordPayload.records.length,
        contentBytes: recordPayload.contentBytes,
      });
      this.writeQueue = this.writeQueue
        .catch(() => {})
        .then(() => this.writeFileRecordPayload(recordPayload))
        .catch(() => this.writeSnapshotFallback(root));
      return;
    }
    const payload = JSON.stringify({
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      root,
    });
    this.updateStatus(payload, { storageFormat: "snapshot", fileRecords: 0, contentBytes: 0 });
    this.write(this.key, payload);
  }

  clearFileSystem() {
    this.updateStatus("");
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
          if (key === this.key) await this.cleanupOpfsFileRecords(new Set());
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
      const text = String(content ?? "");
      const ref = stableFileRef(nodePath);
      const key = this.fileRecordKey(ref);
      const size = byteLength(text);
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
        contentEncoding: "utf-8",
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
        content = await this.opfsGet(this.fileRecordKey(contentRef));
      } catch {
        content = node.content || "";
      }
      return {
        ...snapshot,
        content,
        size: node.size ?? byteLength(content),
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
      root,
    });
    this.updateStatus(payload, { storageFormat: "snapshot-fallback", fileRecords: 0, contentBytes: 0 });
    await this.writeDurableFallback(this.key, payload);
  }

  async cleanupOpfsFileRecords(activeNames) {
    const root = await this.openOpfsRoot();
    if (typeof root.entries !== "function") return;
    const prefix = opfsFileName(this.fileRecordKey("")).replace(/\.json$/, "");
    for await (const [name] of root.entries()) {
      if (name.startsWith(prefix) && !activeNames.has(name)) {
        try {
          await root.removeEntry(name);
        } catch {}
      }
    }
  }

  fileRecordKey(ref) {
    return `${this.key}:file:${ref}`;
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
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}-${value.length}`;
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
