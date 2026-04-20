export class VirtualFileSystem {
  constructor(rootNode, options = {}) {
    this.root = rootNode || { name: "", type: "directory", children: [] };
    this.root.name = "";
    this.root.type = "directory";
    this.home = options.home || "/home/guest";
  }

  list(path = "/", cwd = "/") {
    const node = this.resolve(path, cwd);
    if (!node || node.type !== "directory") return [];
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

  readFile(path, cwd = "/") {
    const node = this.resolve(path, cwd);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    return node.content || "";
  }

  writeFile(path, content, cwd = "/") {
    const node = this.resolve(path, cwd);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    node.content = content;
    node.size = byteLength(content);
    node.modified = new Date().toISOString();
    return this.withPath(node, this.normalize(path, cwd));
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

function mimeForNode(node) {
  if (node.type === "directory") return "inode/directory";
  if (node.type === "app") return "application/x-dindbos-app";
  return "application/octet-stream";
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).length;
}
