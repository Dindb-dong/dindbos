const VALID_EVIDENCE_STATUSES = new Set(["pass", "fail", "degraded", "blocked"]);

export function normalizeDindbOSHostConfig(options = {}) {
  const apps = normalizeHostApps(options.apps || []);
  const packages = normalizeHostPackages(options.packages || {});
  const serviceWorker = normalizeServiceWorker(options.serviceWorker);
  const brokers = normalizeBrokers(options.brokers || options.browserProvider || {});
  const isolation = normalizeIsolation(options.isolation || {});
  const diagnostics = normalizeDiagnostics(options.diagnostics || {});
  return {
    root: options.root ?? null,
    fileSystem: options.fileSystem || options.files || {},
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
    configure: typeof options.configure === "function" ? options.configure : null,
    installApps: typeof options.installApps === "function" ? options.installApps : null,
  };
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
  };
}

export async function applyDindbOSHostConfig(os, config = {}) {
  if (!os) throw new Error("applyDindbOSHostConfig: os is required");
  if (config.installApps) await config.installApps(os);
  for (const app of config.apps || []) os.registerApp(app);
  applyPackageConfig(os, config.packages || {});
  applyDiagnostics(os, config.diagnostics || {});
  applyTheme(os, config.theme || {});
  return os;
}

function normalizeHostApps(apps) {
  if (!Array.isArray(apps)) throw new Error("DindbOS host config: apps must be an array");
  return apps.map((app, index) => {
    if (!app || typeof app !== "object") throw new Error(`DindbOS host config: apps[${index}] must be an object`);
    const id = String(app.id || "").trim();
    if (!id) throw new Error(`DindbOS host config: apps[${index}].id is required`);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error(`DindbOS host config: invalid app id: ${id}`);
    if (typeof app.render !== "function") throw new Error(`DindbOS host config: app ${id} render function is required`);
    return {
      ...app,
      id,
      name: String(app.name || id),
    };
  });
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

function normalizeTheme(value) {
  if (!value || typeof value !== "object") throw new Error("DindbOS host config: theme must be an object");
  return {
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

function applyTheme(os, theme) {
  if (!os.root) return;
  if (theme.className) os.root.classList?.add?.(theme.className);
  for (const [name, value] of Object.entries(theme.variables || {})) {
    os.root.style?.setProperty?.(name, String(value));
  }
}
