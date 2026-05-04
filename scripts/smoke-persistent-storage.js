#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";
import { PersistentStorage } from "../src/dindbos/persistent-storage.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const binaryPath = "/home/guest/Documents/persist.bin";
const binary = new Uint8Array([3, 9, 27, 81, 128, 255]);

await verifySnapshotAdapterFallback();
await verifyOpfsFailureFallsBackToSnapshot();
await verifyBeforeUnloadPendingWritePrompt();

console.log(`persistent storage smoke ok binaryBytes=${binary.byteLength}`);

async function verifySnapshotAdapterFallback() {
  const adapter = createAdapter();
  const storage = new PersistentStorage({
    key: "smoke:vfs",
    adapter,
    indexedDB: null,
    opfsProvider: null,
  });
  const fs = bootVfs();
  fs.writeOrCreateFileBytes(binaryPath, binary, "/", { mime: "application/octet-stream" });
  storage.saveFileSystem(fs.snapshot());
  await storage.flush();

  const reloadedRoot = await new PersistentStorage({
    key: "smoke:vfs",
    adapter,
    indexedDB: null,
    opfsProvider: null,
  }).loadFileSystem();
  const reloaded = new VirtualFileSystem(reloadedRoot, { home: "/home/guest" });
  assertBytes(reloaded.readFileBytes(binaryPath), binary, "adapter fallback bytes changed");
}

async function verifyOpfsFailureFallsBackToSnapshot() {
  const adapter = createAdapter();
  const storage = new PersistentStorage({
    key: "smoke:opfs-fallback",
    adapter,
    indexedDB: null,
    opfsProvider: async () => ({
      async getFileHandle() {
        throw new Error("simulated OPFS unavailable");
      },
      async removeEntry() {},
    }),
  });
  const fs = bootVfs();
  fs.writeOrCreateFileBytes(binaryPath, binary, "/", { mime: "application/octet-stream" });
  storage.saveFileSystem(fs.snapshot());
  await storage.flush();

  const status = storage.status();
  assert(status.storageFormat === "snapshot-fallback", `expected snapshot-fallback, got ${status.storageFormat}`);
  assert(status.lastWriteError.includes("simulated OPFS unavailable"), "OPFS failure was not recorded");

  const reloadedRoot = await new PersistentStorage({
    key: "smoke:opfs-fallback",
    adapter,
    indexedDB: null,
    opfsProvider: null,
  }).loadFileSystem();
  const reloaded = new VirtualFileSystem(reloadedRoot, { home: "/home/guest" });
  assertBytes(reloaded.readFileBytes(binaryPath), binary, "OPFS fallback bytes changed");
}

async function verifyBeforeUnloadPendingWritePrompt() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const listeners = new Map();
  const storage = createRuntimeStorage();
  globalThis.window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  try {
    const os = new DindbOS({ root: {}, storage, persistDelayMs: 10000 });
    os.installPersistenceLifecycleHooks();
    os.schedulePersistFileSystem({ action: "smoke", path: "/home/guest/Documents/pending.txt" });
    const event = {
      returnValue: "",
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    const message = listeners.get("beforeunload")(event);
    assert(event.prevented, "beforeunload did not prevent unload with pending writes");
    assert(event.returnValue.includes("saving filesystem"), `beforeunload message mismatch: ${event.returnValue}`);
    assert(message === event.returnValue, "beforeunload did not return the prompt message");
    assert(storage.saved > 0, "beforeunload did not synchronously queue a filesystem save");

    const cleanStorage = createRuntimeStorage();
    const cleanOs = new DindbOS({ root: {}, storage: cleanStorage, persistDelayMs: 10000 });
    cleanOs.installPersistenceLifecycleHooks();
    const cleanEvent = {
      returnValue: "",
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    const cleanMessage = listeners.get("beforeunload")(cleanEvent);
    assert(!cleanEvent.prevented, "beforeunload prevented unload without pending writes");
    assert(cleanMessage === undefined, "beforeunload returned a message without pending writes");
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
}

function bootVfs() {
  const fs = new VirtualFileSystem(null, { home: "/home/guest" });
  fs.createDirectory("/home");
  fs.createDirectory("/home/guest");
  fs.createDirectory("/home/guest/Documents");
  return fs;
}

function createAdapter() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || "",
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function createRuntimeStorage() {
  return {
    saved: 0,
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {
      this.saved += 1;
    },
    async flush() {},
    status() {
      return { enabled: true, writePending: false };
    },
    resetFileSystem() {},
  };
}

function assertBytes(actual, expected, message) {
  assert(actual.byteLength === expected.byteLength, `${message}: length ${actual.byteLength} !== ${expected.byteLength}`);
  for (let index = 0; index < expected.byteLength; index += 1) {
    assert(actual[index] === expected[index], `${message}: byte ${index} ${actual[index]} !== ${expected[index]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
