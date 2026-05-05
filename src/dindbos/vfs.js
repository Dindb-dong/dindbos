import { bytesToBase64, cloneFileContent, fileContentByteLength, fileContentToBytes, fileContentToText, normalizeFileContent, normalizeFileContentAsync } from "./file-data.js?v=20260422-browserd";

export class VirtualFileSystem {
  constructor(rootNode, options = {}) {
    this.root = rootNode || { name: "", type: "directory", children: [] };
    this.root.name = "";
    this.root.type = "directory";
    this.home = options.home || "/home/guest";
    this.policy = options.policy || null;
    this.systemPrincipal = this.policy?.systemPrincipal() || { user: "root", groups: ["root"], system: true };
    this.onChange = options.onChange || (() => {});
    this.onAccessDenied = options.onAccessDenied || (() => {});
  }

  list(path = "/", cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node || !isDirectoryLike(node)) return [];
    this.assertTraversalAccess(node.path, "/", principal);
    this.assertAccess(node, "read", principal, node.path);
    this.assertAccess(node, "execute", principal, node.path);
    return (node.children || [])
      .map((child) => this.withPath(child, this.join(node.path, child.name)))
      .sort((a, b) => sortNodes(a, b));
  }

  resolve(path = "/", cwd = "/", seen = new Set()) {
    const normalized = this.normalize(path, cwd);
    if (normalized === "/") return this.withPath(this.root, "/");
    const parts = normalized.split("/").filter(Boolean);
    let current = this.root;
    let currentPath = "/";
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!current || !isDirectoryLike(current)) return null;
      current = (current.children || []).find((child) => child.name === part);
      currentPath = this.join(currentPath, part);
      if (current && this.isLink(current)) {
        if (seen.has(currentPath)) throw new Error(`Too many symbolic links: ${currentPath}`);
        seen.add(currentPath);
        const target = this.normalize(current.target, this.dirname(currentPath));
        const rest = parts.slice(index + 1).join("/");
        return this.resolve(rest ? this.join(target, rest) : target, "/", seen);
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
    this.assertTraversalAccess(node.path, "/", principal);
    this.assertAccess(node, "read", principal, node.path);
    return fileContentToText(node.content);
  }

  readFileBytes(path, cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    this.assertTraversalAccess(node.path, "/", principal);
    this.assertAccess(node, "read", principal, node.path);
    return fileContentToBytes(node.content);
  }

  writeFile(path, content, cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node || node.type !== "file") throw new Error(`File not found: ${path}`);
    this.assertTraversalAccess(node.path, "/", principal);
    this.assertAccess(node, "write", principal, node.path);
    const normalizedContent = normalizeFileContent(content, { mime: node.mime });
    const linked = node.linkId ? this.linkedFiles(node.linkId) : [node];
    const modified = new Date().toISOString();
    linked.forEach((linkedNode) => {
      linkedNode.content = cloneFileContent(normalizedContent);
      linkedNode.size = fileContentByteLength(linkedNode.content);
      linkedNode.modified = modified;
    });
    this.emitChange("write", node.path);
    return this.withPath(node, this.normalize(path, cwd));
  }

  writeFileBytes(path, bytes, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.writeFile(path, normalizeFileContent(bytes, options), cwd, principal);
  }

  async writeFileBlob(path, blob, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.writeFile(path, await normalizeFileContentAsync(blob, options), cwd, principal);
  }

  atomicWriteFile(path, content, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    const existing = this.resolve(normalized);
    if (!existing || existing.type !== "file") throw new Error(`File not found: ${path}`);
    return this.atomicWriteOrCreateFile(existing.path || normalized, content, "/", options, principal);
  }

  atomicWriteFileBytes(path, bytes, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.atomicWriteFile(path, normalizeFileContent(bytes, options), cwd, options, principal);
  }

  async atomicWriteFileBlob(path, blob, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.atomicWriteFile(path, await normalizeFileContentAsync(blob, options), cwd, options, principal);
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
    this.assertTraversalAccess(parent.path, "/", principal);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    const name = this.basename(normalized);
    const node = this.createNode({
      name,
      type: "file",
      mime: options.mime || mimeFromName(name),
      content: normalizeFileContent(content, { mime: options.mime || mimeFromName(name) }),
      icon: options.icon || iconFromMime(options.mime || mimeFromName(name)),
      permissions: options.permissions || "-rw-r--r--",
      owner: options.owner || ownerFromPrincipal(principal),
      group: options.group || groupFromPrincipal(principal),
    });
    parent.children.push(node);
    this.emitChange("create", normalized);
    return this.withPath(node, normalized);
  }

  writeOrCreateFileBytes(path, bytes, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.writeOrCreateFile(path, normalizeFileContent(bytes, options), cwd, options, principal);
  }

  async writeOrCreateFileBlob(path, blob, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.writeOrCreateFile(path, await normalizeFileContentAsync(blob, options), cwd, options, principal);
  }

  atomicWriteOrCreateFile(path, content, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    const { parent, node: existing, index: existingIndex } = this.lookupChild(normalized);
    if (existing && existing.type !== "file") throw new Error(`atomic write: ${normalized}: not a regular file`);
    this.assertTraversalAccess(parent.path, "/", principal);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    if (existing) {
      this.assertTraversalAccess(existing.path || normalized, "/", principal);
      this.assertAccess(existing, "write", principal, existing.path || normalized);
    }
    const name = this.basename(normalized);
    const mime = options.mime || existing?.mime || mimeFromName(name);
    const stagedName = this.nextAtomicStagedName(parent, name);
    const staged = this.createNode({
      name: stagedName,
      type: "file",
      mime,
      content: normalizeFileContent(content, { mime }),
      icon: options.icon || existing?.icon || iconFromMime(mime),
      permissions: options.permissions || existing?.permissions || "-rw-r--r--",
      owner: options.owner || existing?.owner || ownerFromPrincipal(principal),
      group: options.group || existing?.group || groupFromPrincipal(principal),
      atomicStagedFor: normalized,
      transient: true,
    });
    if (existing?.created) staged.created = existing.created;
    parent.children.push(staged);
    try {
      if (typeof options.beforeCommit === "function") options.beforeCommit(this.withPath(staged, this.join(parent.path, stagedName)), existing ? this.withPath(existing, normalized) : null);
      const stagedIndex = parent.children.indexOf(staged);
      if (stagedIndex < 0) throw new Error(`atomic write: staged file missing for ${normalized}`);
      parent.children.splice(stagedIndex, 1);
      staged.name = name;
      delete staged.atomicStagedFor;
      delete staged.transient;
      staged.created = existing?.created || staged.created;
      staged.modified = new Date().toISOString();
      if (existing) parent.children.splice(existingIndex, 1, staged);
      else parent.children.push(staged);
      this.emitChange(existing ? "atomic-replace" : "atomic-create", normalized);
      return this.withPath(staged, normalized);
    } catch (error) {
      const stagedIndex = parent.children.indexOf(staged);
      if (stagedIndex >= 0) parent.children.splice(stagedIndex, 1);
      this.emitChange("atomic-abort", normalized);
      throw error;
    }
  }

  atomicWriteOrCreateFileBytes(path, bytes, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.atomicWriteOrCreateFile(path, normalizeFileContent(bytes, options), cwd, options, principal);
  }

  async atomicWriteOrCreateFileBlob(path, blob, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.atomicWriteOrCreateFile(path, await normalizeFileContentAsync(blob, options), cwd, options, principal);
  }

  createDirectory(path, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    if (this.exists(normalized)) throw new Error(`mkdir: ${normalized}: file exists`);
    const parent = this.parentFor(normalized);
    this.assertTraversalAccess(parent.path, "/", principal);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    const node = this.createNode({
      name: this.basename(normalized),
      type: "directory",
      icon: options.icon || "folder",
      children: [],
      permissions: options.permissions || "drwxr-xr-x",
      owner: options.owner || ownerFromPrincipal(principal),
      group: options.group || groupFromPrincipal(principal),
    });
    parent.children.push(node);
    this.emitChange("mkdir", normalized);
    return this.withPath(node, normalized);
  }

  createFile(path, cwd = "/", options = {}, principal = this.systemPrincipal) {
    return this.writeOrCreateFile(path, options.content || "", cwd, options, principal);
  }

  createSymlink(target, path, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    const existing = this.lookupChild(normalized).node;
    if (existing) throw new Error(`ln: ${normalized}: file exists`);
    const parent = this.parentFor(normalized);
    this.assertTraversalAccess(parent.path, "/", principal);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    const node = this.createNode({
      name: this.basename(normalized),
      type: "link",
      target: String(target || ""),
      permissions: options.permissions || "lrwxrwxrwx",
      owner: options.owner || ownerFromPrincipal(principal),
      group: options.group || groupFromPrincipal(principal),
    });
    parent.children.push(node);
    this.emitChange("symlink", normalized);
    return this.withPath(node, normalized);
  }

  createHardLink(sourcePath, destinationPath, cwd = "/", principal = this.systemPrincipal) {
    const source = this.resolve(sourcePath, cwd);
    if (!source) throw new Error(`ln: ${sourcePath}: no such file or directory`);
    if (source.type !== "file") throw new Error(`ln: ${sourcePath}: not a regular file`);
    const normalizedDestination = this.normalize(destinationPath, cwd);
    if (this.exists(normalizedDestination)) throw new Error(`ln: ${normalizedDestination}: file exists`);
    this.assertTraversalAccess(source.path, "/", principal);
    this.assertAccess(source, "read", principal, source.path);
    const parent = this.parentFor(normalizedDestination);
    this.assertTraversalAccess(parent.path, "/", principal);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    if (!source.linkId) source.linkId = this.nextLinkId(source.path);
    const node = this.createNode({
      name: this.basename(normalizedDestination),
      type: "file",
      mime: source.mime || mimeFromName(this.basename(normalizedDestination)),
      content: cloneFileContent(source.content),
      icon: source.icon || iconFromMime(source.mime || mimeFromName(this.basename(normalizedDestination))),
      permissions: source.permissions || "-rw-r--r--",
      owner: source.owner || ownerFromPrincipal(principal),
      group: source.group || groupFromPrincipal(principal),
      linkId: source.linkId,
    });
    parent.children.push(node);
    this.emitChange("link", normalizedDestination);
    return this.withPath(node, normalizedDestination);
  }

  createApp(path, appId, icon = "app", cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    const existing = this.resolve(normalized);
    if (existing) {
      if (existing.type !== "app") throw new Error(`app: ${normalized}: file exists`);
      this.assertAccess(existing, "write", principal, normalized);
      existing.appId = appId;
      existing.icon = icon;
      existing.packageId = options.packageId || existing.packageId || "";
      existing.modified = new Date().toISOString();
      this.emitChange("update-app", normalized);
      return this.withPath(existing, normalized);
    }
    const parent = this.parentFor(normalized);
    this.assertTraversalAccess(parent.path, "/", principal);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    const node = this.createNode({
      name: this.basename(normalized),
      type: "app",
      appId,
      icon,
      packageId: options.packageId || "",
      permissions: options.permissions || "-rwxr-xr-x",
      owner: options.owner || "root",
      group: options.group || "root",
    });
    parent.children.push(node);
    this.emitChange("create-app", normalized);
    return this.withPath(node, normalized);
  }

  createMount(path, options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path);
    if (this.exists(normalized)) throw new Error(`mount: ${normalized}: file exists`);
    const parent = this.parentFor(normalized);
    this.assertTraversalAccess(parent.path, "/", principal);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    const node = this.createNode({
      name: this.basename(normalized),
      type: "mount",
      icon: options.icon || "folder",
      mountType: options.mountType || "local-folder",
      handleName: options.handleName || this.basename(normalized),
      transient: options.transient ?? true,
      children: [],
      permissions: options.permissions || "drwxrwxrwx",
      owner: options.owner || ownerFromPrincipal(principal),
      group: options.group || groupFromPrincipal(principal),
    });
    parent.children.push(node);
    this.emitChange("mount", normalized);
    return this.withPath(node, normalized);
  }

  remove(path, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    if (normalized === "/") throw new Error("rm: cannot remove root");
    const { parent, node, index } = this.lookupChild(normalized);
    if (!node) throw new Error(`rm: ${path}: no such file or directory`);
    this.assertTraversalAccess(parent.path, "/", principal);
    this.assertAccess(parent, "write", principal, parent.path);
    this.assertAccess(parent, "execute", principal, parent.path);
    if ((node.type === "directory" || node.type === "mount") && node.children?.length && !options.recursive) {
      throw new Error(`rm: ${path}: directory not empty`);
    }
    parent.children.splice(index, 1);
    this.emitChange("remove", normalized);
    return this.withPath(node, normalized);
  }

  copy(sourcePath, destinationPath, cwd = "/", options = {}, principal = this.systemPrincipal) {
    const source = this.resolve(sourcePath, cwd);
    if (!source) throw new Error(`cp: ${sourcePath}: no such file or directory`);
    this.assertTraversalAccess(source.path, "/", principal);
    this.assertAccess(source, "read", principal, source.path);
    if (source.type === "directory" || source.type === "mount") this.assertAccess(source, "execute", principal, source.path);
    if ((source.type === "directory" || source.type === "mount") && !options.recursive) throw new Error(`cp: ${sourcePath}: is a directory`);
    const destination = this.resolve(destinationPath, cwd);
    const destinationPathNormalized = destination?.type === "directory"
      ? this.join(destination.path, source.name)
      : this.normalize(destinationPath, cwd);
    if (destinationPathNormalized.startsWith(`${source.path}/`)) {
      throw new Error(`cp: cannot copy ${source.path} into itself`);
    }
    if (this.exists(destinationPathNormalized)) throw new Error(`cp: ${destinationPathNormalized}: file exists`);
    const parent = this.parentFor(destinationPathNormalized);
    this.assertTraversalAccess(parent.path, "/", principal);
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
    this.assertTraversalAccess(sourceParent.path, "/", principal);
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
    this.assertTraversalAccess(targetParent.path, "/", principal);
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
    this.assertTraversalAccess(node.path, "/", principal);
    if (!principal.system && principal.user !== "root" && principal.user !== (node.owner || "root")) {
      throw new Error(`chmod: ${path}: permission denied`);
    }
    node.permissions = normalizePermissions(permissions, node);
    node.modified = new Date().toISOString();
    this.emitChange("chmod", node.path);
    return this.withPath(node, node.path);
  }

  chown(path, owner, group = "", cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node) throw new Error(`chown: ${path}: no such file or directory`);
    this.assertTraversalAccess(node.path, "/", principal);
    if (!canChangeOwner(principal)) throw new Error(`chown: ${path}: permission denied`);
    node.owner = sanitizeIdentity(owner, node.owner || "root");
    if (group) node.group = sanitizeIdentity(group, node.group || "users");
    node.modified = new Date().toISOString();
    this.emitChange("chown", node.path);
    return this.withPath(node, node.path);
  }

  chgrp(path, group, cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node) throw new Error(`chgrp: ${path}: no such file or directory`);
    this.assertTraversalAccess(node.path, "/", principal);
    const nextGroup = sanitizeIdentity(group, "");
    if (!nextGroup) throw new Error("chgrp: group is required");
    if (!canChangeGroup(principal, node, nextGroup)) throw new Error(`chgrp: ${path}: permission denied`);
    node.group = nextGroup;
    node.modified = new Date().toISOString();
    this.emitChange("chgrp", node.path);
    return this.withPath(node, node.path);
  }

  stat(path, cwd = "/", principal = this.systemPrincipal) {
    const node = this.resolve(path, cwd);
    if (!node) return null;
    this.assertTraversalAccess(node.path, "/", principal);
    return this.nodeStat(node, node.path);
  }

  lstat(path, cwd = "/", principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    if (normalized === "/") return this.nodeStat(this.root, "/");
    const parts = normalized.split("/").filter(Boolean);
    const parentPath = `/${parts.slice(0, -1).join("/")}`;
    const parent = this.resolve(parentPath || "/");
    const node = parent?.children?.find((child) => child.name === parts.at(-1));
    if (!node) return null;
    this.assertTraversalAccess(normalized, "/", principal);
    return this.nodeStat(this.withPath(node, normalized), normalized);
  }

  readlink(path, cwd = "/", principal = this.systemPrincipal) {
    const normalized = this.normalize(path, cwd);
    const stat = this.lstat(normalized, "/", principal);
    if (!stat) throw new Error(`readlink: ${path}: no such file or directory`);
    if (stat.type !== "link" && stat.type !== "symlink") throw new Error(`readlink: ${path}: not a symbolic link`);
    return stat.target || "";
  }

  exists(path, cwd = "/", principal = this.systemPrincipal) {
    this.assertTraversalAccess(path, cwd, principal);
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
    if (!parent || !isDirectoryLike(parent)) throw new Error(`No such directory: ${parentPath}`);
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
      size: node.size ?? fileContentByteLength(node.content),
    };
  }

  linkedFiles(linkId) {
    const matches = [];
    const visit = (node) => {
      if (!node) return;
      if (node.type === "file" && node.linkId === linkId) matches.push(node);
      (node.children || []).forEach(visit);
    };
    visit(this.root);
    return matches;
  }

  nextLinkId(path) {
    const normalized = this.normalize(path);
    const existing = new Set();
    const visit = (node) => {
      if (!node) return;
      if (node.linkId) existing.add(node.linkId);
      (node.children || []).forEach(visit);
    };
    visit(this.root);
    let candidate = `link:${normalized}:${Date.now().toString(36)}`;
    let index = 0;
    while (existing.has(candidate)) {
      index += 1;
      candidate = `link:${normalized}:${Date.now().toString(36)}:${index}`;
    }
    return candidate;
  }

  nextAtomicStagedName(parent, name) {
    const existing = new Set((parent.children || []).map((child) => child.name));
    let index = 0;
    let candidate = `.${name}.dindbos-tmp`;
    while (existing.has(candidate)) {
      index += 1;
      candidate = `.${name}.dindbos-tmp-${index}`;
    }
    return candidate;
  }

  checkIntegrity(options = {}) {
    const dryRun = options.dryRun !== false;
    const repair = Boolean(options.repair);
    const problems = [];
    const repairs = [];
    let checkedNodes = 0;
    const linkCounts = new Map();
    const queueProtectedRepair = (kind, path, node, from, to, apply) => {
      const record = repairRecord(kind, path, from, to, dryRun);
      if (!dryRun) {
        const protectedBefore = protectedRepairMetadata(node);
        apply();
        const violations = protectedRepairMetadataViolations(protectedBefore, node);
        if (violations.length) {
          restoreProtectedRepairMetadata(node, protectedBefore);
          record.refused = true;
          record.reason = `protected metadata changed: ${violations.join(",")}`;
          problems.push(problem("repair-policy-refused", path, record.reason, false));
        }
      }
      repairs.push(record);
    };
    const visit = (node, path = "/") => {
      checkedNodes += 1;
      if (!node || typeof node !== "object") {
        problems.push(problem("invalid-node", path, "node is not an object", false));
        return;
      }
      if (node.type === "file") {
        const actualSize = fileContentByteLength(node.content);
        if (Number(node.size || 0) !== actualSize) {
          problems.push(problem("size-mismatch", path, `size=${node.size || 0} actual=${actualSize}`, true));
          if (repair) {
            queueProtectedRepair("size", path, node, node.size || 0, actualSize, () => {
              node.size = actualSize;
            });
          }
        }
        if (node.linkId) linkCounts.set(node.linkId, (linkCounts.get(node.linkId) || 0) + 1);
      }
      if (this.isLink(node) && node.target && !safeResolveLink(this, node, path)) {
        problems.push(problem("broken-link", path, `target=${node.target}`, false));
      }
      if (!isDirectoryLike(node)) return;
      if (!Array.isArray(node.children)) {
        problems.push(problem("invalid-children", path, "directory children is not an array", true));
        if (repair) {
          queueProtectedRepair("children", path, node, "invalid", "[]", () => {
            node.children = [];
          });
        }
        return;
      }
      const names = new Map();
      node.children.slice().forEach((child) => {
        const childName = child?.name || "";
        const childPath = this.join(path, childName || "<unnamed>");
        if (!childName) {
          problems.push(problem("orphaned-unnamed-node", childPath, "child has no name and cannot be addressed by path", true));
          if (repair) {
            repairs.push(repairRecord("remove-orphaned-unnamed-node", childPath, "present", "removed", dryRun));
            if (!dryRun) {
              const childIndex = node.children.indexOf(child);
              if (childIndex >= 0) node.children.splice(childIndex, 1);
              return;
            }
          }
        }
        if (names.has(childName)) problems.push(problem("duplicate-name", childPath, `duplicates ${this.join(path, childName)}`, false));
        else names.set(childName, child);
        if (child?.atomicStagedFor || isAtomicStagingName(childName)) {
          problems.push(problem("orphaned-atomic-staging", childPath, `target=${child.atomicStagedFor || "unknown"}`, true));
          if (repair) {
            repairs.push(repairRecord("remove-orphaned-atomic-staging", childPath, "present", "removed", dryRun));
            if (!dryRun) {
              const childIndex = node.children.indexOf(child);
              if (childIndex >= 0) node.children.splice(childIndex, 1);
              return;
            }
          }
        }
        visit(child, childPath);
      });
    };
    visit(this.root, "/");
    const linkActualCounts = linkCounts;
    const verifyLinks = (node, path = "/") => {
      if (node?.type === "file" && node.linkId) {
        const expected = linkActualCounts.get(node.linkId) || 0;
        const statCount = this.nodeStat(node, path).linkCount;
        if (statCount !== expected) problems.push(problem("link-count-mismatch", path, `linkCount=${statCount} actual=${expected}`, false));
      }
      (node?.children || []).forEach((child) => verifyLinks(child, this.join(path, child.name || "<unnamed>")));
    };
    verifyLinks(this.root, "/");
    return {
      ok: problems.length === 0,
      dryRun,
      repaired: repair && !dryRun && repairs.some((entry) => !entry.refused),
      checkedNodes,
      problemCount: problems.length,
      repairCount: repairs.length,
      problems,
      repairs,
    };
  }

  salvageExport(options = {}) {
    const rootPath = this.normalize(options.root || "/");
    const rootNode = this.resolve(rootPath);
    const entries = [];
    const skipped = [];
    const startedAt = new Date().toISOString();
    const walk = (node, path) => {
      if (!node || typeof node !== "object") {
        skipped.push({ path, reason: "invalid-node" });
        return;
      }
      if (path === "/var/recovery" || path.startsWith("/var/recovery/")) {
        skipped.push({ path, reason: "recovery-output" });
        return;
      }
      if (node.transient) {
        skipped.push({ path, reason: "transient" });
        return;
      }
      if (node.type === "file") {
        const bytes = fileContentToBytes(node.content);
        entries.push({
          path,
          type: "file",
          mime: node.mime || mimeFromName(node.name || path),
          size: bytes.byteLength,
          owner: node.owner || "",
          group: node.group || "",
          permissions: node.permissions || "",
          modified: node.modified || "",
          encoding: "base64",
          data: bytesToBase64(bytes),
        });
        return;
      }
      if (isDirectoryLike(node)) {
        entries.push({
          path,
          type: node.type === "mount" ? "mount" : "directory",
          owner: node.owner || "",
          group: node.group || "",
          permissions: node.permissions || "",
          modified: node.modified || "",
        });
        if (!Array.isArray(node.children)) {
          skipped.push({ path, reason: "invalid-children" });
          return;
        }
        node.children.forEach((child) => walk(child, this.join(path, child?.name || "<unnamed>")));
        return;
      }
      skipped.push({ path, reason: `unsupported-${node.type || "unknown"}` });
    };
    if (!rootNode) skipped.push({ path: rootPath, reason: "missing-root" });
    else walk(rootNode, rootPath);
    return {
      kind: "dindbos-fsck-salvage-v1",
      exportedAt: startedAt,
      root: rootPath,
      entries,
      skipped,
      entryCount: entries.length,
      skippedCount: skipped.length,
    };
  }

  snapshot() {
    return cloneForSnapshot(this.root);
  }

  assertAccess(node, access, principal, path) {
    if (!this.policy) return;
    try {
      this.policy.assert(node, access, principal, path);
    } catch (error) {
      if (isPermissionDenied(error)) {
        this.emitAccessDenied({ access, path, node, principal, error });
      }
      throw error;
    }
  }

  assertTraversalAccess(path, cwd = "/", principal = this.systemPrincipal) {
    if (!this.policy || principal?.system || principal?.user === "root") return;
    const normalized = this.normalize(path, cwd);
    const parts = normalized.split("/").filter(Boolean);
    let cursor = "/";
    for (let index = 0; index < parts.length - 1; index += 1) {
      cursor = this.join(cursor, parts[index]);
      const node = this.resolve(cursor);
      if (!node) return;
      this.assertAccess(node, "execute", principal, cursor);
    }
  }

  emitChange(action, path) {
    this.onChange({ action, path, root: this.root });
  }

  emitAccessDenied(event = {}) {
    try {
      this.onAccessDenied({
        access: event.access || "unknown",
        path: event.path || event.node?.path || "",
        principal: event.principal || {},
        node: event.node ? this.nodeStat(event.node, event.node.path || event.path || "") : null,
        reason: "permission-denied",
        message: event.error?.message || "",
      });
    } catch {
      // Access audit hooks must never change the filesystem operation result.
    }
  }

  nodeStat(node, path) {
    const resolved = this.resolveNode(node);
    return {
      path,
      name: node.name,
      type: node.type,
      resolvedType: node.type === "mount" ? "directory" : resolved.type,
      target: node.target || "",
      mime: resolved.mime || mimeForNode(resolved),
      permissions: node.permissions || resolved.permissions || defaultPermissions(node),
      owner: node.owner || resolved.owner || "root",
      group: node.group || resolved.group || "root",
      size: resolved.size ?? fileContentByteLength(resolved.content),
      linkId: resolved.linkId || node.linkId || "",
      linkCount: resolved.linkId || node.linkId ? this.linkedFiles(resolved.linkId || node.linkId).length : 1,
      modified: resolved.modified || node.modified || "2026-04-20T00:00:00.000Z",
    };
  }
}

function isPermissionDenied(error) {
  return String(error?.message || "").includes("permission denied");
}

function sortNodes(a, b) {
  const aRank = isDirectoryLike(a) ? 0 : 1;
  const bRank = isDirectoryLike(b) ? 0 : 1;
  if (aRank !== bRank) return aRank - bRank;
  return a.name.localeCompare(b.name);
}

function defaultPermissions(node) {
  if (isDirectoryLike(node)) return "drwxr-xr-x";
  if (node.type === "app") return "-rwxr-xr-x";
  if (node.type === "link" || node.type === "symlink") return "lrwxrwxrwx";
  return "-rw-r--r--";
}

function isDirectoryLike(node) {
  return node?.type === "directory" || node?.type === "mount";
}

function normalizePermissions(value, node) {
  if (/^[0-7]{3,4}$/.test(value)) return `${typePrefix(node)}${octalToPermissions(value.slice(-3))}`;
  if (value.length === 9) return `${typePrefix(node)}${value}`;
  return value;
}

function canChangeOwner(principal = {}) {
  return Boolean(principal.system || principal.user === "root" || (principal.groups || []).includes("admins"));
}

function canChangeGroup(principal = {}, node = {}, group = "") {
  if (canChangeOwner(principal)) return true;
  if (principal.user !== (node.owner || "root")) return false;
  return (principal.groups || []).includes(group);
}

function sanitizeIdentity(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function typePrefix(node) {
  if (node.type === "directory" || node.type === "mount") return "d";
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
  if (node.type === "directory" || node.type === "mount") return "inode/directory";
  if (node.type === "app") return "application/x-dindbos-app";
  return "application/octet-stream";
}

function cloneNode(node) {
  return {
    ...node,
    content: node.type === "file" ? cloneFileContent(node.content) : node.content,
    children: node.children?.map((child) => cloneNode(child)),
  };
}

function ownerFromPrincipal(principal) {
  return principal?.user || "guest";
}

function groupFromPrincipal(principal) {
  return principal?.groups?.[0] || "users";
}

function cloneForSnapshot(node) {
  const { path, ...snapshot } = node;
  const children = node.children
    ?.filter((child) => !child.transient)
    .map((child) => cloneForSnapshot(child));
  return {
    ...snapshot,
    children,
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
  if (/\.deck\.html?$/i.test(name)) return "application/x-dindbos-deck";
  if (/\.html?$/i.test(name)) return "text/html";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "text/plain";
}

function iconFromMime(mime) {
  if (mime === "application/x-dindbos-deck") return "pdf";
  if (mime === "text/html") return "browser";
  if (mime === "application/pdf") return "pdf";
  if (mime?.startsWith("image/")) return "image";
  return "text";
}

function problem(code, path, message, repairable) {
  return {
    code,
    path,
    message,
    repairable: Boolean(repairable),
  };
}

function isAtomicStagingName(name) {
  return /^\..+\.dindbos-tmp(?:-\d+)?$/.test(String(name || ""));
}

function repairRecord(kind, path, from, to, dryRun) {
  return {
    kind,
    path,
    from,
    to,
    dryRun: Boolean(dryRun),
  };
}

const PROTECTED_REPAIR_METADATA = [
  "owner",
  "group",
  "permissions",
  "securityLabel",
  "securityLabels",
  "quarantine",
  "quarantined",
  "encrypted",
  "volumeLocked",
  "encryptedVolumeLocked",
  "lockState",
];

function protectedRepairMetadata(node) {
  return Object.fromEntries(PROTECTED_REPAIR_METADATA.map((key) => [key, {
    present: Object.hasOwn(node, key),
    value: cloneProtectedValue(node[key]),
  }]));
}

function protectedRepairMetadataViolations(before, node) {
  return Object.entries(before)
    .filter(([key, entry]) => entry.present !== Object.hasOwn(node, key) || JSON.stringify(entry.value) !== JSON.stringify(node[key]))
    .map(([key]) => key);
}

function restoreProtectedRepairMetadata(node, before) {
  Object.entries(before).forEach(([key, entry]) => {
    if (!entry.present) delete node[key];
    else node[key] = cloneProtectedValue(entry.value);
  });
}

function cloneProtectedValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.parse(JSON.stringify(value));
  return value;
}

function safeResolveLink(fs, node, path) {
  try {
    return Boolean(fs.resolve(node.target, fs.dirname(path)));
  } catch {
    return false;
  }
}
