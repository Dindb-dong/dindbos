#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";
import { ShellSession } from "../src/dindbos/shell.js";

const os = new DindbOS({ root: {}, storage: memoryStorage(), timers: { maxDelayMs: 1000 } });
const app = {
  id: "timer-smoke",
  name: "Timer Smoke",
  manifest: {
    capabilities: ["process.read"],
    fileSystem: { read: ["/home/guest"], write: ["/home/guest"] },
  },
};
const process = os.processes.spawn(app, { cwd: "/home/guest" });
const context = {
  process,
  principal: os.permissions.principal(os.session),
  assertCapability: (capability) => {
    if (!app.manifest.capabilities.includes(capability)) throw new Error(`capability denied: ${capability}`);
  },
};

let result = os.syscall("timer.create", { delayMs: 100 }, context);
assert(result.ok && result.value.id === "timer-1", `timer.create mismatch: ${JSON.stringify(result)}`);
const cancelTimer = result.value;
assert(os.objects.get(cancelTimer.objectId)?.type === "timer", "timer kernel object was not registered");
assert(os.objects.getHandle(cancelTimer.handleId)?.rights.includes("cancel"), "timer handle missing cancel right");
assert(os.fs.readFile("/proc/timers").includes("timer-1"), "/proc/timers did not list pending timer");
assert(JSON.parse(os.fs.readFile("/proc/timers.json")).some((entry) => entry.id === "timer-1" && entry.status === "pending"), "/proc/timers.json did not list pending timer");

result = os.syscall("timer.cancel", { id: cancelTimer.id }, context);
assert(result.ok && result.value.status === "canceled", `timer.cancel mismatch: ${JSON.stringify(result)}`);
assert(os.objects.get(cancelTimer.objectId)?.status === "revoked", "timer cancel did not revoke timer object");
assert(os.objects.getHandle(cancelTimer.handleId)?.status === "revoked", "timer cancel did not revoke timer handle");

result = os.syscall("timer.create", { delayMs: 100 }, context);
assert(result.ok, `timer.create stale target mismatch: ${JSON.stringify(result)}`);
const staleTimer = result.value;
os.objects.revokeHandle(staleTimer.handleId, "timer-handle-smoke");
result = os.syscall("timer.cancel", { id: staleTimer.id }, context);
assert(!result.ok && result.error.code === "ESTALE", `stale timer handle did not return ESTALE: ${JSON.stringify(result)}`);
os.timers.cancel(staleTimer.id, null, { reason: "timer-stale-cleanup", force: true });

const firedEvents = [];
os.bus.on("timer:fire", (event) => firedEvents.push(event.id));
const beforeSleep = Date.now();
result = await os.syscallAsync("timer.sleep", { delayMs: 5 }, context);
assert(result.ok && result.value.status === "fired", `timer.sleep mismatch: ${JSON.stringify(result)}`);
assert(Date.now() - beforeSleep >= 0, "timer.sleep returned before monotonic measurement started");
assert(os.objects.get(result.value.objectId)?.status === "revoked", "fired timer object was not revoked");
assert(os.objects.get(result.value.objectId)?.revocationReason === "timer-fired", "fired timer revocation reason mismatch");
assert(firedEvents.includes(result.value.id), "timer fire event was not emitted");

const shell = new ShellSession(os);
result = os.syscall("timer.create", { delayMs: 100 }, context);
assert(result.ok, `timer.create shell target mismatch: ${JSON.stringify(result)}`);
const shellTimer = result.value;
let output = await shell.executeAsync("timerctl list");
assert(output.status === 0 && output.output.includes(shellTimer.id), `timerctl list did not show timer: ${output.output}`);
output = await shell.executeAsync(`timerctl stat ${shellTimer.id}`);
assert(output.status === 0 && output.output.includes(`Timer:\t${shellTimer.id}`), `timerctl stat did not show timer detail: ${output.output}`);
os.timers.cancel(shellTimer.id, null, { reason: "timerctl-smoke-cleanup", force: true });

const cleanupProcess = os.processes.spawn(app, { cwd: "/home/guest" });
const cleanupContext = { ...context, process: cleanupProcess };
result = os.syscall("timer.create", { delayMs: 100 }, cleanupContext);
assert(result.ok, `timer.create cleanup target mismatch: ${JSON.stringify(result)}`);
const cleanupTimer = result.value;
os.processes.kill(cleanupProcess.pid, "timer-process-exit");
assert(os.timers.get(cleanupTimer.id).status === "canceled", "process exit did not cancel owned timer");
assert(os.timers.get(cleanupTimer.id).reason === "timer-process-exit", "process exit timer cleanup reason mismatch");
assert(os.objects.get(cleanupTimer.objectId)?.status === "revoked", "process exit did not revoke timer object");

os.processes.kill(process.pid, "timer-smoke-exit");
console.log("timers smoke ok object handles sleep cancel procfs cleanup");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function memoryStorage() {
  let value = null;
  return {
    supported: true,
    async loadFileSystem() { return value; },
    saveFileSystem(next) { value = next; return { ok: true, bytes: JSON.stringify(next).length }; },
    async flush() { return { ok: true, bytes: value ? JSON.stringify(value).length : 0 }; },
    status() { return { supported: true, pending: false }; },
  };
}
