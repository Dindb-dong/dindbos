import { canAccessFileSystem, canUseCapability } from "./app-manifest.js?v=20260420-text-save";

export class AppSandbox {
  constructor(os, process) {
    this.os = os;
    this.process = process;
    this.principal = os.permissions.principal({ user: process.user, groups: os.session.groups });
    this.fs = this.createFileSystemFacade();
    this.apps = this.createAppFacade();
    this.processes = this.createProcessFacade();
    this.storage = this.createStorageFacade();
    this.session = Object.freeze({ ...os.session });
  }

  launch(appId, context = {}) {
    this.assertCapability("app.launch");
    return this.os.launch(appId, context);
  }

  openPath(path, context = {}) {
    this.assertCapability("app.launch");
    const normalized = this.os.fs.normalize(path, this.process.cwd);
    this.assertFileSystem(normalized, "read");
    return this.os.openPath(normalized, context);
  }

  openNode(node, context = {}) {
    this.assertCapability("app.launch");
    this.assertFileSystem(node.path || "/", "read");
    return this.os.openNode(node, context);
  }

  assertCapability(capability) {
    if (canUseCapability(this.process.manifest, capability)) return;
    throw new Error(`${this.process.appId}: capability denied: ${capability}`);
  }

  assertFileSystem(path, access) {
    if (canAccessFileSystem(this.process.manifest, path, access)) return;
    throw new Error(`${this.process.appId}: ${access}: ${path}: sandbox denied`);
  }

  createFileSystemFacade() {
    return {
      list: (path = "/", cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.list(normalized, "/", this.principal);
      },
      resolve: (path = "/", cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.resolve(normalized);
      },
      resolveNode: (node) => this.os.fs.resolveNode(node),
      readFile: (path, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.readFile(normalized, "/", this.principal);
      },
      writeFile: (path, content, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.writeFile(normalized, content, "/", this.principal);
      },
      appendFile: (path, content, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.appendFile(normalized, content, "/", this.principal);
      },
      writeOrCreateFile: (path, content, cwd = this.process.cwd, options = {}) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.writeOrCreateFile(normalized, content, "/", options, this.principal);
      },
      createFile: (path, cwd = this.process.cwd, options = {}) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.createFile(normalized, "/", options, this.principal);
      },
      createDirectory: (path, cwd = this.process.cwd, options = {}) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.createDirectory(normalized, "/", options, this.principal);
      },
      remove: (path, cwd = this.process.cwd, options = {}) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.remove(normalized, "/", options, this.principal);
      },
      copy: (sourcePath, destinationPath, cwd = this.process.cwd, options = {}) => {
        const source = this.os.fs.normalize(sourcePath, cwd);
        const destination = this.os.fs.normalize(destinationPath, cwd);
        this.assertFileSystem(source, "read");
        this.assertFileSystem(destination, "write");
        return this.os.fs.copy(source, destination, "/", options, this.principal);
      },
      move: (sourcePath, destinationPath, cwd = this.process.cwd) => {
        const source = this.os.fs.normalize(sourcePath, cwd);
        const destination = this.os.fs.normalize(destinationPath, cwd);
        this.assertFileSystem(source, "write");
        this.assertFileSystem(destination, "write");
        return this.os.fs.move(source, destination, "/", this.principal);
      },
      chmod: (path, permissions, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.chmod(normalized, permissions, "/", this.principal);
      },
      stat: (path, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.stat(normalized);
      },
      lstat: (path, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.lstat(normalized);
      },
      exists: (path, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.exists(normalized);
      },
      isLink: (node) => this.os.fs.isLink(node),
      normalize: (path, cwd = this.process.cwd) => this.os.fs.normalize(path, cwd),
      join: (base, name) => this.os.fs.join(base, name),
      dirname: (path) => this.os.fs.dirname(path),
      basename: (path) => this.os.fs.basename(path),
    };
  }

  createAppFacade() {
    return {
      list: () => this.os.apps.list().map((app) => ({
        id: app.id,
        name: app.name,
        icon: app.icon,
        pinned: app.pinned,
        accepts: [...(app.accepts || [])],
      })),
      manifests: () => this.os.apps.manifests(),
      getManifest: (appId) => this.os.apps.getManifest(appId),
    };
  }

  createProcessFacade() {
    return {
      current: () => ({ ...this.process }),
      list: () => {
        this.assertCapability("process.read");
        return this.os.processes.list();
      },
      kill: (pid) => {
        this.assertCapability("process.manage");
        return this.os.processes.kill(pid, "killed");
      },
      table: () => {
        this.assertCapability("process.read");
        return this.os.processes.formatTable();
      },
    };
  }

  createStorageFacade() {
    return {
      status: () => {
        this.assertCapability("storage.read");
        return this.os.storage.status();
      },
      resetFileSystem: () => {
        this.assertCapability("storage.manage");
        this.os.storage.clearFileSystem();
      },
    };
  }
}
