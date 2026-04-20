const APPLICATION_DIR = "/usr/share/applications";
const PACKAGE_DB_DIR = "/var/lib/dindbos/packages";
const PACKAGE_SOURCE_DIR = "/opt/dindbos/packages";
const PACKAGE_INSTALL_ROOT = "/opt";
const MAX_REMOTE_MANIFEST_BYTES = 512 * 1024;
const MAX_REMOTE_FILE_BYTES = 1024 * 1024;

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

  async installFromUrl(url, options = {}) {
    const sourceUrl = normalizePackageUrl(url);
    const fetcher = options.fetch || globalThis.fetch;
    if (typeof fetcher !== "function") throw new Error("pkg: fetch is not available in this runtime");
    const manifestText = await fetchText(fetcher, sourceUrl, MAX_REMOTE_MANIFEST_BYTES, "manifest");
    const manifest = parseJson(manifestText, sourceUrl);
    const record = this.normalizePackage(manifest, {
      sourcePath: sourceUrl,
      sourceUrl,
    });
    this.ensurePackageRoots();
    this.ensurePackageDirectory(record);
    await this.installDeclaredFiles(record, manifest.files || [], sourceUrl, fetcher);
    this.writePackageRecord(record);
    this.installLauncher(record);
    this.registerPackageApp(record);
    return record;
  }

  install(manifest, options = {}) {
    const record = this.normalizePackage(manifest, options);
    this.ensurePackageRoots();
    this.ensurePackageDirectory(record);
    this.installDeclaredInlineFiles(record, manifest.files || []);
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
      files: [],
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

  installDeclaredInlineFiles(record, files) {
    files.forEach((file) => {
      if (file.url) throw new Error(`pkg: ${file.path || ""}: URL file entries require remote install`);
      const content = contentFromInlineFile(file);
      this.writePackageFile(record, file, content);
    });
  }

  async installDeclaredFiles(record, files, sourceUrl, fetcher) {
    for (const file of files) {
      if (file.url) {
        const fileUrl = normalizePackageUrl(new URL(file.url, sourceUrl).toString());
        const content = await fetchText(fetcher, fileUrl, MAX_REMOTE_FILE_BYTES, `file ${file.path || fileUrl}`);
        this.writePackageFile(record, { ...file, sourceUrl: fileUrl }, content);
        continue;
      }
      this.writePackageFile(record, file, contentFromInlineFile(file));
    }
  }

  writePackageFile(record, file, content) {
    const path = this.resolvePackageFilePath(record, file.path);
    this.ensureParentDirectories(path);
    this.os.fs.writeOrCreateFile(
      path,
      content,
      "/",
      {
        mime: file.mime || mimeFromName(path),
        owner: "root",
        group: "root",
        permissions: file.permissions || "-rw-r--r--",
      },
      this.system,
    );
    record.files.push({
      path,
      mime: file.mime || mimeFromName(path),
      sourceUrl: file.sourceUrl || "",
      size: byteLength(content),
    });
  }

  ensureParentDirectories(path) {
    const directory = this.os.fs.dirname(path);
    let cursor = "/";
    directory.split("/").filter(Boolean).forEach((part) => {
      cursor = this.os.fs.join(cursor, part);
      if (!this.os.fs.exists(cursor)) {
        this.os.fs.createDirectory(cursor, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, this.system);
      }
    });
  }

  resolvePackageFilePath(record, path) {
    const relative = String(path || "").trim();
    if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) {
      throw new Error(`pkg: invalid package file path: ${path || ""}`);
    }
    const resolved = this.os.fs.normalize(relative, record.installPath);
    if (resolved !== record.installPath && resolved.startsWith(`${record.installPath}/`)) return resolved;
    throw new Error(`pkg: file escapes package root: ${path}`);
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
        <div><dt>Files</dt><dd>${escapeHtml(record.files?.map((file) => runtime.fs.basename(file.path)).join(", ") || files.map((file) => file.name).join(", ") || "-")}</dd></div>
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

function normalizePackageUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`pkg: invalid package URL: ${value || ""}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`pkg: unsupported URL protocol: ${url.protocol}`);
  return url.toString();
}

async function fetchText(fetcher, url, maxBytes, label) {
  const response = await fetcher(url, { headers: { Accept: "application/json, text/plain, */*" } });
  if (!response?.ok) throw new Error(`pkg: failed to fetch ${label}: ${response?.status || "network error"}`);
  const length = Number(response.headers?.get?.("content-length") || 0);
  if (length > maxBytes) throw new Error(`pkg: ${label} is too large`);
  const text = await response.text();
  if (byteLength(text) > maxBytes) throw new Error(`pkg: ${label} is too large`);
  return text;
}

function contentFromInlineFile(file) {
  if (!file || typeof file !== "object") throw new Error("pkg: file entry must be an object");
  if (typeof file.content === "string") return file.content;
  if (typeof file.base64 === "string") return decodeBase64Text(file.base64);
  throw new Error(`pkg: ${file.path || ""}: file entry needs content, base64, or url`);
}

function decodeBase64Text(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }
  return Buffer.from(value, "base64").toString("utf8");
}

function mimeFromName(path) {
  if (/\.md$/i.test(path)) return "text/markdown";
  if (/\.txt$/i.test(path)) return "text/plain";
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.html?$/i.test(path)) return "text/html";
  if (/\.css$/i.test(path)) return "text/css";
  if (/\.js$/i.test(path)) return "text/javascript";
  return "text/plain";
}

function normalizeAppId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) throw new Error(`pkg: invalid app id: ${value || ""}`);
  return id;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).length;
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
