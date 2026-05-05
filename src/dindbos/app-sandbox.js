import { canAccessFileSystem, canUseCapability } from "./app-manifest.js?v=20260422-browserd";

const APP_STATE_DIR = "/var/lib/dindbos/app-state";
const MAX_APP_STATE_VALUE_BYTES = 64 * 1024;

export class AppSandbox {
  constructor(os, process) {
    this.os = os;
    this.process = process;
    this.principal = os.permissions.principal({ user: process.user, groups: os.session.groups });
    this.fs = this.createFileSystemFacade();
    this.apps = this.createAppFacade();
    this.processes = this.createProcessFacade();
    this.packages = this.createPackageFacade();
    this.services = this.createServiceFacade();
    this.npm = this.createNpmFacade();
    this.node = this.createNodeFacade();
    this.storage = this.createStorageFacade();
    this.state = this.createStateFacade();
    this.localMounts = this.createLocalMountFacade();
    this.syscall = (name, args = {}) => this.os.syscall(name, args, {
      process: this.process,
      principal: this.principal,
      assertCapability: (capability) => this.assertCapability(capability),
      assertFileSystem: (path, access) => this.assertFileSystem(path, access),
    });
    this.session = Object.freeze({ ...os.session });
  }

  launch(appId, context = {}) {
    this.assertCapability("app.launch");
    return this.os.launch(appId, { ...context, parentPid: this.process.pid });
  }

  openPath(path, context = {}) {
    this.assertCapability("app.launch");
    const normalized = this.os.fs.normalize(path, this.process.cwd);
    this.assertFileSystem(normalized, "read");
    return this.os.openPath(normalized, { ...context, parentPid: this.process.pid });
  }

  openNode(node, context = {}) {
    this.assertCapability("app.launch");
    this.assertFileSystem(node.path || "/", "read");
    return this.os.openNode(node, { ...context, parentPid: this.process.pid });
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
        this.os.fs.assertTraversalAccess(normalized, "/", this.principal);
        return this.os.fs.resolve(normalized);
      },
      resolveNode: (node) => this.os.fs.resolveNode(node),
      readFile: (path, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.readFile(normalized, "/", this.principal);
      },
      readFileBytes: (path, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.readFileBytes(normalized, "/", this.principal);
      },
      writeFile: (path, content, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.writeFile(normalized, content, "/", this.principal);
      },
      writeFileBytes: (path, bytes, cwd = this.process.cwd, options = {}) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.writeFileBytes(normalized, bytes, "/", options, this.principal);
      },
      writeFileBlob: async (path, blob, cwd = this.process.cwd, options = {}) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.writeFileBlob(normalized, blob, "/", options, this.principal);
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
      writeOrCreateFileBytes: (path, bytes, cwd = this.process.cwd, options = {}) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.writeOrCreateFileBytes(normalized, bytes, "/", options, this.principal);
      },
      writeOrCreateFileBlob: async (path, blob, cwd = this.process.cwd, options = {}) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.fs.writeOrCreateFileBlob(normalized, blob, "/", options, this.principal);
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
        return this.os.fs.stat(normalized, "/", this.principal);
      },
      lstat: (path, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.lstat(normalized, "/", this.principal);
      },
      exists: (path, cwd = this.process.cwd) => {
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.fs.exists(normalized, "/", this.principal);
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
      current: () => this.os.processes.get(this.process.pid) || { ...this.process },
      list: () => {
        this.assertCapability("process.read");
        return this.os.processes.list();
      },
      get: (pid) => {
        this.assertCapability("process.read");
        return this.os.processes.get(pid);
      },
      log: (pid) => {
        this.assertCapability("process.read");
        return this.os.processes.readLog(pid);
      },
      logSelf: (message, level = "info") => {
        this.os.processes.log(this.process.pid, String(message || ""), level);
      },
      kill: (pid) => {
        this.assertCapability("process.manage");
        return this.os.processes.kill(pid, "killed");
      },
      restart: (pid) => {
        this.assertCapability("process.manage");
        return this.os.processes.restart(pid);
      },
      table: () => {
        this.assertCapability("process.read");
        return this.os.processes.formatTable();
      },
    };
  }

  createPackageFacade() {
    return {
      list: () => {
        this.assertCapability("package.read");
        return this.os.packages.list().map((record) => packageSummary(record));
      },
      info: (packageId) => {
        this.assertCapability("package.read");
        const record = this.os.packages.info(packageId);
        return record ? packageSummary(record, true) : null;
      },
      dependencies: (packageId) => {
        this.assertCapability("package.read");
        return this.os.packages.dependencies(packageId);
      },
      registries: () => {
        this.assertCapability("package.read");
        return this.os.packages.registries();
      },
      search: async (query) => {
        this.assertCapability("package.read");
        return this.os.packages.search(query);
      },
      installFromManifestPath: (path, cwd = this.process.cwd) => {
        this.assertCapability("package.manage");
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return packageSummary(this.os.packages.installFromManifestPath(normalized), true);
      },
      installFromRegistry: async (packageId) => {
        this.assertCapability("package.manage");
        return packageSummary(await this.os.packages.installFromRegistry(packageId), true);
      },
      installFromUrl: async (url) => {
        this.assertCapability("package.manage");
        return packageSummary(await this.os.packages.installFromUrl(url), true);
      },
      update: async (packageId) => {
        this.assertCapability("package.manage");
        return packageSummary(await this.os.packages.update(packageId), true);
      },
      addNpmDependency: (packageId, specifier) => {
        this.assertCapability("package.manage");
        return this.os.packages.installNpmDependency(packageId, specifier);
      },
      remove: (packageId) => {
        this.assertCapability("package.manage");
        return packageSummary(this.os.packages.remove(packageId), true);
      },
    };
  }

  createServiceFacade() {
    return {
      list: () => {
        this.assertCapability("service.read");
        return this.os.services?.list?.() || [];
      },
      get: (serviceId) => {
        this.assertCapability("service.read");
        return this.os.services?.get?.(serviceId) || null;
      },
      log: (serviceId) => {
        this.assertCapability("service.read");
        return this.os.services?.readLog?.(serviceId) || [];
      },
      start: (serviceId) => {
        this.assertCapability("service.manage");
        return this.os.services.start(serviceId, { principal: this.os.permissions.systemPrincipal() });
      },
      stop: (serviceId) => {
        this.assertCapability("service.manage");
        return this.os.services.stop(serviceId, { principal: this.os.permissions.systemPrincipal() });
      },
      restart: (serviceId) => {
        this.assertCapability("service.manage");
        return this.os.services.restart(serviceId, { principal: this.os.permissions.systemPrincipal() });
      },
      disable: (serviceId) => {
        this.assertCapability("service.manage");
        return this.os.services.disable(serviceId, { principal: this.os.permissions.systemPrincipal() });
      },
      enable: (serviceId) => {
        this.assertCapability("service.manage");
        return this.os.services.enable(serviceId, { principal: this.os.permissions.systemPrincipal() });
      },
    };
  }

  createNpmFacade() {
    return {
      install: async (specifiers, cwd = this.process.cwd) => {
        this.assertCapability("npm.install");
        const normalized = this.os.fs.normalize(cwd, this.process.cwd);
        this.assertFileSystem(normalized, "write");
        return this.os.npm.install(specifiers, normalized);
      },
    };
  }

  createNodeFacade() {
    return {
      runFile: (path, cwd = this.process.cwd, argv = []) => {
        this.assertCapability("node.execute");
        const normalized = this.os.fs.normalize(path, cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.node.runFile(normalized, "/", { argv });
      },
      evaluate: (source, cwd = this.process.cwd) => {
        this.assertCapability("node.execute");
        const normalized = this.os.fs.normalize(cwd, this.process.cwd);
        this.assertFileSystem(normalized, "read");
        return this.os.node.evaluate(source, normalized);
      },
    };
  }

  createStorageFacade() {
    return {
      status: () => {
        this.assertCapability("storage.read");
        return { ...this.os.storage.status(), ...this.os.persistenceStatus?.() };
      },
      estimate: async () => {
        this.assertCapability("storage.read");
        return { ...await this.os.storage.estimate(), ...this.os.persistenceStatus?.() };
      },
      flush: async () => {
        this.assertCapability("storage.manage");
        return this.os.flushPersistentFileSystem?.();
      },
      resetFileSystem: () => {
        this.assertCapability("storage.manage");
        if (typeof this.os.resetPersistentFileSystem === "function") this.os.resetPersistentFileSystem();
        else this.os.storage.clearFileSystem();
      },
    };
  }

  createStateFacade() {
    return {
      get: (key, fallback = null) => {
        const normalizedKey = normalizeStateKey(key);
        const record = this.readStateRecord();
        return Object.hasOwn(record.values, normalizedKey) ? cloneJson(record.values[normalizedKey]) : cloneJson(fallback);
      },
      set: (key, value) => {
        const normalizedKey = normalizeStateKey(key);
        const record = this.readStateRecord();
        record.values[normalizedKey] = normalizeStateValue(value);
        this.writeStateRecord(record);
        return cloneJson(record.values[normalizedKey]);
      },
      remove: (key) => {
        const normalizedKey = normalizeStateKey(key);
        const record = this.readStateRecord();
        const existed = Object.hasOwn(record.values, normalizedKey);
        delete record.values[normalizedKey];
        this.writeStateRecord(record);
        return existed;
      },
      keys: () => Object.keys(this.readStateRecord().values).sort(),
      snapshot: () => cloneJson(this.readStateRecord().values),
      clear: () => {
        this.writeStateRecord(this.emptyStateRecord());
        return true;
      },
      path: () => this.statePath(),
    };
  }

  statePath() {
    return appStatePath(this.process.appId);
  }

  emptyStateRecord() {
    return {
      version: 1,
      appId: this.process.appId,
      updatedAt: "",
      values: {},
    };
  }

  readStateRecord() {
    const path = this.statePath();
    if (!this.os.fs.exists(path)) return this.emptyStateRecord();
    const parsed = safeParseJson(this.os.fs.readFile(path, "/", this.os.permissions.systemPrincipal()), path);
    if (!parsed || parsed.version !== 1 || parsed.appId !== this.process.appId || !isPlainObject(parsed.values)) {
      return this.emptyStateRecord();
    }
    return {
      version: 1,
      appId: this.process.appId,
      updatedAt: String(parsed.updatedAt || ""),
      values: cloneJson(parsed.values),
    };
  }

  writeStateRecord(record) {
    ensureStateDirectory(this.os);
    const payload = {
      version: 1,
      appId: this.process.appId,
      updatedAt: new Date().toISOString(),
      values: cloneJson(record.values || {}),
    };
    this.os.fs.writeOrCreateFile(
      this.statePath(),
      `${JSON.stringify(payload, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-------" },
      this.os.permissions.systemPrincipal(),
    );
  }

  createLocalMountFacade() {
    return {
      supported: () => Boolean(this.os.localMounts?.supported()),
      mountLocal: (name = "", options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.mountLocal(name, options);
      },
      unmount: (path, options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.unmount(path, options);
      },
      listMounts: () => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.listMounts();
      },
      status: () => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.status();
      },
      restorePersistedMounts: (options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.restorePersistedMounts(options);
      },
      requestAccess: (path, options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.requestAccess(path, options);
      },
      forgetMount: (path) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.forgetMount(path);
      },
      operations: () => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.operationStatus();
      },
      copyPolicy: () => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.copyPolicy();
      },
      nativeHelperStatus: () => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.nativeHelperStatus();
      },
      isMountedPath: (path, cwd = this.process.cwd) => this.os.localMounts.isMountedPath(path, cwd),
      syncDirectory: (path) => this.os.localMounts.syncDirectory(path),
      list: (path, cwd = this.process.cwd) => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.list(path, cwd);
      },
      stat: (path, cwd = this.process.cwd) => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.stat(path, cwd);
      },
      readFile: (path, cwd = this.process.cwd) => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.readFile(path, cwd);
      },
      readFileBytes: (path, cwd = this.process.cwd) => {
        this.assertCapability("localMount.read");
        return this.os.localMounts.readFileBytes(path, cwd);
      },
      writeFile: (path, content, cwd = this.process.cwd) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.writeFile(path, content, cwd);
      },
      writeFileBytes: (path, bytes, cwd = this.process.cwd, options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.writeFileBytes(path, bytes, cwd, options);
      },
      writeFileBlob: (path, blob, cwd = this.process.cwd, options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.writeFileBlob(path, blob, cwd, options);
      },
      createDirectory: (path, cwd = this.process.cwd, options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.createDirectory(path, cwd, options);
      },
      copy: (sourcePath, destinationPath, cwd = this.process.cwd, options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.copy(sourcePath, destinationPath, cwd, options);
      },
      move: (sourcePath, destinationPath, cwd = this.process.cwd, options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.move(sourcePath, destinationPath, cwd, options);
      },
      remove: (path, cwd = this.process.cwd, options = {}) => {
        this.assertCapability("localMount.manage");
        return this.os.localMounts.remove(path, cwd, options);
      },
      exists: (path, cwd = this.process.cwd) => this.os.localMounts.exists(path, cwd),
    };
  }
}

export function appStatePath(appId) {
  const safeId = encodeURIComponent(String(appId || "app"));
  return `${APP_STATE_DIR}/${safeId && safeId !== "." && safeId !== ".." ? safeId : "app"}.json`;
}

export function removeAppState(os, appId) {
  const path = appStatePath(appId);
  if (os.fs.exists(path)) os.fs.remove(path, "/", {}, os.permissions.systemPrincipal());
  return path;
}

function ensureStateDirectory(os) {
  const system = os.permissions.systemPrincipal();
  ["/var", "/var/lib", "/var/lib/dindbos", APP_STATE_DIR].forEach((path) => {
    if (!os.fs.exists(path)) {
      os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, system);
    }
  });
}

function normalizeStateKey(key) {
  const value = String(key ?? "").trim();
  if (!value) throw new Error("app state key is required");
  if (value.length > 128) throw new Error("app state key is too long");
  return value;
}

function normalizeStateValue(value) {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("app state value must be JSON serializable");
  if (new TextEncoder().encode(text).byteLength > MAX_APP_STATE_VALUE_BYTES) {
    throw new Error("app state value exceeds 64 KiB");
  }
  return JSON.parse(text);
}

function safeParseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    return { version: 1, appId: "", updatedAt: "", values: {}, source: path };
  }
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function packageSummary(record, details = false) {
  const summary = {
    id: record.id,
    name: record.name,
    version: record.version,
    description: record.description,
    installPath: record.installPath,
    sourcePath: record.sourcePath,
    app: {
      id: record.app.id,
      name: record.app.name,
      title: record.app.title,
      icon: record.app.icon,
    },
  };
  if (details) {
    summary.permissions = {
      capabilities: [...record.app.capabilities],
      fileSystem: {
        read: [...record.app.fileSystem.read],
        write: [...record.app.fileSystem.write],
      },
    };
    summary.dependencies = JSON.parse(JSON.stringify(record.dependencies || { packages: {}, npm: {} }));
  }
  return summary;
}
