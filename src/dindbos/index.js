import { AppRegistry } from "./app-registry.js?v=20260420-shell-chaining";
import { AppSandbox } from "./app-sandbox.js?v=20260420-shell-chaining";
import { DesktopShell } from "./desktop-shell.js?v=20260420-shell-chaining";
import { EventBus } from "./event-bus.js?v=20260420-shell-chaining";
import { PermissionPolicy } from "./permission-policy.js?v=20260420-shell-chaining";
import { PersistentStorage } from "./persistent-storage.js?v=20260420-shell-chaining";
import { ProcessManager } from "./process-manager.js?v=20260420-shell-chaining";
import { VirtualFileSystem } from "./vfs.js?v=20260420-shell-chaining";
import { WindowManager } from "./window-manager.js?v=20260420-shell-chaining";

export class DindbOS {
  constructor(options) {
    this.root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    this.session = { user: "guest", groups: ["users"], home: "/home/guest", ...options.session };
    this.bus = new EventBus();
    this.permissions = new PermissionPolicy({ defaultUser: this.session.user, defaultGroups: this.session.groups });
    this.storage = new PersistentStorage({ key: options.storageKey || "dindbos:vfs" });
    this.initialFileSystem = options.fileSystem;
    this.fs = this.createFileSystem(options.fileSystem);
    this.shell = new DesktopShell(this);
    this.windows = new WindowManager(this);
    this.processes = new ProcessManager(this);
    this.apps = new AppRegistry(this);
  }

  createFileSystem(rootNode) {
    return new VirtualFileSystem(rootNode, {
      home: this.session.home,
      policy: this.permissions,
      onChange: () => this.persistFileSystem(),
    });
  }

  async loadPersistentFileSystem() {
    const storedFileSystem = await this.storage.loadFileSystem();
    if (storedFileSystem) this.fs = this.createFileSystem(storedFileSystem);
  }

  boot() {
    if (!this.root) throw new Error("DindbOS root element was not found.");
    this.shell.mount(this.root);
    this.windows.mount(this.shell.refs.windowLayer, this.shell.refs.taskStrip);
    this.shell.renderDesktop();
    this.shell.renderDock();
    this.processes.syncProcfs();
    this.bus.emit("boot", { session: this.session });
  }

  registerApp(app) {
    this.apps.register(app);
    if (this.shell.refs.dock) this.shell.renderDock();
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

  openPath(path, context = {}) {
    const node = this.fs.resolve(path);
    return this.openNode(node, context);
  }

  openNode(node, context = {}) {
    if (!node) return null;
    const resolved = this.fs.resolveNode(node);
    if (resolved.type === "directory") {
      return this.launch("files", { path: resolved.path });
    }
    if (resolved.type === "app") {
      return this.launch(resolved.appId, { node: resolved, ...context });
    }
    return this.apps.openFile(resolved, context);
  }
}

export { AppRegistry, AppSandbox, DesktopShell, EventBus, PermissionPolicy, PersistentStorage, ProcessManager, VirtualFileSystem, WindowManager };
