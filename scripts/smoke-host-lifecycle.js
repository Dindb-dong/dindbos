import assert from "node:assert/strict";
import { createDindbOS } from "../src/sdk/index.js";

const savedStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const values = new Map();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
} });
try {
  const a = await createDindbOS({ storage: { backend: "memory", name: "a" } });
  const b = await createDindbOS({ storage: { backend: "memory", name: "b" } });
  a.acquireRuntimeOperationLock("packages");
  b.acquireRuntimeOperationLock("packages");
  assert.notEqual(a.sessionChannelName, b.sessionChannelName);
  a.setAppearance({ mode: "dark", dockSize: 60 });
  assert.equal(b.appearance.dockSize, 52);
  assert.equal(values.size, 0, "memory instances must never write durable preferences or locks");
  assert.equal(a.destroy(), a.destroy(), "destroy is idempotent");
  await a.destroy();
  await b.destroy();
  assert.equal(a.sessionChannelStatus.connected, false);

  let pendingRuntime;
  let completeConfigure;
  const controller = new AbortController();
  const pending = createDindbOS({ storage: { backend: "memory" }, signal: controller.signal,
    configure(os) { pendingRuntime = os; return new Promise((resolve) => { completeConfigure = resolve; }); },
  });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(pendingRuntime.destroyed, true);
  assert.equal(pendingRuntime.sessionChannelStatus.connected, false);
  completeConfigure();

  class CustomStorage {
    #root;
    async loadFileSystem() { return this.#root; }
    saveFileSystem(root) { this.#root = root; }
  }
  const custom = await createDindbOS({ storage: new CustomStorage(), bootstrapPackages: false });
  await custom.loadPersistentFileSystem();
  assert.equal(custom.storage.status().backend, "custom");
  custom.fs.writeOrCreateFile("/home/guest/custom.txt", "saved");
  await custom.destroy();
  console.log("host lifecycle smoke ok memory isolation immediate abort idempotent destroy optional custom-adapter status");
} finally {
  if (savedStorage) Object.defineProperty(globalThis, "localStorage", savedStorage);
  else delete globalThis.localStorage;
}
