import { bootDindbOS, createDindbOS } from "./index.js";

export async function createHeadlessDindbOS(options = {}) {
  return createDindbOS({
    root: options.root || null,
    persistDelayMs: 0,
    ...options,
  });
}

export async function createBootedTestDindbOS(options = {}) {
  if (!options.root) throw new Error("createBootedTestDindbOS: root is required for desktop boot");
  const os = await createHeadlessDindbOS(options);
  return bootDindbOS(os, {
    builtins: options.builtins,
    bootstrapPackages: options.bootstrapPackages,
    serviceWorker: false,
    launch: [],
  });
}
