import { normalizeUIStyleOptions } from "../dindbos/ui-style.js";
import { defineApp } from "./app-definition.js";

const normalizedConfigs = new WeakSet();

const VALID_EVIDENCE_STATUSES = new Set(["pass", "fail", "degraded", "blocked"]);

export function normalizeDindbOSHostConfig(options = {}) {
  if (normalizedConfigs.has(options)) return options;
  const apps = normalizeHostApps(options.apps || []);
  const packages = normalizeHostPackages(options.packages || {});
  const serviceWorker = normalizeServiceWorker(options.serviceWorker);
  const brokers = normalizeBrokers(options.brokers || options.browserProvider || {});
  const isolation = normalizeIsolation(options.isolation || {});
  const diagnostics = normalizeDiagnostics(options.diagnostics || {});
  const config = {
    root: options.root ?? null,
    fileSystem: normalizeFileSystemSeed(options.fileSystem || options.files || null),
    session: {
      user: "guest",
      product: "DindbOS.js",
      ...(options.session || {}),
    },
    storage: normalizeStorage(options.storage || null),
    persistDelayMs: options.persistDelayMs,
    cache: options.cache || null,
    safeBootProfile: options.safeBootProfile || options.bootProfile || "",
    builtins: options.builtins,
    bootstrapPackages: options.bootstrapPackages,
    launch: normalizeLaunch(options.launch || options.desktop?.launch || []),
    apps,
    packages,
    serviceWorker,
    brokers,
    isolation,
    diagnostics,
    theme: normalizeTheme(options.theme || {}),
    ui: normalizeUI(options.ui || {}),
    configure: typeof options.configure === "function" ? options.configure : null,
    installApps: typeof options.installApps === "function" ? options.installApps : null,
  };
  normalizedConfigs.add(config);
  return config;
}

export function publicHostConfig(config = {}) {
  return {
    apps: config.apps?.map((app) => ({ id: app.id, name: app.name || app.id })) || [],
    storage: config.storage?.public || { mode: "default", key: "dindbos:vfs" },
    packages: {
      registries: config.packages?.registries?.map((registry) => ({ ...registry })) || [],
      trustedPublishers: config.packages?.trustedPublishers?.map((publisher) => ({ id: publisher.id, name: publisher.name })) || [],
      manifests: config.packages?.manifests?.map((manifest) => manifest.id || manifest.name || "manifest") || [],
    },
    serviceWorker: config.serviceWorker,
    brokers: config.brokers,
    isolation: config.isolation,
    diagnostics: {
      evidenceCount: config.diagnostics?.evidence?.length || 0,
      hasConformanceHook: typeof config.diagnostics?.onConformanceEvidence === "function",
    },
    theme: config.theme,
    ui: { style: config.ui?.style || "macos", mobileStyle: config.ui?.mobileStyle, slots: Object.keys(config.ui?.slots || {}), liquidGlass: config.ui?.liquidGlass !== false },
  };
}

export async function applyDindbOSHostConfig(os, config = {}) {
  if (!os) throw new Error("applyDindbOSHostConfig: os is required");
  if (config.installApps) await config.installApps(os);
  for (const app of config.apps || []) os.registerApp(app);
  applyPackageConfig(os, config.packages || {});
  applyDiagnostics(os, config.diagnostics || {});
  applyDindbOSTheme(os, config.theme || {});
  return os;
}

function normalizeHostApps(apps) {
  if (!Array.isArray(apps)) throw new Error("DindbOS host config: apps must be an array");
  const normalized = apps.map((app) => defineApp(app));
  const ids = new Set();
  for (const app of normalized) {
    if (ids.has(app.id)) throw new Error(`DindbOS host config: duplicate app id: ${app.id}`);
    ids.add(app.id);
  }
  return normalized;
}

function normalizeFileSystemSeed(seed) {
  if (!seed) return undefined;
  if (seed.type === "directory" || seed.type === "file") return seed;
  if (typeof seed !== "object") throw new Error("DindbOS host config: fileSystem must be a VFS tree or path map");
  const root = { name: "", type: "directory", children: [] };
  for (const [path, value] of Object.entries(seed)) {
    addSeedPath(root, path, value);
  }
  return root;
}

function addSeedPath(root, path, value) {
  const normalized = String(path || "").trim().normalize("NFC");
  if (!normalized.startsWith("/")) throw new Error(`DindbOS host config: fileSystem path must be absolute: ${path}`);
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) return;
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = ensureSeedDirectory(directory, part);
  }
  const name = parts.at(-1);
  const existingIndex = directory.children.findIndex((child) => child.name === name);
  const node = seedNode(name, value);
  if (existingIndex >= 0) throw new Error(`DindbOS host config: duplicate fileSystem path: ${normalized}`);
  directory.children.push(node);
}

function ensureSeedDirectory(parent, name) {
  let node = parent.children.find((child) => child.name === name);
  if (!node) {
    node = { name, type: "directory", children: [] };
    parent.children.push(node);
  }
  if (node.type !== "directory") throw new Error(`DindbOS host config: fileSystem path crosses file: ${name}`);
  return node;
}

function seedNode(name, value) {
  if (value && typeof value === "object" && (value.type === "directory" || value.type === "file")) {
    return { ...value, name };
  }
  if (value && typeof value === "object" && !(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) {
    const directory = { name, type: "directory", children: [] };
    for (const [childName, childValue] of Object.entries(value)) {
      addSeedPath(directory, `/${childName}`, childValue);
    }
    return directory;
  }
  return {
    name,
    type: "file",
    mime: guessSeedMime(name, value),
    content: value instanceof ArrayBuffer ? new Uint8Array(value) : value,
  };
}

function guessSeedMime(name, value) {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return "application/octet-stream";
  if (name.endsWith(".json")) return "application/json";
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".html")) return "text/html";
  return "text/plain";
}

function normalizeStorage(storage) {
  if (!storage) return { adapter: null, runtimeOptions: {}, public: { mode: "default", key: "dindbos:vfs" } };
  if (typeof storage.loadFileSystem === "function" && typeof storage.saveFileSystem === "function") {
    return { adapter: storage, runtimeOptions: {}, public: { mode: "custom-adapter" } };
  }
  if (typeof storage !== "object") throw new Error("DindbOS host config: storage must be an object or adapter");
  const backend = String(storage.backend || "browser").trim();
  const name = String(storage.name || storage.key || "dindbos").trim();
  if (!/^[a-z0-9._:-]+$/i.test(name)) throw new Error(`DindbOS host config: invalid storage name: ${name}`);
  return {
    adapter: null,
    runtimeOptions: {
      storageBackend: backend,
      storageKey: storage.key || `dindbos:vfs:${name}`,
      cacheName: storage.cacheName || `dindbos-runtime-cache-${name}`,
    },
    public: {
      mode: backend,
      key: storage.key || `dindbos:vfs:${name}`,
      name,
    },
  };
}

function normalizeHostPackages(packages) {
  if (!packages || typeof packages !== "object") throw new Error("DindbOS host config: packages must be an object");
  return {
    registries: normalizeRegistries(packages.registries || []),
    trustedPublishers: normalizeTrustedPublishers(packages.trustedPublishers || []),
    manifests: normalizePackageManifests(packages.manifests || []),
  };
}

function normalizeRegistries(registries) {
  if (!Array.isArray(registries)) throw new Error("DindbOS host config: packages.registries must be an array");
  return registries.map((registry, index) => {
    const name = String(registry?.name || "").trim();
    const url = String(registry?.url || "").trim();
    if (!name || !url) throw new Error(`DindbOS host config: packages.registries[${index}] requires name and url`);
    return { name, url };
  });
}

function normalizeTrustedPublishers(publishers) {
  if (!Array.isArray(publishers)) throw new Error("DindbOS host config: packages.trustedPublishers must be an array");
  return publishers.map((publisher, index) => {
    const id = String(publisher?.id || "").trim();
    const publicKey = String(publisher?.publicKey || "").trim();
    if (!id || !publicKey) throw new Error(`DindbOS host config: packages.trustedPublishers[${index}] requires id and publicKey`);
    return { ...publisher, id, publicKey, name: String(publisher.name || id) };
  });
}

function normalizePackageManifests(manifests) {
  if (!Array.isArray(manifests)) throw new Error("DindbOS host config: packages.manifests must be an array");
  return manifests.map((manifest, index) => {
    if (!manifest || typeof manifest !== "object") throw new Error(`DindbOS host config: packages.manifests[${index}] must be an object`);
    return manifest;
  });
}

function normalizeServiceWorker(value) {
  if (value === false) return { enabled: false, scriptUrl: "", scope: "", mode: "disabled" };
  if (value === true || value === undefined) return { enabled: false, scriptUrl: "/dindbos-sw.js", scope: "", mode: "host-managed" };
  if (!value || typeof value !== "object") throw new Error("DindbOS host config: serviceWorker must be false, true, or an object");
  return {
    enabled: Boolean(value.enabled),
    scriptUrl: String(value.scriptUrl || "/dindbos-sw.js"),
    scope: String(value.scope || ""),
    mode: value.enabled ? "auto-register" : "host-managed",
  };
}

function normalizeBrokers(value) {
  if (!value || typeof value !== "object") throw new Error("DindbOS host config: brokers must be an object");
  return {
    browserProviderUrl: String(value.browserProviderUrl || value.url || ""),
    browserProviderLabel: String(value.browserProviderLabel || value.label || ""),
    companions: Array.isArray(value.companions) ? value.companions.map((entry) => ({ ...entry })) : [],
  };
}

function normalizeIsolation(value) {
  if (!value || typeof value !== "object") throw new Error("DindbOS host config: isolation must be an object");
  return {
    preferOriginIsolated: Boolean(value.preferOriginIsolated),
    allowDegraded: value.allowDegraded !== false,
    requiredHeaders: {
      "Cross-Origin-Opener-Policy": value.requiredHeaders?.["Cross-Origin-Opener-Policy"] || "same-origin",
      "Cross-Origin-Embedder-Policy": value.requiredHeaders?.["Cross-Origin-Embedder-Policy"] || "require-corp",
      "Cross-Origin-Resource-Policy": value.requiredHeaders?.["Cross-Origin-Resource-Policy"] || "same-origin or explicit cross-origin for allowed assets",
    },
  };
}

function normalizeDiagnostics(value) {
  if (!value || typeof value !== "object") throw new Error("DindbOS host config: diagnostics must be an object");
  const evidence = Array.isArray(value.evidence) ? value.evidence.map(normalizeEvidence) : [];
  return {
    evidence,
    onConformanceEvidence: typeof value.onConformanceEvidence === "function" ? value.onConformanceEvidence : null,
  };
}

function normalizeEvidence(record, index) {
  const profile = String(record?.profile || "").trim();
  if (!profile) throw new Error(`DindbOS host config: diagnostics.evidence[${index}].profile is required`);
  const status = String(record.status || "blocked");
  if (!VALID_EVIDENCE_STATUSES.has(status)) throw new Error(`DindbOS host config: diagnostics.evidence[${index}] has invalid status`);
  return {
    ...record,
    profile,
    status,
    id: String(record.id || `host-evidence-${profile}`),
  };
}

function normalizeUI(value) {
  if (!value || typeof value !== "object") throw new TypeError("DindbOS ui must be an object");
  if (value.liquidGlass !== undefined && typeof value.liquidGlass !== "boolean") {
    if (!value.liquidGlass || typeof value.liquidGlass !== "object" || Array.isArray(value.liquidGlass)) throw new TypeError("DindbOS liquidGlass must be a boolean or options object");
    for (const [key, limit] of [["strength", 3], ["blur", 30], ["maxSurfaces", 48]]) {
      const option = value.liquidGlass[key];
      if (option !== undefined && (!Number.isFinite(option) || option < (key === "maxSurfaces" ? 1 : 0) || option > limit || (key === "maxSurfaces" && !Number.isInteger(option)))) throw new TypeError(`Invalid liquidGlass ${key}`);
    }
  }
  const slots = { ...(value.slots || {}) };
  for (const [name, render] of Object.entries(slots)) {
    if (!["desktop", "menubar", "dock", "windowChrome"].includes(name) || typeof render !== "function") throw new TypeError(`Invalid DindbOS UI slot: ${name}`);
  }
  return normalizeUIStyleOptions({ ...value, slots });
}

function normalizeTheme(value) {
  if (!value || typeof value !== "object") throw new Error("DindbOS host config: theme must be an object");
  return {
    ...value,
    className: String(value.className || ""),
    variables: value.variables && typeof value.variables === "object" ? { ...value.variables } : {},
  };
}

function normalizeLaunch(launch) {
  if (!Array.isArray(launch)) throw new Error("DindbOS host config: launch must be an array");
  return launch.map((entry) => (typeof entry === "string" ? entry : {
    id: String(entry?.id || ""),
    context: entry?.context || {},
  })).filter((entry) => (typeof entry === "string" ? entry : entry.id));
}

function applyPackageConfig(os, packages) {
  for (const registry of packages.registries || []) os.packages.addRegistry(registry.name, registry.url);
  for (const publisher of packages.trustedPublishers || []) os.packages.addTrustedPublisher(publisher);
  for (const manifest of packages.manifests || []) os.packages.install(manifest, { sourcePath: "host-config" });
}

function applyDiagnostics(os, diagnostics) {
  for (const record of diagnostics.evidence || []) {
    const normalized = os.addConformanceEvidence(record);
    diagnostics.onConformanceEvidence?.(normalized, os);
  }
}

export function applyDindbOSTheme(os, theme = {}) {
  if (!os.root) return;
  if (typeof os.setAppearance === "function") os.setAppearance(theme);
  else {
    if (theme.mode) os.root.dataset.appearance = theme.mode;
    if (theme.accent) os.root.style?.setProperty?.("--accent", String(theme.accent));
    if (theme.wallpaper) os.root.style?.setProperty?.("--wallpaper", String(theme.wallpaper));
    if (theme.dockSize) os.root.style?.setProperty?.("--dock-size", `${Number(theme.dockSize)}px`);
  }
  if (theme.className) os.root.classList?.add?.(theme.className);
  for (const [name, value] of Object.entries(theme.variables || {})) {
    os.root.style?.setProperty?.(name, String(value));
  }
}
