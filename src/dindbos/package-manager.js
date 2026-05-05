import { removeAppState } from "./app-sandbox.js?v=20260422-browserd";
import { apiRequirementForManifest, compatibilityRequirementForManifest } from "./compat.js?v=20260422-browserd";
import { NodeCompat } from "./node-compat.js?v=20260422-browserd";
import { createDindbOSSDK } from "./sdk.js?v=20260422-browserd";

const APPLICATION_DIR = "/usr/share/applications";
const PACKAGE_DB_DIR = "/var/lib/dindbos/packages";
const PACKAGE_STATE_ROOT = "/var/lib/dindbos/package-state";
const PACKAGE_CACHE_ROOT = "/var/cache/dindbos/packages";
const PACKAGE_TEMP_ROOT = "/tmp/dindbos/packages";
const PACKAGE_STAGING_ROOT = "/tmp/dindbos/package-staging";
const PACKAGE_SOURCE_DIR = "/opt/dindbos/packages";
const PACKAGE_TEMPLATE_DIR = "/opt/dindbos/templates";
const PACKAGE_INSTALL_ROOT = "/opt";
const REGISTRY_CONFIG_PATH = "/etc/dindbos/package-registries.json";
const TRUSTED_PUBLISHERS_PATH = "/etc/dindbos/trusted-publishers.json";
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

const SAMPLE_API_PACKAGE = {
  id: "api-lab",
  name: "API Lab",
  version: "0.1.0",
  description: "A sample third-party app that exercises sandboxed runtime APIs.",
  app: {
    id: "api-lab",
    name: "API Lab",
    title: "API Lab.app",
    icon: "app",
    width: 620,
    height: 420,
    entry: "app.js",
  },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export function mount({ content, os, pkg, sdk }) {",
        "  const workspace = '/home/guest/DindbOS API Lab';",
        "  if (!os.fs.exists(workspace)) os.fs.createDirectory(workspace);",
        "  const reportPath = os.fs.join(workspace, 'report.txt');",
        "  const launches = Number(os.state.get('launches', 0)) + 1;",
        "  os.state.set('launches', launches);",
        "  const process = sdk.processes.current();",
        "  const info = sdk.packages.info(pkg.id);",
        "  const report = 'package=' + pkg.id + '\\nprocess=' + process.pid + '\\nversion=' + info.version + '\\nlaunches=' + launches + '\\n';",
        "  sdk.fs.writeText(reportPath, report);",
        "  os.fs.atomicWriteOrCreateFile(os.fs.join(workspace, 'atomic.txt'), 'atomic=' + launches + '\\n');",
        "  sdk.processes.log(`api-lab wrote ${reportPath}`);",
        "  const read = sdk.fs.readText(reportPath);",
        "  content.innerHTML = '<main data-api-lab><h2>' + pkg.name + '</h2><p>' + read + '</p></main>';",
        "}",
      ].join("\n"),
    },
  ],
  permissions: {
    capabilities: ["package.read"],
    fileSystem: {
      read: ["/opt/api-lab", "/home/guest/DindbOS API Lab"],
      write: ["/home/guest/DindbOS API Lab"],
    },
  },
};

const SAMPLE_PAINT_PACKAGE = {
  id: "paint-sample",
  name: "Paint Sample",
  version: "0.1.0",
  description: "A sample canvas app proving packaged visual tools can render inside DindbOS.",
  app: {
    id: "paint-sample",
    name: "Paint Sample",
    title: "Paint Sample.app",
    icon: "app",
    width: 640,
    height: 460,
    entry: "app.js",
  },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export function mount({ content, pkg }) {",
        "  content.innerHTML = '<main class=\"package-app\" data-sample-paint><p class=\"dos-kicker\">Package ' + pkg.id + '</p><h2>' + pkg.name + '</h2><canvas width=\"480\" height=\"260\" aria-label=\"Paint sample canvas\"></canvas><p>Canvas sample app rendered from /opt/paint-sample/app.js.</p></main>';",
        "}",
      ].join("\n"),
    },
  ],
  permissions: {
    capabilities: [],
    fileSystem: {
      read: ["/opt/paint-sample"],
      write: [],
    },
  },
};

const SAMPLE_PDF_VIEWER_PACKAGE = {
  id: "pdf-viewer-sample",
  name: "PDF Viewer Sample",
  version: "0.1.0",
  description: "A sample file-viewer package that declares PDF association through the app manifest.",
  app: {
    id: "pdf-viewer-sample",
    name: "PDF Viewer Sample",
    title: "PDF Viewer Sample.app",
    icon: "pdf",
    width: 720,
    height: 520,
    accepts: ["application/pdf"],
    entry: "app.js",
  },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export function mount({ content, pkg }) {",
        "  content.innerHTML = '<main class=\"package-app\" data-sample-pdf-viewer><p class=\"dos-kicker\">Package ' + pkg.id + '</p><h2>' + pkg.name + '</h2><p>This sample declares application/pdf in dindbos.app.json so it can be used as a packaged file viewer.</p></main>';",
        "}",
      ].join("\n"),
    },
  ],
  permissions: {
    capabilities: [],
    fileSystem: {
      read: ["/opt/pdf-viewer-sample"],
      write: [],
    },
  },
};

const TEMPLATE_GUI_PACKAGE = {
  id: "template-gui-app",
  name: "Template GUI App",
  version: "0.1.0",
  description: "Installable starter template for a DindbOS GUI package.",
  app: {
    id: "template-gui-app",
    name: "Template GUI App",
    title: "Template GUI App.app",
    icon: "app",
    width: 560,
    height: 360,
    entry: "app.js",
  },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export function mount({ content, pkg }) {",
        "  content.innerHTML = '<main class=\"package-app\" data-template-gui><p class=\"dos-kicker\">Template</p><h2>' + pkg.name + '</h2><p>Replace /opt/' + pkg.id + '/app.js with your app UI.</p></main>';",
        "}",
      ].join("\n"),
    },
  ],
  permissions: {
    capabilities: [],
    fileSystem: {
      read: ["/opt/template-gui-app"],
      write: [],
    },
  },
};

const TEMPLATE_CLI_PACKAGE = {
  id: "template-cli-app",
  name: "Template CLI App",
  version: "0.1.0",
  description: "Starter template for a command-oriented DindbOS package.",
  app: {
    id: "template-cli-app",
    name: "Template CLI App",
    title: "Template CLI App.app",
    icon: "terminal",
    width: 560,
    height: 320,
    entry: "app.js",
  },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export function mount({ content, pkg }) {",
        "  content.innerHTML = '<main class=\"package-app\" data-template-cli><p class=\"dos-kicker\">Template</p><h2>' + pkg.name + '</h2><pre>bin/cli.js ready</pre></main>';",
        "}",
      ].join("\n"),
    },
    {
      path: "bin/cli.js",
      mime: "text/javascript",
      content: [
        "export function main(argv = []) {",
        "  return `template cli ${argv.join(' ')}`.trim();",
        "}",
      ].join("\n"),
    },
  ],
  permissions: {
    capabilities: [],
    fileSystem: {
      read: ["/opt/template-cli-app"],
      write: [],
    },
  },
};

const TEMPLATE_WASM_CLI_PACKAGE = {
  id: "template-wasm-cli",
  name: "Template WASM CLI",
  version: "0.1.0",
  description: "Starter template for a WASI-style WASM CLI package.",
  app: {
    id: "template-wasm-cli",
    name: "Template WASM CLI",
    title: "Template WASM CLI.app",
    icon: "terminal",
    width: 560,
    height: 320,
    runtime: "wasm",
    entry: "bin/tool.wasm",
  },
  files: [
    {
      path: "bin/tool.wasm",
      mime: "application/wasm",
      base64: "AGFzbQEAAAABDAJgBH9/f38Bf2AAAAIjARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAADAgEBBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAEKDwENAEEBQRBBAUEgEAAaCwsuAQBBAAsodGVtcGxhdGUgd2FzbSBvawAAAAASAAAAAAAAAAAAAAAAAAAAAAAAAA==",
    },
  ],
  permissions: {
    capabilities: [],
    fileSystem: {
      read: ["/opt/template-wasm-cli"],
      write: [],
    },
  },
};

const TEMPLATE_BACKGROUND_WORKER_PACKAGE = {
  id: "template-background-worker",
  name: "Template Background Worker",
  version: "0.1.0",
  description: "Starter template for a package with a worker-backed background task.",
  app: {
    id: "template-background-worker",
    name: "Template Background Worker",
    title: "Template Background Worker.app",
    icon: "process",
    width: 600,
    height: 360,
    entry: "app.js",
  },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export function mount({ content, pkg }) {",
        "  content.innerHTML = '<main class=\"package-app\" data-template-worker><p class=\"dos-kicker\">Template</p><h2>' + pkg.name + '</h2><p>worker.js is the background task entry point for this package template.</p></main>';",
        "}",
      ].join("\n"),
    },
    {
      path: "worker.js",
      mime: "text/javascript",
      content: [
        "export async function run({ os, pkg }) {",
        "  return os.executor.runCpuTask({ appId: `${pkg.id}:worker`, name: `${pkg.name} Worker`, durationMs: 10 });",
        "}",
      ].join("\n"),
    },
  ],
  permissions: {
    capabilities: ["process.execute", "process.read"],
    fileSystem: {
      read: ["/opt/template-background-worker"],
      write: [],
    },
  },
};

const TEMPLATE_PACKAGES = [
  TEMPLATE_GUI_PACKAGE,
  TEMPLATE_CLI_PACKAGE,
  TEMPLATE_WASM_CLI_PACKAGE,
  TEMPLATE_BACKGROUND_WORKER_PACKAGE,
];

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

  checkIntegrity(options = {}) {
    this.ensurePackageRoots();
    const dryRun = options.dryRun !== false;
    const repair = Boolean(options.repair);
    const problems = [];
    const repairs = [];
    const recordsByInstallPath = new Map();
    let checkedPackages = 0;
    this.packageRecordNodes().forEach((node) => {
      const recordPath = node.path;
      const record = this.readPackageRecord(recordPath);
      if (!record?.id) {
        problems.push(packageFsckProblem("package-record-invalid", recordPath, "package record is unreadable or missing id"));
        return;
      }
      checkedPackages += 1;
      const installPath = this.os.fs.normalize(record.installPath || `${PACKAGE_INSTALL_ROOT}/${record.id}`);
      recordsByInstallPath.set(installPath, record);
      if (!this.os.fs.exists(installPath)) {
        problems.push(packageFsckProblem("package-root-missing", installPath, `record=${recordPath}`));
        return;
      }
      const root = this.os.fs.resolve(installPath);
      if (root?.mountType !== "pkgfs") {
        problems.push(packageFsckProblem("package-root-invalid", installPath, `mountType=${root?.mountType || root?.type || "unknown"} record=${recordPath}`));
      }
      const entryPath = record.app?.entryPath ? this.os.fs.normalize(record.app.entryPath) : "";
      if (entryPath && !this.os.fs.exists(entryPath)) {
        problems.push(packageFsckProblem("package-entry-missing", entryPath, `package=${record.id} record=${recordPath}`));
      }
      const appProblems = this.checkPackageAppRegistry(record, { repair, dryRun });
      problems.push(...appProblems.problems);
      repairs.push(...appProblems.repairs);
    });
    this.os.fs.list(PACKAGE_INSTALL_ROOT, "/", this.system)
      .filter((node) => node.mountType === "pkgfs")
      .forEach((node) => {
        const installPath = this.os.fs.join(PACKAGE_INSTALL_ROOT, node.name);
        if (!recordsByInstallPath.has(installPath)) {
          problems.push(packageFsckProblem("package-record-missing", installPath, "pkgfs root has no package DB record", true));
          if (repair) {
            repairs.push(packageFsckRepair("remove-orphan-pkgfs", installPath, "present", "removed", dryRun));
            if (!dryRun) this.os.fs.remove(installPath, "/", { recursive: true }, this.system);
          }
        }
      });
    return {
      ok: problems.length === 0,
      dryRun,
      repaired: repair && !dryRun && repairs.length > 0,
      checkedPackages,
      problemCount: problems.length,
      repairCount: repairs.length,
      problems,
      repairs,
    };
  }

  checkPackageAppRegistry(record, options = {}) {
    const repair = Boolean(options.repair);
    const dryRun = options.dryRun !== false;
    const problems = [];
    const repairs = [];
    if (!record?.app?.id) return { problems, repairs };
    const appId = record.app.id;
    const expectedEntry = `package:${record.id}`;
    const registeredApp = this.os.apps?.apps?.get?.(appId) || null;
    const manifestPath = `/usr/share/dindbos/manifests/${appId}.json`;
    let repairQueued = false;
    const queueRegisterRepair = (path) => {
      if (!repair || repairQueued) return;
      repairs.push(packageFsckRepair("register-package-app", path, "missing", "registered", dryRun));
      repairQueued = true;
      if (!dryRun) this.registerPackageApp(record);
    };
    if (!registeredApp) {
      problems.push(packageFsckProblem("package-app-missing", manifestPath, `package=${record.id} app=${appId}`, true));
      queueRegisterRepair(manifestPath);
      return { problems, repairs };
    }
    if (registeredApp.manifest?.entry !== expectedEntry) {
      problems.push(packageFsckProblem("package-app-mismatch", manifestPath, `expected=${expectedEntry} actual=${registeredApp.manifest?.entry || "unknown"}`));
      return { problems, repairs };
    }
    if (!this.os.fs.exists(manifestPath)) {
      problems.push(packageFsckProblem("package-app-manifest-missing", manifestPath, `package=${record.id} app=${appId}`, true));
      queueRegisterRepair(manifestPath);
    }
    const launcherPath = this.os.apps?.applicationPathFor?.(registeredApp, registeredApp.manifest);
    if (launcherPath && !this.os.fs.exists(launcherPath)) {
      problems.push(packageFsckProblem("package-app-launcher-missing", launcherPath, `package=${record.id} app=${appId}`, true));
      queueRegisterRepair(launcherPath);
    }
    return { problems, repairs };
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
    const manifestText = await fetchText(this.os, fetcher, sourceUrl, MAX_REMOTE_MANIFEST_BYTES, "manifest");
    const manifest = parseJson(manifestText, sourceUrl);
    const trust = await this.verifyRemoteManifestTrust(manifest, sourceUrl, options);
    const record = this.normalizePackage(manifest, {
      sourcePath: sourceUrl,
      sourceUrl,
      registry: options.registry || "",
      trust,
    });
    const previous = this.info(record.id);
    record.lifecycle = packageLifecycle(record, previous);
    this.reservePackageInstallQuota(record, manifest.files || [], { remote: true });
    return this.runPackageTransactionAsync(record, previous ? "update" : "install", async () => {
      this.ensurePackageRoots();
      this.preparePackageStaging(record);
      await this.installDeclaredFiles(record, manifest.files || [], sourceUrl, fetcher);
      this.activatePackage(record, previous, previous ? "update" : "install");
      this.emitPackageLifecycle(previous ? "update" : "install", record, { previousVersion: previous?.version || "" });
      return record;
    });
  }

  install(manifest, options = {}) {
    const record = this.normalizePackage(manifest, options);
    const previous = this.info(record.id);
    record.lifecycle = packageLifecycle(record, previous);
    this.reservePackageInstallQuota(record, manifest.files || []);
    return this.runPackageTransaction(record, previous ? "update" : "install", () => {
      this.ensurePackageRoots();
      this.preparePackageStaging(record);
      this.installDeclaredInlineFiles(record, manifest.files || []);
      this.activatePackage(record, previous, previous ? "update" : "install");
      this.emitPackageLifecycle(previous ? "update" : "install", record, { previousVersion: previous?.version || "" });
      return record;
    });
  }

  async installFromRegistry(packageId, options = {}) {
    const match = (await this.search(packageId, options))
      .find((entry) => entry.id === packageId || entry.name === packageId);
    if (!match) throw new Error(`pkg: ${packageId}: package not found in registries`);
    if (!match.manifestUrl) throw new Error(`pkg: ${packageId}: registry entry has no manifestUrl`);
    if (isHttpUrl(match.manifestUrl)) return this.installFromUrl(match.manifestUrl, { ...options, registry: match.registry });
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

  dependencyView(packageId) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    return packageDependencyView(record);
  }

  dependencyViewForNamespace(namespace = {}) {
    const packageId = String(namespace.packageId || "").trim();
    const record = packageId ? safeRead(() => this.info(packageId), null) : null;
    if (record) return packageDependencyView(record);
    return packageDependencyViewFromNamespace(namespace);
  }

  assertDependencyPathAllowed(namespace = {}, path = "", access = "read") {
    const view = this.dependencyViewForNamespace(namespace);
    const dependency = dependencyPathPackage(this.os.fs.normalize(path, "/"), view.dependencyRoot);
    if (!dependency.inside || !dependency.packageName) return true;
    if (view.allowedPackages.includes(dependency.packageName)) return true;
    throw new Error(`package dependency view denied: ${path}`);
  }

  filterDependencyList(namespace = {}, path = "", entries = []) {
    const view = this.dependencyViewForNamespace(namespace);
    const normalized = this.os.fs.normalize(path, "/");
    if (!view.dependencyRoot) return entries;
    if (normalized === view.dependencyRoot) {
      const visible = new Set(view.allowedPackages.map((name) => name.split("/")[0]));
      return entries.filter((entry) => visible.has(entry.name));
    }
    const scope = dependencyScopeForPath(normalized, view.dependencyRoot);
    if (!scope) return entries;
    const visible = new Set(view.allowedPackages
      .filter((name) => name.startsWith(`${scope}/`))
      .map((name) => name.slice(scope.length + 1)));
    return entries.filter((entry) => visible.has(entry.name));
  }

  strictNamespaceCheck(target, cwd = "/") {
    const value = String(target || "").trim();
    if (!value) throw new Error("pkg: strict namespace target is required");
    const installed = safeRead(() => this.info(value), null);
    if (installed) return strictNamespaceReport(this.os, installed, { source: "installed" });
    return this.strictNamespaceCheckFromManifestPath(value, cwd);
  }

  strictNamespaceCheckFromManifestPath(path, cwd = "/") {
    const manifestPath = this.os.fs.normalize(path, cwd);
    const node = this.os.fs.resolve(manifestPath);
    if (!node || node.type !== "file") throw new Error(`pkg: ${path}: manifest not found`);
    const manifest = parseJson(this.os.fs.readFile(manifestPath, "/", this.system), manifestPath);
    const record = this.normalizePackage(manifest, {
      sourcePath: manifestPath,
      sourceDirectory: this.os.fs.dirname(manifestPath),
    });
    record.files = (manifest.files || []).map((file) => ({
      path: this.resolvePackageFilePath(record, file.path),
      mime: file.mime || mimeFromName(file.path || ""),
      sourceUrl: file.url || "",
      integrity: file.integrity || "",
      size: contentByteLength(inlineFilePayload({ ...file, content: file.content || file.base64 || "" })),
    }));
    return strictNamespaceReport(this.os, record, { source: "manifest" });
  }

  evictNamespaceCache(packageId) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    const cacheRoot = record.namespace?.cacheRoot;
    if (!cacheRoot) throw new Error(`pkg: ${packageId}: package cache root missing`);
    const removedBytes = safeRead(() => this.os.countBytes?.(cacheRoot), 0) || 0;
    if (this.os.fs.exists(cacheRoot)) this.os.fs.remove(cacheRoot, "/", { recursive: true }, this.system);
    this.ensureDirectoryPath(cacheRoot, { owner: record.id, group: "packages", permissions: "drwx------" });
    this.emitPackageLifecycle("cache-evict", record, { cacheRoot, removedBytes });
    return {
      packageId: record.id,
      cacheRoot,
      removedBytes,
      stateRoot: record.namespace?.stateRoot || "",
      tempRoot: record.namespace?.tempRoot || "",
      installPath: record.installPath,
    };
  }

  async runCli(packageId, argv = [], options = {}) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    const entry = resolvePackageCliEntry(this.os, record, options.entry);
    const process = this.os.processes.spawn({
      id: `package:${record.id}:cli`,
      name: `${record.name} CLI`,
      manifest: {
        version: record.version,
        entry,
        runtime: "nodecompat-cli",
        sandbox: cloneJson(record.sandbox || {}),
        namespace: cloneJson(record.namespace || {}),
        capabilities: unique([...(record.app.capabilities || []), "node.execute"]),
        fileSystem: cloneJson(record.app.fileSystem || { read: [record.installPath], write: [] }),
      },
    }, {
      argv: [entry, ...argv],
      cwd: options.cwd || record.installPath,
      executable: entry,
      parentPid: options.parentPid || 0,
      runtime: "nodecompat-cli",
      source: "package-manager",
      executorKind: "package-cli",
      namespace: cloneJson(record.namespace || {}),
    });
    try {
      this.os.processes.markReady(process.pid);
      const node = new NodeCompat(this.os, {
        fileSystem: record.app.fileSystem,
        allowedPackages: record.namespace?.dependencyAllowlist,
      });
      const result = await node.runMain(entry, record.installPath, { argv, inputType: record.cli?.inputType || "module" });
      const valueOutput = result.value === undefined ? "" : stringifyCliValue(result.value);
      const output = [result.output, valueOutput].filter(Boolean).join("\n");
      this.os.processes.kill(process.pid, result.status ? `exit-${result.status}` : "completed");
      return {
        packageId: record.id,
        pid: process.pid,
        entry,
        status: result.status || 0,
        output,
        value: result.value,
        namespace: cloneJson(record.namespace || {}),
      };
    } catch (error) {
      this.os.processes.crash(process.pid, error);
      throw error;
    }
  }

  packageImageMounts() {
    return this.packageRecordNodes()
      .map((node) => this.readPackageRecord(node.path))
      .filter(Boolean)
      .map((record) => ({
        id: `pkg:${record.id}`,
        root: record.installPath,
        driver: "pkgfs",
        readonly: true,
        owner: "root",
        durability: "persistent",
        quotaPolicy: "package-storage",
        capabilities: ["package.read"],
        source: record.sourcePath || "package-db",
        packageId: record.id,
        version: record.version,
        trust: record.trust?.trusted ? "trusted" : record.trust?.source || "local",
        usedBytes: this.os.countBytes?.(record.installPath) || 0,
        support: "package-image",
      }));
  }

  installNpmDependency(packageId, specifier) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    const dependency = normalizeNpmDependencySpecifier(specifier);
    record.dependencies = record.dependencies || { packages: {}, npm: {} };
    record.dependencies.npm = record.dependencies.npm || {};
    record.dependencies.npm[dependency.name] = dependency;
    record.namespace = record.namespace || packageNamespace(record.id, record.app.id, record.installPath, {}, record.dependencies);
    record.namespace.dependencyAllowlist = Object.keys(record.dependencies.npm || {});
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

  trustedPublishers() {
    this.ensurePackageRoots();
    const trustStore = parseJson(this.os.fs.readFile(TRUSTED_PUBLISHERS_PATH, "/", this.system), TRUSTED_PUBLISHERS_PATH);
    return [...(trustStore.publishers || [])];
  }

  addTrustedPublisher(publisher) {
    const entry = normalizeTrustedPublisher(publisher);
    const publishers = this.trustedPublishers().filter((item) => item.id !== entry.id && item.publicKey !== entry.publicKey);
    publishers.push({ ...entry, addedAt: entry.addedAt || new Date().toISOString() });
    this.writeTrustedPublishers(publishers);
    return entry;
  }

  removeTrustedPublisher(idOrKey) {
    const value = String(idOrKey || "").trim();
    const publishers = this.trustedPublishers();
    const next = publishers.filter((entry) => entry.id !== value && entry.publicKey !== value);
    if (next.length === publishers.length) throw new Error(`pkg: trusted publisher not found: ${idOrKey}`);
    this.writeTrustedPublishers(next);
    return value;
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
    return this.withPackageDbLock(record, "remove", () => {
      this.emitSessionPackageOperation("remove", record, "start");
      const cleanup = {
        installPath: record.installPath,
        launcher: this.launcherPath(record),
        recordPath: this.packageRecordPath(record.id),
        appStatePath: removeAppState(this.os, record.app.id),
        namespace: record.namespace || {},
      };
      try {
        this.cleanupNamespaceRuntime(record);
        this.unregisterPackageServices(record);
        const launcher = this.launcherPath(record);
        if (this.os.fs.exists(launcher)) this.os.fs.remove(launcher, "/", {}, this.system);
        if (this.os.fs.exists(record.installPath)) this.os.fs.remove(record.installPath, "/", { recursive: true }, this.system);
        this.removeNamespaceRoots(record);
        if (this.os.fs.exists(this.packageRecordPath(record.id))) {
          this.os.fs.remove(this.packageRecordPath(record.id), "/", {}, this.system);
        }
        this.os.unregisterApp(record.app.id);
        this.emitPackageLifecycle("uninstall-cleanup", record, { cleanup });
        this.emitPackageLifecycle("uninstall", record, { cleanup });
        this.emitSessionPackageOperation("remove", record, "complete");
        return record;
      } catch (error) {
        this.emitSessionPackageOperation("remove", record, "error", error);
        throw error;
      }
    });
  }

  markFirstRun(packageId) {
    const record = this.info(packageId);
    if (!record) throw new Error(`pkg: ${packageId}: package not installed`);
    record.lifecycle = record.lifecycle || packageLifecycle(record, null);
    if (record.lifecycle.firstRunAt) return record;
    record.lifecycle.firstRunAt = new Date().toISOString();
    this.writePackageRecord(record);
    this.emitPackageLifecycle("first-run", record);
    return record;
  }

  emitPackageLifecycle(type, record, extra = {}) {
    const payload = {
      type,
      packageId: record.id,
      appId: record.app?.id || "",
      name: record.name,
      version: record.version,
      record: packagePublicRecord(record),
      ...extra,
    };
    this.os.bus?.emit?.(`package:${type}`, payload);
    this.os.bus?.emit?.(`app:${type}`, payload);
  }

  registerInstalledPackages() {
    this.list().forEach((record) => {
      this.registerPackageApp(record);
      this.registerPackageServices(record);
    });
  }

  runPackageTransaction(record, operation, install) {
    return this.withPackageDbLock(record, operation, () => {
      const beforeRoot = this.os.fs.snapshot();
      const previousApp = this.os.apps?.apps?.get?.(record.app.id) || null;
      this.emitSessionPackageOperation(operation, record, "start");
      try {
        const result = install();
        this.emitSessionPackageOperation(operation, record, "complete");
        return result;
      } catch (error) {
        this.rollbackPackageTransaction(record, beforeRoot, previousApp);
        this.emitSessionPackageOperation(operation, record, "error", error);
        throw error;
      }
    });
  }

  reservePackageInstallQuota(record, files = [], options = {}) {
    if (typeof this.os.storage?.reserveStorageBytes !== "function") return null;
    const estimatedBytes = this.estimatePackageInstallBytes(record, files, options);
    return this.os.storage.reserveStorageBytes(estimatedBytes, {
      key: `package:${record.id}`,
      storageFormat: "package-install",
      transactionKind: "package-install",
      storageClass: "package-roots",
      storageClassUsageBytes: this.os.countBytes?.(PACKAGE_INSTALL_ROOT) || 0,
      packageId: record.id,
      source: options.remote ? "remote" : "inline",
    });
  }

  estimatePackageInstallBytes(record, files = [], options = {}) {
    const plannedFiles = files.map((file) => {
      if (file.url || options.remote) {
        return {
          path: this.resolvePackageFilePath(record, file.path),
          size: Math.max(0, Number(file.size || file.bytes || 0)),
        };
      }
      const content = inlineFilePayload(file);
      return {
        path: this.resolvePackageFilePath(record, file.path),
        size: contentByteLength(content),
      };
    });
    const packageRecordEstimate = byteLength(JSON.stringify({
      ...record,
      files: plannedFiles.map((file) => ({ path: file.path, size: file.size })),
    }));
    const launcherEstimate = byteLength(`${this.launcherPath(record)}:${record.app.id}:${record.app.icon}`);
    return plannedFiles.reduce((total, file) => total + file.size, 0) + packageRecordEstimate + launcherEstimate;
  }

  async runPackageTransactionAsync(record, operation, install) {
    return this.withPackageDbLock(record, operation, async () => {
      const beforeRoot = this.os.fs.snapshot();
      const previousApp = this.os.apps?.apps?.get?.(record.app.id) || null;
      this.emitSessionPackageOperation(operation, record, "start");
      try {
        const result = await install();
        this.emitSessionPackageOperation(operation, record, "complete");
        return result;
      } catch (error) {
        this.rollbackPackageTransaction(record, beforeRoot, previousApp);
        this.emitSessionPackageOperation(operation, record, "error", error);
        throw error;
      }
    });
  }

  withPackageDbLock(record, operation, callback) {
    if (typeof this.os.withRuntimeOperationLock !== "function") return callback();
    return this.os.withRuntimeOperationLock("package-db", {
      operation,
      packageId: record.id,
    }, callback);
  }

  emitSessionPackageOperation(operation, record, phase, error = null) {
    this.os.publishSessionPackageOperation?.(operation, {
      phase,
      packageId: record.id,
      appId: record.app?.id || "",
      version: record.version,
      error: error?.message || "",
    });
  }

  rollbackPackageTransaction(record, beforeRoot, previousApp) {
    this.os.fs.root = beforeRoot;
    if (this.os.apps?.apps instanceof Map) {
      if (previousApp) this.os.apps.apps.set(record.app.id, previousApp);
      else this.os.apps.apps.delete(record.app.id);
    } else if (!previousApp) {
      this.os.unregisterApp?.(record.app.id);
    }
    this.os.fs.emitChange?.("package-rollback", record.installPath);
  }

  async readRegistryIndex(registry, fetcher = globalThis.fetch) {
    if (isHttpUrl(registry.url)) {
      if (typeof fetcher !== "function") throw new Error("pkg: fetch is not available in this runtime");
      return parseJson(await fetchText(this.os, fetcher, registry.url, MAX_REMOTE_MANIFEST_BYTES, `registry ${registry.name}`), registry.url);
    }
    return parseJson(this.os.fs.readFile(registry.url, "/", this.system), registry.url);
  }

  writeRegistryConfig(registries) {
    this.os.fs.atomicWriteOrCreateFile(
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
    const compatibility = compatibilityRequirementForManifest(manifest);
    if (!compatibility.supported) {
      throw new Error(`pkg: ${id}: requires unsupported compatibility tier ${compatibility.tier} (${compatibility.name})`);
    }
    const api = apiRequirementForManifest(manifest);
    if (!api.supported) {
      throw new Error(`pkg: ${id}: requires unsupported API version ${api.minVersion === api.maxVersion ? api.targetVersion : `${api.minVersion}-${api.maxVersion}`} (runtime supports ${api.supportedVersions.join(", ")})`);
    }
    const app = manifest.app || {};
    const appId = normalizeAppId(app.id || id);
    const name = String(manifest.name || app.name || id);
    const installPath = `${PACKAGE_INSTALL_ROOT}/${id}`;
    const entry = normalizeOptionalRelativePath(app.entry || manifest.entry || "");
    const runtime = normalizePackageRuntime(app.runtime || manifest.runtime || inferPackageRuntime(entry));
    const capabilities = [
      ...(manifest.permissions?.capabilities || []),
      ...(manifest.capabilities || []),
      ...(app.capabilities || []),
    ];
    const fileSystem = app.fileSystem || manifest.fileSystem || manifest.permissions?.fileSystem || {};
    const dependencies = normalizeDependencies(manifest.dependencies || app.dependencies || {});
    const secrets = normalizePackageSecrets(manifest.secrets || app.secrets || {});
    const sandbox = normalizePackageSandbox(manifest.sandbox || manifest.namespace || {});
    const cli = normalizePackageCli(manifest.cli || app.cli || manifest.bin || app.bin || {});
    const services = normalizePackageServices(manifest.services || app.services || [], id, installPath, fileSystem);
    return {
      id,
      name,
      version: String(manifest.version || app.version || "0.1.0"),
      description: String(manifest.description || app.description || ""),
      installPath,
      sourcePath: options.sourcePath || manifest.sourcePath || "",
      trust: options.trust || packageTrust(options.sourcePath || manifest.sourcePath || "", options.registry || ""),
      compatibility,
      api,
      installedAt: new Date().toISOString(),
      originalManifest: manifest,
      files: [],
      dependencies,
      secrets,
      sandbox,
      cli,
      services,
      namespace: packageNamespace(id, appId, installPath, sandbox, dependencies),
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
        runtime,
        api,
        secrets: cloneJson(secrets),
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
      PACKAGE_STATE_ROOT,
      PACKAGE_INSTALL_ROOT,
      "/var/cache",
      "/var/cache/dindbos",
      PACKAGE_CACHE_ROOT,
      "/tmp",
      "/tmp/dindbos",
      PACKAGE_TEMP_ROOT,
      PACKAGE_STAGING_ROOT,
      "/opt/dindbos",
      PACKAGE_SOURCE_DIR,
      PACKAGE_TEMPLATE_DIR,
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
    this.ensureTrustedPublishers();
    this.ensureLocalRegistryIndex();
  }

  ensureSamplePackageSource() {
    this.ensureSamplePackage(SAMPLE_PACKAGE, "# Hello Notes package\n\nInstall with `pkg install /opt/dindbos/packages/hello-notes/dindbos.app.json`.\n");
    this.ensureSamplePackage(SAMPLE_API_PACKAGE, "# API Lab package\n\nInstall with `pkg install /opt/dindbos/packages/api-lab/dindbos.app.json`.\n");
    this.ensureSamplePackage(SAMPLE_PAINT_PACKAGE, "# Paint Sample package\n\nInstall with `pkg install /opt/dindbos/packages/paint-sample/dindbos.app.json`.\n");
    this.ensureSamplePackage(SAMPLE_PDF_VIEWER_PACKAGE, "# PDF Viewer Sample package\n\nInstall with `pkg install /opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json`.\n");
    this.ensurePackageTemplates();
  }

  ensurePackageTemplates() {
    TEMPLATE_PACKAGES.forEach((manifest) => {
      this.ensurePackageSource(
        manifest,
        "# " + manifest.name + "\n\nInstall with `pkg install " + PACKAGE_TEMPLATE_DIR + "/" + manifest.id + "/dindbos.app.json`.\nCopy this directory to start a real package.\n",
        PACKAGE_TEMPLATE_DIR,
      );
    });
  }

  ensureSamplePackage(manifest, readme) {
    this.ensurePackageSource(manifest, readme, PACKAGE_SOURCE_DIR);
  }

  ensurePackageSource(manifest, readme, sourceRoot = PACKAGE_SOURCE_DIR) {
    const directory = `${sourceRoot}/${manifest.id}`;
    if (!this.os.fs.exists(directory)) {
      this.os.fs.createDirectory(directory, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, this.system);
    }
    const manifestPath = `${directory}/dindbos.app.json`;
    const currentManifest = this.os.fs.exists(manifestPath)
      ? safeRead(() => this.os.fs.readFile(manifestPath, "/", this.system), "")
      : "";
    if (!currentManifest.includes(`"id": "${manifest.id}"`)) {
      this.os.fs.atomicWriteOrCreateFile(
        manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "/",
        { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
        this.system,
      );
    }
    for (const file of manifest.files || []) {
      if (file.url) continue;
      const filePath = `${directory}/${file.path}`;
      this.ensureParentDirectories(filePath);
      if (!this.os.fs.exists(filePath)) {
        this.os.fs.atomicWriteOrCreateFile(
          filePath,
          contentFromInlineFile(file),
          "/",
          { mime: file.mime || mimeFromName(filePath), owner: "root", group: "root", permissions: file.permissions || "-rw-r--r--" },
          this.system,
        );
      }
    }
    const readmePath = `${directory}/README.md`;
    if (!this.os.fs.exists(readmePath)) {
      this.os.fs.atomicWriteOrCreateFile(
        readmePath,
        readme,
        "/",
        { mime: "text/markdown", owner: "root", group: "root", permissions: "-rw-r--r--" },
        this.system,
      );
    }
  }

  ensureRegistryConfig() {
    if (this.os.fs.exists(REGISTRY_CONFIG_PATH)) return;
    this.os.fs.atomicWriteOrCreateFile(
      REGISTRY_CONFIG_PATH,
      `${JSON.stringify({ registries: [{ name: "local", url: LOCAL_REGISTRY_PATH }] }, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
  }

  ensureTrustedPublishers() {
    if (this.os.fs.exists(TRUSTED_PUBLISHERS_PATH)) return;
    this.writeTrustedPublishers([]);
  }

  writeTrustedPublishers(publishers) {
    this.os.fs.atomicWriteOrCreateFile(
      TRUSTED_PUBLISHERS_PATH,
      `${JSON.stringify({ publishers }, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
  }

  async verifyRemoteManifestTrust(manifest, sourceUrl, options = {}) {
    const signatureTrust = await verifyManifestSignature(manifest, sourceUrl);
    const registry = options.registry || "";
    if (signatureTrust.signature.status === "missing") {
      if (!options.allowUnsigned && !options.allowUntrusted) throw new Error(`pkg: signature missing for ${sourceUrl}`);
      return packageTrust(sourceUrl, registry, signatureTrust.signature);
    }
    if (signatureTrust.signature.status === "invalid") throw new Error(`pkg: signature invalid for ${manifest?.id || sourceUrl}`);
    const trusted = this.trustedPublishers().some((publisher) => (
      publisher.id === signatureTrust.signature.publisherId
      && publisher.publicKey === signatureTrust.signature.keyId
    ));
    if (!trusted) {
      if (!options.allowUntrusted) throw new Error(`pkg: publisher ${signatureTrust.signature.publisherId || "unknown"} is not trusted`);
      return packageTrust(sourceUrl, registry, { ...signatureTrust.signature, status: "untrusted-key" });
    }
    return packageTrust(sourceUrl, registry, { ...signatureTrust.signature, status: "valid" });
  }

  ensureLocalRegistryIndex() {
    const payload = localRegistryIndexPayload();
    if (this.os.fs.exists(LOCAL_REGISTRY_PATH)) {
      const current = safeRead(() => this.os.fs.readFile(LOCAL_REGISTRY_PATH, "/", this.system), "");
      const hasAllSamples = payload.packages.every((entry) => current.includes(`"id": "${entry.id}"`));
      if (hasAllSamples) return;
    }
    this.os.fs.atomicWriteOrCreateFile(
      LOCAL_REGISTRY_PATH,
      `${JSON.stringify(payload, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
  }

  preparePackageStaging(record) {
    const stagingPath = this.packageStagingPath(record);
    if (this.os.fs.exists(stagingPath)) this.os.fs.remove(stagingPath, "/", { recursive: true }, this.system);
    this.os.fs.createMount(stagingPath, {
      mountType: "pkgfs",
      handleName: `${record.id}:staging`,
      owner: "root",
      group: "root",
      permissions: "dr-xr-xr-x",
      transient: true,
    }, this.system);
    record.stagingPath = stagingPath;
    this.os.fs.emitChange?.("package-staging", stagingPath);
    this.writePackageImageMetadata(record, stagingPath);
    this.writeNpmDependencyRecords(record);
    this.ensureNamespaceRoots(record);
    return stagingPath;
  }

  writePackageImageMetadata(record, rootPath = record.installPath) {
    this.os.fs.atomicWriteOrCreateFile(
      `${rootPath}/dindbos.app.json`,
      `${JSON.stringify(record.originalManifest, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
    this.os.fs.atomicWriteOrCreateFile(
      `${rootPath}/PACKAGE.md`,
      [`# ${record.name}`, "", record.description || "No package description.", ""].join("\n"),
      "/",
      { mime: "text/markdown", owner: "root", group: "root", permissions: "-rw-r--r--" },
      this.system,
    );
  }

  activatePackageRoot(record) {
    const stagingPath = record.stagingPath || "";
    if (!stagingPath) return null;
    if (!this.os.fs.exists(stagingPath)) throw new Error(`pkg: staging root missing for ${record.id}`);
    if (this.os.fs.exists(record.installPath)) this.os.fs.remove(record.installPath, "/", { recursive: true }, this.system);
    const node = this.os.fs.move(stagingPath, record.installPath, "/", this.system);
    node.type = "mount";
    node.mountType = "pkgfs";
    node.handleName = record.id;
    node.permissions = "dr-xr-xr-x";
    node.owner = "root";
    node.group = "root";
    node.transient = false;
    delete record.stagingPath;
    this.os.fs.emitChange?.("package-image-activate", record.installPath);
    return node;
  }

  ensurePackageDirectory(record) {
    const existing = this.os.fs.resolve(record.installPath);
    if (!existing) {
      this.os.fs.createMount(record.installPath, {
        mountType: "pkgfs",
        handleName: record.id,
        owner: "root",
        group: "root",
        permissions: "dr-xr-xr-x",
        transient: false,
      }, this.system);
    } else if (existing.type !== "mount") {
      existing.type = "mount";
      existing.mountType = "pkgfs";
      existing.handleName = record.id;
      existing.permissions = "dr-xr-xr-x";
      existing.owner = "root";
      existing.group = "root";
      existing.transient = false;
      this.os.fs.emitChange?.("package-image-mount", record.installPath);
    }
    this.writePackageImageMetadata(record);
    this.ensureNamespaceRoots(record);
  }

  ensureNamespaceRoots(record) {
    const namespace = record.namespace || {};
    [namespace.stateRoot, namespace.cacheRoot, namespace.tempRoot].filter(Boolean).forEach((path) => {
      this.ensureDirectoryPath(path, { owner: record.id, group: "packages", permissions: "drwx------" });
    });
  }

  removeNamespaceRoots(record) {
    const namespace = record.namespace || {};
    [namespace.tempRoot, namespace.cacheRoot, namespace.stateRoot].filter(Boolean).forEach((path) => {
      if (this.os.fs.exists(path)) this.os.fs.remove(path, "/", { recursive: true }, this.system);
    });
  }

  cleanupNamespaceRuntime(record) {
    const namespace = record.namespace || {};
    const processGroup = namespace.processGroup || "";
    const packageId = namespace.packageId || record.id;
    const running = this.os.processes?.list?.() || [];
    running
      .filter((process) => (
        process.appId === record.app.id
        || process.manifest?.namespace?.packageId === packageId
        || (processGroup && process.manifest?.namespace?.processGroup === processGroup)
      ))
      .sort((left, right) => Number(right.pid || 0) - Number(left.pid || 0))
      .forEach((process) => {
        if (this.os.processes?.get?.(process.pid)) this.os.processes.kill(process.pid, "package-uninstall");
      });
    this.os.unregisterIpcEndpointsForNamespace?.(namespace, "package-uninstall");
  }

  ensureDirectoryPath(path, options = {}) {
    let cursor = "/";
    this.os.fs.normalize(path).split("/").filter(Boolean).forEach((part) => {
      cursor = this.os.fs.join(cursor, part);
      if (!this.os.fs.exists(cursor)) {
        this.os.fs.createDirectory(cursor, "/", {
          owner: options.owner || "root",
          group: options.group || "root",
          permissions: options.permissions || "drwxr-xr-x",
        }, this.system);
      }
    });
  }

  writeNpmDependencyRecords(record) {
    Object.entries(record.dependencies?.npm || {}).forEach(([name, dependency]) => {
      const path = this.resolvePackageFilePath(record, `node_modules/${name}/package.json`, this.packageWriteRoot(record));
      this.ensureParentDirectories(path);
      this.os.fs.atomicWriteOrCreateFile(
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
      const content = inlineFilePayload(file);
      this.writePackageFile(record, file, content);
    });
  }

  async installDeclaredFiles(record, files, sourceUrl, fetcher) {
    for (const file of files) {
      if (file.url) {
        const fileUrl = normalizePackageUrl(new URL(file.url, sourceUrl).toString());
        const content = await fetchText(this.os, fetcher, fileUrl, MAX_REMOTE_FILE_BYTES, `file ${file.path || fileUrl}`);
        await verifyIntegrity(content, file.integrity, file.path || fileUrl);
        this.writePackageFile(record, { ...file, sourceUrl: fileUrl }, content);
        continue;
      }
      const content = inlineFilePayload(file);
      await verifyIntegrity(content, file.integrity, file.path);
      this.writePackageFile(record, file, content);
    }
  }

  writePackageFile(record, file, content) {
    const finalPath = this.resolvePackageFilePath(record, file.path);
    const writePath = this.resolvePackageFilePath(record, file.path, this.packageWriteRoot(record));
    this.ensureParentDirectories(writePath);
    const metadata = {
      mime: file.mime || mimeFromName(finalPath),
      owner: "root",
      group: "root",
      permissions: file.permissions || "-rw-r--r--",
    };
    if (content instanceof Uint8Array) this.os.fs.atomicWriteOrCreateFileBytes(writePath, content, "/", metadata, this.system);
    else this.os.fs.atomicWriteOrCreateFile(writePath, content, "/", metadata, this.system);
    record.files.push({
      path: finalPath,
      mime: file.mime || mimeFromName(finalPath),
      sourceUrl: file.sourceUrl || "",
      integrity: file.integrity || "",
      size: contentByteLength(content),
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

  packageWriteRoot(record) {
    return record.stagingPath || record.installPath;
  }

  packageStagingPath(record) {
    return `${PACKAGE_STAGING_ROOT}/${record.id}-${Date.now().toString(36)}`;
  }

  resolvePackageFilePath(record, path, rootPath = record.installPath) {
    const relative = String(path || "").trim();
    if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) {
      throw new Error(`pkg: invalid package file path: ${path || ""}`);
    }
    const root = this.os.fs.normalize(rootPath || record.installPath);
    const resolved = this.os.fs.normalize(relative, root);
    if (resolved !== root && resolved.startsWith(`${root}/`)) return resolved;
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
        runtime: record.app.runtime,
        description: record.description,
        compatibility: record.compatibility,
        api: record.api,
        sandbox: cloneJson(record.sandbox || {}),
        namespace: cloneJson(record.namespace || {}),
        secrets: cloneJson(record.secrets || []),
        capabilities: record.app.capabilities,
        fileSystem: record.app.fileSystem,
      },
      render: ({ content, os: runtime, window }) => renderPackagedApp(content, runtime, record, window, this),
    });
  }

  registerPackageServices(record, previous = null) {
    if (previous) this.unregisterPackageServices(previous);
    (record.services || []).forEach((service) => {
      this.os.services?.register?.({
        ...service,
        packageId: record.id,
        namespace: cloneJson(record.namespace || {}),
        capabilities: unique([...(service.capabilities || [])]),
        fileSystem: cloneJson(service.fileSystem || record.app.fileSystem),
        start: ({ log }) => log(`package ${record.id} service ${service.name || service.id} started`),
        stop: ({ log }) => log(`package ${record.id} service ${service.name || service.id} stopped`),
      });
    });
  }

  unregisterPackageServices(record) {
    (record.services || []).forEach((service) => {
      if (!this.os.services?.get?.(service.id)) return;
      this.os.services.unregister(service.id, { principal: this.system });
    });
  }

  activatePackage(record, previous = null, operation = "install") {
    const activation = this.createPackageActivation(record, operation);
    this.emitPackageActivation("start", record, activation);
    try {
      this.runPackageActivationPhase(activation, record, "package-root", () => this.activatePackageRoot(record));
      this.runPackageActivationPhase(activation, record, "package-record", () => this.writePackageRecord(record));
      this.runPackageActivationPhase(activation, record, "launcher", () => this.installLauncher(record));
      this.runPackageActivationPhase(activation, record, "app-registry", () => this.registerPackageApp(record));
      this.runPackageActivationPhase(activation, record, "services", () => this.registerPackageServices(record, previous));
      activation.status = "complete";
      activation.completedAt = new Date().toISOString();
      this.emitPackageActivation("complete", record, activation);
      return activation;
    } catch (error) {
      activation.status = "error";
      activation.error = error?.message || String(error);
      activation.completedAt = new Date().toISOString();
      this.emitPackageActivation("error", record, activation);
      throw error;
    }
  }

  createPackageActivation(record, operation) {
    return {
      id: `package-activation:${record.id}:${Date.now().toString(36)}`,
      packageId: record.id,
      appId: record.app?.id || "",
      operation,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: "",
      phases: [],
      error: "",
    };
  }

  runPackageActivationPhase(activation, record, phase, action) {
    const entry = {
      phase,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: "",
      error: "",
    };
    activation.phases.push(entry);
    this.emitPackageActivation("phase-start", record, activation, entry);
    try {
      const result = action();
      entry.status = "complete";
      entry.completedAt = new Date().toISOString();
      this.emitPackageActivation("phase-complete", record, activation, entry);
      return result;
    } catch (error) {
      entry.status = "error";
      entry.completedAt = new Date().toISOString();
      entry.error = error?.message || String(error);
      this.emitPackageActivation("phase-error", record, activation, entry);
      throw error;
    }
  }

  emitPackageActivation(type, record, activation, phase = null) {
    const payload = {
      type,
      packageId: record.id,
      appId: record.app?.id || "",
      operation: activation.operation,
      activation: cloneJson(activation),
      phase: phase ? cloneJson(phase) : null,
    };
    this.os.bus?.emit?.(`package:activation:${type}`, payload);
    this.os.bus?.emit?.("package:activation", payload);
  }

  writePackageRecord(record) {
    const { stagingPath, ...persistedRecord } = record;
    this.os.fs.atomicWriteOrCreateFile(
      this.packageRecordPath(record.id),
      `${JSON.stringify(persistedRecord, null, 2)}\n`,
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

function localRegistryIndexPayload() {
  return {
    name: "DindbOS Local Registry",
    packages: [
      {
        id: "hello-notes",
        name: "Hello Notes",
        version: "0.1.0",
        description: "Sample executable DindbOS package.",
        manifestUrl: `${PACKAGE_SOURCE_DIR}/hello-notes/dindbos.app.json`,
      },
      {
        id: "api-lab",
        name: "API Lab",
        version: "0.1.0",
        description: "Sample app proving sandboxed runtime APIs.",
        manifestUrl: `${PACKAGE_SOURCE_DIR}/api-lab/dindbos.app.json`,
      },
      {
        id: "paint-sample",
        name: "Paint Sample",
        version: "0.1.0",
        description: "Sample canvas app for packaged visual tools.",
        manifestUrl: `${PACKAGE_SOURCE_DIR}/paint-sample/dindbos.app.json`,
      },
      {
        id: "pdf-viewer-sample",
        name: "PDF Viewer Sample",
        version: "0.1.0",
        description: "Sample packaged PDF file viewer manifest.",
        manifestUrl: `${PACKAGE_SOURCE_DIR}/pdf-viewer-sample/dindbos.app.json`,
      },
    ],
  };
}

function renderPackagedApp(content, runtime, record, windowApi, manager = null) {
  if (record.app.entryPath && record.app.runtime === "wasm") {
    return mountPackageWasmEntrypoint(content, runtime, record, windowApi, manager);
  }
  if (record.app.entryPath) {
    return mountPackageEntrypoint(content, runtime, record, windowApi, manager);
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

async function mountPackageWasmEntrypoint(content, runtime, record, windowApi, manager = null) {
  const activeRecord = safeRead(() => manager?.markFirstRun?.(record.id), record) || record;
  content.innerHTML = `
    <section class="package-app">
      <p class="dos-kicker">WASM Package ${escapeHtml(activeRecord.id)} ${escapeHtml(activeRecord.version)}</p>
      <h2>${escapeHtml(activeRecord.app.name)}</h2>
      <p>Running ${escapeHtml(activeRecord.app.entry)}.</p>
    </section>
  `;
  try {
    const root = manager?.os || runtime.os;
    if (!root?.wasm?.runFile) throw new Error("WASM package runtime is unavailable");
    const result = await root.wasm.runFile(activeRecord.app.entryPath, activeRecord.installPath, {
      argv: [activeRecord.app.entryPath],
      principal: runtime.principal,
      parentPid: runtime.process?.pid || 0,
      appId: `package:${activeRecord.app.id}:wasm`,
      name: activeRecord.app.name,
      manifest: {
        version: activeRecord.version,
        entry: activeRecord.app.entryPath,
        namespace: cloneJson(activeRecord.namespace || {}),
        capabilities: activeRecord.app.capabilities,
        fileSystem: activeRecord.app.fileSystem,
      },
    });
    content.innerHTML = `
      <section class="package-app" data-wasm-package>
        <p class="dos-kicker">WASM Package ${escapeHtml(activeRecord.id)} ${escapeHtml(activeRecord.version)}</p>
        <h2>${escapeHtml(activeRecord.app.name)}</h2>
        <dl>
          <div><dt>Entry</dt><dd>${escapeHtml(activeRecord.app.entry)}</dd></div>
          <div><dt>Status</dt><dd data-wasm-status>${escapeHtml(String(result.status))}</dd></div>
          <div><dt>PID</dt><dd>${escapeHtml(String(result.pid))}</dd></div>
        </dl>
        ${result.stdout ? `<pre data-wasm-stdout>${escapeHtml(result.stdout)}</pre>` : ""}
        ${result.stderr ? `<pre data-wasm-stderr>${escapeHtml(result.stderr)}</pre>` : ""}
      </section>
    `;
  } catch (error) {
    content.innerHTML = `
      <section class="package-app">
        <p class="dos-kicker">WASM package runtime error</p>
        <h2>${escapeHtml(activeRecord.app.name)}</h2>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
  }
}

async function mountPackageEntrypoint(content, runtime, record, windowApi, manager = null) {
  const activeRecord = safeRead(() => manager?.markFirstRun?.(record.id), record) || record;
  content.innerHTML = `
    <section class="package-app">
      <p class="dos-kicker">Package ${escapeHtml(activeRecord.id)} ${escapeHtml(activeRecord.version)}</p>
      <h2>${escapeHtml(activeRecord.app.name)}</h2>
      <p>Loading ${escapeHtml(activeRecord.app.entry)}.</p>
    </section>
  `;
  try {
    const source = runtime.fs.readFile(activeRecord.app.entryPath);
    const moduleHandle = createModuleUrl(source);
    const module = await import(moduleHandle.url);
    moduleHandle.revoke();
    const mount = module.mount || module.default;
    if (typeof mount !== "function") throw new Error(`${record.app.entry} must export mount() or default()`);
    content.innerHTML = "";
    await mount({
      content,
      os: runtime,
      pkg: packagePublicRecord(activeRecord),
      package: packagePublicRecord(activeRecord),
      sdk: createDindbOSSDK(runtime),
      imports: createImportFacade(activeRecord),
      window: windowApi,
    });
  } catch (error) {
    content.innerHTML = `
      <section class="package-app">
        <p class="dos-kicker">Package runtime error</p>
        <h2>${escapeHtml(activeRecord.app.name)}</h2>
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

function resolvePackageCliEntry(os, record, requestedEntry = "") {
  const candidates = [
    requestedEntry,
    record.cli?.entry,
    record.bin?.dindbos,
    record.bin?.[record.id],
    "bin/cli.js",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const relative = normalizeOptionalRelativePath(candidate);
    if (!relative) continue;
    const resolved = os.fs.normalize(relative, record.installPath);
    if (resolved !== record.installPath && resolved.startsWith(`${record.installPath}/`) && os.fs.exists(resolved)) {
      return resolved;
    }
  }
  throw new Error(`pkg: ${record.id}: CLI entry not found`);
}

function stringifyCliValue(value) {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function packagePublicRecord(record) {
  return Object.freeze({
    id: record.id,
    name: record.name,
    version: record.version,
    description: record.description,
    installPath: record.installPath,
    sourcePath: record.sourcePath,
    compatibility: cloneJson(record.compatibility || { tier: "A", status: "supported" }),
    api: cloneJson(record.api || { targetVersion: 1, negotiatedVersion: 1, status: "matched" }),
    dependencies: cloneJson(record.dependencies || {}),
    secrets: cloneJson(record.secrets || []),
    files: [...(record.files || [])],
    lifecycle: cloneJson(record.lifecycle || {}),
    trust: cloneJson(record.trust || {}),
    sandbox: cloneJson(record.sandbox || {}),
    cli: cloneJson(record.cli || {}),
    services: cloneJson(record.services || []),
    namespace: cloneJson(record.namespace || {}),
  });
}

function normalizePackageSandbox(sandbox = {}) {
  return {
    rootPolicy: String(sandbox.rootPolicy || "readonly-package-image"),
    statePolicy: String(sandbox.statePolicy || "private"),
    cachePolicy: String(sandbox.cachePolicy || "private-evictable"),
    tempPolicy: String(sandbox.tempPolicy || "private-runtime"),
    deviceGrants: [...(sandbox.deviceGrants || sandbox.devices || [])].map(String),
    networkHosts: [...(sandbox.networkHosts || sandbox.network || [])].map(String),
    ipcEndpoints: [...(sandbox.ipcEndpoints || sandbox.ipc || [])].map(String),
    childProcessLimit: Math.max(0, Number(sandbox.childProcessLimit || 0)),
  };
}

function normalizePackageCli(cli = {}) {
  if (typeof cli === "string") return { entry: normalizeOptionalRelativePath(cli), inputType: "module" };
  if (typeof cli !== "object" || !cli) return { entry: "" };
  const entry = cli.entry || cli.path || cli.dindbos || Object.values(cli)[0] || "";
  const inputType = cli.inputType === "commonjs" ? "commonjs" : "module";
  return { entry: normalizeOptionalRelativePath(entry), inputType };
}

function normalizePackageServices(services = [], packageId, installPath, packageFileSystem = {}) {
  if (!Array.isArray(services)) return [];
  return services.map((service) => {
    const localId = String(service.id || service.name || "").trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(localId)) throw new Error(`pkg: invalid service id: ${service.id || ""}`);
    const fileSystem = service.fileSystem || packageFileSystem || {};
    return {
      id: `package:${packageId}:${localId}`,
      packageServiceId: localId,
      name: String(service.name || `${packageId} ${localId}`),
      enabled: service.enabled !== false,
      schedule: service.schedule || null,
      lifecyclePolicy: service.lifecyclePolicy || service.policy || "resumable",
      capabilities: [...(service.capabilities || [])].map(String),
      fileSystem: {
        read: unique(fileSystem.read || [installPath]),
        write: unique(fileSystem.write || []),
      },
    };
  });
}

function strictNamespaceReport(os, record, options = {}) {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });
  const namespace = record.namespace || {};
  const expected = packageNamespace(record.id, record.app?.id || record.id, record.installPath, record.sandbox || {}, record.dependencies || {});
  add("package-root", namespace.packageRoot === record.installPath && namespace.processGroup === `package:${record.id}`
    ? "pass"
    : "fail", `root=${namespace.packageRoot || "-"} group=${namespace.processGroup || "-"}`);
  add("private-roots", namespace.stateRoot === expected.stateRoot && namespace.cacheRoot === expected.cacheRoot && namespace.tempRoot === expected.tempRoot
    ? "pass"
    : "fail", `state=${namespace.stateRoot || "-"} cache=${namespace.cacheRoot || "-"} temp=${namespace.tempRoot || "-"}`);
  const declaredDeps = Object.keys(record.dependencies?.npm || {}).sort();
  const allowedDeps = [...(namespace.dependencyAllowlist || [])].sort();
  add("dependency-allowlist", sameList(declaredDeps, allowedDeps)
    ? "pass"
    : "fail", allowedDeps.length ? allowedDeps.join(",") : "-");
  const readScopes = (record.app?.fileSystem?.read || []).map((path) => os.fs.normalize(path));
  const writeScopes = (record.app?.fileSystem?.write || []).map((path) => os.fs.normalize(path));
  add("read-scopes", readScopes.every((path) => strictReadScope(path, record, namespace))
    ? "pass"
    : "fail", readScopes.join(",") || "-");
  add("write-scopes", writeScopes.every((path) => strictWriteScope(path, record, namespace))
    ? "pass"
    : "fail", writeScopes.join(",") || "-");
  const cliEntry = record.cli?.entry || ((record.files || []).some((file) => file.path === `${record.installPath}/bin/cli.js`) ? "bin/cli.js" : "");
  add("cli-entry", !cliEntry || packageRelativePathStaysInside(os, record, cliEntry)
    ? "pass"
    : "fail", cliEntry || "-");
  const services = record.services || [];
  add("services", services.every((service) => String(service.id || "").startsWith(`package:${record.id}:`))
    ? "pass"
    : "fail", services.length ? services.map((service) => service.id).join(",") : "-");
  return {
    strict: !checks.some((check) => check.status === "fail"),
    source: options.source || "package",
    packageId: record.id,
    appId: record.app?.id || "",
    namespace: cloneJson(namespace),
    checks,
  };
}

function strictReadScope(path, record, namespace = {}) {
  if (!path || path === "/" || path === "/opt") return false;
  if (path === record.installPath || path.startsWith(`${record.installPath}/`)) return true;
  if (path === namespace.stateRoot || path.startsWith(`${namespace.stateRoot}/`)) return true;
  if (path === namespace.cacheRoot || path.startsWith(`${namespace.cacheRoot}/`)) return true;
  if (path === namespace.tempRoot || path.startsWith(`${namespace.tempRoot}/`)) return true;
  if (path === namespace.dependencyRoot || path.startsWith(`${namespace.dependencyRoot}/`)) return true;
  if (path.startsWith("/home/") || path.startsWith("/mnt/")) return true;
  return false;
}

function strictWriteScope(path, record, namespace = {}) {
  if (!path || path === "/" || path === "/opt") return false;
  if (path === record.installPath || path.startsWith(`${record.installPath}/`)) return false;
  if (path === namespace.stateRoot || path.startsWith(`${namespace.stateRoot}/`)) return true;
  if (path === namespace.cacheRoot || path.startsWith(`${namespace.cacheRoot}/`)) return true;
  if (path === namespace.tempRoot || path.startsWith(`${namespace.tempRoot}/`)) return true;
  if (path.startsWith("/home/") || path.startsWith("/mnt/")) return true;
  return false;
}

function packageRelativePathStaysInside(os, record, relativePath) {
  const path = normalizeOptionalRelativePath(relativePath);
  const resolved = os.fs.normalize(path, record.installPath);
  return resolved !== record.installPath && resolved.startsWith(`${record.installPath}/`);
}

function sameList(left = [], right = []) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function packageNamespace(packageId, appId, installPath, sandbox = {}, dependencies = {}) {
  return {
    packageId,
    packageRoot: installPath,
    stateRoot: `${PACKAGE_STATE_ROOT}/${packageId}`,
    cacheRoot: `${PACKAGE_CACHE_ROOT}/${packageId}`,
    tempRoot: `${PACKAGE_TEMP_ROOT}/${packageId}`,
    processGroup: `package:${packageId}`,
    appId,
    dependencyRoot: `${installPath}/node_modules`,
    rootPolicy: sandbox.rootPolicy || "readonly-package-image",
    statePolicy: sandbox.statePolicy || "private",
    cachePolicy: sandbox.cachePolicy || "private-evictable",
    tempPolicy: sandbox.tempPolicy || "private-runtime",
    deviceGrants: [...(sandbox.deviceGrants || sandbox.devices || [])],
    networkHosts: [...(sandbox.networkHosts || sandbox.network || [])],
    ipcEndpoints: [...(sandbox.ipcEndpoints || sandbox.ipc || [])],
    childProcessLimit: Number(sandbox.childProcessLimit || 0),
    dependencyAllowlist: Object.keys(dependencies.npm || {}),
  };
}

function packageDependencyView(record) {
  const namespace = record.namespace || {};
  const dependencies = record.dependencies || { packages: {}, npm: {} };
  const allowedPackages = [...(namespace.dependencyAllowlist || Object.keys(dependencies.npm || {}))].sort();
  const dependencyRoot = namespace.dependencyRoot || `${record.installPath}/node_modules`;
  return {
    packageId: record.id,
    dependencyRoot,
    allowedPackages,
    allowedPaths: allowedPackages.map((name) => `${dependencyRoot}/${name}`),
    npm: Object.fromEntries(allowedPackages
      .filter((name) => dependencies.npm?.[name])
      .map((name) => [name, cloneJson(dependencies.npm[name])])),
  };
}

function packageDependencyViewFromNamespace(namespace = {}) {
  const allowedPackages = [...(namespace.dependencyAllowlist || [])].sort();
  const dependencyRoot = namespace.dependencyRoot || "";
  return {
    packageId: namespace.packageId || "",
    dependencyRoot,
    allowedPackages,
    allowedPaths: dependencyRoot ? allowedPackages.map((name) => `${dependencyRoot}/${name}`) : [],
    npm: {},
  };
}

function dependencyPathPackage(path, dependencyRoot = "") {
  if (!dependencyRoot || (path !== dependencyRoot && !path.startsWith(`${dependencyRoot}/`))) {
    return { inside: false, packageName: "" };
  }
  const relative = path === dependencyRoot ? "" : path.slice(dependencyRoot.length + 1);
  const parts = relative.split("/").filter(Boolean);
  if (!parts.length) return { inside: true, packageName: "" };
  if (parts[0].startsWith("@")) return { inside: true, packageName: parts.length > 1 ? `${parts[0]}/${parts[1]}` : "" };
  return { inside: true, packageName: parts[0] };
}

function dependencyScopeForPath(path, dependencyRoot = "") {
  if (!dependencyRoot || !path.startsWith(`${dependencyRoot}/@`)) return "";
  const relative = path.slice(dependencyRoot.length + 1);
  const [scope, extra] = relative.split("/").filter(Boolean);
  return scope?.startsWith("@") && !extra ? scope : "";
}

function inferPackageRuntime(entry) {
  return String(entry || "").toLowerCase().endsWith(".wasm") ? "wasm" : "javascript";
}

function normalizePackageRuntime(value) {
  const runtime = String(value || "javascript").trim().toLowerCase();
  if (runtime === "js" || runtime === "module" || runtime === "javascript") return "javascript";
  if (runtime === "wasm" || runtime === "webassembly") return "wasm";
  throw new Error(`pkg: unsupported app runtime: ${value}`);
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

function packageFsckProblem(code, path, message, repairable = false) {
  return { code, path, message, repairable };
}

function packageFsckRepair(kind, path, from, to, dryRun) {
  return { kind, path, from, to, dryRun };
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

function normalizePackageSecrets(secrets = {}) {
  const entries = Array.isArray(secrets)
    ? secrets
    : Object.entries(secrets).map(([name, declaration]) => (
      typeof declaration === "string" ? { name, keychainName: declaration } : { name, ...declaration }
    ));
  return entries.map((entry) => {
    const name = normalizeSecretReferenceName(entry.name || entry.id || entry.alias);
    const keychainName = normalizeSecretReferenceName(entry.keychainName || entry.keychain || entry.secret || name);
    return {
      name,
      keychainName,
      kind: String(entry.kind || "generic"),
      required: entry.required !== false,
      purpose: String(entry.purpose || ""),
    };
  });
}

function normalizeSecretReferenceName(name) {
  const value = String(name || "").trim();
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value)) throw new Error(`pkg: invalid secret reference: ${name || ""}`);
  return value;
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
    trust: packageTrust(entry.manifestUrl || entry.url || "", registry.name),
  };
}

function packageTrust(sourcePath, registry = "", signature = null) {
  const remote = isHttpUrl(sourcePath);
  const warnings = [];
  const signatureState = signature || { status: remote ? "missing" : "local", publisherId: "", keyId: "", algorithm: "" };
  if (remote && signatureState.status === "missing") warnings.push("remote manifest is unsigned");
  if (remote && signatureState.status === "untrusted-key") warnings.push(`publisher ${signatureState.publisherId || "unknown"} is not trusted`);
  if (remote && signatureState.status === "invalid") warnings.push("remote manifest signature is invalid");
  return {
    source: remote ? "remote" : "local",
    registry,
    trusted: !remote || signatureState.status === "valid",
    signature: signatureState,
    warnings,
  };
}

function packageLifecycle(record, previous = null) {
  const now = new Date().toISOString();
  const previousLifecycle = previous?.lifecycle || {};
  const updateCount = previous ? Number(previousLifecycle.updateCount || 0) + 1 : 0;
  return {
    installedAt: previousLifecycle.installedAt || record.installedAt || now,
    updatedAt: previous ? now : "",
    firstRunAt: previousLifecycle.firstRunAt || "",
    installCount: Number(previousLifecycle.installCount || 0) + (previous ? 0 : 1),
    updateCount,
  };
}

async function verifyManifestSignature(manifest, sourceUrl) {
  const signature = manifest?.signature;
  const publisher = manifest?.publisher || {};
  if (!signature) {
    return {
      signature: {
        status: "missing",
        publisherId: String(publisher.id || ""),
        keyId: "",
        algorithm: "",
      },
    };
  }
  const normalized = {
    algorithm: String(signature.algorithm || "").toLowerCase(),
    keyId: String(signature.keyId || ""),
    payload: String(signature.payload || ""),
    publisherId: String(publisher.id || ""),
  };
  try {
    if (normalized.algorithm !== "ed25519") throw new Error("unsupported algorithm");
    if (normalized.payload !== "dindbos-manifest-v1") throw new Error("unsupported payload");
    if (!normalized.publisherId) throw new Error("missing publisher id");
    if (!isEd25519PublicKey(publisher.publicKey)) throw new Error("invalid publisher public key");
    if (publisher.publicKey !== normalized.keyId) throw new Error("signature key does not match publisher key");
    const signatureBytes = signatureBytesFromValue(signature.value);
    const publicKeyBytes = publicKeyBytesFromValue(normalized.keyId);
    const payload = canonicalPackageManifestPayload(manifest);
    const valid = await verifyEd25519(publicKeyBytes, signatureBytes, payload);
    return {
      signature: {
        status: valid ? "untrusted-key" : "invalid",
        publisherId: normalized.publisherId,
        keyId: normalized.keyId,
        algorithm: normalized.algorithm,
      },
    };
  } catch (error) {
    if (String(error.message || "").includes("unsupported Ed25519")) throw error;
    return {
      signature: {
        status: "invalid",
        publisherId: normalized.publisherId,
        keyId: normalized.keyId,
        algorithm: normalized.algorithm || "ed25519",
        error: `pkg: ${sourceUrl}: ${error.message}`,
      },
    };
  }
}

export function canonicalPackageManifestPayload(manifest) {
  const clone = cloneJson(manifest || {});
  delete clone.signature;
  return canonicalJson(clone);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function verifyEd25519(publicKeyBytes, signatureBytes, payload) {
  if (!globalThis.crypto?.subtle) throw new Error("unsupported Ed25519 verification: Web Crypto is unavailable");
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      new TextEncoder().encode(payload),
    );
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("algorithm")) {
      throw new Error("unsupported Ed25519 verification in this runtime");
    }
    throw error;
  }
}

function normalizeTrustedPublisher(publisher) {
  const id = String(publisher?.id || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error(`pkg: invalid publisher id: ${publisher?.id || ""}`);
  const publicKey = String(publisher?.publicKey || "").trim();
  if (!isEd25519PublicKey(publicKey)) throw new Error(`pkg: invalid publisher public key for ${id}`);
  return {
    id,
    name: String(publisher?.name || id),
    publicKey,
    addedAt: publisher?.addedAt || "",
  };
}

function isEd25519PublicKey(value) {
  try {
    return publicKeyBytesFromValue(value).byteLength === 32;
  } catch {
    return false;
  }
}

function publicKeyBytesFromValue(value) {
  const match = /^ed25519-pub:v1:([A-Za-z0-9_-]+)$/.exec(String(value || ""));
  if (!match) throw new Error("invalid Ed25519 public key format");
  return base64UrlToBytes(match[1]);
}

function signatureBytesFromValue(value) {
  const match = /^ed25519-sig:v1:([A-Za-z0-9_-]+)$/.exec(String(value || ""));
  if (!match) throw new Error("invalid Ed25519 signature format");
  const bytes = base64UrlToBytes(match[1]);
  if (bytes.byteLength !== 64) throw new Error("invalid Ed25519 signature length");
  return bytes;
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

async function fetchText(os, fetcher, url, maxBytes, label) {
  if (os.cache?.fetchText) {
    return os.cache.fetchText(fetcher, url, {
      namespace: "packages",
      headers: { Accept: "application/json, text/plain, */*" },
      maxBytes,
      label,
      errorPrefix: "pkg",
    });
  }
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

function inlineFilePayload(file) {
  if (!file || typeof file !== "object") throw new Error("pkg: file entry must be an object");
  if (typeof file.content === "string") return file.content;
  if (typeof file.base64 === "string" && isBinaryPackageFile(file)) return decodeBase64Bytes(file.base64);
  if (typeof file.base64 === "string") return decodeBase64Text(file.base64);
  throw new Error(`pkg: ${file.path || ""}: file entry needs content, base64, or url`);
}

function isBinaryPackageFile(file) {
  const mime = String(file.mime || mimeFromName(file.path || "")).toLowerCase();
  return mime === "application/wasm" || /\.wasm$/i.test(file.path || "");
}

function decodeBase64Text(value) {
  if (typeof atob === "function") {
    const binary = atob(value);
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }
  return Buffer.from(value, "base64").toString("utf8");
}

function decodeBase64Bytes(value) {
  const base64 = String(value || "");
  if (typeof atob === "function") {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

async function verifyIntegrity(content, integrity, label = "file") {
  if (!integrity) return;
  const match = /^sha256-([A-Za-z0-9+/=]+)$/.exec(integrity);
  if (!match) throw new Error(`pkg: unsupported integrity format for ${label}`);
  const digest = await sha256Base64(content);
  if (digest !== match[1]) throw new Error(`pkg: integrity mismatch for ${label}`);
}

async function sha256Base64(content) {
  const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content ?? ""));
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return base64FromBytes(new Uint8Array(hash));
  }
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(bytes).digest("base64");
}

function base64FromBytes(bytes) {
  if (typeof btoa === "function") {
    return btoa(String.fromCharCode(...bytes));
  }
  return Buffer.from(bytes).toString("base64");
}

function base64UrlToBytes(value) {
  const padded = String(value || "").replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
  if (typeof atob === "function") {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export function base64UrlFromBytes(bytes) {
  const base64 = base64FromBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function mimeFromName(path) {
  if (/\.md$/i.test(path)) return "text/markdown";
  if (/\.txt$/i.test(path)) return "text/plain";
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.deck\.html?$/i.test(path)) return "application/x-dindbos-deck";
  if (/\.html?$/i.test(path)) return "text/html";
  if (/\.css$/i.test(path)) return "text/css";
  if (/\.js$/i.test(path)) return "text/javascript";
  if (/\.wasm$/i.test(path)) return "application/wasm";
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

function contentByteLength(value) {
  return value instanceof Uint8Array ? value.byteLength : byteLength(value);
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
