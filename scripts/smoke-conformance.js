#!/usr/bin/env node
import { conformanceReport } from "../src/dindbos/compat.js";
import { ShellSession } from "../src/dindbos/shell.js";

const report = conformanceReport(mockRuntime());
assert(report.version === 1, "conformance report version mismatch");
assert(report.categories.some((entry) => entry.id === "package-platform" && entry.level === "supported"), "package platform conformance missing");
assert(report.categories.some((entry) => entry.id === "cross-origin-isolation" && entry.level === "degraded"), "isolation degraded conformance missing");
assert(report.browserMatrix.some((entry) => entry.profile === "installed-pwa"), "browser matrix missing installed PWA");

const shell = new ShellSession(mockShellRuntime(report));
let result = shell.execute("conformance");
assert(result.status === 0 && result.output.includes("package-platform level=supported"), `conformance shell output mismatch: ${result.output}`);
result = shell.execute("conformance matrix");
assert(result.output.includes("cross-origin-isolated level=degraded"), `conformance matrix output mismatch: ${result.output}`);
result = await shell.executeAsync("doctor conformance");
assert(result.output.includes("conformance version=1"), `doctor conformance output mismatch: ${result.output}`);

console.log("conformance smoke ok report shell matrix");

function mockRuntime() {
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
    browserBrokerStatus: () => ({
      capabilities: [{ id: "clipboard.read", available: true }],
    }),
    network: { status: () => ({ broker: "dindbos-network" }) },
    browserProvider: { url: "ws://127.0.0.1:8787/browser" },
  };
}

function mockShellRuntime(report) {
  return {
    session: { user: "guest", home: "/home/guest", groups: ["users"] },
    permissions: {
      principal: () => ({ user: "guest", groups: ["users"] }),
      systemPrincipal: () => ({ user: "root", groups: ["root"], system: true }),
    },
    assertSessionUnlocked: () => true,
    conformanceReport: () => report,
    compatibilitySnapshot: () => ({ runtime: "DindbOS.js", version: "0.2.0", mode: "browser-native" }),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
