#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";
import { PersistentStorage } from "../src/dindbos/persistent-storage.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";
import { serializeFileContentRecord } from "../src/dindbos/file-data.js";

const binaryPath = "/home/guest/Documents/persist.bin";
const binary = new Uint8Array([3, 9, 27, 81, 128, 255]);

await verifySnapshotAdapterFallback();
await verifyOpfsTransactionGroupJournal();
await verifyInterruptedOpfsTransactionRecoveryDecision();
await verifyInterruptedOpfsTransactionReplay();
await verifyInodeContentMismatchDiagnostics();
await verifyQuotaReservationDeniesBeforeMutation();
await verifyOpfsFailureFallsBackToSnapshot();
await verifyLifecyclePendingWriteFlushes();
await verifyStorageClassQuotaArbitration();

console.log(`persistent storage smoke ok binaryBytes=${binary.byteLength} journal=write quota=reservation`);

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
  const journalActions = storage.journal().map((entry) => entry.action);
  assert(journalActions.includes("write-queued"), "snapshot adapter journal missing write-queued");
  assert(journalActions.includes("write-completed"), "snapshot adapter journal missing write-completed");
  assert(storage.status().storageJournalRecords >= 2, "snapshot adapter status did not expose journal count");

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
  const journalActions = storage.journal().map((entry) => entry.action);
  assert(journalActions.includes("write-error"), "OPFS fallback journal missing write-error");
  assert(journalActions.includes("write-completed"), "OPFS fallback journal missing write-completed");
  assert(status.lastStorageJournalAction === "write-completed", `OPFS fallback last journal action mismatch: ${status.lastStorageJournalAction}`);

  const reloadedRoot = await new PersistentStorage({
    key: "smoke:opfs-fallback",
    adapter,
    indexedDB: null,
    opfsProvider: null,
  }).loadFileSystem();
  const reloaded = new VirtualFileSystem(reloadedRoot, { home: "/home/guest" });
  assertBytes(reloaded.readFileBytes(binaryPath), binary, "OPFS fallback bytes changed");
}

async function verifyOpfsTransactionGroupJournal() {
  const opfsRoot = createOpfsRoot();
  const storage = new PersistentStorage({
    key: "smoke:opfs-transaction",
    adapter: createAdapter(),
    indexedDB: null,
    opfsProvider: async () => opfsRoot,
  });
  const fs = bootVfs();
  fs.writeOrCreateFileBytes(binaryPath, binary, "/", { mime: "application/octet-stream" });
  fs.writeOrCreateFile("/home/guest/Documents/readme.txt", "journal group", "/", { mime: "text/plain" });
  storage.saveFileSystem(fs.snapshot());
  await storage.flush();

  const journal = storage.journal();
  const queued = journal.find((entry) => entry.action === "write-queued" && entry.transactionKind === "filesystem-save");
  const completed = journal.find((entry) => entry.action === "write-completed" && entry.transactionId === queued?.transactionId);
  assert(queued, "OPFS transaction journal missing queued filesystem-save entry");
  assert(completed, "OPFS transaction journal missing matching completion entry");
  assert(queued.transactionId && queued.transactionId === completed.transactionId, "OPFS transaction journal did not preserve transaction id");
  assert(queued.dirtyFiles >= 2, `OPFS transaction dirty file count too low: ${queued.dirtyFiles}`);
  assert(queued.dirtyInodes >= 4, `OPFS transaction dirty inode count too low: ${queued.dirtyInodes}`);
  assert(storage.status().lastStorageTransactionId === queued.transactionId, "storage status did not expose last transaction id");
  assert(opfsRoot.files.size > 2, "OPFS transaction did not write multiple records");
}

async function verifyInterruptedOpfsTransactionRecoveryDecision() {
  const opfsRoot = createOpfsRoot();
  const storage = new PersistentStorage({
    key: "smoke:opfs-recovery",
    adapter: createAdapter(),
    indexedDB: null,
    opfsProvider: async () => opfsRoot,
  });
  const fs = bootVfs();
  fs.writeOrCreateFileBytes(binaryPath, binary, "/", { mime: "application/octet-stream" });
  storage.saveFileSystem(fs.snapshot());
  await storage.flush();
  const activeTransaction = {
    transactionId: "storage-tx-interrupted",
    transactionKind: "filesystem-save",
    storageFormat: "opfs-inode-records",
    dirtyFiles: 1,
    dirtyInodes: 2,
    state: "active",
  };
  opfsRoot.files.set(opfsFileName(storage.activeStorageTransactionKey()), JSON.stringify(activeTransaction));

  const reloadedStorage = new PersistentStorage({
    key: "smoke:opfs-recovery",
    adapter: createAdapter(),
    indexedDB: null,
    opfsProvider: async () => opfsRoot,
  });
  const reloadedRoot = await reloadedStorage.loadFileSystem();
  const reloaded = new VirtualFileSystem(reloadedRoot, { home: "/home/guest" });
  assertBytes(reloaded.readFileBytes(binaryPath), binary, "interrupted transaction recovery changed persisted bytes");
  const recovery = reloadedStorage.status().storageRecoveryDecision;
  assert(recovery?.transactionId === "storage-tx-interrupted", `recovery transaction id mismatch: ${JSON.stringify(recovery)}`);
  assert(recovery.decision === "load-last-complete-manifest", `recovery decision mismatch: ${JSON.stringify(recovery)}`);
  assert(reloadedStorage.journal().some((entry) => entry.action === "write-recovery" && entry.transactionId === "storage-tx-interrupted"), "recovery journal entry missing");
}

async function verifyInterruptedOpfsTransactionReplay() {
  const opfsRoot = createOpfsRoot();
  const storage = new PersistentStorage({
    key: "smoke:opfs-replay",
    adapter: createAdapter(),
    indexedDB: null,
    opfsProvider: async () => opfsRoot,
  });
  const fs = bootVfs();
  fs.writeOrCreateFileBytes(binaryPath, binary, "/", { mime: "application/octet-stream" });
  storage.saveFileSystem(fs.snapshot());
  await storage.flush();

  fs.writeOrCreateFile(binaryPath, "replayed content", "/", { mime: "text/plain" });
  const replayTransaction = {
    transactionId: "storage-tx-replay",
    transactionKind: "filesystem-save",
    storageFormat: "opfs-inode-records",
    replayManifestKey: storage.replayStorageTransactionKey("storage-tx-replay"),
    state: "active",
  };
  const replayPayload = storage.createInodeRecordPayload(fs.snapshot());
  replayPayload.fileRecords.forEach((record) => opfsRoot.files.set(opfsFileName(record.key), record.content));
  replayPayload.inodeRecords.forEach((record) => opfsRoot.files.set(opfsFileName(record.key), record.metadata));
  opfsRoot.files.set(opfsFileName(replayTransaction.replayManifestKey), replayPayload.manifest);
  opfsRoot.files.set(opfsFileName(storage.activeStorageTransactionKey()), JSON.stringify(replayTransaction));

  const reloadedStorage = new PersistentStorage({
    key: "smoke:opfs-replay",
    adapter: createAdapter(),
    indexedDB: null,
    opfsProvider: async () => opfsRoot,
  });
  const reloadedRoot = await reloadedStorage.loadFileSystem();
  const reloaded = new VirtualFileSystem(reloadedRoot, { home: "/home/guest" });
  assert(reloaded.readFile(binaryPath) === "replayed content", "interrupted transaction replay did not apply pending manifest");
  const recovery = reloadedStorage.status().storageRecoveryDecision;
  assert(recovery?.decision === "replay-pending-manifest", `replay recovery decision mismatch: ${JSON.stringify(recovery)}`);
  assert(reloadedStorage.journal().some((entry) => entry.action === "write-recovery" && entry.transactionId === "storage-tx-replay"), "replay recovery journal entry missing");
  assert(!opfsRoot.files.has(opfsFileName(storage.activeStorageTransactionKey())), "replayed transaction did not clear active marker");
  assert(!opfsRoot.files.has(opfsFileName(replayTransaction.replayManifestKey)), "replayed transaction did not clear replay manifest");
}

async function verifyInodeContentMismatchDiagnostics() {
  const opfsRoot = createOpfsRoot();
  const storage = new PersistentStorage({
    key: "smoke:opfs-integrity",
    adapter: createAdapter(),
    indexedDB: null,
    opfsProvider: async () => opfsRoot,
  });
  const fs = bootVfs();
  fs.writeOrCreateFileBytes(binaryPath, binary, "/", { mime: "application/octet-stream" });
  storage.saveFileSystem(fs.snapshot());
  await storage.flush();
  const manifest = JSON.parse(opfsRoot.files.get(opfsFileName("smoke:opfs-integrity")));
  const fileRecord = manifest.fileRecords.find((record) => record.path === binaryPath);
  opfsRoot.files.set(opfsFileName(fileRecord.key), serializeFileContentRecord("tampered bytes"));

  const reloadedStorage = new PersistentStorage({
    key: "smoke:opfs-integrity",
    adapter: createAdapter(),
    indexedDB: null,
    opfsProvider: async () => opfsRoot,
  });
  await reloadedStorage.loadFileSystem();
  const mismatches = reloadedStorage.status().storageIntegrityMismatches || [];
  assert(mismatches.some((entry) => entry.kind === "file-content-record" && entry.path === binaryPath), `inode/content mismatch was not reported: ${JSON.stringify(mismatches)}`);
  assert(reloadedStorage.journal().some((entry) => entry.action === "storage-integrity-mismatch" && entry.error === "inode-content-mismatch"), "inode/content mismatch journal entry missing");
}

async function verifyQuotaReservationDeniesBeforeMutation() {
  const adapter = createAdapter();
  const storage = new PersistentStorage({
    key: "smoke:quota",
    adapter,
    indexedDB: null,
    opfsProvider: null,
    quotaBytes: 24,
  });
  const fs = bootVfs();
  fs.writeOrCreateFile("/home/guest/Documents/large.txt", "this write should exceed the tiny quota", "/", { mime: "text/plain" });
  await assertRejects(() => storage.saveFileSystem(fs.snapshot()), "storage quota exceeded");
  assert(adapter.getItem("smoke:quota") === "", "quota denial mutated adapter storage");
  const reservation = storage.status().lastQuotaReservation;
  assert(reservation?.allowed === false && reservation.reason === "quota-exceeded", `quota denial status mismatch: ${JSON.stringify(reservation)}`);
  assert(storage.journal().some((entry) => entry.action === "quota-denied" && entry.error === "quota-exceeded"), "quota denial journal entry missing");
}

async function verifyStorageClassQuotaArbitration() {
  const storage = new PersistentStorage({
    key: "smoke:class-quota",
    adapter: createAdapter(),
    indexedDB: null,
    opfsProvider: null,
    quotaBytes: 1_000,
    storageClassQuotas: {
      "package-roots": 32,
      cache: 12,
    },
  });
  storage.reserveStorageBytes(16, {
    transactionKind: "package-install",
    packageId: "quota-lab",
    storageClassUsageBytes: 8,
  });
  let reservation = storage.status().lastQuotaReservation;
  assert(reservation.allowed && reservation.storageClass === "package-roots", `package storage class reservation mismatch: ${JSON.stringify(reservation)}`);
  assert(reservation.storageClassQuotaBytes === 32 && reservation.storageClassAvailableBytes === 24, `package storage class quota fields mismatch: ${JSON.stringify(reservation)}`);
  await assertRejects(() => storage.reserveStorageBytes(16, {
    transactionKind: "package-install",
    packageId: "quota-lab",
    storageClassUsageBytes: 24,
  }), "storage class quota exceeded");
  reservation = storage.status().lastQuotaReservation;
  assert(!reservation.allowed && reservation.reason === "storage-class-quota-exceeded", `storage class denial reason mismatch: ${JSON.stringify(reservation)}`);
  assert(storage.journal().some((entry) => entry.action === "quota-denied" && entry.error === "storage-class-quota-exceeded" && entry.storageClass === "package-roots"), "storage class quota denial journal missing");
  storage.reserveStorageBytes(8, {
    path: "/var/cache/npm/index.json",
    storageClassUsageBytes: 0,
  });
  assert(storage.status().lastQuotaReservation.storageClass === "cache", "path-based cache storage class was not inferred");
}

async function assertRejects(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    if (String(error?.message || error).includes(expectedMessage)) return;
    throw new Error(`expected rejection containing ${expectedMessage}, got ${error?.message || error}`);
  }
  throw new Error(`expected rejection containing ${expectedMessage}`);
}

async function verifyLifecyclePendingWriteFlushes() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const windowListeners = new Map();
  const documentListeners = new Map();
  const storage = createRuntimeStorage();
  globalThis.window = {
    addEventListener: (type, listener) => windowListeners.set(type, listener),
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: (type, listener) => documentListeners.set(type, listener),
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
    const message = windowListeners.get("beforeunload")(event);
    assert(event.prevented, "beforeunload did not prevent unload with pending writes");
    assert(event.returnValue.includes("saving filesystem"), `beforeunload message mismatch: ${event.returnValue}`);
    assert(message === event.returnValue, "beforeunload did not return the prompt message");
    assert(storage.saved > 0, "beforeunload did not synchronously queue a filesystem save");
    await Promise.resolve();

    os.schedulePersistFileSystem({ action: "smoke-pagehide", path: "/home/guest/Documents/pagehide.txt" });
    const savedBeforePagehide = storage.saved;
    windowListeners.get("pagehide")({});
    assert(storage.saved > savedBeforePagehide, "pagehide did not queue a filesystem save");
    await Promise.resolve();

    os.schedulePersistFileSystem({ action: "smoke-hidden", path: "/home/guest/Documents/hidden.txt" });
    const savedBeforeVisibleChange = storage.saved;
    globalThis.document.visibilityState = "visible";
    documentListeners.get("visibilitychange")({});
    assert(storage.saved === savedBeforeVisibleChange, "visible visibilitychange flushed unexpectedly");
    globalThis.document.visibilityState = "hidden";
    documentListeners.get("visibilitychange")({});
    assert(storage.saved > savedBeforeVisibleChange, "hidden visibilitychange did not queue a filesystem save");

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
    const cleanMessage = windowListeners.get("beforeunload")(cleanEvent);
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

function createOpfsRoot() {
  const files = new Map();
  return {
    files,
    async getFileHandle(name, options = {}) {
      if (!files.has(name)) {
        if (!options.create) throw new Error(`file not found: ${name}`);
        files.set(name, "");
      }
      return {
        async getFile() {
          const value = files.get(name) || "";
          return { text: async () => value };
        },
        async createWritable() {
          let pending = "";
          return {
            write: async (value) => {
              pending = String(value ?? "");
            },
            close: async () => {
              files.set(name, pending);
            },
          };
        },
      };
    },
    async removeEntry(name) {
      files.delete(name);
    },
    async *entries() {
      for (const name of files.keys()) yield [name, {}];
    },
  };
}

function opfsFileName(key) {
  return `${String(key || "dindbos").replace(/[^A-Za-z0-9._-]+/g, "_")}.json`;
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
