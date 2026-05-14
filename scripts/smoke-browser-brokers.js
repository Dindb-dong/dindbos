#!/usr/bin/env node
import { DindbOS } from "../src/dindbos/index.js";

const restoreGlobals = installBrowserApiShim();
try {
  const os = new DindbOS({ root: {}, storage: memoryStorage() });
  const app = {
    id: "browser-broker-smoke",
    name: "Browser Broker Smoke",
    manifest: {
      capabilities: ["notifications.show", "screen.capture", "webgpu.adapter"],
      fileSystem: { read: ["/home/guest"], write: ["/home/guest"] },
    },
  };
  const process = os.processes.spawn(app, { cwd: "/home/guest" });
  const context = { process, principal: os.permissions.principal(os.session) };

  let result = os.syscall("browser.status", {}, context);
  assert(result.ok, `browser.status failed: ${JSON.stringify(result)}`);
  assert(result.value.capabilities.some((entry) => entry.id === "notifications.show" && entry.available), "browser status missing notifications broker");
  assert(result.value.capabilities.some((entry) => entry.id === "screen.capture" && entry.device === "/dev/browser/screen"), "browser status missing screen capture broker");

  result = os.syscall("browser.request", { capability: "notifications.show", operation: "show" }, context);
  assert(result.ok && result.value.status === "brokered", `notification broker request mismatch: ${JSON.stringify(result)}`);
  result = os.syscall("browser.request", { capability: "screen.capture", operation: "request-display" }, context);
  assert(result.ok && result.value.ledgerId, `screen capture broker request mismatch: ${JSON.stringify(result)}`);
  result = os.syscall("browser.request", { capability: "webgpu.adapter", operation: "request-adapter" }, context);
  assert(result.ok && result.value.device === "/dev/browser/gpu", `WebGPU broker request mismatch: ${JSON.stringify(result)}`);

  const ledger = os.privacyLedgerStatus({ limit: 20 });
  assert(ledger.some((entry) => entry.capability === "notifications.show" && entry.operation === "show"), "privacy ledger missing notification access");
  assert(ledger.some((entry) => entry.capability === "screen.capture" && entry.broker === "screen-capture"), "privacy ledger missing screen capture access");
  assert(JSON.parse(os.fs.readFile("/proc/privacy-ledger.json")).entries.some((entry) => entry.capability === "webgpu.adapter"), "/proc/privacy-ledger.json missing WebGPU access");
  assert(JSON.parse(os.fs.readFile("/proc/browser-brokers.json")).capabilities.some((entry) => entry.id === "screen.capture" && entry.accessCount >= 1), "/proc/browser-brokers.json missing access count");

  const deniedProcess = os.processes.spawn({
    id: "browser-broker-denied",
    name: "Browser Broker Denied",
    manifest: { capabilities: [], fileSystem: { read: ["/home/guest"], write: ["/home/guest"] } },
  }, { cwd: "/home/guest" });
  result = os.syscall("browser.request", { capability: "screen.capture" }, { ...context, process: deniedProcess });
  assert(!result.ok && result.error.code === "EACCES", `browser broker did not deny missing grant: ${JSON.stringify(result)}`);

  result = os.syscall("browser.revoke", { capability: "screen.capture", reason: "smoke-revoke" }, context);
  assert(result.ok && result.value.capability === "screen.capture", `browser.revoke mismatch: ${JSON.stringify(result)}`);
  result = os.syscall("browser.request", { capability: "screen.capture" }, context);
  assert(!result.ok && result.error.code === "EACCES", `revoked browser grant was accepted: ${JSON.stringify(result)}`);

  const revokedStatus = os.browserBrokerStatus();
  assert(revokedStatus.revokedGrants.some((entry) => entry.capability === "screen.capture" && entry.pid === process.pid), "browser broker status missing revoked grant");
  assert(os.fs.readFile("/var/log/dindbos/privacy-ledger.jsonl").includes('"result":"revoked"'), "privacy ledger jsonl missing revoke result");
} finally {
  restoreGlobals();
}

console.log("browser brokers smoke ok grants ledger revoke procfs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function installBrowserApiShim() {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalNotification = Object.getOwnPropertyDescriptor(globalThis, "Notification");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: { getDisplayMedia() {}, getUserMedia() {}, enumerateDevices() {} },
      gpu: {},
    },
  });
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: function Notification() {} });
  return () => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    if (originalNotification) Object.defineProperty(globalThis, "Notification", originalNotification);
    else delete globalThis.Notification;
  };
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
