export const COMPATIBILITY_TIERS = [
  {
    id: "A",
    key: "dindbos-js",
    name: "DindbOS JavaScript GUI/CLI apps",
    status: "supported",
    description: "DindbOS package apps and shell scripts that use documented runtime APIs.",
  },
  {
    id: "B",
    key: "browser-safe-npm",
    name: "Browser-safe npm CLI packages through NodeCompat",
    status: "supported",
    description: "Pure JavaScript npm packages that fit the documented NodeCompat surface.",
  },
  {
    id: "C",
    key: "wasi-wasm",
    name: "WASI-style WASM CLI programs",
    status: "planned",
    description: "WebAssembly programs with WASI-style imports mapped to future DindbOS syscalls.",
  },
  {
    id: "D",
    key: "worker-isolated",
    name: "Worker-isolated long-running programs",
    status: "planned",
    description: "CPU-heavy or risky user programs isolated behind worker-backed process executors.",
  },
  {
    id: "E",
    key: "companion-assisted",
    name: "Companion-assisted native-adjacent capabilities",
    status: "partial",
    description: "Explicit helper protocols for browser-blocked capabilities; browserd is currently browser-only.",
  },
];

export const DINDBOS_API_VERSIONS = [1];
export const CURRENT_DINDBOS_API_VERSION = Math.max(...DINDBOS_API_VERSIONS);

export function compatibilitySnapshot(runtime = {}) {
  const browser = browserCapabilities();
  const isolation = isolationSnapshot(browser);
  const storageStatus = safeRead(() => runtime.storage?.status?.(), {});
  const storageBucketPolicy = safeRead(() => runtime.storageBucketPolicy?.(), null);
  const localMounts = safeRead(() => runtime.localMounts?.status?.(), []);
  const backgroundMaintenance = safeRead(() => runtime.backgroundMaintenanceStatus?.(), backgroundMaintenanceCapabilities());
  const browserProvider = runtime.browserProvider || {};
  const tiers = COMPATIBILITY_TIERS.map((tier) => ({
    ...tier,
    supported: tier.status === "supported",
    available: tier.status === "supported" || tier.status === "partial",
  }));
  return {
    runtime: "DindbOS.js",
    version: "0.2.0",
    mode: "browser-native",
    api: {
      currentVersion: CURRENT_DINDBOS_API_VERSION,
      supportedVersions: [...DINDBOS_API_VERSIONS],
    },
    tiers,
    browser,
    isolation,
    backgroundMaintenance,
    storage: {
      backend: storageStatus.backend || "memory",
      structuredBackend: storageStatus.structuredBackend || "memory",
      persisted: Boolean(storageStatus.persisted),
      buckets: storageBucketPolicy?.decision || "unknown",
    },
    companions: {
      browserProviderUrl: browserProvider.url || "ws://127.0.0.1:8787/browser",
      browserProviderLabel: browserProvider.label || "Local browserd",
      localMounts: Array.isArray(localMounts) ? localMounts.length : 0,
    },
    unsupportedNative: [
      "kernel-mode execution",
      "hardware drivers",
      "arbitrary host filesystem access",
      "native binary execution without an explicit helper",
      "unrestricted raw sockets",
    ],
  };
}

export function conformanceReport(runtime = {}) {
  const snapshot = compatibilitySnapshot(runtime);
  const browserBroker = safeRead(() => runtime.browserBrokerStatus?.(), { capabilities: [] });
  const network = safeRead(() => runtime.network?.status?.(), null);
  const storage = snapshot.storage || {};
  const isolation = snapshot.isolation || {};
  const background = snapshot.backgroundMaintenance || {};
  const browserBrokerCount = Array.isArray(browserBroker.capabilities) ? browserBroker.capabilities.length : 0;
  const categories = [
    conformanceCategory("durable-disk", storage.backend === "memory" ? "degraded" : "supported", "Storage durability and writeback diagnostics", ["storage", "storage kernel", "fsck --dry-run"], storage.backend === "memory" ? "memory backend is volatile outside test/runtime persistence adapters" : "persistent storage backend is available"),
    conformanceCategory("descriptor-io", "supported", "FD table, descriptor rights, pipes, procfs handle views", ["lsof", "handlectl list", "npm run smoke:descriptors"]),
    conformanceCategory("package-platform", "supported", "Signed packages, namespace policy, app registry integration, package CLI", ["pkg list", "pkg audit", "policyctl list"]),
    conformanceCategory("wasm", snapshot.browser?.webAssembly ? "partial" : "unsupported", "DindbOS ABI/WASI subset with memory and deadline guards", ["wasm <file>", "npm run smoke:wasm"], snapshot.browser?.webAssembly ? "WASI coverage is broad but not full tier C yet" : "WebAssembly is unavailable"),
    conformanceCategory("nodecompat", "supported", "Browser-safe NodeCompat modules and npm package execution", ["npm install", "node", "npm run smoke:npm-node"]),
    conformanceCategory("worker-isolation", snapshot.browser?.workers ? "partial" : "planned", "Worker-backed process executor and memory-region diagnostics", ["doctor isolation", "cat /proc/isolation"], snapshot.browser?.workers ? "syscall-heavy WASM workers remain limited" : "Worker is unavailable in this runtime"),
    conformanceCategory("app-containers", "supported", "Same-realm hardening, sandboxed iframe bridge, process container diagnostics", ["manifest", "ps", "cat /proc/<pid>/container.json"]),
    conformanceCategory("device-brokers", browserBrokerCount ? "partial" : "degraded", "Browser API brokers, /dev/browser tree, privacy ledger, revocation", ["doctor browser", "syscall browser.status", "cat /proc/device-tree"]),
    conformanceCategory("virtual-networking", network ? "supported" : "partial", "Policy-routed fetch/DNS/WebSocket/WebRTC and loopback services", ["netstat", "dig <host>", "cat /proc/net/services.json"]),
    conformanceCategory("companion-trust", "companion-required", "Explicit helper protocol boundaries for native-adjacent browser/provider work", ["companion list", "doctor browser"]),
    conformanceCategory("service-worker-recovery", background.serviceWorkerSupported ? "partial" : "degraded", "SW boot manifest, safe boot profiles, offline queue, recovery shell", ["recovery status", "cat /proc/service-worker-boot"]),
    conformanceCategory("cross-origin-isolation", isolation.sharedMemory?.available ? "supported" : "degraded", "COOP/COEP/CORP profile and SharedArrayBuffer/Atomics readiness", ["doctor isolation", "cat /proc/isolation"]),
    conformanceCategory("policy-trust", "supported", "Package policy compiler, trust state, denial proof descriptors", ["pkg audit", "policyctl show <package>", "cat /proc/policy/packages"]),
  ];
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    runtime: {
      name: snapshot.runtime,
      version: snapshot.version,
      mode: snapshot.mode,
    },
    levels: conformanceLevels(),
    summary: conformanceSummary(categories),
    browserMatrix: conformanceBrowserMatrix(snapshot),
    categories,
  };
}

function conformanceLevels() {
  return [
    { id: "supported", meaning: "Implemented with runtime primitive, diagnostic surface, and smoke coverage." },
    { id: "partial", meaning: "Implemented for a scoped subset with explicit limitations." },
    { id: "degraded", meaning: "Runs with honest fallback because a browser/deployment primitive is absent." },
    { id: "companion-required", meaning: "Requires an explicit trusted helper/provider boundary." },
    { id: "planned", meaning: "Roadmapped and blocked on a stronger primitive or broader implementation." },
    { id: "unsupported", meaning: "Not claimed by DindbOS." },
  ];
}

function conformanceCategory(id, level, claim, evidence = [], note = "") {
  return {
    id,
    level,
    claim,
    evidence,
    note,
  };
}

function conformanceSummary(categories = []) {
  return categories.reduce((summary, category) => {
    summary.total += 1;
    summary[category.level] = Number(summary[category.level] || 0) + 1;
    return summary;
  }, { total: 0 });
}

function conformanceBrowserMatrix(snapshot = {}) {
  const isolation = snapshot.isolation || {};
  const background = snapshot.backgroundMaintenance || {};
  return [
    { profile: "chromium-tab", level: "supported", notes: "Primary smoke target for current browser-native runtime." },
    { profile: "safari-tab", level: "partial", notes: "Requires feature probes for OPFS, File System Access, and service worker variants." },
    { profile: "firefox-tab", level: "partial", notes: "Requires degraded local file and OPFS paths." },
    { profile: "mobile-browser", level: "degraded", notes: "Pointer, file, and background APIs vary heavily by platform." },
    { profile: "installed-pwa", level: background.serviceWorkerSupported ? "partial" : "degraded", notes: "Boot assets can be cached; closed-page OS execution is not claimed." },
    { profile: "cross-origin-isolated", level: isolation.sharedMemory?.available ? "supported" : "degraded", notes: "SharedArrayBuffer requires COOP/COEP/CORP deployment." },
    { profile: "local-companion", level: "companion-required", notes: "Explicit local helper identity and protocol checks required." },
    { profile: "remote-provider", level: "companion-required", notes: "Provider health/protocol identity must match DindbOS expectations." },
  ];
}

export function isolationSnapshot(browser = browserCapabilities()) {
  const crossOriginIsolated = Boolean(globalThis.crossOriginIsolated);
  const sharedArrayBuffer = typeof globalThis.SharedArrayBuffer === "function";
  const atomics = typeof globalThis.Atomics === "object";
  const sharedMemoryAvailable = crossOriginIsolated && sharedArrayBuffer && atomics;
  const missing = [
    crossOriginIsolated ? "" : "crossOriginIsolated=false",
    sharedArrayBuffer ? "" : "SharedArrayBuffer unavailable",
    atomics ? "" : "Atomics unavailable",
    browser.workers ? "" : "Worker unavailable",
    browser.webAssembly ? "" : "WebAssembly unavailable",
  ].filter(Boolean);
  return {
    current: sharedMemoryAvailable ? "origin-isolated" : "degraded-shared-memory",
    crossOriginIsolated,
    sharedMemory: {
      sharedArrayBuffer,
      atomics,
      available: sharedMemoryAvailable,
      status: sharedMemoryAvailable ? "available" : "degraded",
      decision: sharedMemoryAvailable
        ? "shared-memory-enabled"
        : "requires-coop-coep-and-browser-support",
    },
    deployment: {
      requiredHeaders: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin or explicit cross-origin for allowed assets",
      },
      alternatives: ["Cross-Origin-Embedder-Policy: credentialless for compatible third-party assets"],
    },
    profiles: [
      {
        id: "same-origin-open",
        status: crossOriginIsolated ? "inactive" : "current",
        coop: "unsafe-none",
        coep: "unsafe-none",
        corp: "not-enforced",
        sharedMemory: "unavailable",
      },
      {
        id: "origin-isolated",
        status: sharedMemoryAvailable ? "current" : "requires-headers",
        coop: "same-origin",
        coep: "require-corp",
        corp: "same-origin or explicit cross-origin",
        sharedMemory: sharedMemoryAvailable ? "available" : "blocked",
      },
      {
        id: "degraded-shared-memory",
        status: sharedMemoryAvailable ? "inactive" : "current",
        reason: missing.join("; ") || "unknown",
        fallback: "ArrayBuffer copy transfer and worker message ports",
      },
    ],
    workerMemory: {
      handlePrototype: true,
      workerAvailable: Boolean(browser.workers),
      status: sharedMemoryAvailable ? "shared" : "copy-fallback",
      transfer: sharedMemoryAvailable ? "SharedArrayBuffer" : "ArrayBuffer copy fallback",
      maxRegionBytes: 16 * 1024 * 1024,
    },
    degradedModes: missing,
  };
}

export function compatibilityRequirementForManifest(manifest = {}) {
  const value = manifest.compatibility?.tier
    || manifest.compatibility?.requiredTier
    || manifest.requiredCompatibilityTier
    || manifest.compatibilityTier
    || "A";
  const tier = findCompatibilityTier(value);
  if (!tier) throw new Error(`pkg: unsupported compatibility tier: ${value}`);
  return {
    tier: tier.id,
    key: tier.key,
    name: tier.name,
    status: tier.status,
    supported: tier.status === "supported",
  };
}

export function apiRequirementForManifest(manifest = {}) {
  const declared = manifest.api || manifest.dindbosApi || manifest.dindbos || {};
  const hasRange = declared.minVersion !== undefined
    || declared.maxVersion !== undefined
    || manifest.minApiVersion !== undefined
    || manifest.maxApiVersion !== undefined;
  const target = apiVersionNumber(
    declared.targetVersion
      ?? declared.version
      ?? manifest.apiVersion
      ?? manifest.dindbosApiVersion
      ?? manifest.runtimeApiVersion
      ?? CURRENT_DINDBOS_API_VERSION,
    "api version",
  );
  const minVersion = hasRange
    ? apiVersionNumber(declared.minVersion ?? manifest.minApiVersion ?? 1, "minimum API version")
    : target;
  const maxVersion = hasRange
    ? apiVersionNumber(declared.maxVersion ?? manifest.maxApiVersion ?? target, "maximum API version")
    : target;
  if (minVersion > maxVersion) throw new Error(`pkg: invalid API version range: min ${minVersion} > max ${maxVersion}`);
  const candidates = DINDBOS_API_VERSIONS
    .filter((version) => version >= minVersion && version <= maxVersion)
    .sort((left, right) => right - left);
  const negotiatedVersion = candidates.find((version) => version <= target) || candidates[0] || 0;
  return {
    targetVersion: target,
    minVersion,
    maxVersion,
    negotiatedVersion,
    supportedVersions: [...DINDBOS_API_VERSIONS],
    currentVersion: CURRENT_DINDBOS_API_VERSION,
    supported: Boolean(negotiatedVersion),
    status: negotiatedVersion === target ? "matched" : negotiatedVersion ? "downgraded" : "unsupported",
  };
}

export function findCompatibilityTier(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  return COMPATIBILITY_TIERS.find((tier) => (
    tier.id.toLowerCase() === normalized
    || tier.key.toLowerCase() === normalized
    || `tier-${tier.id.toLowerCase()}` === normalized
    || `tier ${tier.id.toLowerCase()}` === normalized
  )) || null;
}

function browserCapabilities() {
  return {
    workers: typeof globalThis.Worker === "function",
    webAssembly: typeof globalThis.WebAssembly === "object",
    opfs: Boolean(globalThis.navigator?.storage?.getDirectory),
    indexedDB: typeof globalThis.indexedDB !== "undefined",
    cacheApi: typeof globalThis.caches !== "undefined",
    fileSystemAccess: typeof globalThis.showDirectoryPicker === "function",
    serviceWorker: Boolean(globalThis.navigator?.serviceWorker),
    periodicSync: Boolean(globalThis.PeriodicSyncManager || globalThis.ServiceWorkerRegistration?.prototype?.periodicSync),
    webCrypto: Boolean(globalThis.crypto?.subtle),
    webSocket: typeof globalThis.WebSocket === "function",
  };
}

function backgroundMaintenanceCapabilities() {
  const serviceWorkerSupported = Boolean(globalThis.navigator?.serviceWorker);
  const periodicSyncSupported = Boolean(globalThis.PeriodicSyncManager || globalThis.ServiceWorkerRegistration?.prototype?.periodicSync);
  return {
    serviceWorkerSupported,
    periodicSyncSupported,
    registered: false,
    permissionRequired: serviceWorkerSupported,
    closedPagePersistence: false,
    decision: serviceWorkerSupported ? "available-but-not-registered" : "unsupported-in-this-runtime",
    reason: serviceWorkerSupported
      ? "Background maintenance requires explicit registration and permissioned browser support."
      : "Service Worker support is unavailable in this runtime.",
  };
}

function apiVersionNumber(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`pkg: ${label} must be a positive integer`);
  return number;
}

function safeRead(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}
