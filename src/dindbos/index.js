import { AppRegistry } from "./app-registry.js?v=20260421-files-app-2";
import { AppSandbox } from "./app-sandbox.js?v=20260421-files-app-2";
import { DesktopShell } from "./desktop-shell.js?v=20260421-files-app-2";
import { EventBus } from "./event-bus.js?v=20260421-files-app-2";
import { LocalFolderMountManager } from "./local-folder-mount.js?v=20260421-files-app-2";
import { NodeCompat } from "./node-compat.js?v=20260421-files-app-2";
import { NpmInstaller } from "./npm-installer.js?v=20260421-files-app-2";
import { PackageManager } from "./package-manager.js?v=20260421-files-app-2";
import { PermissionPolicy } from "./permission-policy.js?v=20260421-files-app-2";
import { PersistentStorage } from "./persistent-storage.js?v=20260421-files-app-2";
import { ProcessManager } from "./process-manager.js?v=20260421-files-app-2";
import { VirtualFileSystem } from "./vfs.js?v=20260421-files-app-2";
import { WindowManager } from "./window-manager.js?v=20260421-files-app-2";

export class DindbOS {
  constructor(options = {}) {
    this.root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    this.session = { user: "guest", groups: ["users"], home: "/home/guest", ...options.session };
    this.bus = new EventBus();
    this.permissions = new PermissionPolicy({ defaultUser: this.session.user, defaultGroups: this.session.groups });
    this.storage = options.storage || new PersistentStorage({ key: options.storageKey || "dindbos:vfs" });
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
      lastFlushedAt: "",
    };
    this.initialFileSystem = options.fileSystem;
    this.fs = this.createFileSystem(options.fileSystem);
    this.shell = new DesktopShell(this);
    this.windows = new WindowManager(this);
    this.processes = new ProcessManager(this);
    this.apps = new AppRegistry(this);
    this.packages = new PackageManager(this);
    this.npm = new NpmInstaller(this);
    this.node = new NodeCompat(this);
    this.localMounts = new LocalFolderMountManager(this, options.localMounts || {});
  }

  createFileSystem(rootNode) {
    return new VirtualFileSystem(rootNode, {
      home: this.session.home,
      policy: this.permissions,
      onChange: (event) => this.schedulePersistFileSystem(event),
    });
  }

  async loadPersistentFileSystem() {
    const storedFileSystem = await this.storage.loadFileSystem();
    if (storedFileSystem) this.fs = this.createFileSystem(storedFileSystem);
    await this.localMounts.restorePersistedMounts();
  }

  boot() {
    if (!this.root) throw new Error("DindbOS root element was not found.");
    this.shell.mount(this.root);
    this.windows.mount(this.shell.refs.windowLayer, this.shell.refs.taskStrip);
    this.shell.renderDesktop();
    this.shell.renderDock();
    this.processes.syncProcfs();
    this.installPersistenceLifecycleHooks();
    this.bus.emit("boot", { session: this.session });
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
      } while (this.persistRequestedDuringFlush || this.persistPending);
    } finally {
      this.persisting = false;
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
      persistScheduled: this.persistenceStats.scheduled,
      persistCoalesced: this.persistenceStats.coalesced,
      persistFlushes: this.persistenceStats.flushed,
      persistLastAction: this.persistenceStats.lastAction,
      persistLastPath: this.persistenceStats.lastPath,
      persistLastFlushedAt: this.persistenceStats.lastFlushedAt,
    };
  }

  installPersistenceLifecycleHooks() {
    if (this.persistenceHooksInstalled || typeof globalThis.window === "undefined") return;
    this.persistenceHooksInstalled = true;
    const flush = () => {
      this.flushPersistentFileSystem();
    };
    globalThis.window.addEventListener("pagehide", flush);
    globalThis.document?.addEventListener?.("visibilitychange", () => {
      if (globalThis.document.visibilityState === "hidden") flush();
    });
  }

  openPath(path, context = {}) {
    const node = this.fs.resolve(path);
    return this.openNode(node, context);
  }

  openNode(node, context = {}) {
    if (!node) return null;
    const resolved = this.fs.resolveNode(node);
    if (resolved.type === "directory" || resolved.type === "mount") {
      return this.launch("files", { path: resolved.path });
    }
    if (resolved.type === "app") {
      return this.launch(resolved.appId, { node: resolved, ...context });
    }
    return this.apps.openFile(resolved, context);
  }
}

export { AppRegistry, AppSandbox, DesktopShell, EventBus, LocalFolderMountManager, NodeCompat, NpmInstaller, PackageManager, PermissionPolicy, PersistentStorage, ProcessManager, VirtualFileSystem, WindowManager };
