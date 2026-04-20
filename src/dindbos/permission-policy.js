export class PermissionPolicy {
  constructor(options = {}) {
    this.defaultUser = options.defaultUser || "guest";
    this.defaultGroups = options.defaultGroups || ["users"];
  }

  principal(session = {}) {
    return {
      user: session.user || this.defaultUser,
      groups: session.groups || this.defaultGroups,
      system: false,
    };
  }

  systemPrincipal() {
    return {
      user: "root",
      groups: ["root"],
      system: true,
    };
  }

  assert(node, access, principal, path = node?.path || "") {
    if (!node) throw new Error(`${access}: ${path}: no such file or directory`);
    if (this.can(node, access, principal)) return;
    throw new Error(`${access}: ${path}: permission denied`);
  }

  can(node, access, principal = this.systemPrincipal()) {
    if (principal.system || principal.user === "root") return true;
    const mode = node.permissions || defaultPermissions(node);
    const triad = this.triadFor(node, principal);
    const required = access === "execute" ? "x" : access[0];
    return triad.includes(required);
  }

  triadFor(node, principal) {
    const mode = node.permissions || defaultPermissions(node);
    if ((node.owner || "root") === principal.user) return mode.slice(1, 4);
    if ((principal.groups || []).includes(node.group || "root")) return mode.slice(4, 7);
    return mode.slice(7, 10);
  }
}

function defaultPermissions(node) {
  if (node.type === "directory") return "drwxr-xr-x";
  if (node.type === "app") return "-rwxr-xr-x";
  if (node.type === "link" || node.type === "symlink") return "lrwxrwxrwx";
  return "-rw-r--r--";
}
