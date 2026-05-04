#!/usr/bin/env node
import { DindbOS, BOOT_PHASES } from "../src/dindbos/index.js";
import { installBuiltinApps } from "../src/dindbos/apps/builtins.js";
import { demoFileSystem, portfolioData } from "../src/demo/portfolio-demo.js";

const restoreGlobals = installDomShim();
try {
  await verifySuccessfulBootPhases();
  await verifyBootPhaseFailure();
} finally {
  restoreGlobals();
}

console.log(`boot smoke ok phases=${BOOT_PHASES.length}`);

async function verifySuccessfulBootPhases() {
  const os = new DindbOS({
    root: createElement("root"),
    fileSystem: demoFileSystem,
    storage: createStorage(),
    persistDelayMs: 0,
  });
  const events = [];
  os.bus.on("boot:phase", (phase) => events.push(`${phase.id}:${phase.status}`));

  await os.loadPersistentFileSystem();
  await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
  await os.runBootPhase("app-registry-load", () => installBuiltinApps(os, { portfolioData }));
  os.boot();

  const status = os.bootStatus();
  assert(status.map((phase) => phase.id).join(",") === BOOT_PHASES.map((phase) => phase.id).join(","), "boot phase order changed");
  status.forEach((phase) => {
    assert(phase.status === "complete", `boot phase ${phase.id} did not complete: ${phase.status}`);
    assert(phase.startedAt, `boot phase ${phase.id} missing startedAt`);
    assert(phase.finishedAt, `boot phase ${phase.id} missing finishedAt`);
    assert(phase.detail, `boot phase ${phase.id} missing detail`);
  });
  assert(events.includes("storage-load:running"), "storage-load running event missing");
  assert(events.includes("desktop-render:complete"), "desktop-render complete event missing");
  assert(os.apps.has("files"), "built-in apps were not registered during app-registry-load");
  assert(os.packages.info("hello-notes"), "package registry did not bootstrap sample package");
  assert(os.fs.exists("/opt/dindbos/packages/api-lab/dindbos.app.json"), "package registry did not bootstrap API Lab sample source");
  assert(os.fs.exists("/proc/processes.json"), "process init did not write /proc/processes.json");
  assert(os.fs.exists("/var/log/dindbos/boot.json"), "boot diagnostics JSON was not written");
  assert(os.fs.exists("/var/log/dindbos/boot.log"), "boot diagnostics log was not written");
  assert(os.fs.exists("/var/cache"), "cache policy root /var/cache was not created");
  assert(os.diskPolicyForPath("/home/guest/Documents").type === "user", "/home did not resolve to user disk policy");
  assert(os.diskPolicyForPath("/opt/hello-notes").type === "packages", "/opt did not resolve to package disk policy");
  assert(os.diskPolicyForPath("/var/cache/npm").type === "cache", "/var/cache did not resolve to cache disk policy");
  assert(os.diskPolicyForPath("/tmp/payload.bin").type === "temporary", "/tmp did not resolve to temporary disk policy");
  assert(os.diskPolicyForPath("/mnt/portfolio").type === "external", "/mnt did not resolve to external disk policy");
  assert(os.diskPolicyAreas().every((area) => area.exists), "not all disk policy roots exist");
  const bootDiagnostics = JSON.parse(os.fs.readFile("/var/log/dindbos/boot.json"));
  assert(bootDiagnostics.phases.length === BOOT_PHASES.length, "boot diagnostics did not include all phases");
  assert(bootDiagnostics.phases.every((phase) => phase.status === "complete"), "boot diagnostics included incomplete phases");
  assert(os.fs.readFile("/var/log/dindbos/boot.log").includes("[complete] desktop-render"), "boot log missing desktop-render completion");
}

async function verifyBootPhaseFailure() {
  const os = new DindbOS({
    root: createElement("root"),
    fileSystem: demoFileSystem,
    storage: createFailingStorage("storage unavailable"),
  });
  await os.loadPersistentFileSystem();
  const storagePhase = os.bootStatus().find((phase) => phase.id === "storage-load");
  assert(storagePhase.status === "recovered", `failed storage phase status mismatch: ${storagePhase.status}`);
  assert(storagePhase.error === "storage unavailable", `failed storage phase error mismatch: ${storagePhase.error}`);
  assert(storagePhase.detail.includes("recovered"), `failed storage phase recovery detail mismatch: ${storagePhase.detail}`);
  await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
  await os.runBootPhase("app-registry-load", () => installBuiltinApps(os, { portfolioData }));
  os.boot();
  assert(os.fs.exists("/var/log/dindbos/boot.json"), "recovered boot did not write diagnostics");
  const diagnostics = JSON.parse(os.fs.readFile("/var/log/dindbos/boot.json"));
  assert(diagnostics.phases.some((phase) => phase.id === "storage-load" && phase.status === "recovered"), "boot diagnostics missing recovered phase");

  const strictOs = new DindbOS({
    root: createElement("root"),
    fileSystem: demoFileSystem,
    storage: createFailingStorage("strict storage unavailable"),
  });
  await assertRejects(() => strictOs.loadPersistentFileSystem({ recover: false }), "strict storage unavailable");
  const strictStoragePhase = strictOs.bootStatus().find((phase) => phase.id === "storage-load");
  assert(strictStoragePhase.status === "error", `strict failed storage phase status mismatch: ${strictStoragePhase.status}`);
}

function installDomShim() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  globalThis.document = {
    createElement: (tagName) => createElement(tagName),
    addEventListener() {},
    visibilityState: "visible",
  };
  globalThis.window = {
    addEventListener() {},
    setInterval() {
      return 1;
    },
    matchMedia: () => ({ matches: false }),
  };
  return () => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  };
}

function createElement(tagName) {
  const children = [];
  const element = {
    tagName,
    children,
    dataset: {},
    style: {},
    hidden: false,
    className: "",
    textContent: "",
    _innerHTML: "",
    classList: {
      toggle() {},
      add() {},
      remove() {},
    },
    set innerHTML(value) {
      this._innerHTML = String(value);
    },
    get innerHTML() {
      return this._innerHTML;
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    append(...items) {
      items.forEach((item) => children.push(item));
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (!this._queries) this._queries = new Map();
      if (!this._queries.has(selector)) this._queries.set(selector, createElement(selector));
      return this._queries.get(selector);
    },
    querySelectorAll() {
      return [];
    },
  };
  return element;
}

function createStorage() {
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {},
    async readValue() {
      return null;
    },
    writeValue() {},
    status: () => ({ backend: "memory" }),
    estimate: async () => ({ backend: "memory" }),
    resetFileSystem() {},
  };
}

function createFailingStorage(message) {
  return {
    async loadFileSystem() {
      throw new Error(message);
    },
    saveFileSystem() {},
    async flush() {},
    async readValue() {
      return null;
    },
    writeValue() {},
    status: () => ({ backend: "memory" }),
    estimate: async () => ({ backend: "memory" }),
    resetFileSystem() {},
  };
}

async function assertRejects(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected rejection: ${error.message}`);
  }
  throw new Error(`expected rejection containing ${expectedMessage}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
