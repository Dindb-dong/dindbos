import { DindbOS, BOOT_PHASES } from "../dindbos/index.js";
import {
  applyDindbOSHostConfig,
  normalizeDindbOSHostConfig,
  publicHostConfig,
} from "./host-config.js";
import { installDindbOSBuiltins } from "./builtins.js";

export { DindbOS, BOOT_PHASES } from "../dindbos/index.js";
export { compatibilitySnapshot, conformanceReport, isolationSnapshot } from "../dindbos/compat.js";
export { installDindbOSBuiltins, installBuiltinApps } from "./builtins.js";
export { applyDindbOSHostConfig, normalizeDindbOSHostConfig, publicHostConfig } from "./host-config.js";

export async function createDindbOS(options = {}) {
  const config = normalizeDindbOSHostConfig(options);
  const os = new DindbOS(runtimeOptions(config, options));
  os.sdkHostConfig = publicHostConfig(config);
  if (typeof config.configure === "function") await config.configure(os, config);
  return os;
}

export async function bootDindbOS(os, options = {}) {
  if (!os) throw new Error("bootDindbOS: os is required");
  const config = normalizeDindbOSHostConfig(options);
  os.sdkHostConfig = publicHostConfig(config);
  await os.loadPersistentFileSystem(options.storage || {});
  if (config.bootstrapPackages !== false) {
    await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
  }
  await os.runBootPhase("app-registry-load", () => prepareDindbOSHost(os, config));
  os.boot();
  if (config.serviceWorker.enabled) {
    await os.registerServiceWorkerBoot(config.serviceWorker.scriptUrl);
  }
  launchInitialApps(os, config.launch);
  return os;
}

export async function createAndBootDindbOS(options = {}) {
  const os = await createDindbOS(options);
  return bootDindbOS(os, options);
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
