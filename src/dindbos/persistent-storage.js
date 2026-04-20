const STORAGE_VERSION = 1;

export class PersistentStorage {
  constructor(options = {}) {
    this.key = options.key || "dindbos:vfs";
    this.adapter = options.adapter || safeLocalStorage();
    this.memory = new Map();
  }

  loadFileSystem() {
    const raw = this.read(this.key);
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
    try {
      this.write(this.key, JSON.stringify({
        version: STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        root,
      }));
    } catch {
      this.memory.set(this.key, JSON.stringify({ version: STORAGE_VERSION, savedAt: new Date().toISOString(), root }));
    }
  }

  clearFileSystem() {
    this.remove(this.key);
  }

  status() {
    const raw = this.read(this.key);
    return {
      key: this.key,
      enabled: Boolean(this.adapter),
      bytes: raw ? new TextEncoder().encode(raw).length : 0,
      persisted: Boolean(raw),
    };
  }

  read(key) {
    if (!this.adapter) return this.memory.get(key) || "";
    return this.adapter.getItem(key) || "";
  }

  write(key, value) {
    if (!this.adapter) {
      this.memory.set(key, value);
      return;
    }
    this.adapter.setItem(key, value);
  }

  remove(key) {
    if (!this.adapter) {
      this.memory.delete(key);
      return;
    }
    this.adapter.removeItem(key);
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
