#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";

const os = new DindbOS({ root: {}, storage: memoryStorage() });
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
    capabilities: [],
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
assert(os.fs.readFile(`/proc/${process.pid}/fd.json`).includes('"fd": 0'), "procfs fd table was not written");

result = os.syscall("fd.open", { path: "input.txt", flags: "r" }, context);
assert(result.ok && result.value.fd === 3, `fd.open read mismatch: ${JSON.stringify(result)}`);
const inputFd = result.value.fd;
result = os.syscall("fd.read", { fd: inputFd, length: 5 }, context);
assert(result.ok && result.value.data === "hello", `fd.read first chunk mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.seek", { fd: inputFd, offset: 6 }, context);
assert(result.ok && result.value.offset === 6, `fd.seek mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: inputFd, length: 5 }, context);
assert(result.ok && result.value.data === "world", `fd.read second chunk mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.close", { fd: inputFd }, context);
assert(result.ok && result.value.closed, `fd.close mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: inputFd, length: 1 }, context);
assert(!result.ok && result.error.code === "EBADF", `closed fd did not return EBADF: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "output.txt", flags: "w+" }, context);
assert(result.ok, `fd.open write mismatch: ${JSON.stringify(result)}`);
const outputFd = result.value.fd;
result = os.syscall("fd.write", { fd: outputFd, data: "alpha" }, context);
assert(result.ok && result.value.bytes === 5, `fd.write mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.seek", { fd: outputFd, offset: 0 }, context);
assert(result.ok, `fd.seek output mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: outputFd, length: 5 }, context);
assert(result.ok && result.value.data === "alpha", `fd.read output mismatch: ${JSON.stringify(result)}`);
assert(os.fs.readFile("/home/guest/output.txt") === "alpha", "fd.write did not persist file content");

result = os.syscall("fd.open", { path: "/dev/null", flags: "w" }, context);
assert(result.ok, `fd.open /dev/null mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.write", { fd: result.value.fd, data: "discarded" }, context);
assert(result.ok && result.value.bytes === 9, `fd.write /dev/null mismatch: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "/dev/zero", flags: "r" }, context);
assert(result.ok, `fd.open /dev/zero mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: result.value.fd, length: 4 }, context);
assert(result.ok && result.value.data === "\0\0\0\0", `fd.read /dev/zero mismatch: ${JSON.stringify(result)}`);

result = os.syscall("fd.open", { path: "/dev/urandom", flags: "r" }, context);
assert(result.ok, `fd.open /dev/urandom mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.read", { fd: result.value.fd, length: 8 }, context);
assert(result.ok && result.value.data.length === 8, `fd.read /dev/urandom mismatch: ${JSON.stringify(result)}`);

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

result = os.syscall("fd.open", { path: "/root/secret.txt", flags: "r" }, context);
assert(!result.ok && result.error.code === "EACCES", `fd.open denied path did not return EACCES: ${JSON.stringify(result)}`);

const pid = process.pid;
os.processes.kill(pid, "smoke-exit");
assert(!os.descriptors.tables.has(pid), "descriptor table remained after process kill");

const crashProcess = os.processes.spawn(app, { cwd: "/home/guest" });
const crashContext = {
  ...context,
  process: crashProcess,
};
result = os.syscall("fd.open", { path: "input.txt", flags: "r" }, crashContext);
assert(result.ok && result.value.fd === 3, `crash fd.open mismatch: ${JSON.stringify(result)}`);
assert(os.descriptors.tables.has(crashProcess.pid), "descriptor table missing before crash");
os.processes.crash(crashProcess.pid, new Error("fd crash smoke"));
assert(!os.descriptors.tables.has(crashProcess.pid), "descriptor table remained after process crash");
assert(os.fs.exists(`/var/log/dindbos/crash-${crashProcess.pid}.log`), "descriptor crash smoke did not write crash report");
assert(!os.fs.exists(`/proc/${crashProcess.pid}/fd.json`), "crashed process fd procfs remained after cleanup");

console.log("descriptors smoke ok open read write seek close devices tty ioctl crash-cleanup");

function memoryStorage() {
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {},
    status: () => ({ backend: "memory", bytes: 0 }),
    estimate: async () => ({ backend: "memory", bytes: 0 }),
    resetFileSystem() {},
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
