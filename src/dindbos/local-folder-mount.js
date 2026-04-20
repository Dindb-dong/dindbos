export class LocalFolderMountManager {
  constructor(os, options = {}) {
    this.os = os;
    this.picker = options.picker || globalThis.showDirectoryPicker?.bind(globalThis) || null;
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
    await requestDirectoryPermission(handle, options.mode || "readwrite");
    const mountName = sanitizeMountName(name || handle.name || "local");
    const path = this.allocateMountPath(`/mnt/${mountName}`);
    this.ensureMountRoot();
    const node = this.os.fs.createMount(path, {
      handleName: handle.name || mountName,
      owner: this.os.session.user || "guest",
      group: "users",
    });
    const record = { id: path, path: node.path, name: mountName, handle, handleName: handle.name || mountName };
    this.mounts.set(node.path, record);
    await this.syncDirectory(node.path);
    return this.summary(record);
  }

  unmount(path) {
    const mount = this.mountFor(path);
    if (!mount || mount.path !== this.os.fs.normalize(path)) throw new Error(`umount: ${path}: not a mount root`);
    this.mounts.delete(mount.path);
    if (this.os.fs.exists(mount.path)) this.os.fs.remove(mount.path, "/", { recursive: true }, this.os.permissions.systemPrincipal());
    return this.summary(mount);
  }

  listMounts() {
    return [...this.mounts.values()].map((mount) => this.summary(mount));
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

  summary(mount) {
    return {
      name: mount.name,
      path: mount.path,
      handleName: mount.handleName,
      type: "local-folder",
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
  if (typeof handle.queryPermission === "function") {
    const current = await handle.queryPermission({ mode });
    if (current === "granted") return;
  }
  if (typeof handle.requestPermission === "function") {
    const next = await handle.requestPermission({ mode });
    if (next !== "granted") throw new Error("mount-local: permission denied");
  }
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
