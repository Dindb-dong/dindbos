import { AppRegistry } from "./app-registry.js?v=20260422-browserd";
import { AppSandbox } from "./app-sandbox.js?v=20260422-browserd";
import { compatibilitySnapshot } from "./compat.js?v=20260422-browserd";
import { RuntimeCacheStore } from "./cache-store.js?v=20260422-browserd";
import { DesktopShell } from "./desktop-shell.js?v=20260422-browserd";
import { EventBus } from "./event-bus.js?v=20260422-browserd";
import { LocalFolderMountManager } from "./local-folder-mount.js?v=20260422-browserd";
import { NodeCompat } from "./node-compat.js?v=20260422-browserd";
import { NpmInstaller } from "./npm-installer.js?v=20260422-browserd";
import { PackageManager } from "./package-manager.js?v=20260422-browserd";
import { PermissionPolicy } from "./permission-policy.js?v=20260422-browserd";
import { PersistentStorage } from "./persistent-storage.js?v=20260422-browserd";
import { ProcessManager } from "./process-manager.js?v=20260422-browserd";
import { SyscallDispatcher } from "./syscalls.js?v=20260422-browserd";
import { VirtualFileSystem } from "./vfs.js?v=20260422-browserd";
import { WindowManager } from "./window-manager.js?v=20260422-browserd";

export const BOOT_PHASES = [
  { id: "storage-load", label: "Storage load" },
  { id: "vfs-mount", label: "VFS mount" },
  { id: "package-registry-load", label: "Package registry load" },
  { id: "app-registry-load", label: "App registry load" },
  { id: "process-init", label: "Process init" },
  { id: "desktop-render", label: "Desktop render" },
];

export const DISK_POLICY_AREAS = [
  { root: "/home", type: "user", durability: "persistent", policy: "browser-backed user files" },
  { root: "/opt", type: "packages", durability: "persistent", policy: "installed package files" },
  { root: "/var/cache", type: "cache", durability: "evictable", policy: "package and document cache" },
  { root: "/var", type: "runtime", durability: "persistent", policy: "runtime records and logs" },
  { root: "/tmp", type: "temporary", durability: "session", policy: "scratch files" },
  { root: "/mnt", type: "external", durability: "user-granted", policy: "local and virtual mounts" },
];

export class DindbOS {
  constructor(options = {}) {
    this.root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    this.session = normalizeSession(options.session || {});
    this.sessionAuth = {
      state: this.session.locked ? "locked" : "authenticated",
      locked: Boolean(this.session.locked),
      lockedAt: this.session.locked ? new Date().toISOString() : "",
      unlockedAt: this.session.locked ? "" : new Date().toISOString(),
      reason: this.session.lockReason || "",
    };
    this.bus = new EventBus();
    this.permissions = new PermissionPolicy({ defaultUser: this.session.user, defaultGroups: this.session.groups });
    this.storage = options.storage || new PersistentStorage({ key: options.storageKey || "dindbos:vfs" });
    this.cache = options.cache || new RuntimeCacheStore({ name: options.cacheName || "dindbos-runtime-cache-v1" });
    this.browserProvider = {
      url: normalizeBrowserProviderUrl(options.browserProviderUrl),
      label: options.browserProviderLabel || "Local browserd",
    };
    this.persistDelayMs = options.persistDelayMs ?? 120;
    this.persistTimer = null;
    this.persistPending = false;
    this.persisting = false;
    this.persistRequestedDuringFlush = false;
    this.persistenceHooksInstalled = false;
    this.persistenceStats = {
      scheduled: 0,
      coalesced: 0,
      flushed: 0,
      lastAction: "",
      lastPath: "",
      lastFlushStartedAt: "",
      lastFlushedAt: "",
      lastFlushDurationMs: 0,
      lastFlushError: "",
    };
    this.initialFileSystem = options.fileSystem;
    this.fs = this.createFileSystem(options.fileSystem);
    this.shell = new DesktopShell(this);
    this.windows = new WindowManager(this);
    this.processes = new ProcessManager(this);
    this.syscalls = new SyscallDispatcher(this);
    this.apps = new AppRegistry(this);
    this.packages = new PackageManager(this);
    this.npm = new NpmInstaller(this);
    this.node = new NodeCompat(this);
    this.localMounts = new LocalFolderMountManager(this, options.localMounts || {});
    this.bootPhases = new Map(BOOT_PHASES.map((phase, index) => [phase.id, {
      ...phase,
      index,
      status: "pending",
      detail: "",
      startedAt: "",
      finishedAt: "",
      durationMs: 0,
      error: "",
    }]));
  }

  createFileSystem(rootNode) {
    return new VirtualFileSystem(rootNode, {
      home: this.session.home,
      policy: this.permissions,
      onChange: (event) => this.schedulePersistFileSystem(event),
    });
  }

  async loadPersistentFileSystem(options = {}) {
    const recover = options.recover !== false;
    try {
      await this.runBootPhase("storage-load", async () => {
        const storedFileSystem = await this.storage.loadFileSystem();
        if (storedFileSystem) this.fs = this.createFileSystem(storedFileSystem);
        return storedFileSystem ? "restored persisted filesystem" : "using initial filesystem";
      });
    } catch (error) {
      if (!recover) throw error;
      this.fs = this.createFileSystem(this.initialFileSystem);
      this.recoverBootPhase("storage-load", "storage load failed; recovered with initial filesystem", error);
    }
    try {
      await this.runBootPhase("vfs-mount", async () => {
        await this.localMounts.restorePersistedMounts();
        return "filesystem and persisted local mounts ready";
      });
    } catch (error) {
      if (!recover) throw error;
      this.recoverBootPhase("vfs-mount", "local mount restore failed; continuing without persisted mounts", error);
    }
    this.ensureDiskPolicyRoots();
    this.ensureUserGroupDatabase();
    this.ensureSessionHome();
    this.writeSessionStatus();
  }

  boot() {
    if (!this.root) throw new Error("DindbOS root element was not found.");
    this.runBootPhaseSync("process-init", () => {
      this.processes.syncProcfs();
      return "process table and /proc ready";
    });
    this.runBootPhaseSync("desktop-render", () => {
      this.shell.mount(this.root);
      this.windows.mount(this.shell.refs.windowLayer, this.shell.refs.taskStrip);
      this.shell.renderDesktop();
      this.shell.renderDock();
      return "desktop shell, dock, and window layer ready";
    });
    this.installPersistenceLifecycleHooks();
    this.writeBootDiagnostics();
    this.bus.emit("boot", { session: this.session, phases: this.bootStatus() });
  }

  async runBootPhase(id, action) {
    this.startBootPhase(id);
    const startedAt = Date.now();
    try {
      const detail = await action();
      return this.finishBootPhase(id, "complete", detail, startedAt);
    } catch (error) {
      this.finishBootPhase(id, "error", "", startedAt, error);
      throw error;
    }
  }

  runBootPhaseSync(id, action) {
    this.startBootPhase(id);
    const startedAt = Date.now();
    try {
      const detail = action();
      return this.finishBootPhase(id, "complete", detail, startedAt);
    } catch (error) {
      this.finishBootPhase(id, "error", "", startedAt, error);
      throw error;
    }
  }

  startBootPhase(id) {
    const phase = this.bootPhases.get(id);
    if (!phase) throw new Error(`unknown boot phase: ${id}`);
    Object.assign(phase, {
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: "",
      durationMs: 0,
      error: "",
    });
    this.bus.emit("boot:phase", { ...phase });
    return { ...phase };
  }

  finishBootPhase(id, status, detail = "", startedAt = Date.now(), error = null) {
    const phase = this.bootPhases.get(id);
    if (!phase) throw new Error(`unknown boot phase: ${id}`);
    Object.assign(phase, {
      status,
      detail: detail || (status === "complete" ? `${phase.label} complete` : ""),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      error: error ? error.message || String(error) : "",
    });
    this.bus.emit("boot:phase", { ...phase });
    return { ...phase };
  }

  recoverBootPhase(id, detail, error = null) {
    const phase = this.bootPhases.get(id);
    if (!phase) throw new Error(`unknown boot phase: ${id}`);
    Object.assign(phase, {
      status: "recovered",
      detail,
      finishedAt: new Date().toISOString(),
      error: error ? error.message || String(error) : phase.error,
    });
    this.bus.emit("boot:phase", { ...phase });
    return { ...phase };
  }

  bootStatus() {
    return [...this.bootPhases.values()]
      .sort((left, right) => left.index - right.index)
      .map((phase) => ({ ...phase }));
  }

  writeBootDiagnostics() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/log", "root", system);
    this.ensureSystemDirectory("/var/log/dindbos", "root", system);
    const phases = this.bootStatus();
    const bootedAt = new Date().toISOString();
    const payload = {
      bootedAt,
      session: {
        user: this.session.user,
        groups: this.session.groups,
        home: this.session.home,
      },
      phases,
      persistence: this.persistenceStatus(),
      storageBuckets: this.storageBucketPolicy(),
    };
    this.fs.writeOrCreateFile("/var/log/dindbos/boot.json", `${JSON.stringify(payload, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.fs.writeOrCreateFile("/var/log/dindbos/boot.log", `${phases.map((phase) => (
      `[${phase.status}] ${phase.id} ${phase.durationMs}ms ${phase.detail || phase.error}`
    )).join("\n")}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "text/plain",
    }, system);
  }

  ensureDiskPolicyRoots() {
    const system = this.permissions.systemPrincipal();
    DISK_POLICY_AREAS
      .map((area) => area.root)
      .sort((left, right) => left.length - right.length)
      .forEach((root) => this.ensureSystemDirectory(root, "root", system));
  }

  ensureSessionHome() {
    const user = this.session.user || "guest";
    const group = this.session.groups?.[0] || "users";
    const home = this.session.home || `/home/${user}`;
    this.ensureUserHome(user, group, home);
  }

  ensureUserHome(user, group = "users", home = `/home/${user}`) {
    const system = this.permissions.systemPrincipal();
    this.ensureDirectoryPath(home, {
      leafOwner: user,
      leafGroup: group,
      leafPermissions: "drwxr-xr-x",
      principal: system,
    });
    ["Desktop", "Documents", "Downloads", ".Trash"].forEach((name) => {
      this.ensureSystemDirectory(this.fs.join(home, name), user, system, {
        group,
        permissions: "drwxr-xr-x",
      });
    });
    const profilePath = this.fs.join(home, ".profile");
    if (!this.fs.exists(profilePath)) {
      this.fs.writeOrCreateFile(profilePath, [
        `export USER=${user}`,
        `export HOME=${home}`,
        "export SHELL=/bin/dindbsh",
        "",
      ].join("\n"), "/", {
        owner: user,
        group,
        permissions: "-rw-r--r--",
        mime: "text/plain",
      }, system);
    }
  }

  ensureUserGroupDatabase() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/etc", "root", system);
    this.ensureSystemDirectory("/etc/dindbos", "root", system);
    const database = this.userGroupDatabase();
    const user = this.session.user || "guest";
    const groups = this.session.groups?.length ? this.session.groups : ["users"];
    if (!database.users[user]) {
      database.users[user] = {
        user,
        home: this.session.home || `/home/${user}`,
        groups: [...groups],
        createdAt: new Date().toISOString(),
      };
    }
    groups.forEach((group) => {
      database.groups[group] = database.groups[group] || { group, members: [] };
      if (!database.groups[group].members.includes(user)) database.groups[group].members.push(user);
    });
    this.writeUserGroupDatabase(database);
  }

  userGroupDatabase() {
    const path = "/etc/dindbos/users.json";
    if (!this.fs.exists(path)) return { users: {}, groups: {} };
    try {
      const parsed = JSON.parse(this.fs.readFile(path, "/", this.permissions.systemPrincipal()));
      return {
        users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
        groups: parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {},
      };
    } catch {
      return { users: {}, groups: {} };
    }
  }

  writeUserGroupDatabase(database) {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/etc", "root", system);
    this.ensureSystemDirectory("/etc/dindbos", "root", system);
    const normalized = {
      users: Object.fromEntries(Object.entries(database.users || {}).sort(([left], [right]) => left.localeCompare(right))),
      groups: Object.fromEntries(Object.entries(database.groups || {}).sort(([left], [right]) => left.localeCompare(right))),
      updatedAt: new Date().toISOString(),
    };
    this.fs.writeOrCreateFile("/etc/dindbos/users.json", `${JSON.stringify(normalized, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    return normalized;
  }

  listUsers() {
    return Object.values(this.userGroupDatabase().users).map((user) => ({
      ...user,
      groups: [...(user.groups || [])],
    }));
  }

  listGroups() {
    return Object.values(this.userGroupDatabase().groups).map((group) => ({
      ...group,
      members: [...(group.members || [])],
    }));
  }

  createGroup(name) {
    const group = sanitizeIdentifier(name, "");
    if (!group) throw new Error("group: invalid group name");
    const database = this.userGroupDatabase();
    database.groups[group] = database.groups[group] || { group, members: [], createdAt: new Date().toISOString() };
    this.writeUserGroupDatabase(database);
    return { ...database.groups[group], members: [...(database.groups[group].members || [])] };
  }

  createUser(name, options = {}) {
    const user = sanitizeUserName(name);
    const groups = sanitizeGroups(options.groups?.length ? options.groups : ["users"]);
    const home = normalizeHomePath(options.home, user);
    const database = this.userGroupDatabase();
    if (database.users[user]) throw new Error(`user: ${user}: already exists`);
    database.users[user] = {
      user,
      home,
      groups: [...groups],
      createdAt: new Date().toISOString(),
    };
    groups.forEach((group) => {
      database.groups[group] = database.groups[group] || { group, members: [], createdAt: new Date().toISOString() };
      if (!database.groups[group].members.includes(user)) database.groups[group].members.push(user);
    });
    this.writeUserGroupDatabase(database);
    this.ensureUserHome(user, groups[0] || "users", home);
    return { ...database.users[user], groups: [...database.users[user].groups] };
  }

  addUserToGroup(userName, groupName) {
    const user = sanitizeUserName(userName);
    const group = sanitizeIdentifier(groupName, "");
    if (!group) throw new Error("group: invalid group name");
    const database = this.userGroupDatabase();
    if (!database.users[user]) throw new Error(`user: ${user}: no such user`);
    database.groups[group] = database.groups[group] || { group, members: [], createdAt: new Date().toISOString() };
    if (!database.users[user].groups.includes(group)) database.users[user].groups.push(group);
    if (!database.groups[group].members.includes(user)) database.groups[group].members.push(user);
    this.writeUserGroupDatabase(database);
    return {
      user: { ...database.users[user], groups: [...database.users[user].groups] },
      group: { ...database.groups[group], members: [...database.groups[group].members] },
    };
  }

  removeUserFromGroup(userName, groupName) {
    const user = sanitizeUserName(userName);
    const group = sanitizeIdentifier(groupName, "");
    const database = this.userGroupDatabase();
    if (!database.users[user]) throw new Error(`user: ${user}: no such user`);
    database.users[user].groups = (database.users[user].groups || []).filter((candidate) => candidate !== group);
    if (database.groups[group]) {
      database.groups[group].members = (database.groups[group].members || []).filter((candidate) => candidate !== user);
    }
    this.writeUserGroupDatabase(database);
    return { ...database.users[user], groups: [...database.users[user].groups] };
  }

  sessionStatus() {
    return {
      user: this.session.user,
      groups: [...(this.session.groups || [])],
      home: this.session.home,
      state: this.sessionAuth.state,
      locked: this.sessionAuth.locked,
      lockedAt: this.sessionAuth.lockedAt,
      unlockedAt: this.sessionAuth.unlockedAt,
      reason: this.sessionAuth.reason,
    };
  }

  lockSession(reason = "manual") {
    if (this.sessionAuth.locked) return this.sessionStatus();
    Object.assign(this.sessionAuth, {
      state: "locked",
      locked: true,
      lockedAt: new Date().toISOString(),
      reason: String(reason || "manual"),
    });
    this.writeSessionStatus();
    this.bus.emit("session:lock", this.sessionStatus());
    return this.sessionStatus();
  }

  unlockSession() {
    if (!this.sessionAuth.locked) return this.sessionStatus();
    Object.assign(this.sessionAuth, {
      state: "authenticated",
      locked: false,
      unlockedAt: new Date().toISOString(),
      reason: "",
    });
    this.writeSessionStatus();
    this.bus.emit("session:unlock", this.sessionStatus());
    return this.sessionStatus();
  }

  assertSessionUnlocked(action = "session") {
    if (!this.sessionAuth.locked) return;
    throw new Error(`${action}: session locked for ${this.session.user}; unlock session to continue`);
  }

  writeSessionStatus() {
    const system = this.permissions.systemPrincipal();
    this.ensureSystemDirectory("/var", "root", system);
    this.ensureSystemDirectory("/var/run", "root", system);
    this.ensureSystemDirectory("/var/run/dindbos", "root", system);
    this.fs.writeOrCreateFile("/var/run/dindbos/session.json", `${JSON.stringify(this.sessionStatus(), null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
  }

  diskPolicyAreas() {
    return DISK_POLICY_AREAS.map((area) => ({
      ...area,
      bucket: this.storageBucketForArea(area),
      exists: this.fs.exists(area.root),
      usedBytes: this.fs.exists(area.root) ? this.countBytes(area.root) : 0,
    }));
  }

  storageBucketPolicy() {
    const supported = Boolean(globalThis.navigator?.storageBuckets);
    return {
      supported,
      decision: supported ? "available-but-not-mounted" : "fallback-to-current-storage-stack",
      reason: supported
        ? "Storage Buckets are detected, but DindbOS keeps the current OPFS/IndexedDB/Cache split until migration and quota semantics are verified."
        : "Storage Buckets are unavailable in this runtime; /tmp, /var/cache, and durable app data stay separated by disk policy and storage backend selection.",
      areas: DISK_POLICY_AREAS.map((area) => ({
        root: area.root,
        type: area.type,
        bucket: this.storageBucketForArea(area),
      })),
    };
  }

  storageBucketForArea(area) {
    if (area.root === "/tmp") return "session";
    if (area.root === "/var/cache") return "cache";
    if (area.root === "/home" || area.root === "/var" || area.root === "/opt") return "durable";
    return "external-or-virtual";
  }

  compatibilitySnapshot() {
    return compatibilitySnapshot(this);
  }

  syscall(name, args = {}, context = {}) {
    const principal = context.principal || this.permissions.principal({ user: this.session.user, groups: this.session.groups });
    return this.syscalls.call(name, args, { ...context, principal });
  }

  diskPolicyForPath(path) {
    const normalized = this.fs.normalize(path);
    return this.diskPolicyAreas()
      .filter((area) => normalized === area.root || normalized.startsWith(`${area.root}/`))
      .sort((left, right) => right.root.length - left.root.length)
      [0] || {
        root: "/",
        type: "root",
        durability: "persistent",
        policy: "root filesystem",
        exists: true,
        usedBytes: this.countBytes("/"),
      };
  }

  countBytes(path) {
    const node = this.fs.resolve(path) || this.fs.lstat(path);
    if (!node) return 0;
    const resolved = this.fs.resolveNode(node);
    if (resolved.type === "file") return Number(resolved.size || this.fs.readFileBytes(resolved.path).byteLength || 0);
    if (resolved.type !== "directory" && resolved.type !== "mount") return 0;
    return this.fs.list(resolved.path).reduce((total, entry) => total + this.countBytes(entry.path), 0);
  }

  ensureDirectoryPath(path, options = {}) {
    const normalized = this.fs.normalize(path);
    const parts = normalized.split("/").filter(Boolean);
    let cursor = "/";
    parts.forEach((part, index) => {
      cursor = this.fs.join(cursor, part);
      const isLeaf = index === parts.length - 1;
      this.ensureSystemDirectory(cursor, isLeaf ? options.leafOwner : "root", options.principal, {
        group: isLeaf ? options.leafGroup : "root",
        permissions: isLeaf ? options.leafPermissions : "drwxr-xr-x",
      });
    });
  }

  ensureSystemDirectory(path, owner, principal, options = {}) {
    if (this.fs.exists(path)) return;
    this.fs.createDirectory(path, "/", {
      owner,
      group: options.group || "root",
      permissions: options.permissions || "drwxr-xr-x",
    }, principal);
  }

  registerApp(app) {
    this.apps.register(app);
    if (this.shell.refs.dock) this.shell.renderDock();
  }

  unregisterApp(appId) {
    const removed = this.apps.unregister(appId);
    if (removed && this.shell.refs.dock) this.shell.renderDock();
    return removed;
  }

  launch(appId, context = {}) {
    this.assertSessionUnlocked("launch");
    return this.apps.launch(appId, context);
  }

  createSandbox(process) {
    return new AppSandbox(this, process);
  }

  persistFileSystem() {
    this.storage.saveFileSystem(this.fs.snapshot());
  }

  schedulePersistFileSystem(event = {}) {
    this.persistPending = true;
    this.persistenceStats.scheduled += 1;
    this.persistenceStats.lastAction = event.action || "";
    this.persistenceStats.lastPath = event.path || "";
    if (this.persisting) {
      this.persistRequestedDuringFlush = true;
      this.persistenceStats.coalesced += 1;
      return;
    }
    if (this.persistDelayMs <= 0) {
      this.flushPersistentFileSystem();
      return;
    }
    if (this.persistTimer) {
      this.persistenceStats.coalesced += 1;
      return;
    }
    this.persistTimer = globalThis.setTimeout(() => {
      this.persistTimer = null;
      this.flushPersistentFileSystem();
    }, this.persistDelayMs);
  }

  async flushPersistentFileSystem() {
    if (this.persistTimer) {
      globalThis.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.persisting) {
      this.persistRequestedDuringFlush = true;
      await this.storage.flush?.();
      return this.persistenceStatus();
    }
    this.persisting = true;
    const startedAt = Date.now();
    this.persistenceStats.lastFlushStartedAt = new Date(startedAt).toISOString();
    this.persistenceStats.lastFlushError = "";
    try {
      do {
        this.persistRequestedDuringFlush = false;
        if (!this.persistPending) {
          await this.storage.flush?.();
          break;
        }
        this.persistPending = false;
        this.persistFileSystem();
        await this.storage.flush?.();
        this.persistenceStats.flushed += 1;
        this.persistenceStats.lastFlushedAt = new Date().toISOString();
        this.persistenceStats.lastFlushDurationMs = Date.now() - startedAt;
      } while (this.persistRequestedDuringFlush || this.persistPending);
    } catch (error) {
      this.persistenceStats.lastFlushError = error?.message || String(error);
      throw error;
    } finally {
      this.persisting = false;
      this.persistenceStats.lastFlushDurationMs = Date.now() - startedAt;
    }
    return this.persistenceStatus();
  }

  resetPersistentFileSystem() {
    if (this.persistTimer) {
      globalThis.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistPending = false;
    this.persistRequestedDuringFlush = false;
    this.storage.resetFileSystem();
  }

  persistenceStatus() {
    return {
      persistDelayMs: this.persistDelayMs,
      persistPending: this.persistPending || Boolean(this.persistTimer),
      persistInFlight: this.persisting,
      persistScheduled: this.persistenceStats.scheduled,
      persistCoalesced: this.persistenceStats.coalesced,
      persistFlushes: this.persistenceStats.flushed,
      persistLastAction: this.persistenceStats.lastAction,
      persistLastPath: this.persistenceStats.lastPath,
      persistLastFlushStartedAt: this.persistenceStats.lastFlushStartedAt,
      persistLastFlushedAt: this.persistenceStats.lastFlushedAt,
      persistLastFlushDurationMs: this.persistenceStats.lastFlushDurationMs,
      persistLastFlushError: this.persistenceStats.lastFlushError,
    };
  }

  hasPendingPersistenceWork() {
    const storageStatus = this.storage.status?.() || {};
    return Boolean(
      this.persistPending
      || this.persistTimer
      || this.persisting
      || storageStatus.writePending
      || storageStatus.persistPending
      || storageStatus.persistInFlight,
    );
  }

  installPersistenceLifecycleHooks() {
    if (this.persistenceHooksInstalled || typeof globalThis.window === "undefined") return;
    this.persistenceHooksInstalled = true;
    const flush = () => {
      this.flushPersistentFileSystem();
    };
    const flushBeforeUnload = (event) => {
      const pending = this.hasPendingPersistenceWork();
      flush();
      if (!pending) return undefined;
      const message = "DindbOS is still saving filesystem changes.";
      event?.preventDefault?.();
      if (event) event.returnValue = message;
      return message;
    };
    globalThis.window.addEventListener("pagehide", flush);
    globalThis.window.addEventListener("beforeunload", flushBeforeUnload);
    globalThis.document?.addEventListener?.("visibilitychange", () => {
      if (globalThis.document.visibilityState === "hidden") flush();
    });
  }

  openPath(path, context = {}) {
    this.assertSessionUnlocked("open");
    const node = this.fs.resolve(path);
    return this.openNode(node, context);
  }

  openNode(node, context = {}) {
    this.assertSessionUnlocked("open");
    if (!node) return null;
    const resolved = this.fs.resolveNode(node);
    if (resolved.type === "directory" || resolved.type === "mount") {
      return this.launch("files", { path: resolved.path });
    }
    if (resolved.type === "app") {
      const principal = this.permissions.principal({ user: this.session.user, groups: this.session.groups });
      this.fs.assertAccess(resolved, "execute", principal, resolved.path || node.path);
      return this.launch(resolved.appId, { node: resolved, ...context });
    }
    return this.apps.openFile(resolved, context);
  }
}

export function normalizeSession(session = {}) {
  const user = sanitizeUserName(session.user || "guest");
  const groups = sanitizeGroups(session.groups);
  const home = normalizeHomePath(session.home, user);
  return {
    ...session,
    user,
    groups,
    home,
  };
}

function sanitizeGroups(groups) {
  const values = Array.isArray(groups) ? groups : ["users"];
  const sanitized = values.map((group) => sanitizeIdentifier(group, "")).filter(Boolean);
  return sanitized.length ? [...new Set(sanitized)] : ["users"];
}

function sanitizeUserName(value) {
  return sanitizeIdentifier(value, "guest");
}

function sanitizeIdentifier(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeHomePath(home, user) {
  if (!home) return `/home/${user}`;
  const normalized = String(home).trim().replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalized || !normalized.startsWith("/") || normalized.includes("..")) return `/home/${user}`;
  return normalized === "/" ? `/home/${user}` : normalized;
}

function normalizeBrowserProviderUrl(url) {
  const value = String(url || "ws://127.0.0.1:8787/browser").trim();
  if (!value) return "ws://127.0.0.1:8787/browser";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return "ws://127.0.0.1:8787/browser";
    if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/browser";
    return parsed.toString();
  } catch {
    return "ws://127.0.0.1:8787/browser";
  }
}

export { AppRegistry, AppSandbox, RuntimeCacheStore, DesktopShell, EventBus, LocalFolderMountManager, NodeCompat, NpmInstaller, PackageManager, PermissionPolicy, PersistentStorage, ProcessManager, SyscallDispatcher, VirtualFileSystem, WindowManager };
