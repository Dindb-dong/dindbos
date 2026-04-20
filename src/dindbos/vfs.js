export class VirtualFileSystem {
  constructor(rootNode, options = {}) {
    this.root = rootNode || { name: "", type: "directory", children: [] };
    this.root.name = "";
    this.root.type = "directory";
    this.home = options.home || "/home/guest";
    this.policy = options.policy || null;
    this.systemPrincipal = this.policy?.systemPrincipal() || { user: "root", groups: ["root"], system: true };
    this.onChange = options.onChange || (() => {});
  }

  list(path = "/", cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node || node.type !== "directory") return [];
    this.assertAccess(node, "read", principal, node.path);
    this.assertAccess(node, "execute", principal, node.path);
    return (node.children || [])
      .map((child) => this.withPath(child, this.join(node.path, child.name)))
      .sort((a, b) => sortNodes(a, b));
  }

  resolve(path = "/", cwd = "/") {
    const normalized = this.normalize(path, cwd);
    if (normalized === "/") return this.withPath(this.root, "/");
    const parts = normalized.split("/").filter(Boolean);
    let current = this.root;
    let currentPath = "/";
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!current || current.type !== "directory") return null;
      current = (current.children || []).find((child) => child.name === part);
      currentPath = this.join(currentPath, part);
      if (current && this.isLink(current)) {
        const target = this.normalize(current.target, this.dirname(currentPath));
        const rest = parts.slice(index + 1).join("/");
        return this.resolve(rest ? this.join(target, rest) : target);
      }
    }
    return current ? this.withPath(current, normalized) : null;
  }

  resolveNode(node) {
    if (this.isLink(node) && node.target) {
      return this.resolve(node.target, this.dirname(node.path || "/")) || node;
    }
    return node;
  }

  readFile(path, cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    this.assertAccess(node, "read", principal, node.path);
    return node.content || "";
  }

  writeFile(path, content, cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    this.assertAccess(node, "write", principal, node.path);
    node.content = content;
    node.size = byteLength(content);
    node.modified = new Date().toISOString();
    this.emitChange("write", node.path);
    return this.withPath(node, this.normalize(path, cwd));
  }

  appendFile(path, content, cwd = "/", principal = this.systemPrincipal) {
    const current = this.exists(path, cwd) ? this.readFile(path, cwd, principal) : "";
    return this.writeOrCreateFile(path, `${current}${content}`, cwd, {}, principal);
  }

  writeOrCreateFile(path, content, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    const existing = this.resolve(normalized);
    if (existing) return this.writeFile(normalized, content, "/", principal);
    const parent = this.parentFor(normalized);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    const name = this.basename(normalized);
    const node = this.createNode({
      name,
      type: "file",
      mime: options.mime || mimeFromName(name),
      content,
      icon: options.icon || iconFromMime(options.mime || mimeFromName(name)),
      permissions: options.permissions || "-rw-r--r--",
      owner: options.owner || "guest",
      group: options.group || "users",
    });
    parent.children.push(node);
    this.emitChange("create", normalized);
    return this.withPath(node, normalized);
  }

  createDirectory(path, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    if (this.exists(normalized)) throw new Error(`mkdir: ${normalized}: file exists`);
    const parent = this.parentFor(normalized);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    const node = this.createNode({
      name: this.basename(normalized),
      type: "directory",
      icon: options.icon || "folder",
      children: [],
      permissions: options.permissions || "drwxr-xr-x",
      owner: options.owner || "guest",
      group: options.group || "users",
    });
    parent.children.push(node);
    this.emitChange("mkdir", normalized);
    return this.withPath(node, normalized);
  }

  createFile(path, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.writeOrCreateFile(path, options.content || "", cwd, options, principal);
  }

  remove(path, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    if (normalized === "/") throw new Error("rm: cannot remove root");
    const { parent, node, index } = this.lookupChild(normalized);
    if (!node) throw new Error(`rm: ${path}: no such file or directory`);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    if (node.type === "directory" && node.children?.length && !options.recursive) {
      throw new Error(`rm: ${path}: directory not empty`);
    }
    parent.children.splice(index, 1);
    this.emitChange("remove", normalized);
    return this.withPath(node, normalized);
  }

  copy(sourcePath, destinationPath, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const source = this.resolve(sourcePath, cwd);
    if (!source) throw new Error(`cp: ${sourcePath}: no such file or directory`);
    this.assertAccess(source, "read", principal, source.path);
    if (source.type === "directory") this.assertAccess(source, "execute", principal, source.path);
    if (source.type === "directory" && !options.recursive) throw new Error(`cp: ${sourcePath}: is a directory`);
    const destination = this.resolve(destinationPath, cwd);
    const destinationPathNormalized = destination?.type === "directory"
      ? this.join(destination.path, source.name)
      : this.normalize(destinationPath, cwd);
    if (destinationPathNormalized.startsWith(`${source.path}/`)) {
      throw new Error(`cp: cannot copy ${source.path} into itself`);
    }
    if (this.exists(destinationPathNormalized)) throw new Error(`cp: ${destinationPathNormalized}: file exists`);
    const parent = this.parentFor(destinationPathNormalized);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    const copy = cloneNode(source);
    copy.name = this.basename(destinationPathNormalized);
    touchNode(copy);
    parent.children.push(copy);
    this.emitChange("copy", destinationPathNormalized);
    return this.withPath(copy, destinationPathNormalized);
  }

  move(sourcePath, destinationPath, cwd = "/", principal = this.systemPrincipal) {
    const normalizedSource = this.normalize(sourcePath, cwd);
    if (normalizedSource === "/") throw new Error("mv: cannot move root");
    const { parent: sourceParent, node, index } = this.lookupChild(normalizedSource);
    if (!node) throw new Error(`mv: ${sourcePath}: no such file or directory`);
    this.assertAccess(sourceParent, "write", principal, sourceParent.path);
    this.assertAccess(sourceParent, "execute", principal, sourceParent.path);
    const destination = this.resolve(destinationPath, cwd);
    const normalizedDestination = destination?.type === "directory"
      ? this.join(destination.path, node.name)
      : this.normalize(destinationPath, cwd);
    if (normalizedDestination.startsWith(`${normalizedSource}/`)) {
      throw new Error(`mv: cannot move ${normalizedSource} into itself`);
    }
    if (this.exists(normalizedDestination)) throw new Error(`mv: ${normalizedDestination}: file exists`);
    const targetParent = this.parentFor(normalizedDestination);
    this.assertAccess(targetParent, "write", principal, targetParent.path);
    this.assertAccess(targetParent, "execute", principal, targetParent.path);
    sourceParent.children.splice(index, 1);
    node.name = this.basename(normalizedDestination);
    touchNode(node);
    targetParent.children.push(node);
    this.emitChange("move", normalizedDestination);
    return this.withPath(node, normalizedDestination);
  }

  chmod(path, permissions, cwd = "/", principal = this.systemPrincipal) {
    if (!/^[-dlbcps]?r?[w-]?[x-]?r?[w-]?[x-]?r?[w-]?[x-]?$/.test(permissions) && !/^[0-7]{3,4}$/.test(permissions)) {
      throw new Error(`chmod: invalid mode: ${permissions}`);
    }
    const node = this.resolve(path, cwd);
    if (!node) throw new Error(`chmod: ${path}: no such file or directory`);
    if (!principal.system && principal.user !== "root" && principal.user !== (node.owner || "root")) {
      throw new Error(`chmod: ${path}: permission denied`);
    }
    node.permissions = normalizePermissions(permissions, node);
    node.modified = new Date().toISOString();
    this.emitChange("chmod", node.path);
    return this.withPath(node, node.path);
  }

  stat(path, cwd = "/") {
    const node = this.resolve(path, cwd);
    if (!node) return null;
    return this.nodeStat(node, node.path);
  }

  lstat(path, cwd = "/") {
    const normalized = this.normalize(path, cwd);
    if (normalized === "/") return this.nodeStat(this.root, "/");
    const parts = normalized.split("/").filter(Boolean);
    const parentPath = `/${parts.slice(0, -1).join("/")}`;
    const parent = this.resolve(parentPath || "/");
    const node = parent?.children?.find((child) => child.name === parts.at(-1));
    return node ? this.nodeStat(this.withPath(node, normalized), normalized) : null;
  }

  exists(path, cwd = "/") {
    return Boolean(this.resolve(path, cwd));
  }

  isLink(node) {
    return node?.type === "link" || node?.type === "symlink";
  }

  normalize(path, cwd = "/") {
    if (!path) return this.normalize(cwd);
    let value = String(path);
    if (value === "~" || value.startsWith("~/")) {
      value = `${this.home}${value.slice(1)}`;
    }
    const input = value.startsWith("/") ? value : `${cwd}/${value}`;
    const parts = [];
    input.split("/").forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") {
        parts.pop();
        return;
      }
      parts.push(part);
    });
    return `/${parts.join("/")}`;
  }

  join(base, name) {
    return this.normalize(`${base}/${name}`);
  }

  dirname(path) {
    const normalized = this.normalize(path);
    const parts = normalized.split("/").filter(Boolean);
    parts.pop();
    return parts.length ? `/${parts.join("/")}` : "/";
  }

  basename(path) {
    const normalized = this.normalize(path);
    return normalized.split("/").filter(Boolean).at(-1) || "/";
  }

  withPath(node, path) {
    node.path = path;
    return node;
  }

  parentFor(path) {
    const parentPath = this.dirname(path);
    const parent = this.resolve(parentPath);
    if (!parent || parent.type !== "directory") throw new Error(`No such directory: ${parentPath}`);
    return parent;
  }

  lookupChild(path) {
    const normalized = this.normalize(path);
    const parent = this.parentFor(normalized);
    const name = this.basename(normalized);
    const index = parent.children?.findIndex((child) => child.name === name) ?? -1;
    return { parent, node: index >= 0 ? parent.children[index] : null, index };
  }

  createNode(node) {
    const created = new Date().toISOString();
    return {
      created,
      modified: created,
      ...node,
      size: node.size ?? byteLength(node.content || ""),
    };
  }

  snapshot() {
    return cloneForSnapshot(this.root);
  }

  assertAccess(node, access, principal, path) {
    if (!this.policy) return;
    this.policy.assert(node, access, principal, path);
  }

  emitChange(action, path) {
    this.onChange({ action, path, root: this.root });
  }

  nodeStat(node, path) {
    const resolved = this.resolveNode(node);
    return {
      path,
      name: node.name,
      type: node.type,
      resolvedType: resolved.type,
      target: node.target || "",
      mime: resolved.mime || mimeForNode(resolved),
      permissions: node.permissions || resolved.permissions || defaultPermissions(node),
      owner: node.owner || resolved.owner || "root",
      group: node.group || resolved.group || "root",
      size: resolved.size ?? byteLength(resolved.content || ""),
      modified: resolved.modified || node.modified || "2026-04-20T00:00:00.000Z",
    };
  }
}

function sortNodes(a, b) {
  const aRank = a.type === "directory" ? 0 : 1;
  const bRank = b.type === "directory" ? 0 : 1;
  if (aRank !== bRank) return aRank - bRank;
  return a.name.localeCompare(b.name);
}

function defaultPermissions(node) {
  if (node.type === "directory") return "drwxr-xr-x";
  if (node.type === "app") return "-rwxr-xr-x";
  if (node.type === "link" || node.type === "symlink") return "lrwxrwxrwx";
  return "-rw-r--r--";
}

function normalizePermissions(value, node) {
  if (/^[0-7]{3,4}$/.test(value)) return `${typePrefix(node)}${octalToPermissions(value.slice(-3))}`;
  if (value.length === 9) return `${typePrefix(node)}${value}`;
  return value;
}

function typePrefix(node) {
  if (node.type === "directory") return "d";
  if (node.type === "link" || node.type === "symlink") return "l";
  if (node.type === "device") return "c";
  return "-";
}

function octalToPermissions(octal) {
  return octal.split("").map((digit) => {
    const value = Number(digit);
    return `${value & 4 ? "r" : "-"}${value & 2 ? "w" : "-"}${value & 1 ? "x" : "-"}`;
  }).join("");
}

function mimeForNode(node) {
  if (node.type === "directory") return "inode/directory";
  if (node.type === "app") return "application/x-dindbos-app";
  return "application/octet-stream";
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).length;
}

function cloneNode(node) {
  return {
    ...node,
    children: node.children?.map((child) => cloneNode(child)),
  };
}

function cloneForSnapshot(node) {
  const { path, ...snapshot } = node;
  return {
    ...snapshot,
    children: node.children?.map((child) => cloneForSnapshot(child)),
  };
}

function touchNode(node) {
  node.modified = new Date().toISOString();
  if (node.children) node.children.forEach((child) => touchNode(child));
}

function mimeFromName(name) {
  if (/\.md$/i.test(name)) return "text/markdown";
  if (/\.txt$/i.test(name)) return "text/plain";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.html?$/i.test(name)) return "text/html";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  return "text/plain";
}

function iconFromMime(mime) {
  if (mime === "text/html") return "browser";
  if (mime === "application/pdf") return "pdf";
  return "text";
}
