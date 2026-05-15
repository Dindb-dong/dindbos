#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";

const os = new DindbOS({ root: {}, storage: memoryStorage() });
const app = {
  id: "jobctl-smoke",
  name: "Job Control Smoke",
  manifest: {
    capabilities: ["process.execute", "process.read", "process.manage"],
    fileSystem: { read: ["/home/guest"], write: ["/home/guest"] },
  },
};
const controller = os.processes.spawn(app, { cwd: "/home/guest", image: { kind: "shell", command: "jobctl" } });
const context = {
  process: controller,
  principal: os.permissions.principal(os.session),
  assertCapability(capability) {
    if (!controller.manifest.capabilities.includes(capability)) throw new Error(`capability denied: ${capability}`);
  },
};

let result = os.syscall("process.spawn", {
  appId: "worker:long-task",
  command: "long-task --watch",
  runtime: "worker-job",
  argv: ["--watch"],
  foreground: false,
}, context);
assert(result.ok, `process.spawn failed: ${JSON.stringify(result)}`);
const worker = result.value;
assert(worker.image.kind === "worker-job" && worker.image.command === "long-task --watch", "process image metadata missing");
assert(worker.jobId && worker.processGroupId === controller.processGroupId && worker.foreground === false, "process job metadata mismatch");
assert(os.fs.readFile(`/proc/${worker.pid}/status`).includes("ImageKind:\tworker-job"), "process status missing image kind");
assert(JSON.parse(os.fs.readFile("/proc/processes.json")).some((entry) => entry.pid === worker.pid && entry.image.command === "long-task --watch"), "/proc/processes.json missing process image");
assert(JSON.parse(os.fs.readFile("/proc/jobs.json")).jobs.some((job) => job.pids.includes(worker.pid) && job.foreground === false), "/proc/jobs.json missing background job");

result = os.syscall("process.signal", { pid: worker.pid, signal: "SIGSTOP" }, context);
assert(result.ok && result.value.process.state === "stopped", `SIGSTOP mismatch: ${JSON.stringify(result)}`);
assert(result.value.delivery.targets.includes("executor") && result.value.delivery.signal === "SIGSTOP", `worker signal delivery mismatch: ${JSON.stringify(result.value.delivery)}`);
const workerSignals = JSON.parse(os.fs.readFile(`/proc/${worker.pid}/signals.json`));
assert(workerSignals.signalDeliveries.some((entry) => entry.signal === "SIGSTOP" && entry.targets.includes("executor")), "worker signal procfs missing executor delivery");
result = os.syscall("process.jobs", {}, context);
assert(result.ok && result.value.some((job) => job.state === "stopped" && job.pids.includes(worker.pid)), `process.jobs mismatch: ${JSON.stringify(result)}`);
assert(os.processes.foreground(worker.pid).foreground === true, "foreground did not mark process foreground");
assert(os.processes.background(worker.pid).foreground === false, "background did not mark process background");

result = os.syscall("process.signal", { pid: worker.pid, signal: "SIGTERM" }, context);
assert(result.ok && result.value.process.state === "signal-sigterm", `SIGTERM mismatch: ${JSON.stringify(result)}`);
result = os.syscall("process.wait", { pid: worker.pid }, context);
assert(result.ok && result.value.running === false && result.value.status === 0, `process.wait mismatch: ${JSON.stringify(result)}`);

result = os.syscall("process.exec", { appId: "cli:echo", command: "echo done", runtime: "shell-command" }, context);
assert(result.ok && result.value.status === 0 && result.value.process.image.command === "echo done", `process.exec mismatch: ${JSON.stringify(result)}`);

const pty = os.pty.createSession({ name: "jobctl pty", input: "pty-data", columns: 90, rows: 28 });
const ptyProcess = os.processes.spawn(app, { cwd: "/home/guest", ptySessionId: pty.id });
const ptyContext = { ...context, process: ptyProcess };
assert(os.pty.getSession(pty.id).ownerPid === ptyProcess.pid, "PTY session did not attach owner pid on process spawn");
const deniedPtyProcess = os.processes.spawn(app, { cwd: "/home/guest" });
result = os.syscall("fd.open", { path: `/dev/pts/${pty.id}`, flags: "r+" }, { ...context, process: deniedPtyProcess });
assert(!result.ok && result.error.code === "EACCES", `foreign process opened protected PTY: ${JSON.stringify(result)}`);
const ptyGroupPeer = os.processes.spawn(app, {
  cwd: "/home/guest",
  ptySessionId: pty.id,
  processGroupId: ptyProcess.processGroupId,
});
result = os.syscall("fd.open", { path: `/dev/pts/${pty.id}`, flags: "r+" }, { ...context, process: ptyGroupPeer });
assert(result.ok, `foreground process group peer could not open PTY: ${JSON.stringify(result)}`);
result = os.syscall("fd.open", { path: `/dev/pts/${pty.id}`, flags: "r+" }, ptyContext);
assert(result.ok, `fd.open /dev/pts mismatch: ${JSON.stringify(result)}`);
const ptsFd = result.value.fd;
assert(result.value.tty.ownerPid === ptyProcess.pid && result.value.tty.deviceMode === "0600", `PTY descriptor ownership metadata mismatch: ${JSON.stringify(result.value.tty)}`);
result = os.syscall("fd.read", { fd: ptsFd, length: 8 }, ptyContext);
assert(result.ok && result.value.data === "pty-data", `fd.read /dev/pts mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.write", { fd: ptsFd, data: " pts-out" }, ptyContext);
assert(result.ok && os.pty.getSession(pty.id).output === " pts-out", `fd.write /dev/pts mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.ioctl", { fd: ptsFd, request: "tty.getMode" }, ptyContext);
assert(result.ok && result.value.mode.canonical && result.value.mode.echo, `tty mode default mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.ioctl", { fd: ptsFd, request: "tty.setMode", mode: { raw: true, echo: false, canonical: false } }, ptyContext);
assert(result.ok && result.value.mode.raw && !result.value.mode.echo && !result.value.mode.canonical, `tty raw mode mismatch: ${JSON.stringify(result)}`);
result = os.syscall("fd.ioctl", { fd: ptsFd, request: "tty.setWindowSize", columns: 120, rows: 32 }, ptyContext);
assert(result.ok && os.pty.getSession(pty.id).columns === 120 && os.pty.getSession(pty.id).rows === 32, `tty resize mismatch: ${JSON.stringify(result)}`);
result = os.syscall("process.signal", { pid: ptyProcess.pid, signal: "SIGTSTP" }, ptyContext);
assert(result.ok && result.value.delivery.targets.includes("pty"), `PTY signal delivery mismatch: ${JSON.stringify(result)}`);
os.processes.syncProcfs();
const ptyProc = JSON.parse(os.fs.readFile(`/proc/${ptyProcess.pid}/pty.json`));
assert(ptyProc.session.events.some((entry) => entry.type === "resize" && entry.columns === 120), "PTY procfs missing resize event");
assert(ptyProc.session.events.some((entry) => entry.type === "mode" && entry.mode.raw), "PTY procfs missing mode event");
assert(ptyProc.session.terminalMode.raw && ptyProc.session.ownerPid === ptyProcess.pid, "PTY procfs missing ownership or terminal mode metadata");
assert(ptyProc.events.some((entry) => entry.type === "signal" && entry.signal === "SIGTSTP"), "PTY procfs missing signal event");

console.log("process job control smoke ok images jobs wait signal pts ownership mode delivery");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function memoryStorage() {
  let value = null;
  return {
    async loadFileSystem() { return value; },
    saveFileSystem(next) { value = next; },
    async flush() { return { flushed: true }; },
    status() { return { enabled: true, writePending: false }; },
    resetFileSystem() { value = null; },
  };
}
