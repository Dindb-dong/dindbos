#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";

const os = new DindbOS({
  root: {},
  storage: memoryStorage(),
  trustedPrompts: { timeoutMs: 1000 },
});
const app = {
  id: "trusted-ui-smoke",
  name: "Trusted UI Smoke",
  manifest: {
    capabilities: ["process.read"],
    fileSystem: { read: ["/home/guest"], write: ["/home/guest"] },
  },
};
const process = os.processes.spawn(app, { cwd: "/home/guest" });
const guest = os.permissions.principal(os.session);
const system = os.permissions.systemPrincipal();
const context = { process, principal: guest };

let result = os.syscall("trustedPrompt.create", {
  capability: "keychain.export",
  target: "secret:deploy-token",
  message: "Export deploy token",
  timeoutMs: 1000,
}, context);
assert(result.ok, `trustedPrompt.create mismatch: ${JSON.stringify(result)}`);
const prompt = result.value;
assert(prompt.objectId && prompt.handleId && prompt.requesterHandleId, "trusted prompt did not expose object/control/requester handles");
assert(prompt.compositorSurfaceId && prompt.compositorOwned && prompt.captureProtected, "trusted prompt did not expose compositor-owned capture-protected surface");
assert(os.objects.get(prompt.objectId)?.type === "trusted-prompt", "trusted prompt kernel object type mismatch");
assert(os.objects.getHandle(prompt.requesterHandleId)?.ownerPid === process.pid, "trusted prompt requester handle owner mismatch");
assert(os.objects.getHandle(prompt.handleId)?.ownerPid === 0, "trusted prompt control handle owner mismatch");
const compositorPrompt = os.windows.compositorStatus().trustedSurfaces.find((surface) => surface.promptId === prompt.id);
assert(compositorPrompt?.compositorOwned && compositorPrompt?.captureProtected, "compositor did not own trusted prompt surface");
assert(os.fs.readFile("/proc/trusted-ui").includes(prompt.id), "/proc/trusted-ui did not list prompt");
assert(os.fs.readFile("/var/log/dindbos/trusted-ui.log").includes(`prompt=${prompt.id} action=created`), "trusted prompt creation audit missing");

result = os.syscall("trustedPrompt.decide", { id: prompt.id, decision: "granted" }, context);
assert(!result.ok && result.error.code === "EACCES", `non-admin trusted prompt decision was not denied: ${JSON.stringify(result)}`);
result = os.syscall("trustedPrompt.decide", { id: prompt.id, decision: "granted" }, { ...context, principal: system });
assert(result.ok && result.value.status === "granted", `admin trusted prompt grant mismatch: ${JSON.stringify(result)}`);
assert(os.objects.get(prompt.objectId)?.status === "revoked", "trusted prompt decision did not revoke object");
assert(os.objects.get(prompt.objectId)?.revocationReason === "trusted-prompt-granted", "trusted prompt grant revocation reason mismatch");
assert(os.objects.getHandle(prompt.handleId)?.status === "revoked", "trusted prompt decision did not revoke control handle");
assert(!os.windows.compositorStatus().trustedSurfaces.some((surface) => surface.promptId === prompt.id), "trusted prompt surface survived decision cleanup");
assert(os.fs.readFile("/var/log/dindbos/trusted-ui.log").includes(`prompt=${prompt.id} action=granted`), "trusted prompt grant audit missing");

result = os.syscall("trustedPrompt.create", {
  capability: "screen.capture",
  target: "window:demo",
  timeoutMs: 5,
}, context);
assert(result.ok, `trustedPrompt.create timeout target mismatch: ${JSON.stringify(result)}`);
const timeoutPrompt = result.value;
await wait(20);
assert(os.trustedPrompts.get(timeoutPrompt.id).status === "expired", "trusted prompt did not expire");
assert(os.objects.get(timeoutPrompt.objectId)?.status === "revoked", "expired trusted prompt object was not revoked");
assert(os.objects.get(timeoutPrompt.objectId)?.revocationReason === "trusted-prompt-timeout", "expired trusted prompt revoke reason mismatch");

const cleanupProcess = os.processes.spawn(app, { cwd: "/home/guest" });
result = os.syscall("trustedPrompt.create", {
  capability: "device.usb",
  target: "usb:lab",
  timeoutMs: 1000,
}, { process: cleanupProcess, principal: guest });
assert(result.ok, `trustedPrompt.create cleanup target mismatch: ${JSON.stringify(result)}`);
const cleanupPrompt = result.value;
os.processes.kill(cleanupProcess.pid, "trusted-ui-process-exit");
assert(os.trustedPrompts.get(cleanupPrompt.id).status === "expired", "process exit did not expire owned trusted prompt");
assert(os.trustedPrompts.get(cleanupPrompt.id).reason === "trusted-ui-process-exit", "process exit trusted prompt cleanup reason mismatch");

result = os.syscall("trustedPrompt.status", {}, context);
assert(result.ok && result.value.some((entry) => entry.id === prompt.id), `trustedPrompt.status mismatch: ${JSON.stringify(result)}`);

os.processes.kill(process.pid, "trusted-ui-smoke-exit");
console.log("trusted ui smoke ok prompts handles decisions timeout cleanup audit");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
