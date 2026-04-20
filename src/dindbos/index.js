import { AppRegistry } from "./app-registry.js";
import { DesktopShell } from "./desktop-shell.js";
import { EventBus } from "./event-bus.js";
import { VirtualFileSystem } from "./vfs.js";
import { WindowManager } from "./window-manager.js";

export class DindbOS {
  constructor(options) {
    this.root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    this.session = options.session || {};
    this.bus = new EventBus();
    this.fs = new VirtualFileSystem(options.fileSystem);
    this.shell = new DesktopShell(this);
    this.windows = new WindowManager(this);
    this.apps = new AppRegistry(this);
  }

  boot() {
    if (!this.root) throw new Error("DindbOS root element was not found.");
    this.shell.mount(this.root);
    this.windows.mount(this.shell.refs.windowLayer, this.shell.refs.taskStrip);
    this.shell.renderDesktop();
    this.shell.renderDock();
    this.bus.emit("boot", { session: this.session });
  }

  registerApp(app) {
    this.apps.register(app);
    if (this.shell.refs.dock) this.shell.renderDock();
  }

  launch(appId, context = {}) {
    return this.apps.launch(appId, context);
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

export { AppRegistry, DesktopShell, EventBus, VirtualFileSystem, WindowManager };
