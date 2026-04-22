export class LocalFolderMountManager {
  constructor(os, options = {}) {
    this.os = os;
    this.picker = options.picker || globalThis.showDirectoryPicker?.bind(globalThis) || null;
    this.storageKey = options.storageKey || "dindbos:local-folder-mounts";
    this.defaultMode = options.mode || "readwrite";
    this.mounts = new Map();
    this.encoder = new TextEncoder();
    this.operations = [];
    this.operationSeq = 0;
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
    const mounted = await Promise.all([...this.mounts.values()].map(async (mount) => {
      const permission = await directoryPermissionState(mount.handle, mount.mode || this.defaultMode).catch(() => "error");
      return this.summary(mount, {
        persisted: persistedPaths.has(mount.path),
        permission,
        status: permission === "granted" ? "mounted" : permission,
      });
    }));
    mounted.forEach((mount) => byPath.set(mount.path, mount));
    return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  async requestAccess(path, options = {}) {
    const normalized = this.os.fs.normalize(path);
    const mounted = this.mountFor(normalized);
    if (mounted) {
      await requestDirectoryPermission(mounted.handle, mounted.mode || this.defaultMode);
      await this.syncDirectory(mounted.path);
      const records = await this.loadPersistedRecords();
      const persisted = records.some((entry) => this.os.fs.normalize(entry.path) === mounted.path);
      return this.summary(mounted, { persisted, permission: "granted", status: "mounted" });
    }
    const records = await this.loadPersistedRecords();
    const record = records.find((entry) => this.os.fs.normalize(entry.path) === normalized);
    if (!record) throw new Error(`mount-local: no persisted handle for ${normalized}`);
    await requestDirectoryPermission(record.handle, record.mode || this.defaultMode);
    const mountedRecord = await this.attachMount(record.name || record.handleName || "local", record.handle, {
      path: normalized,
      handleName: record.handleName,
      mode: record.mode || this.defaultMode,
      persist: options.persist !== false,
    });
    return { ...mountedRecord, persisted: true, permission: "granted", status: "mounted" };
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

  async readFileBytes(path, cwd = "/") {
    const normalized = this.os.fs.normalize(path, cwd);
    const { parentHandle, name } = await this.parentHandleFor(normalized);
    const handle = await parentHandle.getFileHandle(name);
    const file = await handle.getFile();
    return new Uint8Array(await file.arrayBuffer());
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

  async writeFileBytes(path, bytes, cwd = "/", options = {}) {
    const normalized = this.os.fs.normalize(path, cwd);
    const { parentHandle, name } = await this.parentHandleFor(normalized, { create: true });
    const handle = await parentHandle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    await writable.close();
    await this.syncDirectory(this.os.fs.dirname(normalized));
    return this.stat(normalized);
  }

  async writeFileBlob(path, blob, cwd = "/", options = {}) {
    const normalized = this.os.fs.normalize(path, cwd);
    const { parentHandle, name } = await this.parentHandleFor(normalized, { create: true });
    const handle = await parentHandle.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
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

  async copy(sourcePath, destinationPath, cwd = "/", options = {}) {
    const source = this.os.fs.normalize(sourcePath, cwd);
    const destinationInput = this.os.fs.normalize(destinationPath, cwd);
    const sourceStat = await this.stat(source);
    if (!sourceStat) throw new Error(`cp: ${source}: no such file or directory`);
    if ((sourceStat.type === "directory" || sourceStat.type === "mount") && !options.recursive) throw new Error(`cp: ${source}: is a directory`);
    const destinationStat = await this.stat(destinationInput).catch(() => null);
    const destination = destinationStat && (destinationStat.type === "directory" || destinationStat.type === "mount")
      ? this.os.fs.join(destinationInput, this.os.fs.basename(source))
      : destinationInput;
    if (destination === source || destination.startsWith(`${source}/`)) throw new Error(`cp: cannot copy ${source} into itself`);
    if (await this.exists(destination)) throw new Error(`cp: ${destination}: file exists`);
    const operation = this.beginOperation("copy", source, destination, options);
    try {
      operation.total = await this.countEntries(source, sourceStat);
      this.reportProgress(operation, { detail: source });
      await this.copyEntry(source, destination, sourceStat, operation);
      this.finishOperation(operation);
    } catch (error) {
      this.finishOperation(operation, error);
      throw error;
    }
    await this.syncDirectory(this.os.fs.dirname(destination));
    return this.stat(destination);
  }

  async move(sourcePath, destinationPath, cwd = "/", options = {}) {
    const source = this.os.fs.normalize(sourcePath, cwd);
    const destinationInput = this.os.fs.normalize(destinationPath, cwd);
    const sourceStat = await this.stat(source);
    if (!sourceStat) throw new Error(`mv: ${source}: no such file or directory`);
    const destinationStat = await this.stat(destinationInput).catch(() => null);
    const destination = destinationStat && (destinationStat.type === "directory" || destinationStat.type === "mount")
      ? this.os.fs.join(destinationInput, this.os.fs.basename(source))
      : destinationInput;
    if (destination === source || destination.startsWith(`${source}/`)) throw new Error(`mv: cannot move ${source} into itself`);
    if (await this.exists(destination)) throw new Error(`mv: ${destination}: file exists`);
    const operation = this.beginOperation("move", source, destination, options);
    try {
      operation.total = await this.countEntries(source, sourceStat);
      this.reportProgress(operation, { detail: source });
      await this.copyEntry(source, destination, sourceStat, operation);
      await this.remove(source, "/", { recursive: true });
      this.finishOperation(operation);
    } catch (error) {
      this.finishOperation(operation, error);
      throw error;
    }
    await this.syncDirectory(this.os.fs.dirname(destination));
    return this.stat(destination);
  }

  async copyEntry(source, destination, sourceStat = null, operation = null) {
    const stat = sourceStat || await this.stat(source);
    if (stat.type === "directory" || stat.type === "mount") {
      await this.createDirectory(destination, "/", { parents: true });
      this.reportProgress(operation, { detail: source, increment: 1 });
      const entries = await this.list(source);
      for (const entry of entries) {
        await this.copyEntry(entry.path, this.os.fs.join(destination, entry.name), entry, operation);
      }
      return;
    }
    await this.writeFileBytes(destination, await this.readFileBytes(source), "/", { mime: stat.mime || "application/octet-stream" });
    this.reportProgress(operation, { detail: source, increment: 1 });
  }

  async countEntries(path, stat = null) {
    const node = stat || await this.stat(path);
    if (!node || (node.type !== "directory" && node.type !== "mount")) return 1;
    const entries = await this.list(path);
    let total = 1;
    for (const entry of entries) total += await this.countEntries(entry.path, entry);
    return total;
  }

  beginOperation(kind, source, destination, options = {}) {
    const operation = {
      id: ++this.operationSeq,
      kind,
      source,
      destination,
      startedAt: new Date().toISOString(),
      finishedAt: "",
      done: 0,
      total: 0,
      detail: source,
      status: "running",
      onProgress: options.onProgress || null,
    };
    this.operations = [operation, ...this.operations].slice(0, 8);
    options.onProgress?.({ ...operation });
    return operation;
  }

  reportProgress(operation, patch = {}) {
    if (!operation) return;
    if (patch.increment) operation.done += patch.increment;
    if (patch.detail) operation.detail = patch.detail;
    operation.updatedAt = new Date().toISOString();
    operation.onProgress?.({ ...operation });
  }

  finishOperation(operation, error = null) {
    if (!operation) return;
    operation.status = error ? "error" : "complete";
    operation.error = error?.message || "";
    operation.finishedAt = new Date().toISOString();
    operation.updatedAt = operation.finishedAt;
    operation.onProgress?.({ ...operation });
  }

  operationStatus() {
    return this.operations.map(({ onProgress: _onProgress, ...operation }) => ({ ...operation }));
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
    return this.listMounts().map((mount) => `${mount.name} ${mount.path} local-folder ${mount.mode === "read" ? "ro" : "rw"} 0 0`);
  }

  summary(mount, extra = {}) {
    return {
      name: mount.name,
      path: mount.path,
      handleName: mount.handleName,
      mode: mount.mode || this.defaultMode,
      access: mount.mode === "read" ? "read-only" : "read-write",
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
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "text/plain";
}

function iconFromMime(mime) {
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "browser";
  if (mime?.startsWith("image/")) return "image";
  return "text";
}
