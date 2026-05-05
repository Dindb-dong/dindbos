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
  const storageStatus = safeRead(() => runtime.storage?.status?.(), {});
  const storageBucketPolicy = safeRead(() => runtime.storageBucketPolicy?.(), null);
  const localMounts = safeRead(() => runtime.localMounts?.status?.(), []);
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
    webCrypto: Boolean(globalThis.crypto?.subtle),
    webSocket: typeof globalThis.WebSocket === "function",
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
