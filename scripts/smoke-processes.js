#!/usr/bin/env node
import { EventBus } from "../src/dindbos/event-bus.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { ProcessExecutor } from "../src/dindbos/process-executor.js";
import { ProcessManager } from "../src/dindbos/process-manager.js";
import { SyscallDispatcher } from "../src/dindbos/syscalls.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";
import { filterAndSortActivityProcesses, renderActivityDetail } from "../src/dindbos/apps/builtins.js";

const os = bootOs();
const launched = [];
let closedWindow = null;
const lifecycleEvents = [];
["launch", "ready", "focus", "suspend", "resume", "crash", "close"].forEach((type) => {
  os.bus.on(`app:${type}`, (event) => lifecycleEvents.push(`${type}:${event.appId}:${event.reason || event.error || ""}`));
});

os.launch = (appId) => {
  launched.push(appId);
  return { appId };
};

os.windows = {
  has: (windowId) => windowId === "window-activity",
  close: (windowId, options = {}) => {
    closedWindow = { windowId, options };
  },
};

const app = { id: "activity-monitor", name: "Activity Monitor", manifest: { capabilities: ["process.read"] } };
const process = os.processes.spawn(app, { source: "smoke" });
os.processes.attachWindow(process.pid, "window-activity");
os.processes.markReady(process.pid);
os.processes.updateWindowState(process.pid, "focused", { windowId: "window-activity" });
os.processes.updateWindowState(process.pid, "minimized", { windowId: "window-activity" });
os.processes.updateWindowState(process.pid, "restored", { windowId: "window-activity" });

assert(os.processes.current()?.pid === process.pid, "current process did not return first running process");
assert(Number(os.processes.get(process.pid)?.runtimeBytes) > 0, "runtime byte estimate was not populated");
assert(Number(os.processes.get(process.pid)?.activityScore) > 0, "activity score was not populated");
assert(Number(os.processes.get(process.pid)?.activitySamples) >= 3, "activity sample count was not populated");
assert(os.fs.exists(`/proc/${process.pid}/status`), "/proc status was not written");
assert(os.fs.readFile(`/proc/${process.pid}/status`).includes("Activity Monitor"), "/proc status missing process name");
assert(os.fs.readFile(`/proc/${process.pid}/status`).includes("RuntimeBytes:"), "/proc status missing runtime byte estimate");
assert(os.fs.readFile(`/proc/${process.pid}/status`).includes("ActivityScore:"), "/proc status missing activity score");
assert(os.fs.readFile(`/proc/${process.pid}/status`).includes("ExecutionBackend:\tmain-thread"), "/proc status missing main-thread backend");
assert(JSON.parse(os.fs.readFile("/proc/processes.json")).some((entry) => entry.pid === process.pid && entry.activityScore > 0), "/proc processes JSON missing activity score");
assert(os.processes.log(process.pid).includes("ready"), "log read did not include ready entry");
assert(lifecycleEvents.includes("launch:activity-monitor:"), "app:launch lifecycle event missing");
assert(lifecycleEvents.includes("ready:activity-monitor:"), "app:ready lifecycle event missing");
assert(lifecycleEvents.includes("focus:activity-monitor:"), "app:focus lifecycle event missing");
assert(lifecycleEvents.includes("suspend:activity-monitor:"), "app:suspend lifecycle event missing");
assert(lifecycleEvents.includes("resume:activity-monitor:"), "app:resume lifecycle event missing");

const previousActivity = os.processes.get(process.pid).activityScore;
os.processes.sampleActivity(process.pid, "smoke-click", 3);
assert(os.processes.get(process.pid).activityScore > previousActivity, "manual activity sample did not raise activity score");

const childApp = { id: "child-viewer", name: "Child Viewer", manifest: { capabilities: [] } };
const child = os.processes.spawn(childApp, { parentPid: process.pid, source: "child-smoke" });
assert(os.processes.get(child.pid).parentPid === process.pid, "child process parent pid mismatch");
assert(os.processes.get(child.pid).parentAppId === process.appId, "child process parent app mismatch");
assert(os.processes.get(process.pid).childPids.includes(child.pid), "parent process missing child pid");
assert(os.fs.readFile(`/proc/${child.pid}/status`).includes(`ParentPid:\t${process.pid}`), "child /proc status missing parent pid");
assert(JSON.parse(os.fs.readFile("/proc/processes.json")).some((entry) => entry.pid === child.pid && entry.parentPid === process.pid), "/proc processes JSON missing parent pid");

const beforeLog = os.processes.readLog(process.pid);
os.processes.log(process.pid);
assert(os.processes.readLog(process.pid) === beforeLog, "log read unexpectedly mutated process log");

const crashApp = { id: "crashy", name: "Crashy", manifest: { capabilities: [] } };
const crashed = os.processes.spawn(crashApp, { source: "crash-smoke" });
os.processes.attachWindow(crashed.pid, "window-crashy");
os.processes.crash(crashed.pid, new Error("boom smoke"));
const crashReportPath = `/var/log/dindbos/crash-${crashed.pid}.log`;
assert(os.fs.exists(crashReportPath), "crash report file was not written");
assert(os.fs.readFile(crashReportPath).includes("boom smoke"), "crash report missing error message");
assert(os.fs.readFile("/var/log/dindbos/crashes.log").includes(`pid=${crashed.pid}`), "crash index missing crashed pid");
assert(lifecycleEvents.includes("crash:crashy:boom smoke"), "app:crash lifecycle event missing");

const restartTarget = os.processes.get(process.pid);
const relaunched = os.processes.restart(process.pid);

assert(!os.processes.get(process.pid), "killed process still exists");
assert(!os.fs.exists(`/proc/${process.pid}`), "killed process /proc directory still exists");
assert(closedWindow?.windowId === "window-activity", "kill did not close attached window");
assert(closedWindow?.options?.skipOnClose === true, "kill did not close window with skipOnClose");
assert(launched[0] === "activity-monitor", "restart did not relaunch original app");
assert(relaunched.appId === restartTarget.appId, "restart returned wrong app launch");
assert(lifecycleEvents.includes("close:activity-monitor:restarting"), "app:close lifecycle event missing");

const filtered = filterAndSortActivityProcesses([
  { pid: 301, appId: "browser", name: "Browser", state: "running", windowState: "focused", uptimeMs: 5000, runtimeBytes: 400 },
  { pid: 102, appId: "files", name: "Files", state: "sleeping", windowState: "minimized", uptimeMs: 9000, runtimeBytes: 120 },
  { pid: 240, appId: "terminal", name: "Terminal", state: "running", windowState: "ready", uptimeMs: 2000, runtimeBytes: 800 },
], { query: "term", state: "running", sort: "uptime", direction: "desc" });
assert(filtered.length === 1 && filtered[0].appId === "terminal", "activity filter did not match app/state");

const sorted = filterAndSortActivityProcesses([
  { pid: 1, appId: "b", state: "running", uptimeMs: 100, runtimeBytes: 1 },
  { pid: 2, appId: "a", state: "running", uptimeMs: 300, runtimeBytes: 1 },
], { sort: "uptime", direction: "desc" });
assert(sorted.map((item) => item.pid).join(",") === "2,1", "activity uptime sort mismatch");

const activitySorted = filterAndSortActivityProcesses([
  { pid: 1, appId: "quiet", state: "running", activityScore: 0.5 },
  { pid: 2, appId: "busy", state: "running", activityScore: 8 },
], { sort: "activity", direction: "desc" });
assert(activitySorted.map((item) => item.pid).join(",") === "2,1", "activity score sort mismatch");

const serviceDetail = renderActivityDetail(
  { pid: 450, appId: "service:search-indexer", name: "Search Indexer", state: "running", user: "guest", startedAt: new Date().toISOString() },
  "process ready",
  { id: "search-indexer", name: "Search Indexer", state: "running", runCount: 2, lastRunAt: new Date().toISOString() },
  [{ at: "2026-05-05T00:00:00.000Z", level: "info", message: "indexed" }],
  {
    id: "search-indexer",
    name: "Search Indexer",
    schedule: { everyMs: 60000 },
    capabilities: ["storage.read"],
    fileSystem: { read: ["/home/guest"], write: ["/var/lib/dindbos/search"] },
  },
);
assert(serviceDetail.includes("Service ID"), "activity service detail did not render service metadata");
assert(serviceDetail.includes("data-service-action=\"restart\""), "activity service detail did not expose restart action");
assert(serviceDetail.includes("data-service-action=\"disable\""), "activity service detail did not expose disable action");
assert(serviceDetail.includes("Permission Review"), "activity service detail did not render service permission review");
assert(serviceDetail.includes("storage.read"), "activity service detail did not render service capabilities");
assert(serviceDetail.includes("/var/lib/dindbos/search"), "activity service detail did not render service write scope");
assert(serviceDetail.includes("every 60000ms"), "activity service detail did not render service schedule");
assert(serviceDetail.includes("indexed"), "activity service detail did not render service log");

const workerStartedAt = Date.now();
const workerRun = os.executor.runCpuTask({ appId: "worker:busy", name: "Busy Worker", durationMs: 150 });
await delay(20);
const workerProcess = os.processes.list().find((entry) => entry.appId === "worker:busy");
assert(workerProcess?.executionBackend === "worker", "worker task did not use worker backend");
assert(workerProcess?.executorState === "running", "worker task did not report running executor state");
assert(Date.now() - workerStartedAt < 100, "worker task blocked the main smoke thread before shell-equivalent work");
const responsive = os.processes.spawn({ id: "responsive-shell", name: "Responsive Shell", manifest: { capabilities: [] } }, { runtime: "shell" });
assert(os.processes.get(responsive.pid)?.appId === "responsive-shell", "main runtime could not spawn while worker was busy");
assert(os.fs.readFile(`/proc/${workerProcess.pid}/status`).includes("ExecutionBackend:\tworker"), "worker /proc status missing backend");
assert(JSON.parse(os.fs.readFile("/proc/processes.json")).some((entry) => entry.pid === workerProcess.pid && entry.executionBackend === "worker"), "/proc processes JSON missing worker backend");
const workerResult = await workerRun;
assert(workerResult.status === 0 && workerResult.backend === "worker", "worker task did not finish successfully");
assert(!os.processes.get(workerResult.pid), "worker process remained after completion");
os.processes.kill(responsive.pid, "responsive-smoke-exit");

let timeoutError = null;
try {
  await os.executor.runCpuTask({ appId: "worker:timeout", name: "Timeout Worker", durationMs: 200, timeoutMs: 20 });
} catch (error) {
  timeoutError = error;
}
assert(timeoutError?.code === "ETIMEOUT", "worker timeout did not reject with ETIMEOUT");
const timedOut = os.processes.list().find((entry) => entry.appId === "worker:timeout");
assert(timedOut?.state === "crashed", "worker timeout did not mark process crashed");
assert(os.fs.exists(`/var/log/dindbos/crash-${timedOut.pid}.log`), "worker timeout did not write crash report");

const killRun = os.executor.runCpuTask({ appId: "worker:kill", name: "Kill Worker", durationMs: 500 });
await delay(20);
const killTarget = os.processes.list().find((entry) => entry.appId === "worker:kill");
assert(killTarget?.executionBackend === "worker", "kill worker task did not start");
os.processes.kill(killTarget.pid, "worker-smoke-kill");
const killResult = await killRun.then(
  () => null,
  (error) => error,
);
assert(killResult?.code === "ETERMINATED", "worker kill did not terminate worker execution");
assert(!os.processes.get(killTarget.pid), "worker kill left process running");

const syscallTask = await os.executor.runSyscallTask({
  appId: "worker:syscall",
  name: "Worker Syscall",
  fileSystem: {
    read: ["/home/guest"],
    write: ["/home/guest"],
  },
  operations: [
    { type: "stdout", data: "bridge:" },
    { type: "syscall", name: "fs.writeText", args: { path: "worker-bridge.txt", content: "from worker bridge" } },
    { type: "syscall", name: "fs.readText", args: { path: "worker-bridge.txt" }, stdoutValue: true },
    { type: "syscall", name: "entropy.randomBytes", args: { length: 6 }, binaryResult: true },
    { type: "syscall", name: "fs.writeText", args: { path: "/root/worker-denied.txt", content: "no" }, expectErrorCode: "EACCES", stderrErrorCode: true },
  ],
});
assert(syscallTask.backend === "worker" && syscallTask.status === 0, "worker syscall task did not complete through worker backend");
assert(syscallTask.stdout === "bridge:from worker bridge", `worker syscall stdout mismatch: ${JSON.stringify(syscallTask.stdout)}`);
assert(syscallTask.stderr === "EACCES", `worker syscall stderr mismatch: ${JSON.stringify(syscallTask.stderr)}`);
assert(syscallTask.binaryBytes === 6, "worker syscall binary transfer byte count mismatch");
assert(os.fs.readFile("/home/guest/worker-bridge.txt") === "from worker bridge", "worker syscall bridge did not write VFS content");
assert(!os.fs.exists("/root/worker-denied.txt"), "worker syscall denial mutated root path");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("fs.writeText OK"), "worker syscall bridge did not write success trace");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("fs.writeText EACCES"), "worker syscall bridge did not write denied trace");

console.log(`process smoke ok pid=${process.pid} relaunched=${launched[0]}`);

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const system = permissions.systemPrincipal();
  fs.createDirectory("/home", "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users", permissions: "drwxr-xr-x" }, system);
  const os = {
    fs,
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    bus: new EventBus(),
    windows: null,
  };
  os.processes = new ProcessManager(os);
  os.syscalls = new SyscallDispatcher(os);
  os.syscall = (name, args = {}, context = {}) => {
    const principal = context.principal || os.permissions.principal({ user: os.session.user, groups: os.session.groups });
    return os.syscalls.call(name, args, { ...context, principal });
  };
  os.executor = new ProcessExecutor(os);
  return os;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
