export class VirtualFileSystem {
  constructor(rootNode) {
    this.root = rootNode || { name: "", type: "directory", children: [] };
    this.root.name = "";
    this.root.type = "directory";
  }

  list(path = "/") {
    const node = this.resolve(path);
    if (!node || node.type !== "directory") return [];
    return (node.children || []).map((child) => this.withPath(child, this.join(node.path, child.name)));
  }

  resolve(path = "/") {
    const normalized = this.normalize(path);
    if (normalized === "/") return this.withPath(this.root, "/");
    const parts = normalized.split("/").filter(Boolean);
    let current = this.root;
    let currentPath = "";
    for (const part of parts) {
      if (!current || current.type !== "directory") return null;
      current = (current.children || []).find((child) => child.name === part);
      currentPath = this.join(currentPath || "/", part);
    }
    return current ? this.withPath(current, normalized) : null;
  }

  resolveNode(node) {
    if (node.type === "link" && node.target) {
      return this.resolve(node.target) || node;
    }
    return node;
  }

  readFile(path) {
    const node = this.resolve(path);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    return node.content || "";
  }

  writeFile(path, content) {
    const node = this.resolve(path);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    node.content = content;
    return this.withPath(node, path);
  }

  normalize(path) {
    if (!path) return "/";
    const parts = String(path).split("/").filter(Boolean);
    return `/${parts.join("/")}`;
  }

  join(base, name) {
    return this.normalize(`${base}/${name}`);
  }

  withPath(node, path) {
    return { ...node, path };
  }
}
