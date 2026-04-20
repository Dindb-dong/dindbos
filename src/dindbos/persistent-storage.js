const STORAGE_VERSION = 2;
const STORE_NAME = "kv";

export class PersistentStorage {
  constructor(options = {}) {
    this.key = options.key || "dindbos:vfs";
    this.dbName = options.dbName || "dindbos";
    this.adapter = options.adapter || safeLocalStorage();
    this.indexedDB = options.indexedDB || safeIndexedDB();
    this.memory = new Map();
    this.dbPromise = null;
    this.lastStatus = {
      key: this.key,
      backend: this.indexedDB ? "indexedDB" : this.adapter ? "localStorage" : "memory",
      enabled: Boolean(this.indexedDB || this.adapter),
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
      return payload.root || null;
    } catch {
      return null;
    }
  }

  saveFileSystem(root) {
    const payload = JSON.stringify({
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      root,
    });
    this.updateStatus(payload);
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

  async read(key) {
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
    if (this.indexedDB) {
      this.idbSet(key, value).catch(() => this.writeFallback(key, value));
      return;
    }
    this.writeFallback(key, value);
  }

  remove(key) {
    if (this.indexedDB) {
      this.idbDelete(key).catch(() => this.removeFallback(key));
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

  updateStatus(raw) {
    this.lastStatus = {
      ...this.lastStatus,
      bytes: raw ? new TextEncoder().encode(raw).length : 0,
      persisted: Boolean(raw),
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
