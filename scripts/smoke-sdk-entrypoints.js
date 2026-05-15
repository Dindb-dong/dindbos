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
  normalizeDindbOSHostConfig,
  prepareDindbOSHost,
  publicHostConfig,
} from "../src/sdk/index.js";
import { mountDindbOSDesktop } from "../src/sdk/desktop.js";
import { createHeadlessDindbOS } from "../src/sdk/testing.js";

assert(typeof DindbOS === "function", "DindbOS export missing");
assert(typeof createDindbOS === "function", "createDindbOS export missing");
assert(typeof bootDindbOS === "function", "bootDindbOS export missing");
assert(typeof createAndBootDindbOS === "function", "createAndBootDindbOS export missing");
assert(typeof installBuiltinApps === "function", "installBuiltinApps export missing");
assert(typeof installDindbOSBuiltins === "function", "installDindbOSBuiltins export missing");
assert(typeof normalizeDindbOSHostConfig === "function", "normalizeDindbOSHostConfig export missing");
assert(typeof prepareDindbOSHost === "function", "prepareDindbOSHost export missing");
assert(typeof publicHostConfig === "function", "publicHostConfig export missing");
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
  storage: { backend: "indexeddb", name: "host-sdk-smoke" },
  apps: [hostApp()],
  serviceWorker: { enabled: true, scriptUrl: "/custom-sw.js" },
  brokers: { browserProviderUrl: "ws://127.0.0.1:8788/browser", browserProviderLabel: "Host browserd" },
  isolation: { preferOriginIsolated: true, allowDegraded: true },
  diagnostics: {
    evidence: [{
      id: "host-sdk-smoke",
      profile: "chromium-tab",
      status: "pass",
      runner: "sdk-entrypoints-smoke",
      categories: ["package-platform"],
      artifacts: [],
    }],
  },
  configure(runtime) {
    runtime.sdkConfigured = true;
  },
});
assert(configured.session.user === "ada", "createDindbOS session override failed");
assert(configured.session.product === "HostOS", "createDindbOS product override failed");
assert(configured.sdkConfigured === true, "createDindbOS configure hook failed");
assert(configured.browserProvider.url === "ws://127.0.0.1:8788/browser", "host broker URL was not applied");
assert(configured.storage.key === "dindbos:vfs:host-sdk-smoke", "named host storage key was not applied");
assert(configured.sdkHostConfig.storage.mode === "indexeddb", "public host config did not record storage mode");
assert(configured.sdkHostConfig.apps.some((app) => app.id === "host-notes"), "public host config did not record host app");
await prepareDindbOSHost(configured, {
  builtins: { includePortfolio: false },
  apps: [hostApp("host-admin")],
  diagnostics: {
    evidence: [{
      id: "host-config-smoke",
      profile: "installed-pwa",
      status: "degraded",
      runner: "sdk-entrypoints-smoke",
      categories: ["service-worker-recovery"],
      artifacts: [],
    }],
  },
});
assert(configured.apps.getManifest("host-admin"), "prepareDindbOSHost did not register host app");
assert(configured.conformanceEvidenceRecords().some((record) => record.id === "host-config-smoke"), "host diagnostics evidence was not applied");

assertRejects(() => normalizeDindbOSHostConfig({ apps: [{ id: "bad app", render() {} }] }), "invalid host app id was accepted");
assertRejects(() => normalizeDindbOSHostConfig({ diagnostics: { evidence: [{ profile: "x", status: "unknown" }] } }), "invalid diagnostics status was accepted");

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

function hostApp(id = "host-notes") {
  return {
    id,
    name: id,
    title: `${id}.app`,
    icon: "text",
    manifest: { capabilities: ["app.launch"], fileSystem: { read: ["/"], write: [] } },
    render: ({ content }) => {
      content.innerHTML = `<main>${id}</main>`;
    },
  };
}

function assertRejects(callback, message) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(message);
}
