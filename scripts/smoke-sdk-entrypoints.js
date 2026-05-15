#!/usr/bin/env node
import {
  BOOT_PHASES,
  DindbOS,
  bootDindbOS,
  compatibilitySnapshot,
  conformanceReport,
  createAndBootDindbOS,
  createDindbOS,
  installBuiltinApps,
  installDindbOSBuiltins,
  isolationSnapshot,
} from "../src/sdk/index.js";
import { mountDindbOSDesktop } from "../src/sdk/desktop.js";
import { createHeadlessDindbOS } from "../src/sdk/testing.js";

assert(typeof DindbOS === "function", "DindbOS export missing");
assert(typeof createDindbOS === "function", "createDindbOS export missing");
assert(typeof bootDindbOS === "function", "bootDindbOS export missing");
assert(typeof createAndBootDindbOS === "function", "createAndBootDindbOS export missing");
assert(typeof installBuiltinApps === "function", "installBuiltinApps export missing");
assert(typeof installDindbOSBuiltins === "function", "installDindbOSBuiltins export missing");
assert(typeof mountDindbOSDesktop === "function", "mountDindbOSDesktop export missing");
assert(typeof createHeadlessDindbOS === "function", "createHeadlessDindbOS export missing");
assert(BOOT_PHASES.some((phase) => phase.id === "desktop-render"), "BOOT_PHASES export incomplete");
assert(compatibilitySnapshot(minimalRuntime()).runtime === "DindbOS.js", "compatibilitySnapshot export failed");
assert(conformanceReport(minimalRuntime()).categories.some((entry) => entry.id === "package-platform"), "conformanceReport export failed");
assert(isolationSnapshot().deployment.requiredHeaders["Cross-Origin-Opener-Policy"] === "same-origin", "isolationSnapshot export failed");

const os = await createHeadlessDindbOS({
  fileSystem: {
    "/home/guest/readme.md": "# SDK smoke\n",
  },
  session: { user: "guest" },
});
assert(os instanceof DindbOS, "createHeadlessDindbOS did not return a DindbOS runtime");
installDindbOSBuiltins(os, { includePortfolio: false });
assert(os.apps.getManifest("files"), "builtins facade did not register Files.app");
assert(os.apps.getManifest("terminal"), "builtins facade did not register Terminal.app");
assert(!os.apps.getManifest("portfolio"), "includePortfolio=false still registered demo portfolio");

const configured = await createDindbOS({
  root: null,
  session: { user: "ada", product: "HostOS" },
  configure(runtime) {
    runtime.sdkConfigured = true;
  },
});
assert(configured.session.user === "ada", "createDindbOS session override failed");
assert(configured.session.product === "HostOS", "createDindbOS product override failed");
assert(configured.sdkConfigured === true, "createDindbOS configure hook failed");

console.log("sdk entrypoints smoke ok public exports builtins facade");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function minimalRuntime() {
  return {
    storage: { status: () => ({ backend: "memory", structuredBackend: "memory", persisted: false }) },
    storageBucketPolicy: () => ({ decision: "fallback" }),
    localMounts: { status: () => [] },
    backgroundMaintenanceStatus: () => ({
      serviceWorkerSupported: false,
      periodicSyncSupported: false,
      registered: false,
      closedPagePersistence: false,
      decision: "unsupported-in-this-runtime",
    }),
    conformanceEvidenceRecords: () => [],
    browserBrokerStatus: () => ({ capabilities: [] }),
  };
}
