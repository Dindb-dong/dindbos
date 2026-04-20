const APPLICATION_DIR = "/usr/share/applications";
const PACKAGE_DB_DIR = "/var/lib/dindbos/packages";
const PACKAGE_SOURCE_DIR = "/opt/dindbos/packages";
const PACKAGE_INSTALL_ROOT = "/opt";

const SAMPLE_PACKAGE = {
  id: "hello-notes",
  name: "Hello Notes",
  version: "0.1.0",
  description: "A small packaged app installed from dindbos.app.json.",
  app: {
    id: "hello-notes",
    name: "Hello Notes",
    title: "Hello Notes.app",
    icon: "text",
    width: 560,
    height: 380,
    content: [
      "# Hello Notes",
      "",
      "This app was installed through the DindbOS package manager.",
      "Try `pkg list`, `pkg info hello-notes`, or open `/usr/share/applications/Hello Notes.app`.",
    ].join("\n"),
  },
  permissions: {
    capabilities: [],
    fileSystem: {
      read: ["/opt/hello-notes"],
      write: [],
    },
  },
};

export class PackageManager {
  constructor(os) {
    this.os = os;
    this.system = os.permissions.systemPrincipal();
  }

  bootstrap() {
    this.ensurePackageRoots();
    this.ensureSamplePackageSource();
    if (!this.list().length) this.installFromManifestPath(`${PACKAGE_SOURCE_DIR}/hello-notes/dindbos.app.json`);
    this.registerInstalledPackages();
  }

  list() {
    this.ensurePackageRoots();
    return this.packageRecordNodes()
      .map((node) => this.readPackageRecord(node.path))
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  info(packageId) {
    const id = normalizePackageId(packageId);
    const path = this.packageRecordPath(id);
    if (!this.os.fs.exists(path)) return null;
    return this.readPackageRecord(path);
  }

  installFromManifestPath(path, cwd = "/") {
    const manifestPath = this.os.fs.normalize(path, cwd);
    const node = this.os.fs.resolve(manifestPath);
    if (!node || node.type !== "file") throw new Error(`pkg: ${path}: manifest not found`);
    const manifest = parseJson(this.os.fs.readFile(manifestPath, "/", this.system), manifestPath);
    return this.install(manifest, {
      sourcePath: manifestPath,
      sourceDirectory: this.os.fs.dirname(manifestPath),
    });
  }

  install(manifest, options = {}) {
    const record = this.normalizePackage(manifest, options);
    this.ensurePackageRoots();
    this.ensurePackageDirectory(record);
    this.writePackageRecord(record);
    this.installLauncher(record);
    this.registerPackageApp(record);
    return record;
  }

  remove(packageId) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    const launcher = this.launcherPath(record);
    if (this.os.fs.exists(launcher)) this.os.fs.remove(launcher, "/", {}, this.system);
    if (this.os.fs.exists(record.installPath)) this.os.fs.remove(record.installPath, "/", { recursive: true }, this.system);
    if (this.os.fs.exists(this.packageRecordPath(record.id))) {
      this.os.fs.remove(this.packageRecordPath(record.id), "/", {}, this.system);
    }
    this.os.unregisterApp(record.app.id);
    return record;
  }

  registerInstalledPackages() {
    this.list().forEach((record) => this.registerPackageApp(record));
  }

  normalizePackage(manifest, options = {}) {
    if (!manifest || typeof manifest !== "object") throw new Error("pkg: manifest must be an object");
    const id = normalizePackageId(manifest.id);
    const app = manifest.app || {};
    const appId = normalizeAppId(app.id || id);
    const name = String(manifest.name || app.name || id);
    const installPath = `${PACKAGE_INSTALL_ROOT}/${id}`;
    const capabilities = [
      ...(manifest.permissions?.capabilities || []),
      ...(manifest.capabilities || []),
      ...(app.capabilities || []),
    ];
    const fileSystem = app.fileSystem || manifest.fileSystem || manifest.permissions?.fileSystem || {};
    return {
      id,
      name,
      version: String(manifest.version || app.version || "0.1.0"),
      description: String(manifest.description || app.description || ""),
      installPath,
      sourcePath: options.sourcePath || manifest.sourcePath || "",
      installedAt: new Date().toISOString(),
      originalManifest: manifest,
      app: {
        id: appId,
        name: String(app.name || name),
        title: String(app.title || `${app.name || name}.app`),
        icon: String(app.icon || manifest.icon || "app"),
        width: Number(app.width || manifest.width || 620),
        height: Number(app.height || manifest.height || 420),
        pinned: Boolean(app.pinned || manifest.pinned),
        accepts: [...(app.accepts || manifest.accepts || [])],
        content: String(app.content || manifest.content || ""),
        capabilities: unique(capabilities),
        fileSystem: {
          read: unique(fileSystem.read || [installPath]),
          write: unique(fileSystem.write || []),
        },
      },
    };
  }

  ensurePackageRoots() {
    [
      "/var",
      "/var/lib",
      "/var/lib/dindbos",
      PACKAGE_DB_DIR,
      PACKAGE_INSTALL_ROOT,
      "/opt/dindbos",
      PACKAGE_SOURCE_DIR,
      "/usr",
      "/usr/share",
      APPLICATION_DIR,
    ].forEach((path) => {
      if (!this.os.fs.exists(path)) {
        this.os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, this.system);
      }
    });
  }

  ensureSamplePackageSource() {
    const directory = `${PACKAGE_SOURCE_DIR}/hello-notes`;
    if (!this.os.fs.exists(directory)) {
      this.os.fs.createDirectory(directory, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, this.system);
    }
    const manifestPath = `${directory}/dindbos.app.json`;
    if (!this.os.fs.exists(manifestPath)) {
      this.os.fs.writeOrCreateFile(
        manifestPath,
        `${JSON.stringify(SAMPLE_PACKAGE, null, 2)}\n`,
        "/",
        { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
        this.system,
      );
    }
    const readmePath = `${directory}/README.md`;
    if (!this.os.fs.exists(readmePath)) {
      this.os.fs.writeOrCreateFile(
        readmePath,
        "# Hello Notes package\n\nInstall with `pkg install /opt/dindbos/packages/hello-notes/dindbos.app.json`.\n",
        "/",
        { mime: "text/markdown", owner: "root", group: "root", permissions: "-rw-r--r--" },
        this.system,
      );
    }
  }

  ensurePackageDirectory(record) {
    if (!this.os.fs.exists(record.installPath)) {
      this.os.fs.createDirectory(record.installPath, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, this.system);
    }
    this.os.fs.writeOrCreateFile(
      `${record.installPath}/dindbos.app.json`,
      `${JSON.stringify(record.originalManifest, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
    this.os.fs.writeOrCreateFile(
      `${record.installPath}/PACKAGE.md`,
      [`# ${record.name}`, "", record.description || "No package description.", ""].join("\n"),
      "/",
      { mime: "text/markdown", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
  }

  installLauncher(record) {
    this.os.fs.createApp(
      this.launcherPath(record),
      record.app.id,
      record.app.icon,
      "/",
      {
        owner: "root",
        group: "root",
        permissions: "-rwxr-xr-x",
        packageId: record.id,
      },
      this.system,
    );
  }

  registerPackageApp(record) {
    this.os.registerApp({
      id: record.app.id,
      name: record.app.name,
      title: record.app.title,
      icon: record.app.icon,
      pinned: record.app.pinned,
      width: record.app.width,
      height: record.app.height,
      accepts: record.app.accepts,
      manifest: {
        version: record.version,
        entry: `package:${record.id}`,
        description: record.description,
        capabilities: record.app.capabilities,
        fileSystem: record.app.fileSystem,
      },
      render: ({ content, os: runtime }) => renderPackagedApp(content, runtime, record),
    });
  }

  writePackageRecord(record) {
    this.os.fs.writeOrCreateFile(
      this.packageRecordPath(record.id),
      `${JSON.stringify(record, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
  }

  readPackageRecord(path) {
    try {
      return parseJson(this.os.fs.readFile(path, "/", this.system), path);
    } catch {
      return null;
    }
  }

  packageRecordNodes() {
    return this.os.fs.list(PACKAGE_DB_DIR, "/", this.system)
      .filter((node) => node.type === "file" && node.name.endsWith(".json"));
  }

  packageRecordPath(packageId) {
    return `${PACKAGE_DB_DIR}/${normalizePackageId(packageId)}.json`;
  }

  launcherPath(record) {
    return `${APPLICATION_DIR}/${record.app.title || `${record.app.name}.app`}`;
  }
}

function renderPackagedApp(content, runtime, record) {
  const files = safeRead(() => runtime.fs.list(record.installPath), []);
  content.innerHTML = `
    <section class="package-app">
      <p class="dos-kicker">Package ${escapeHtml(record.id)} ${escapeHtml(record.version)}</p>
      <h2>${escapeHtml(record.app.name)}</h2>
      <p>${escapeHtml(record.description || "Installed DindbOS package.")}</p>
      ${record.app.content ? `<pre>${escapeHtml(record.app.content)}</pre>` : ""}
      <dl>
        <div><dt>Install path</dt><dd>${escapeHtml(record.installPath)}</dd></div>
        <div><dt>Source</dt><dd>${escapeHtml(record.sourcePath || "-")}</dd></div>
        <div><dt>Files</dt><dd>${escapeHtml(files.map((file) => file.name).join(", ") || "-")}</dd></div>
      </dl>
    </section>
  `;
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`pkg: ${path}: invalid JSON: ${error.message}`);
  }
}

function normalizePackageId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`pkg: invalid package id: ${value || ""}`);
  }
  return id;
}

function normalizeAppId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) throw new Error(`pkg: invalid app id: ${value || ""}`);
  return id;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function safeRead(reader, fallback) {
  try {
    return reader();
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
