import { DindbOS, BOOT_PHASES } from "../dindbos/index.js";
import { installDindbOSBuiltins } from "./builtins.js";

export { DindbOS, BOOT_PHASES } from "../dindbos/index.js";
export { compatibilitySnapshot, conformanceReport, isolationSnapshot } from "../dindbos/compat.js";
export { installDindbOSBuiltins, installBuiltinApps } from "./builtins.js";

export async function createDindbOS(options = {}) {
  const os = new DindbOS(normalizeCreateOptions(options));
  if (typeof options.configure === "function") await options.configure(os);
  return os;
}

export async function bootDindbOS(os, options = {}) {
  if (!os) throw new Error("bootDindbOS: os is required");
  await os.loadPersistentFileSystem(options.storage || {});
  if (options.bootstrapPackages !== false) {
    await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
  }
  if (options.builtins !== false) {
    await os.runBootPhase("app-registry-load", () => installDindbOSBuiltins(os, builtinOptions(options)));
  } else if (typeof options.installApps === "function") {
    await os.runBootPhase("app-registry-load", () => options.installApps(os));
  }
  os.boot();
  if (options.serviceWorker?.enabled) {
    await os.registerServiceWorkerBoot(options.serviceWorker.scriptUrl || "/dindbos-sw.js");
  }
  launchInitialApps(os, options.launch);
  return os;
}

export async function createAndBootDindbOS(options = {}) {
  const os = await createDindbOS(options);
  return bootDindbOS(os, options);
}

function normalizeCreateOptions(options = {}) {
  const fileSystem = options.fileSystem || options.files;
  return {
    ...options,
    fileSystem,
    session: {
      user: "guest",
      product: "DindbOS.js",
      ...(options.session || {}),
    },
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
