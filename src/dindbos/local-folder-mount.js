export class LocalFolderMountManager {
  constructor(os, options = {}) {
    this.os = os;
    this.picker = options.picker || globalThis.showDirectoryPicker?.bind(globalThis) || null;
    this.storageKey = options.storageKey || "dindbos:local-folder-mounts";
    this.defaultMode = options.mode || "readwrite";
    this.mounts = new Map();
    this.encoder = new TextEncoder();
  }

  supported() {
    return Boolean(this.picker);
  }

  async mountLocal(name = "", options = {}) {
    if (!this.supported() && !options.handle) throw new Error("mount-local: File System Access API is not available");
    const handle = options.handle || await this.picker({ mode: options.mode || "readwrite" });
    if (!handle || handle.kind !== "directory") throw new Error("mount-local: directory handle required");
    const mode = options.mode || this.defaultMode;
    await requestDirectoryPermission(handle, mode);
    return this.attachMount(name || handle.name || "local", handle, {
      mode,
      persist: options.persist !== false,
    });
  }

  async attachMount(name, handle, options = {}) {
    const mountName = sanitizeMountName(name || handle.name || "local");
    const requestedPath = options.path ? this.os.fs.normalize(options.path) : "";
    const path = requestedPath || this.allocateMountPath(`/mnt/${mountName}`);
    this.ensureMountRoot();
    const node = this.os.fs.createMount(path, {
      handleName: options.handleName || handle.name || mountName,
      owner: this.os.session.user || "guest",
      group: "users",
    });
    const record = {
      id: node.path,
      path: node.path,
      name: mountName,
      handle,
      handleName: options.handleName || handle.name || mountName,
      mode: options.mode || this.defaultMode,
    };
    this.mounts.set(node.path, record);
    await this.syncDirectory(node.path);
    if (options.persist !== false) await this.persistMount(record);
    return this.summary(record, { persisted: options.persist !== false, status: "mounted" });
  }

  async unmount(path, options = {}) {
    const normalized = this.os.fs.normalize(path);
    const mount = this.mountFor(normalized);
    if (!mount || mount.path !== normalized) throw new Error(`umount: ${path}: not a mount root`);
    this.mounts.delete(mount.path);
    if (this.os.fs.exists(mount.path)) this.os.fs.remove(mount.path, "/", { recursive: true }, this.os.permissions.systemPrincipal());
    if (options.forget) await this.forgetMount(mount.path);
    return this.summary(mount, { persisted: !options.forget, status: "unmounted" });
  }

  listMounts() {
    return [...this.mounts.values()].map((mount) => this.summary(mount));
  }

  async listPersistedMounts() {
    const records = await this.loadPersistedRecords();
    return Promise.all(records.map(async (record) => {
      try {
        const status = this.mounts.has(record.path)
          ? "mounted"
          : await directoryPermissionState(record.handle, record.mode || this.defaultMode);
        return this.summary(record, { persisted: true, status });
      } catch (error) {
        return this.summary(record, {
          persisted: true,
          status: "error",
          error: error?.message || String(error),
        });
      }
    }));
  }

  async status() {
    const byPath = new Map();
    const persisted = await this.listPersistedMounts();
    const persistedPaths = new Set(persisted.map((mount) => mount.path));
    persisted.forEach((mount) => byPath.set(mount.path, mount));
    this.listMounts().forEach((mount) => byPath.set(mount.path, { ...mount, persisted: persistedPaths.has(mount.path), status: "mounted" }));
    return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  async restorePersistedMounts(options = {}) {
    const records = await this.loadPersistedRecords();
    const results = [];
    for (const record of records) {
      const path = this.os.fs.normalize(record.path || `/mnt/${sanitizeMountName(record.name || record.handleName || "local")}`);
      const mode = record.mode || this.defaultMode;
      try {
        if (!record.handle || record.handle.kind !== "directory") {
          results.push(this.summary({ ...record, path }, { persisted: true, status: "invalid" }));
          continue;
        }
        if (this.mounts.has(path)) {
          results.push(this.summary({ ...record, path }, { persisted: true, status: "mounted" }));
          continue;
        }
        const permission = await directoryPermissionState(record.handle, mode);
        if (permission !== "granted") {
          if (!options.request) {
            results.push(this.summary({ ...record, path }, { persisted: true, status: permission }));
            continue;
          }
          await requestDirectoryPermission(record.handle, mode);
        }
        this.ensureMountRoot();
        if (this.os.fs.exists(path)) {
          results.push(this.summary({ ...record, path }, { persisted: true, status: "conflict" }));
          continue;
        }
        const mounted = await this.attachMount(record.name || record.handleName || "local", record.handle, {
          path,
          handleName: record.handleName,
          mode,
          persist: false,
        });
        results.push({ ...mounted, persisted: true, status: "mounted" });
      } catch (error) {
        results.push(this.summary({ ...record, path }, {
          persisted: true,
          status: "error",
          error: error?.message || String(error),
        }));
      }
    }
    return results;
  }

  async persistMount(mount) {
    const records = await this.loadPersistedRecords();
    const path = this.os.fs.normalize(mount.path);
    const record = {
      id: path,
      path,
      name: mount.name,
      handleName: mount.handleName,
      mode: mount.mode || this.defaultMode,
      handle: mount.handle,
      savedAt: new Date().toISOString(),
    };
    await this.savePersistedRecords([
      ...records.filter((entry) => this.os.fs.normalize(entry.path) !== path),
      record,
    ]);
    return this.summary(record, { persisted: true, status: "saved" });
  }

  async forgetMount(path) {
    const normalized = this.os.fs.normalize(path);
    const records = await this.loadPersistedRecords();
    await this.savePersistedRecords(records.filter((entry) => this.os.fs.normalize(entry.path) !== normalized));
    if (this.mounts.has(normalized)) await this.unmount(normalized);
    return { path: normalized, status: "forgotten" };
  }

  async loadPersistedRecords() {
    const payload = await this.os.storage?.readValue?.(this.storageKey);
    if (!payload || payload.version !== 1 || !Array.isArray(payload.mounts)) return [];
    return payload.mounts.filter((mount) => mount?.path && mount?.handle);
  }

  async savePersistedRecords(records) {
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      mounts: records,
    };
    this.os.storage?.writeValue?.(this.storageKey, payload);
    await this.os.storage?.flush?.();
  }

  isMountedPath(path, cwd = "/") {
    return Boolean(this.mountFor(this.os.fs.normalize(path, cwd)));
  }

  mountFor(path) {
    const normalized = this.os.fs.normalize(path);
    return [...this.mounts.values()]
      .filter((mount) => normalized === mount.path || normalized.startsWith(`${mount.path}/`))
      .sort((left, right) => right.path.length - left.path.length)[0] || null;
  }

  async list(path, cwd = "/") {
    const normalized = this.os.fs.normalize(path, cwd);
    const directory = await this.directoryHandleFor(normalized);
    const entries = [];
    for await (const [name, handle] of directory.entries()) {
      entries.push(await this.nodeFromHandle(name, handle, this.os.fs.join(normalized, name)));
    }
    entries.sort((a, b) => sortNodes(a, b));
    this.mirrorDirectory(normalized, entries);
    return entries;
  }

  async stat(path, cwd = "/") {
    const normalized = this.os.fs.normalize(path, cwd);
    const mount = this.mountFor(normalized);
    if (!mount) return null;
    if (normalized === mount.path) {
      return {
        path: mount.path,
        name: this.os.fs.basename(mount.path),
        type: "mount",
        resolvedType: "directory",
        mime: "inode/directory",
        permissions: "drwxrwxrwx",
        owner: this.os.session.user || "guest",
        group: "users",
        size: 0,
        modified: new Date().toISOString(),
      };
    }
    const { parentHandle, name } = await this.parentHandleFor(normalized);
    const handle = await getChildHandle(parentHandle, name);
    return this.nodeStat(await this.nodeFromHandle(name, handle, normalized));
  }

  async readFile(path, cwd = "/") {
    const normalized = this.os.fs.normalize(path, cwd);
    const { parentHandle, name } = await this.parentHandleFor(normalized);
    const handle = await parentHandle.getFileHandle(name);
    const file = await handle.getFile();
    return file.text();
  }

  async writeFile(path, content, cwd = "/") {
    const normalized = this.os.fs.normalize(path, cwd);
    const { parentHandle, name } = await this.parentHandleFor(normalized, { create: true });
    const handle = await parentHandle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    await this.syncDirectory(this.os.fs.dirname(normalized));
    return this.stat(normalized);
  }

  async appendFile(path, content, cwd = "/") {
    const normalized = this.os.fs.normalize(path, cwd);
    const current = await this.exists(normalized) ? await this.readFile(normalized) : "";
    return this.writeFile(normalized, `${current}${content}`);
  }

  async createDirectory(path, cwd = "/", options = {}) {
    const normalized = this.os.fs.normalize(path, cwd);
    if (options.parents) {
      await this.directoryHandleFor(normalized, { create: true });
    } else {
      const { parentHandle, name } = await this.parentHandleFor(normalized);
      await parentHandle.getDirectoryHandle(name, { create: true });
    }
    await this.syncDirectory(this.os.fs.dirname(normalized));
    return this.stat(normalized);
  }

  async remove(path, cwd = "/", options = {}) {
    const normalized = this.os.fs.normalize(path, cwd);
    const mount = this.mountFor(normalized);
    if (!mount || normalized === mount.path) throw new Error(`rm: cannot remove mount root: ${normalized}`);
    const { parentHandle, name } = await this.parentHandleFor(normalized);
    await parentHandle.removeEntry(name, { recursive: Boolean(options.recursive) });
    await this.syncDirectory(this.os.fs.dirname(normalized));
  }

  async exists(path, cwd = "/") {
    try {
      await this.stat(path, cwd);
      return true;
    } catch {
      return false;
    }
  }

  async syncDirectory(path) {
    const normalized = this.os.fs.normalize(path);
    if (!this.mountFor(normalized)) return [];
    return this.list(normalized);
  }

  mountLines() {
    return this.listMounts().map((mount) => `${mount.name} ${mount.path} local-folder rw 0 0`);
  }

  summary(mount, extra = {}) {
    return {
      name: mount.name,
      path: mount.path,
      handleName: mount.handleName,
      type: "local-folder",
      ...extra,
    };
  }

  ensureMountRoot() {
    if (!this.os.fs.exists("/mnt")) {
      this.os.fs.createDirectory("/mnt", "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, this.os.permissions.systemPrincipal());
    }
  }

  allocateMountPath(basePath) {
    let path = this.os.fs.normalize(basePath);
    for (let index = 2; this.os.fs.exists(path); index += 1) {
      path = `${this.os.fs.normalize(basePath)}-${index}`;
    }
    return path;
  }

  async directoryHandleFor(path, options = {}) {
    const normalized = this.os.fs.normalize(path);
    const mount = this.mountFor(normalized);
    if (!mount) throw new Error(`local mount not found: ${path}`);
    const parts = relativeParts(mount.path, normalized);
    let handle = mount.handle;
    for (const part of parts) {
      handle = await handle.getDirectoryHandle(part, { create: Boolean(options.create) });
    }
    return handle;
  }

  async parentHandleFor(path, options = {}) {
    const normalized = this.os.fs.normalize(path);
    return {
      parentHandle: await this.directoryHandleFor(this.os.fs.dirname(normalized), options),
      name: this.os.fs.basename(normalized),
    };
  }

  async nodeFromHandle(name, handle, path) {
    if (handle.kind === "directory") {
      return {
        name,
        type: "directory",
        icon: "folder",
        path,
        mount: "local-folder",
        external: true,
        permissions: "drwxrwxrwx",
        owner: this.os.session.user || "guest",
        group: "users",
        children: [],
      };
    }
    const file = await handle.getFile();
    return {
      name,
      type: "file",
      icon: iconFromMime(file.type || mimeFromName(name)),
      path,
      mount: "local-folder",
      external: true,
      mime: file.type || mimeFromName(name),
      size: file.size,
      modified: new Date(file.lastModified || Date.now()).toISOString(),
      permissions: "-rw-rw-rw-",
      owner: this.os.session.user || "guest",
      group: "users",
    };
  }

  nodeStat(node) {
    return {
      path: node.path,
      name: node.name,
      type: node.type,
      resolvedType: node.type === "mount" ? "directory" : node.type,
      mime: node.mime || (node.type === "directory" ? "inode/directory" : "application/octet-stream"),
      permissions: node.permissions || "-rw-rw-rw-",
      owner: node.owner || this.os.session.user || "guest",
      group: node.group || "users",
      size: node.size || 0,
      modified: node.modified || new Date().toISOString(),
    };
  }

  mirrorDirectory(path, entries) {
    const node = this.os.fs.resolve(path);
    if (!node || (node.type !== "mount" && node.type !== "directory")) return;
    node.children = entries.map((entry) => ({
      ...entry,
      children: entry.type === "directory" ? entry.children || [] : undefined,
    }));
    this.os.fs.emitChange("sync-mount", path);
  }

}

async function requestDirectoryPermission(handle, mode) {
  const current = await directoryPermissionState(handle, mode);
  if (current === "granted") return;
  if (typeof handle.requestPermission === "function") {
    const next = await handle.requestPermission({ mode });
    if (next !== "granted") throw new Error("mount-local: permission denied");
    return;
  }
  throw new Error("mount-local: permission denied");
}

async function directoryPermissionState(handle, mode) {
  if (typeof handle.queryPermission === "function") return handle.queryPermission({ mode });
  if (typeof handle.requestPermission === "function") return "prompt";
  return "granted";
}

async function getChildHandle(parentHandle, name) {
  try {
    return await parentHandle.getDirectoryHandle(name);
  } catch {
    return parentHandle.getFileHandle(name);
  }
}

function relativeParts(root, path) {
  const normalizedRoot = String(root || "/").replace(/\/$/, "");
  const normalizedPath = String(path || "/").replace(/\/$/, "");
  if (normalizedPath === normalizedRoot) return [];
  return normalizedPath.slice(normalizedRoot.length + 1).split("/").filter(Boolean);
}

function sanitizeMountName(name) {
  return String(name || "local").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "local";
}

function sortNodes(a, b) {
  const aRank = a.type === "directory" || a.type === "mount" ? 0 : 1;
  const bRank = b.type === "directory" || b.type === "mount" ? 0 : 1;
  if (aRank !== bRank) return aRank - bRank;
  return a.name.localeCompare(b.name);
}

function mimeFromName(name) {
  if (/\.md$/i.test(name)) return "text/markdown";
  if (/\.txt$/i.test(name)) return "text/plain";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.html?$/i.test(name)) return "text/html";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.(png|jpe?g|gif|webp)$/i.test(name)) return "image/*";
  return "text/plain";
}

function iconFromMime(mime) {
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "browser";
  if (mime?.startsWith("image/")) return "image";
  return "text";
}
