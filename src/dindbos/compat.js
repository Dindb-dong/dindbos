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

function safeRead(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}
