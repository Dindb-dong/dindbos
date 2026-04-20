const APPLICATION_DIR = "/usr/share/applications";
const PACKAGE_DB_DIR = "/var/lib/dindbos/packages";
const PACKAGE_SOURCE_DIR = "/opt/dindbos/packages";
const PACKAGE_INSTALL_ROOT = "/opt";
const REGISTRY_CONFIG_PATH = "/etc/dindbos/package-registries.json";
const LOCAL_REGISTRY_PATH = "/opt/dindbos/registry/index.json";
const NPM_ESM_BASE_URL = "https://esm.sh";
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
    entry: "app.js",
    content: [
      "# Hello Notes",
      "",
      "This app was installed through the DindbOS package manager.",
      "Try `pkg list`, `pkg info hello-notes`, or open `/usr/share/applications/Hello Notes.app`.",
    ].join("\n"),
  },
  dependencies: {
    npm: {
      "lodash-es": "^4.17.21",
    },
  },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export function mount({ content, pkg, imports }) {",
        "  content.innerHTML = `",
        "    <section class=\"package-app\">",
        "      <p class=\"dos-kicker\">Package ${pkg.id} ${pkg.version}</p>",
        "      <h2>${pkg.name}</h2>",
        "      <p>This UI was rendered by /opt/${pkg.id}/app.js.</p>",
        "      <button type=\"button\" data-load-npm>Load lodash-es from npm</button>",
        "      <pre data-output>Waiting for action.</pre>",
        "    </section>",
        "  `;",
        "  content.querySelector('[data-load-npm]').addEventListener('click', async () => {",
        "    const lodash = await imports.npm('lodash-es');",
        "    content.querySelector('[data-output]').textContent = lodash.kebabCase('Hello Notes Package Runtime');",
        "  });",
        "}",
      ].join("\n"),
    },
  ],
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
    const packages = this.list();
    if (!packages.length || !this.info("hello-notes")?.app?.entryPath) {
      this.installFromManifestPath(`${PACKAGE_SOURCE_DIR}/hello-notes/dindbos.app.json`);
    }
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

  async installFromRegistry(packageId, options = {}) {
    const match = (await this.search(packageId, options))
      .find((entry) => entry.id === packageId || entry.name === packageId);
    if (!match) throw new Error(`pkg: ${packageId}: package not found in registries`);
    if (!match.manifestUrl) throw new Error(`pkg: ${packageId}: registry entry has no manifestUrl`);
    if (isHttpUrl(match.manifestUrl)) return this.installFromUrl(match.manifestUrl, options);
    return this.installFromManifestPath(match.manifestUrl);
  }

  async update(packageId, options = {}) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    if (isHttpUrl(record.sourcePath)) return this.installFromUrl(record.sourcePath, options);
    if (record.sourcePath) return this.installFromManifestPath(record.sourcePath);
    throw new Error(`pkg: ${packageId}: no update source recorded`);
  }

  dependencies(packageId) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    return cloneJson(record.dependencies || { packages: {}, npm: {} });
  }

  installNpmDependency(packageId, specifier) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    const dependency = normalizeNpmDependencySpecifier(specifier);
    record.dependencies = record.dependencies || { packages: {}, npm: {} };
    record.dependencies.npm = record.dependencies.npm || {};
    record.dependencies.npm[dependency.name] = dependency;
    this.writeNpmDependencyRecords(record);
    this.writePackageRecord(record);
    this.registerPackageApp(record);
    return dependency;
  }

  registries() {
    this.ensurePackageRoots();
    const config = parseJson(this.os.fs.readFile(REGISTRY_CONFIG_PATH, "/", this.system), REGISTRY_CONFIG_PATH);
    return [...(config.registries || [])];
  }

  addRegistry(name, url) {
    const registry = { name: normalizeRegistryName(name), url: normalizeRegistryUrl(url) };
    const registries = this.registries().filter((entry) => entry.name !== registry.name);
    registries.push(registry);
    this.writeRegistryConfig(registries);
    return registry;
  }

  removeRegistry(name) {
    const registryName = normalizeRegistryName(name);
    const registries = this.registries();
    const next = registries.filter((entry) => entry.name !== registryName);
    if (next.length === registries.length) throw new Error(`pkg: registry not found: ${name}`);
    this.writeRegistryConfig(next);
    return registryName;
  }

  async search(query = "", options = {}) {
    const fetcher = options.fetch || globalThis.fetch;
    const needle = String(query || "").toLowerCase();
    const results = [];
    for (const registry of this.registries()) {
      const index = await this.readRegistryIndex(registry, fetcher);
      (index.packages || []).forEach((entry) => {
        const candidate = normalizeRegistryPackage(entry, registry);
        if (!needle || [candidate.id, candidate.name, candidate.description].join(" ").toLowerCase().includes(needle)) {
          results.push(candidate);
        }
      });
    }
    return results.sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
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

  async readRegistryIndex(registry, fetcher = globalThis.fetch) {
    if (isHttpUrl(registry.url)) {
      if (typeof fetcher !== "function") throw new Error("pkg: fetch is not available in this runtime");
      return parseJson(await fetchText(fetcher, registry.url, MAX_REMOTE_MANIFEST_BYTES, `registry ${registry.name}`), registry.url);
    }
    return parseJson(this.os.fs.readFile(registry.url, "/", this.system), registry.url);
  }

  writeRegistryConfig(registries) {
    this.os.fs.writeOrCreateFile(
      REGISTRY_CONFIG_PATH,
      `${JSON.stringify({ registries }, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
  }

  normalizePackage(manifest, options = {}) {
    if (!manifest || typeof manifest !== "object") throw new Error("pkg: manifest must be an object");
    const id = normalizePackageId(manifest.id);
    const app = manifest.app || {};
    const appId = normalizeAppId(app.id || id);
    const name = String(manifest.name || app.name || id);
    const installPath = `${PACKAGE_INSTALL_ROOT}/${id}`;
    const entry = normalizeOptionalRelativePath(app.entry || manifest.entry || "");
    const capabilities = [
      ...(manifest.permissions?.capabilities || []),
      ...(manifest.capabilities || []),
      ...(app.capabilities || []),
    ];
    const fileSystem = app.fileSystem || manifest.fileSystem || manifest.permissions?.fileSystem || {};
    const dependencies = normalizeDependencies(manifest.dependencies || app.dependencies || {});
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
      dependencies,
      app: {
        id: appId,
        name: String(app.name || name),
        title: String(app.title || `${app.name || name}.app`),
        icon: String(app.icon || manifest.icon || "app"),
        width: Number(app.width || manifest.width || 620),
        height: Number(app.height || manifest.height || 420),
        pinned: Boolean(app.pinned || manifest.pinned),
        accepts: [...(app.accepts || manifest.accepts || [])],
        entry,
        entryPath: entry ? `${installPath}/${entry}` : "",
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
      "/etc",
      "/etc/dindbos",
      "/var",
      "/var/lib",
      "/var/lib/dindbos",
      PACKAGE_DB_DIR,
      PACKAGE_INSTALL_ROOT,
      "/opt/dindbos",
      PACKAGE_SOURCE_DIR,
      "/opt/dindbos/registry",
      "/usr",
      "/usr/share",
      APPLICATION_DIR,
    ].forEach((path) => {
      if (!this.os.fs.exists(path)) {
        this.os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, this.system);
      }
    });
    this.ensureRegistryConfig();
    this.ensureLocalRegistryIndex();
  }

  ensureSamplePackageSource() {
    const directory = `${PACKAGE_SOURCE_DIR}/hello-notes`;
    if (!this.os.fs.exists(directory)) {
      this.os.fs.createDirectory(directory, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, this.system);
    }
    const manifestPath = `${directory}/dindbos.app.json`;
    const currentManifest = this.os.fs.exists(manifestPath)
      ? safeRead(() => this.os.fs.readFile(manifestPath, "/", this.system), "")
      : "";
    if (!currentManifest.includes('"entry": "app.js"')) {
      this.os.fs.writeOrCreateFile(
        manifestPath,
        `${JSON.stringify(SAMPLE_PACKAGE, null, 2)}\n`,
        "/",
        { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
        this.system,
      );
    }
    const appPath = `${directory}/app.js`;
    if (!this.os.fs.exists(appPath)) {
      const appFile = SAMPLE_PACKAGE.files.find((file) => file.path === "app.js");
      this.os.fs.writeOrCreateFile(
        appPath,
        appFile.content,
        "/",
        { mime: "text/javascript", owner: "root", group: "root", permissions: "-rw-r--r--" },
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

  ensureRegistryConfig() {
    if (this.os.fs.exists(REGISTRY_CONFIG_PATH)) return;
    this.os.fs.writeOrCreateFile(
      REGISTRY_CONFIG_PATH,
      `${JSON.stringify({ registries: [{ name: "local", url: LOCAL_REGISTRY_PATH }] }, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
  }

  ensureLocalRegistryIndex() {
    if (this.os.fs.exists(LOCAL_REGISTRY_PATH)) return;
    this.os.fs.writeOrCreateFile(
      LOCAL_REGISTRY_PATH,
      `${JSON.stringify({
        name: "DindbOS Local Registry",
        packages: [
          {
            id: "hello-notes",
            name: "Hello Notes",
            version: "0.1.0",
            description: "Sample executable DindbOS package.",
            manifestUrl: `${PACKAGE_SOURCE_DIR}/hello-notes/dindbos.app.json`,
          },
        ],
      }, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
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
    this.writeNpmDependencyRecords(record);
  }

  writeNpmDependencyRecords(record) {
    Object.entries(record.dependencies?.npm || {}).forEach(([name, dependency]) => {
      const path = this.resolvePackageFilePath(record, `node_modules/${name}/package.json`);
      this.ensureParentDirectories(path);
      this.os.fs.writeOrCreateFile(
        path,
        `${JSON.stringify({
          name,
          version: dependency.version,
          provider: dependency.provider,
          module: dependency.url,
          installedBy: "dindbos",
        }, null, 2)}\n`,
        "/",
        { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
        this.system,
      );
    });
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
        await verifyIntegrity(content, file.integrity, file.path || fileUrl);
        this.writePackageFile(record, { ...file, sourceUrl: fileUrl }, content);
        continue;
      }
      const content = contentFromInlineFile(file);
      await verifyIntegrity(content, file.integrity, file.path);
      this.writePackageFile(record, file, content);
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
      integrity: file.integrity || "",
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
      render: ({ content, os: runtime, window }) => renderPackagedApp(content, runtime, record, window),
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

function renderPackagedApp(content, runtime, record, windowApi) {
  if (record.app.entryPath) {
    mountPackageEntrypoint(content, runtime, record, windowApi);
    return;
  }
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

async function mountPackageEntrypoint(content, runtime, record, windowApi) {
  content.innerHTML = `
    <section class="package-app">
      <p class="dos-kicker">Package ${escapeHtml(record.id)} ${escapeHtml(record.version)}</p>
      <h2>${escapeHtml(record.app.name)}</h2>
      <p>Loading ${escapeHtml(record.app.entry)}.</p>
    </section>
  `;
  try {
    const source = runtime.fs.readFile(record.app.entryPath);
    const moduleHandle = createModuleUrl(source);
    const module = await import(moduleHandle.url);
    moduleHandle.revoke();
    const mount = module.mount || module.default;
    if (typeof mount !== "function") throw new Error(`${record.app.entry} must export mount() or default()`);
    content.innerHTML = "";
    await mount({
      content,
      os: runtime,
      pkg: packagePublicRecord(record),
      package: packagePublicRecord(record),
      imports: createImportFacade(record),
      window: windowApi,
    });
  } catch (error) {
    content.innerHTML = `
      <section class="package-app">
        <p class="dos-kicker">Package runtime error</p>
        <h2>${escapeHtml(record.app.name)}</h2>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
  }
}

function createImportFacade(record) {
  return {
    npm: async (name) => {
      const dependency = record.dependencies?.npm?.[name];
      if (!dependency) throw new Error(`npm dependency not declared: ${name}`);
      return import(dependency.url);
    },
    url: async (url) => import(normalizePackageUrl(url)),
  };
}

function packagePublicRecord(record) {
  return Object.freeze({
    id: record.id,
    name: record.name,
    version: record.version,
    description: record.description,
    installPath: record.installPath,
    sourcePath: record.sourcePath,
    dependencies: cloneJson(record.dependencies || {}),
    files: [...(record.files || [])],
  });
}

function createModuleUrl(source) {
  if (
    typeof window !== "undefined"
    && typeof Blob !== "undefined"
    && typeof URL !== "undefined"
    && typeof URL.createObjectURL === "function"
  ) {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  const base64 = Buffer.from(source, "utf8").toString("base64");
  return { url: `data:text/javascript;base64,${base64}`, revoke: () => {} };
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

function normalizeOptionalRelativePath(value) {
  const path = String(value || "").trim().replace(/^\.\//, "");
  if (!path) return "";
  if (path.startsWith("/") || path.split("/").includes("..")) throw new Error(`pkg: invalid entry path: ${value}`);
  return path;
}

function normalizeDependencies(dependencies) {
  const npm = {};
  Object.entries(dependencies.npm || {}).forEach(([name, declaration]) => {
    npm[name] = normalizeNpmDependency(name, declaration);
  });
  const packages = {};
  Object.entries(dependencies.packages || {}).forEach(([name, declaration]) => {
    packages[normalizePackageId(name)] = typeof declaration === "string"
      ? { version: declaration }
      : { version: declaration.version || "latest", manifestUrl: declaration.manifestUrl || "" };
  });
  return { packages, npm };
}

function normalizeNpmDependency(name, declaration) {
  const value = typeof declaration === "string" ? { version: declaration } : { ...declaration };
  const version = String(value.version || "latest");
  return {
    name,
    version,
    provider: value.provider || "esm.sh",
    url: value.url || npmEsmUrl(name, version),
    integrity: value.integrity || "",
  };
}

function normalizeNpmDependencySpecifier(specifier) {
  const value = String(specifier || "").trim();
  if (!value) throw new Error("pkg: missing npm package specifier");
  const atIndex = value.startsWith("@") ? value.lastIndexOf("@") : value.indexOf("@");
  const name = atIndex > 0 ? value.slice(0, atIndex) : value;
  const version = atIndex > 0 ? value.slice(atIndex + 1) : "latest";
  if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error(`pkg: invalid npm package: ${specifier}`);
  return normalizeNpmDependency(name, version || "latest");
}

function npmEsmUrl(name, version) {
  const encodedName = name.split("/").map((part) => encodeURIComponent(part)).join("/");
  const suffix = version && version !== "latest" ? `@${encodeURIComponent(version)}` : "";
  return `${NPM_ESM_BASE_URL}/${encodedName}${suffix}`;
}

function normalizeRegistryName(value) {
  const name = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error(`pkg: invalid registry name: ${value || ""}`);
  return name;
}

function normalizeRegistryUrl(value) {
  const url = String(value || "").trim();
  if (isHttpUrl(url)) return normalizePackageUrl(url);
  if (!url.startsWith("/")) throw new Error(`pkg: registry URL must be http(s) or an absolute VFS path: ${value || ""}`);
  return url;
}

function normalizeRegistryPackage(entry, registry) {
  const id = normalizePackageId(entry.id);
  return {
    id,
    name: String(entry.name || id),
    version: String(entry.version || "0.1.0"),
    description: String(entry.description || ""),
    manifestUrl: entry.manifestUrl || entry.url || "",
    registry: registry.name,
  };
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

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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

async function verifyIntegrity(content, integrity, label = "file") {
  if (!integrity) return;
  const match = /^sha256-([A-Za-z0-9+/=]+)$/.exec(integrity);
  if (!match) throw new Error(`pkg: unsupported integrity format for ${label}`);
  const digest = await sha256Base64(content);
  if (digest !== match[1]) throw new Error(`pkg: integrity mismatch for ${label}`);
}

async function sha256Base64(content) {
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    return base64FromBytes(new Uint8Array(hash));
  }
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(content).digest("base64");
}

function base64FromBytes(bytes) {
  if (typeof btoa === "function") {
    return btoa(String.fromCharCode(...bytes));
  }
  return Buffer.from(bytes).toString("base64");
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
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
