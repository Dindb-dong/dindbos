#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";

const storage = memoryStorage();
const os = new DindbOS({ root: {}, storage });
const system = os.permissions.systemPrincipal();
os.ensureDirectoryPath("/home/guest", { leafOwner: "guest", leafGroup: "users", principal: system });
os.fs.writeOrCreateFile("/home/guest/input.txt", "hello world", "/", {
  owner: "guest",
  group: "users",
  permissions: "-rw-r--r--",
}, system);

const app = {
  id: "fd-smoke",
  name: "FD Smoke",
  manifest: {
    capabilities: ["clipboard.read", "clipboard.write"],
    fileSystem: {
      read: ["/home/guest"],
      write: ["/home/guest"],
    },
  },
};
const process = os.processes.spawn(app, { cwd: "/home/guest" });
const context = {
  process,
  principal: os.permissions.principal(os.session),
  assertFileSystem: (path, access) => {
    if (path === "/home/guest" || path.startsWith("/home/guest/")) return;
    throw new Error(`fd-smoke: ${access}: ${path}: sandbox denied`);
  },
};

let result = os.syscall("fd.list", {}, context);
assert(result.ok && result.value.length === 3, `initial fd table mismatch: ${JSON.stringify(result)}`);
assert(result.value.every((descriptor) => descriptor.objectId), `initial fd table missing object ids: ${JSON.stringify(result)}`);
assert(result.value.every((descriptor) => descriptor.handleId), `initial fd table missing handle ids: ${JSON.stringify(result)}`);
assert(os.fs.readFile(`/proc/${process.pid}/fd.json`).includes('"fd": 0'), "procfs fd table was not written");
assert(JSON.parse(os.fs.readFile("/proc/objects.json")).filter((entry) => entry.type === "descriptor" && entry.ownerPid === process.pid && entry.status === "active").length === 3, "initial descriptor objects were not registered");
assert(JSON.parse(os.fs.readFile(`/proc/${process.pid}/handles.json`)).filter((entry) => entry.objectType === "descriptor" && entry.ownerPid === process.pid && entry.status === "active").length === 3, "initial process handle table was not written");

result = os.syscall("fd.open", { path: "input.txt", flags: "r" }, context);
assert(result.ok && result.value.fd === 3, `fd.open read mismatch: ${JSON.stringify(result)}`);
const inputFd = result.value.fd;
const inputObjectId = result.value.objectId;
const inputHandleId = result.value.handleId;
const inputFileObjectId = result.value.fileObjectId;
const inputFileHandleId = result.value.fileHandleId;
assert(os.objects.get(inputObjectId)?.metadata?.path === "/home/guest/input.txt", "input descriptor object metadata path mismatch");
assert(os.objects.getHandle(inputHandleId)?.objectId === inputObjectId, "input descriptor handle did not reference object");
assert(os.objects.getHandle(inputHandleId)?.rights.includes("read"), "input descriptor handle missing read right");
assert(os.objects.get(inputFileObjectId)?.type === "file" && os.objects.get(inputFileObjectId)?.metadata?.path === "/home/guest/input.txt", "input file object metadata path mismatch");
assert(os.objects.getHandle(inputFileHandleId)?.objectType === "file" && os.objects.getHandle(inputFileHandleId)?.rights.includes("read"), "input file handle missing read right");
result = os.syscall("fd.read", { fd: inputFd, length: 5 }, context);
assert(result.ok && result.value.data === "hello", `fd.read first chunk mismatch: ${JSON.stringify(result)}`);
assert(os.objects.get(inputObjectId)?.metadata?.offset === 5, "input descriptor object offset did not update after read");
assert(os.objects.getHandle(inputHandleId)?.metadata?.offset === 5, "input descriptor handle offset did not update after read");
assert(os.objects.get(inputFileObjectId)?.metadata?.offset === 5, "input file object offset did not update after read");
assert(os.objects.getHandle(inputFileHandleId)?.metadata?.offset === 5, "input file handle offset did not update after read");
result = os.syscall("fd.seek", { fd: inputFd, offset: 6 }, context);
assert(result.ok && result.value.offset === 6, `fd.seek mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: inputFd, length: 5 }, context);
assert(result.ok && result.value.data === "world", `fd.read second chunk mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.close", { fd: inputFd }, context);
assert(result.ok && result.value.closed, `fd.close mismatch: ${JSON.stringify(result)}`);
assert(os.objects.get(inputObjectId)?.status === "revoked", "closed descriptor object was not revoked");
assert(os.objects.get(inputObjectId)?.revocationReason === "fd-close", "closed descriptor object revocation reason mismatch");
assert(os.objects.getHandle(inputHandleId)?.status === "revoked", "closed descriptor handle was not revoked");
assert(os.objects.getHandle(inputHandleId)?.revocationReason === "fd-close", "closed descriptor handle revocation reason mismatch");
assert(os.objects.get(inputFileObjectId)?.status === "revoked", "closed file object was not revoked");
assert(os.objects.getHandle(inputFileHandleId)?.status === "revoked", "closed file handle was not revoked");
result = os.syscall("fd.read", { fd: inputFd, length: 1 }, context);
assert(!result.ok && result.error.code === "EBADF", `closed fd did not return EBADF: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "input.txt", flags: "r+", rights: { read: true, write: false } }, context);
assert(result.ok, `fd.open wrong-right target mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.write", { fd: result.value.fd, data: "blocked" }, context);
assert(!result.ok && result.error.code === "EACCES", `write through read-only handle did not return EACCES: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "input.txt", flags: "r" }, context);
assert(result.ok, `fd.open stale target mismatch: ${JSON.stringify(result)}`);
const staleFd = result.value.fd;
const staleHandleId = result.value.handleId;
os.objects.revokeHandle(staleHandleId, "smoke-stale");
result = os.syscall("fd.read", { fd: staleFd, length: 1 }, context);
assert(!result.ok && result.error.code === "ESTALE", `stale descriptor handle did not return ESTALE: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "input.txt", flags: "r" }, context);
assert(result.ok, `fd.open stale file target mismatch: ${JSON.stringify(result)}`);
const staleFileFd = result.value.fd;
os.objects.revokeHandle(result.value.fileHandleId, "smoke-file-stale");
result = os.syscall("fd.read", { fd: staleFileFd, length: 1 }, context);
assert(!result.ok && result.error.code === "ESTALE", `stale file handle did not return ESTALE: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "output.txt", flags: "w+" }, context);
assert(result.ok, `fd.open write mismatch: ${JSON.stringify(result)}`);
const outputFd = result.value.fd;
const outputObjectId = result.value.objectId;
const outputHandleId = result.value.handleId;
result = os.syscall("fd.write", { fd: outputFd, data: "alpha" }, context);
assert(result.ok && result.value.bytes === 5, `fd.write mismatch: ${JSON.stringify(result)}`);
assert(os.objects.get(outputObjectId)?.metadata?.offset === 5, "output descriptor object offset did not update after write");
assert(os.objects.getHandle(outputHandleId)?.metadata?.offset === 5, "output descriptor handle offset did not update after write");
result = os.syscall("fd.sync", { fd: outputFd }, context);
assert(!result.ok && result.error.code === "EAGAIN", `sync fd.sync did not require async dispatch: ${JSON.stringify(result)}`);
const beforeFdSyncFlushes = storage.flushes;
result = await os.syscallAsync("fd.sync", { fd: outputFd }, context);
assert(result.ok && result.value.synced === true && result.value.fd === outputFd, `fd.sync mismatch: ${JSON.stringify(result)}`);
assert(storage.flushes === beforeFdSyncFlushes + 1, "fd.sync did not reach storage flush barrier");
result = os.syscall("fd.seek", { fd: outputFd, offset: 0 }, context);
assert(result.ok, `fd.seek output mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: outputFd, length: 5 }, context);
assert(result.ok && result.value.data === "alpha", `fd.read output mismatch: ${JSON.stringify(result)}`);
assert(os.fs.readFile("/home/guest/output.txt") === "alpha", "fd.write did not persist file content");

result = os.syscall("fd.open", { path: "/dev/null", flags: "w" }, context);
assert(result.ok, `fd.open /dev/null mismatch: ${JSON.stringify(result)}`);
const nullFd = result.value.fd;
result = os.syscall("fd.write", { fd: nullFd, data: "discarded" }, context);
assert(result.ok && result.value.bytes === 9, `fd.write /dev/null mismatch: ${JSON.stringify(result)}`);
result = await os.syscallAsync("fd.sync", { fd: nullFd }, context);
assert(!result.ok && result.error.code === "EINVAL", `fd.sync /dev/null did not reject non-file descriptor: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "/dev/zero", flags: "r" }, context);
assert(result.ok, `fd.open /dev/zero mismatch: ${JSON.stringify(result)}`);
const zeroFd = result.value.fd;
const zeroDeviceObjectId = result.value.deviceObjectId;
const zeroDeviceHandleId = result.value.deviceHandleId;
assert(os.objects.get(zeroDeviceObjectId)?.type === "device", "/dev/zero device object was not registered");
assert(os.objects.getHandle(zeroDeviceHandleId)?.rights.includes("read"), "/dev/zero device handle missing read right");
result = os.syscall("fd.read", { fd: zeroFd, length: 4 }, context);
assert(result.ok && result.value.data === "\0\0\0\0" && result.value.bytes === 4, `fd.read /dev/zero mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.close", { fd: zeroFd }, context);
assert(result.ok && os.objects.get(zeroDeviceObjectId)?.status === "revoked", "/dev/zero close did not revoke device object");

result = os.syscall("fd.open", { path: "/dev/random", flags: "r" }, context);
assert(result.ok, `fd.open /dev/random mismatch: ${JSON.stringify(result)}`);
const randomStaleFd = result.value.fd;
os.objects.revokeHandle(result.value.deviceHandleId, "device-handle-smoke");
result = os.syscall("fd.read", { fd: randomStaleFd, length: 1 }, context);
assert(!result.ok && result.error.code === "ESTALE", `stale device handle did not return ESTALE: ${JSON.stringify(result)}`);
result = os.syscall("fd.open", { path: "/dev/random", flags: "r" }, context);
assert(result.ok, `fd.open /dev/random after stale mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: result.value.fd, length: 8 }, context);
assert(result.ok && result.value.data.length === 8 && result.value.bytes === 8, `fd.read /dev/random byte count mismatch: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "/dev/urandom", flags: "r" }, context);
assert(result.ok, `fd.open /dev/urandom mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: result.value.fd, length: 8 }, context);
assert(result.ok && result.value.data.length === 8 && result.value.bytes === 8, `fd.read /dev/urandom mismatch: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "/dev/clipboard", flags: "w" }, context);
assert(result.ok, `fd.open /dev/clipboard write mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.write", { fd: result.value.fd, data: "clipboard text" }, context);
assert(result.ok && result.value.bytes === 14, `fd.write /dev/clipboard mismatch: ${JSON.stringify(result)}`);
assert(os.clipboard.readText() === "clipboard text", "/dev/clipboard did not update runtime clipboard");
result = os.syscall("fd.open", { path: "/dev/clipboard", flags: "r" }, context);
assert(result.ok, `fd.open /dev/clipboard read mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: result.value.fd, length: 9 }, context);
assert(result.ok && result.value.data === "clipboard" && result.value.bytes === 9, `fd.read /dev/clipboard first chunk mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: result.value.fd, length: 64 }, context);
assert(result.ok && result.value.data === " text", `fd.read /dev/clipboard second chunk mismatch: ${JSON.stringify(result)}`);
result = os.syscall("clipboard.write", { text: "syscall clip" }, context);
assert(result.ok && result.value.bytes === 12, `clipboard.write syscall mismatch: ${JSON.stringify(result)}`);
result = os.syscall("clipboard.read", {}, context);
assert(result.ok && result.value.text === "syscall clip", `clipboard.read syscall mismatch: ${JSON.stringify(result)}`);
const ledger = os.privacyLedgerStatus({ capability: "clipboard.write" });
assert(ledger.some((entry) => entry.pid === process.pid && entry.broker === "clipboard" && entry.bytes === 12), "privacy ledger missing clipboard write entry");
assert(JSON.parse(os.fs.readFile("/proc/privacy-ledger.json")).entries.some((entry) => entry.capability === "clipboard.read" && entry.pid === process.pid), "/proc/privacy-ledger.json missing clipboard read entry");
assert(os.fs.readFile("/var/log/dindbos/privacy-ledger.jsonl").includes('"capability":"clipboard.write"'), "privacy ledger jsonl missing clipboard write entry");
const deniedClipboardProcess = os.processes.spawn({
  id: "fd-clipboard-denied",
  name: "FD Clipboard Denied",
  manifest: { capabilities: [], fileSystem: { read: ["/home/guest"], write: ["/home/guest"] } },
}, { cwd: "/home/guest" });
const deniedClipboardContext = { ...context, process: deniedClipboardProcess };
result = os.syscall("fd.open", { path: "/dev/clipboard", flags: "w" }, deniedClipboardContext);
assert(result.ok, `fd.open /dev/clipboard denied setup mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.write", { fd: result.value.fd, data: "denied" }, deniedClipboardContext);
assert(!result.ok && result.error.code === "EACCES", `clipboard broker did not deny missing write capability: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "/dev/tty", flags: "r+" }, context);
assert(result.ok, `fd.open /dev/tty mismatch: ${JSON.stringify(result)}`);
const ttyFd = result.value.fd;
result = os.syscall("fd.ioctl", { fd: ttyFd, request: "tty.getWindowSize" }, context);
assert(result.ok && result.value.columns === 80 && result.value.rows === 24, `fd.ioctl tty default size mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.ioctl", { fd: ttyFd, request: "tty.setWindowSize", columns: 132, rows: 43, pixelWidth: 990, pixelHeight: 640 }, context);
assert(result.ok && result.value.columns === 132 && result.value.rows === 43, `fd.ioctl tty set size mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.ioctl", { fd: ttyFd, request: "tty.getWindowSize" }, context);
assert(result.ok && result.value.columns === 132 && result.value.pixelWidth === 990, `fd.ioctl tty persisted size mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.ioctl", { fd: 1, request: "tty.isatty" }, context);
assert(result.ok && result.value.tty === true, `fd.ioctl stdout isatty mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.ioctl", { fd: outputFd, request: "tty.getWindowSize" }, context);
assert(!result.ok && result.error.code === "ENOTTY", `fd.ioctl non-tty did not return ENOTTY: ${JSON.stringify(result)}`);
result = os.syscall("fd.write", { fd: ttyFd, data: "tty out" }, context);
assert(result.ok && result.value.bytes === 7, `fd.write /dev/tty mismatch: ${JSON.stringify(result)}`);
assert(os.descriptors.standardStreams(process.pid).stdout === "tty out", "/dev/tty did not write to process stdout stream");
result = os.syscall("fd.read", { fd: ttyFd, length: 5 }, context);
assert(result.ok && result.value.data === "", `fd.read /dev/tty empty stdin mismatch: ${JSON.stringify(result)}`);

const pty = os.pty.createSession({ name: "descriptor smoke pty", columns: 100, rows: 30, input: "pty in" });
const ptyProcess = os.processes.spawn(app, { cwd: "/home/guest", ptySessionId: pty.id });
const ptyContext = { ...context, process: ptyProcess };
result = os.syscall("fd.open", { path: "/dev/tty", flags: "r+" }, ptyContext);
assert(result.ok, `fd.open pty /dev/tty mismatch: ${JSON.stringify(result)}`);
const ptyTtyFd = result.value.fd;
result = os.syscall("fd.ioctl", { fd: ptyTtyFd, request: "tty.getWindowSize" }, ptyContext);
assert(result.ok && result.value.columns === 100 && result.value.rows === 30, `pty tty size mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: ptyTtyFd, length: 6 }, ptyContext);
assert(result.ok && result.value.data === "pty in", `pty tty input mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.write", { fd: ptyTtyFd, data: "pty out" }, ptyContext);
assert(result.ok && os.pty.getSession(pty.id).output === "pty out", `pty tty output mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.write", { fd: 1, data: " stream out" }, ptyContext);
assert(result.ok && os.pty.getSession(pty.id).output === "pty out stream out", `pty stdout output mismatch: ${JSON.stringify(result)}`);
os.processes.kill(ptyProcess.pid, "pty-smoke-exit");
assert(!os.descriptors.tables.has(ptyProcess.pid), "pty descriptor table remained after process kill");

const pipeWriter = os.processes.spawn(app, { cwd: "/home/guest" });
const pipeMiddle = os.processes.spawn(app, { cwd: "/home/guest" });
const pipeReader = os.processes.spawn(app, { cwd: "/home/guest" });
const firstPipe = os.descriptors.pipe(pipeWriter);
const middleRead = os.descriptors.attachPipe(pipeMiddle, { pipeId: firstPipe.pipeId, mode: "read" });
const secondPipe = os.descriptors.pipe(pipeMiddle);
const readerRead = os.descriptors.attachPipe(pipeReader, { pipeId: secondPipe.pipeId, mode: "read" });
os.descriptors.write(pipeWriter, { fd: firstPipe.writeFd, data: "cross process" }, context);
const middleReadResult = os.descriptors.read(pipeMiddle, { fd: middleRead.fd, length: 64 }, context);
os.descriptors.write(pipeMiddle, { fd: secondPipe.writeFd, data: `${middleReadResult.data} pipe` }, context);
const readerReadResult = os.descriptors.read(pipeReader, { fd: readerRead.fd, length: 64 }, context);
assert(readerReadResult.data === "cross process pipe", `cross-process pipe chain mismatch: ${JSON.stringify(readerReadResult)}`);
const transferDescriptor = os.descriptors.open(pipeWriter, { path: "input.txt", flags: "r" }, {
  ...context,
  process: pipeWriter,
});
const transferred = os.objects.transferHandle(transferDescriptor.handleId, pipeReader.pid, {
  fromPid: pipeWriter.pid,
  metadata: { purpose: "cross-process-transfer-smoke" },
});
assert(transferred.source.status === "revoked" && transferred.source.revocationReason === "handle-transfer", "transferred source handle was not revoked");
assert(transferred.target.ownerPid === pipeReader.pid && transferred.target.duplicatedFrom === transferDescriptor.handleId, "transferred target handle owner mismatch");
assert(JSON.parse(os.fs.readFile(`/proc/${pipeReader.pid}/handles.json`)).some((entry) => entry.id === transferred.target.id && entry.status === "active"), "transferred handle missing from target procfs handle table");
result = wrap(() => os.descriptors.read(pipeWriter, { fd: transferDescriptor.fd, length: 1 }, context));
assert(!result.ok && result.error.code === "ESTALE", `transferred source handle remained usable: ${JSON.stringify(result)}`);
os.processes.kill(pipeWriter.pid, "pipe-writer-exit");
os.processes.kill(pipeMiddle.pid, "pipe-middle-exit");
os.processes.kill(pipeReader.pid, "pipe-reader-exit");
assert(!os.descriptors.pipes.has(firstPipe.pipeId) && !os.descriptors.pipes.has(secondPipe.pipeId), "cross-process pipe registry retained closed pipes");

result = os.syscall("fd.open", { path: "/root/secret.txt", flags: "r" }, context);
assert(!result.ok && result.error.code === "EACCES", `fd.open denied path did not return EACCES: ${JSON.stringify(result)}`);

const pid = process.pid;
os.processes.kill(pid, "smoke-exit");
assert(!os.descriptors.tables.has(pid), "descriptor table remained after process kill");
assert(os.objects.get(outputObjectId)?.status === "revoked", "process exit did not revoke open descriptor object");
assert(os.objects.get(outputObjectId)?.revocationReason === "smoke-exit", "process exit descriptor revocation reason mismatch");
assert(os.objects.getHandle(outputHandleId)?.status === "revoked", "process exit did not revoke open descriptor handle");
assert(os.objects.getHandle(outputHandleId)?.revocationReason === "smoke-exit", "process exit descriptor handle revocation reason mismatch");

const crashProcess = os.processes.spawn(app, { cwd: "/home/guest" });
const crashContext = {
  ...context,
  process: crashProcess,
};
result = os.syscall("fd.open", { path: "input.txt", flags: "r" }, crashContext);
assert(result.ok && result.value.fd === 3, `crash fd.open mismatch: ${JSON.stringify(result)}`);
const crashObjectId = result.value.objectId;
const crashHandleId = result.value.handleId;
assert(os.descriptors.tables.has(crashProcess.pid), "descriptor table missing before crash");
os.processes.crash(crashProcess.pid, new Error("fd crash smoke"));
assert(!os.descriptors.tables.has(crashProcess.pid), "descriptor table remained after process crash");
assert(os.objects.get(crashObjectId)?.status === "revoked", "process crash did not revoke open descriptor object");
assert(os.objects.get(crashObjectId)?.revocationReason === "process-crash", "process crash descriptor revocation reason mismatch");
assert(os.objects.getHandle(crashHandleId)?.status === "revoked", "process crash did not revoke open descriptor handle");
assert(os.objects.getHandle(crashHandleId)?.revocationReason === "process-crash", "process crash descriptor handle revocation reason mismatch");
assert(os.fs.exists(`/var/log/dindbos/crash-${crashProcess.pid}.log`), "descriptor crash smoke did not write crash report");
assert(!os.fs.exists(`/proc/${crashProcess.pid}/fd.json`), "crashed process fd procfs remained after cleanup");

console.log("descriptors smoke ok open read write seek close devices clipboard tty pty pipes ioctl crash-cleanup");

function memoryStorage() {
  let flushes = 0;
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {
      flushes += 1;
      return { flushed: true };
    },
    get flushes() {
      return flushes;
    },
    status: () => ({ backend: "memory", bytes: 0 }),
    estimate: async () => ({ backend: "memory", bytes: 0 }),
    resetFileSystem() {},
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wrap(run) {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error: { code: error.code || "ERROR", message: error.message } };
  }
}
