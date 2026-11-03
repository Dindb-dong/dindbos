import { DindbOS, BOOT_PHASES } from "../dindbos/index.js";
import {
  applyDindbOSHostConfig,
  normalizeDindbOSHostConfig,
  publicHostConfig,
} from "./host-config.js";
import { installDindbOSBuiltins } from "./builtins.js";

export { defineApp } from "./app-definition.js";
export { applyDindbOSTheme } from "./host-config.js";

export { DindbOS, BOOT_PHASES } from "../dindbos/index.js";
export { compatibilitySnapshot, conformanceReport, isolationSnapshot } from "../dindbos/compat.js";
export { installDindbOSBuiltins, installBuiltinApps } from "./builtins.js";
export { applyDindbOSHostConfig, normalizeDindbOSHostConfig, publicHostConfig } from "./host-config.js";

export async function createDindbOS(options = {}) {
  const config = normalizeDindbOSHostConfig(options);
  throwIfAborted(options.signal);
  const os = new DindbOS(runtimeOptions(config, options));
  watchAbort(os, options.signal);
  os.sdkHostConfig = publicHostConfig(config);
  try {
    if (typeof config.configure === "function") await abortable(Promise.resolve().then(() => config.configure(os, config)), options.signal);
    throwIfAborted(options.signal, os);
    return os;
  } catch (error) {
    await os.destroy?.();
    throw error;
  }
}

export async function bootDindbOS(os, options = {}) {
  if (!os) throw new Error("bootDindbOS: os is required");
  const config = normalizeDindbOSHostConfig(options);
  watchAbort(os, options.signal);
  os.sdkHostConfig = publicHostConfig(config);
  throwIfAborted(options.signal, os);
  await abortable(os.loadPersistentFileSystem(options.storage || {}), options.signal);
  throwIfAborted(options.signal, os);
  if (config.bootstrapPackages !== false) {
    await abortable(os.runBootPhase("package-registry-load", () => os.packages.bootstrap()), options.signal);
  }
  throwIfAborted(options.signal, os);
  await abortable(os.runBootPhase("app-registry-load", async () => {
    await prepareDindbOSHost(os, config);
    return appRegistryBootDetail(os);
  }), options.signal);
  throwIfAborted(options.signal, os);
  os.boot();
  if (config.serviceWorker.enabled) {
    await abortable(os.registerServiceWorkerBoot(config.serviceWorker.scriptUrl, { scope: config.serviceWorker.scope || "/" }), options.signal);
  }
  throwIfAborted(options.signal, os);
  launchInitialApps(os, config.launch);
  return os;
}

export async function createAndBootDindbOS(options = {}) {
  const os = await createDindbOS(options);
  try { return await bootDindbOS(os, options); }
  catch (error) { await os.destroy?.(); throw error; }
}

export async function prepareDindbOSHost(os, options = {}) {
  const config = options.apps || options.packages || options.serviceWorker
    ? normalizeDindbOSHostConfig(options)
    : options;
  if (config.builtins !== false) installDindbOSBuiltins(os, builtinOptions(config));
  await applyDindbOSHostConfig(os, config);
  os.sdkHostConfig = publicHostConfig(config);
  return os;
}

function runtimeOptions(config, originalOptions = {}) {
  return {
    root: config.root,
    uiOptions: config.ui,
    fileSystem: config.fileSystem,
    session: config.session,
    storage: config.storage.adapter || undefined,
    cache: config.cache || originalOptions.cache,
    persistDelayMs: config.persistDelayMs ?? originalOptions.persistDelayMs,
    ...(config.storage.runtimeOptions || {}),
    safeBootProfile: config.safeBootProfile || originalOptions.safeBootProfile,
    browserProviderUrl: config.brokers.browserProviderUrl || originalOptions.browserProviderUrl,
    browserProviderLabel: config.brokers.browserProviderLabel || originalOptions.browserProviderLabel,
  };
}

function builtinOptions(options = {}) {
  if (options.builtins && typeof options.builtins === "object") return options.builtins;
  return {};
}

function launchInitialApps(os, launch = []) {
  const apps = Array.isArray(launch) ? launch : [];
  for (const entry of apps) {
    if (typeof entry === "string") os.launch(entry);
    else if (entry?.id) os.launch(entry.id, entry.context || {});
  }
}

function appRegistryBootDetail(os) {
  const apps = os.apps?.list?.() || [];
  const pinnedCount = apps.filter((app) => app.pinned).length;
  const packageAppCount = apps.filter((app) => app.packageId).length;
  const packageText = packageAppCount ? `, ${packageAppCount} package apps` : "";
  return `${apps.length} apps registered, ${pinnedCount} pinned${packageText}`;
}

function throwIfAborted(signal, os) {
  if (!signal?.aborted && !os?.destroyed) return;
  const error = new Error("DindbOS mount was cancelled");
  error.name = "AbortError";
  throw error;
}

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => {
      const error = new Error("DindbOS mount was cancelled");
      error.name = "AbortError";
      reject(error);
    };
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function watchAbort(os, signal) {
  if (!signal || os.mountSignal === signal) return;
  os.mountSignal = signal;
  const cancel = () => { os.destroy().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  os.lifecycleCleanups.push(() => signal.removeEventListener("abort", cancel));
  if (signal.aborted) cancel();
}
