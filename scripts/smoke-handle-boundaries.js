#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";

const os = new DindbOS({
  root: {},
  storage: memoryStorage(),
  timers: { maxDelayMs: 1000 },
  trustedPrompts: { timeoutMs: 1000 },
});
const app = {
  id: "handle-boundary-smoke",
  name: "Handle Boundary Smoke",
  manifest: {
    capabilities: ["process.read"],
    fileSystem: { read: ["/home/guest"], write: ["/home/guest"] },
  },
};
const owner = os.processes.spawn(app, { cwd: "/home/guest" });
const peer = os.processes.spawn({ ...app, id: "handle-boundary-peer" }, { cwd: "/home/guest" });
const principal = os.permissions.principal(os.session);
const system = os.permissions.systemPrincipal();
const ownerContext = { process: owner, principal };
const peerContext = { process: peer, principal };

let error = capture(() => os.objects.assertHandle("kh-missing", { rights: ["inspect"] }));
assert(error?.code === "EBADF", `unknown handle did not return EBADF: ${error?.code}`);

let result = os.syscall("timer.create", { delayMs: 100 }, ownerContext);
assert(result.ok, `timer.create for handle boundary mismatch: ${JSON.stringify(result)}`);
const timer = result.value;
error = capture(() => os.objects.assertHandle(timer.handleId, { objectType: "socket", rights: ["inspect"] }));
assert(error?.code === "EINVAL", `wrong object type did not return EINVAL: ${error?.code}`);
error = capture(() => os.objects.assertHandle(timer.handleId, { ownerPid: peer.pid, objectType: "timer", rights: ["cancel"] }));
assert(error?.code === "EACCES", `cross-process handle ownership did not return EACCES: ${error?.code}`);
result = os.syscall("timer.cancel", { id: timer.id }, peerContext);
assert(!result.ok && result.error.code === "EACCES", `peer canceled another process timer: ${JSON.stringify(result)}`);
os.timers.cancel(timer.id, null, { reason: "handle-boundary-cleanup", force: true });
result = os.syscall("timer.cancel", { id: timer.id }, ownerContext);
assert(!result.ok && result.error.code === "ESTALE", `double timer cancel did not report stale handle: ${JSON.stringify(result)}`);

result = os.syscall("trustedPrompt.create", {
  capability: "keychain.export",
  target: "secret:boundary",
  timeoutMs: 1000,
}, ownerContext);
assert(result.ok, `trustedPrompt.create boundary mismatch: ${JSON.stringify(result)}`);
const prompt = result.value;
os.objects.revokeHandle(prompt.handleId, "handle-boundary-stale");
result = os.syscall("trustedPrompt.decide", { id: prompt.id, decision: "granted" }, { ...ownerContext, principal: system });
assert(!result.ok && result.error.code === "ESTALE", `stale trusted prompt handle was accepted: ${JSON.stringify(result)}`);
os.trustedPrompts.expire(prompt.id, "handle-boundary-cleanup");

const tx = os.storageTransactions.begin("boundary-smoke");
os.objects.revokeHandle(tx.handleId, "handle-boundary-stale");
error = capture(() => os.storageTransactions.commit(tx.id));
assert(error?.code === "ESTALE", `stale storage transaction handle did not return ESTALE: ${error?.code}`);

os.processes.kill(owner.pid, "handle-boundary-owner-exit");
os.processes.kill(peer.pid, "handle-boundary-peer-exit");
console.log("handle boundaries smoke ok unknown wrong-type cross-process stale double-close");

function capture(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

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
