#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";
import { createDindbOSTestRuntime } from "./helpers/dindbos-test-runtime.js";

const os = createDindbOSTestRuntime();
const events = [];
const fsEvents = [];
os.fs.onChange = (event) => fsEvents.push(event);
["start", "stop", "crash", "scheduled-run", "degraded", "suspend", "resume"].forEach((type) => {
  os.bus.on(`service:${type}`, (event) => events.push(`${type}:${event.service.id}:${event.service.state}`));
});

os.services.register({
  id: "search-indexer",
  name: "Search Indexer",
  schedule: { everyMs: 60000 },
  fileSystem: { read: ["/home/guest"], write: ["/var/lib/dindbos/search"] },
  start: ({ log }) => log("indexer boot"),
  run: ({ os: runtime, log }) => {
    if (!runtime.fs.exists("/var/lib")) runtime.fs.createDirectory("/var/lib", "/", {}, runtime.permissions.systemPrincipal());
    if (!runtime.fs.exists("/var/lib/dindbos")) runtime.fs.createDirectory("/var/lib/dindbos", "/", {}, runtime.permissions.systemPrincipal());
    if (!runtime.fs.exists("/var/lib/dindbos/search")) runtime.fs.createDirectory("/var/lib/dindbos/search", "/", {}, runtime.permissions.systemPrincipal());
    runtime.fs.writeOrCreateFile("/var/lib/dindbos/search/last-run.txt", "indexed\n", "/", {}, runtime.permissions.systemPrincipal());
    log("indexer run");
  },
});

const started = await os.services.start("search-indexer");
assert(started.state === "running", "service did not enter running state");
assert(started.pid > 0 && os.processes.get(started.pid), "service did not create a runtime process");
assert(os.fs.readFile("/var/run/dindbos/services.json").includes("search-indexer"), "service state file missing registered service");
assert(fsEvents.some((event) => event.action === "atomic-create" && event.path === "/var/run/dindbos/services.json"), "service state was not atomically created");
assert(os.fs.readFile("/var/log/dindbos/services.log").includes("indexer boot"), "service log missing start entry");
assert(events.includes("start:search-indexer:running"), "service start event missing");

const scheduled = await os.services.runScheduled("search-indexer");
assert(scheduled.runCount === 1, "scheduled service run count mismatch");
assert(os.fs.readFile("/var/lib/dindbos/search/last-run.txt") === "indexed\n", "scheduled service did not write runtime state");
assert(events.includes("scheduled-run:search-indexer:running"), "scheduled-run event missing");
const manifest = os.services.manifest("search-indexer");
assert(manifest.capabilities.length === 0, "service manifest default capabilities mismatch");
assert(manifest.lifecyclePolicy === "resumable", "service manifest default lifecycle policy mismatch");
assert(manifest.fileSystem.read.includes("/home/guest"), "service manifest read scope missing");
assert(manifest.fileSystem.write.includes("/var/lib/dindbos/search"), "service manifest write scope missing");
manifest.fileSystem.read.push("/mutated");
assert(!os.services.manifest("search-indexer").fileSystem.read.includes("/mutated"), "service manifest leaked mutable read scope");

os.services.suspend("visibility-hidden");
assert(os.services.get("search-indexer").state === "suspended", "service did not suspend");
os.services.resume("visibility-visible");
assert(os.services.get("search-indexer").state === "running", "service did not resume");
assert(events.includes("suspend:search-indexer:suspended"), "service suspend event missing");
assert(events.includes("resume:search-indexer:running"), "service resume event missing");

os.services.register({
  id: "visible-sync",
  name: "Visible Sync",
  lifecyclePolicy: "visible-tab-only",
});
await os.services.start("visible-sync");
os.services.suspend("pagehide");
const visibleSync = os.services.get("visible-sync");
assert(visibleSync.state === "degraded", "visible-tab-only service did not degrade on pagehide");
assert(visibleSync.lastError.includes("visible-tab-only"), "degraded service missing lifecycle policy reason");
assert(os.fs.readFile("/var/run/dindbos/services.json").includes("visible-tab-only"), "service state missing lifecycle policy");
assert(events.includes("degraded:visible-sync:degraded"), "service lifecycle policy degraded event missing");

const deniedPrincipal = os.permissions.principal({ user: "guest", groups: ["users"] });
assertThrows(() => os.services.stop("search-indexer", { principal: deniedPrincipal }), "service: manage denied");

const serviceStatePath = "/var/run/dindbos/services.json";
const serviceLogPath = "/var/log/dindbos/services.log";
const serviceStateBeforeFailedRegister = os.fs.readFile(serviceStatePath);
const originalAtomicWrite = os.fs.atomicWriteOrCreateFile.bind(os.fs);
os.fs.atomicWriteOrCreateFile = (path, ...args) => {
  if (path === serviceStatePath) throw new Error("service state write failed");
  return originalAtomicWrite(path, ...args);
};
assertThrows(() => os.services.register({ id: "failed-register", name: "Failed Register" }), "service state write failed");
os.fs.atomicWriteOrCreateFile = originalAtomicWrite;
assert(!os.services.get("failed-register"), "failed service register left record behind");
assert(os.fs.readFile(serviceStatePath) === serviceStateBeforeFailedRegister, "failed service register changed state file");

os.services.register({ id: "cleanup-service", name: "Cleanup Service" });
const serviceStateBeforeFailedUnregister = os.fs.readFile(serviceStatePath);
const serviceLogBeforeFailedUnregister = os.fs.readFile(serviceLogPath);
os.fs.atomicWriteOrCreateFile = (path, ...args) => {
  if (path === serviceStatePath) throw new Error("service unregister write failed");
  return originalAtomicWrite(path, ...args);
};
assertThrows(() => os.services.unregister("cleanup-service"), "service unregister write failed");
os.fs.atomicWriteOrCreateFile = originalAtomicWrite;
assert(os.services.get("cleanup-service"), "failed service unregister removed record");
assert(os.fs.readFile(serviceStatePath) === serviceStateBeforeFailedUnregister, "failed service unregister changed state file");
assert(os.fs.readFile(serviceLogPath) === serviceLogBeforeFailedUnregister, "failed service unregister changed service log");
assert(os.services.unregister("cleanup-service").state === "unregistered", "service unregister did not return unregistered state");
assert(!os.services.get("cleanup-service"), "service unregister left record behind");

os.services.register({
  id: "failing-sync",
  name: "Failing Sync",
  run: () => {
    throw new Error("sync failed");
  },
});
await os.services.start("failing-sync");
const degraded = await os.services.runScheduled("failing-sync");
assert(degraded.state === "degraded", "failed scheduled service did not degrade");
assert(degraded.lastError === "sync failed", "degraded service missing last error");

const crashed = os.services.crash("failing-sync", new Error("boom service"));
assert(crashed.state === "crashed", "service crash state mismatch");
assert(os.fs.exists(`/var/log/dindbos/crash-${crashed.pid}.log`), "service crash did not write process crash report");
assert(events.includes("crash:failing-sync:crashed"), "service crash event missing");

const restarted = await os.services.restart("failing-sync");
assert(restarted.state === "running", "service restart did not return to running");
assert(restarted.pid !== crashed.pid, "service restart reused crashed pid");
os.services.disable("failing-sync");
assert(os.services.get("failing-sync").state === "disabled", "service disable state mismatch");

await verifyBrowserServiceLifecycleHooks();

console.log("services smoke ok lifecycle schedule suspend permission crash restart transactions browser-hooks");

async function verifyBrowserServiceLifecycleHooks() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const windowListeners = new Map();
  const documentListeners = new Map();
  globalThis.window = {
    addEventListener: (type, listener) => windowListeners.set(type, listener),
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (type, listener) => documentListeners.set(type, listener),
  };
  try {
    const browserOs = new DindbOS({ root: {}, storage: createNoopStorage(), persistDelayMs: 0 });
    browserOs.installServiceLifecycleHooks();
    assert(windowListeners.has("pagehide"), "service pagehide hook was not installed");
    assert(windowListeners.has("pageshow"), "service pageshow hook was not installed");
    assert(documentListeners.has("visibilitychange"), "service visibilitychange hook was not installed");

    browserOs.services.register({ id: "lifecycle-sync", name: "Lifecycle Sync" });
    await browserOs.services.start("lifecycle-sync");
    windowListeners.get("pagehide")({});
    assert(browserOs.services.get("lifecycle-sync").state === "suspended", "pagehide did not suspend service");
    assert(browserOs.lifecycleStatus().state === "suspended", "pagehide did not suspend OS lifecycle");
    const pagehideRecord = JSON.parse(browserOs.fs.readFile("/var/run/dindbos/recovery/last-shutdown.json"));
    assert(pagehideRecord.reason === "pagehide", "pagehide did not write a recovery shutdown record");
    assert(pagehideRecord.suspendedServices.some((service) => service.id === "lifecycle-sync"), "pagehide recovery record missing suspended service");
    windowListeners.get("pageshow")({});
    assert(browserOs.services.get("lifecycle-sync").state === "running", "pageshow did not resume service");
    assert(browserOs.lifecycleStatus().state === "active", "pageshow did not reactivate OS lifecycle");

    globalThis.document.visibilityState = "hidden";
    documentListeners.get("visibilitychange")({});
    assert(browserOs.services.get("lifecycle-sync").state === "suspended", "hidden visibility did not suspend service");
    assert(browserOs.lifecycleStatus().state === "suspended", "hidden visibility did not suspend OS lifecycle");
    globalThis.document.visibilityState = "visible";
    documentListeners.get("visibilitychange")({});
    assert(browserOs.services.get("lifecycle-sync").state === "running", "visible visibility did not resume service");
    assert(browserOs.lifecycleStatus().state === "active", "visible visibility did not reactivate OS lifecycle");
    windowListeners.get("beforeunload")({});
    assert(browserOs.lifecycleStatus().state === "shutting-down", "beforeunload did not mark OS lifecycle shutting-down");
    assert(browserOs.fs.readFile("/var/run/dindbos/lifecycle.json").includes("shutting-down"), "lifecycle diagnostics missing shutting-down state");
    const unloadRecord = JSON.parse(browserOs.fs.readFile("/var/run/dindbos/recovery/last-shutdown.json"));
    assert(unloadRecord.reason === "beforeunload", "beforeunload did not write a recovery shutdown record");

    const messages = browserOs.services.readLog("lifecycle-sync").map((entry) => entry.message).join("\n");
    assert(messages.includes("suspended pagehide"), "service log missing pagehide suspend reason");
    assert(messages.includes("resumed pageshow"), "service log missing pageshow resume reason");
    assert(messages.includes("suspended visibility-hidden"), "service log missing visibility suspend reason");
    assert(messages.includes("resumed visibility-visible"), "service log missing visibility resume reason");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
}

function createNoopStorage() {
  return {
    saveFileSystem() {},
    async flush() {},
    status: () => ({}),
  };
}

function assertThrows(fn, expected) {
  try {
    fn();
  } catch (error) {
    if (!String(error.message).includes(expected)) throw error;
    return;
  }
  throw new Error(`expected error containing ${expected}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
