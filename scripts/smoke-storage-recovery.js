#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";

const os = new DindbOS({ root: {}, storage: memoryStorage() });
const app = {
  id: "storage-recovery-smoke",
  name: "Storage Recovery Smoke",
  manifest: {
    capabilities: ["storage.read", "storage.manage"],
    fileSystem: { read: ["/home/guest"], write: ["/home/guest"] },
  },
};
const process = os.processes.spawn(app, { cwd: "/home/guest" });
const context = {
  process,
  principal: os.permissions.principal(os.session),
  assertCapability(capability) {
    if (!process.manifest.capabilities.includes(capability)) throw new Error(`capability denied: ${capability}`);
  },
};

ensureDirectory("/home");
ensureDirectory("/home/guest");
ensureDirectory("/home/guest/Documents");
os.fs.writeOrCreateFile("/home/guest/Documents/writeback.txt", "start", "/", { mime: "text/plain" }, context.principal);
let result = os.syscall("fd.open", { path: "/home/guest/Documents/writeback.txt", flags: "r+" }, context);
assert(result.ok, `fd.open failed: ${JSON.stringify(result)}`);
const fd = result.value.fd;
result = os.syscall("fd.write", { fd, data: "mapped" }, context);
assert(result.ok && result.value.bytes === "mapped".length, `fd.write failed: ${JSON.stringify(result)}`);

let kernel = os.storageKernelStatus("smoke");
assert(kernel.service === "dindbos-storage-kernel", "storage kernel service id mismatch");
assert(kernel.transactionGroups.some((entry) => entry.kind === "mapped-file-write" && entry.status === "committed"), "mapped write transaction group missing");
assert(kernel.transactions.some((entry) => entry.kind === "fd-write" && entry.groupId), "fd write transaction missing group id");
assert(os.fs.exists("/proc/storage-kernel.json"), "storage kernel procfs JSON missing");
assert(os.fs.readFile("/proc/writeback").includes("transactions="), "writeback procfs summary missing transaction count");

result = os.syscall("storage.kernel", {}, context);
assert(result.ok && result.value.pageCache, `storage.kernel syscall mismatch: ${JSON.stringify(result)}`);
result = await os.syscallAsync("storage.fsck", { repair: true, dryRun: true }, context);
assert(result.ok && result.value.dryRun === true, `storage.fsck dry run mismatch: ${JSON.stringify(result)}`);
kernel = os.storageKernelStatus("after-fsck");
assert(kernel.recovery.lastRepair?.dryRun === true, "storage fsck did not update last repair");

await os.flushPersistentFileSystem();
kernel = os.storageKernelStatus("after-flush");
assert(kernel.transactionGroups.some((entry) => entry.kind === "writeback-flush" && entry.status === "committed"), "writeback flush group missing");
assert(kernel.writeback.flushes >= 1, "writeback flush count missing");
assert(os.persistenceStatus().storageTransactionGroups.length >= 2, "persistence status missing storage transaction groups");

const serviceGroup = os.storageTransactions.beginGroup("service-lifecycle-suspend", {
  metadata: { reason: "smoke" },
});
os.storageTransactions.commitGroup(serviceGroup.id, { metadata: { suspendedServices: 0 } });
kernel = os.writeStorageKernelProcfs("service-lifecycle-suspend");
assert(kernel.transactionGroups.some((entry) => entry.id === serviceGroup.id), "service lifecycle group missing from storage kernel");
assert(JSON.parse(os.fs.readFile("/proc/storage-transaction-groups.json")).some((entry) => entry.id === serviceGroup.id), "transaction group procfs JSON missing");

console.log("storage recovery smoke ok kernel procfs fsck writeback groups");
globalThis.process?.exit?.(0);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ensureDirectory(path) {
  if (!os.fs.exists(path)) os.fs.createDirectory(path, "/", { owner: "guest", group: "users", permissions: "drwxrwxr-x" });
}

function memoryStorage() {
  let value = null;
  let flushed = 0;
  const journal = [];
  return {
    async loadFileSystem() { return value; },
    saveFileSystem(next) {
      value = next;
      journal.push({ action: "write-queued", transactionId: `memory-${journal.length + 1}` });
    },
    async flush() {
      flushed += 1;
      journal.push({ action: "write-completed", transactionId: `memory-${journal.length + 1}` });
      return { flushed };
    },
    status() {
      return {
        key: "memory:vfs",
        enabled: true,
        backend: "memory",
        structuredBackend: "memory",
        storageFormat: "snapshot",
        bytes: JSON.stringify(value || {}).length,
        writePending: false,
        dirtyInodes: 0,
        dirtyFiles: 0,
        storageJournalRecords: journal.length,
      };
    },
    journal() {
      return journal.map((entry) => ({ ...entry }));
    },
    async checkIntegrity(options = {}) {
      return {
        ok: true,
        dryRun: Boolean(options.dryRun),
        checkedStorage: 1,
        problemCount: 0,
        repairCount: 0,
        problems: [],
        repairs: [],
      };
    },
    resetFileSystem() { value = null; },
  };
}
