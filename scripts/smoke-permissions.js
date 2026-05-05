#!/usr/bin/env node
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { DindbOS } from "../src/dindbos/index.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { ShellSession } from "../src/dindbos/shell.js";
import { SyscallDispatcher } from "../src/dindbos/syscalls.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const os = bootOs();
const shell = new ShellSession(os);

let result = await shell.executeAsync("cat /root/secret.txt");
assert(result.status === 1, `shell denied read status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `shell denied read output mismatch: ${result.output}`);

result = await shell.executeAsync("cat /root/public.txt");
assert(result.status === 1, `shell denied traversal read status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `shell denied traversal read output mismatch: ${result.output}`);

result = await shell.executeAsync("stat /root/public.txt");
assert(result.status === 1, `shell denied traversal stat status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `shell denied traversal stat output mismatch: ${result.output}`);

result = await shell.executeAsync("echo nope > /root/new.txt");
assert(result.status === 1, `shell denied write status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `shell denied write output mismatch: ${result.output}`);

result = await shell.executeAsync("cat /home/guest/private.txt");
assert(result.status === 1, `shell denied direct read status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `shell denied direct read output mismatch: ${result.output}`);

let auditLog = os.fs.readFile("/var/log/dindbos/security-audit.log");
assert(auditLog.includes("action=fs-access:execute decision=denied") && auditLog.includes("target=/root"), "security audit missing denied traversal execute");
assert(auditLog.includes("action=fs-access:write decision=denied") && auditLog.includes("target=/root"), "security audit missing denied filesystem write");
assert(auditLog.includes("action=fs-access:read decision=denied") && auditLog.includes("target=/home/guest/private.txt"), "security audit missing denied filesystem read");

result = await shell.executeAsync("syscall fs.readText '{}'");
assert(result.status === 2, `raw syscall invalid args status mismatch: ${result.status}`);
assert(JSON.parse(result.output).error.code === "EINVAL", `raw syscall invalid args code mismatch: ${result.output}`);

result = await shell.executeAsync("syscall fs.readText '{\"path\":\"/root/secret.txt\"}'");
assert(result.status === 1, `raw syscall denied read status mismatch: ${result.status}`);
assert(JSON.parse(result.output).error.code === "EACCES", `raw syscall denied read code mismatch: ${result.output}`);

const process = {
  pid: 100,
  appId: "limited",
  user: "guest",
  cwd: "/home/guest",
  manifest: {
    capabilities: [],
    fileSystem: {
      read: ["/home/guest"],
      write: ["/home/guest/Documents"],
    },
  },
};
const sandbox = new AppSandbox(os, process);
sandbox.fs.readFile("/home/guest/readable.txt");
let syscallResult = sandbox.syscall("fs.readText", {});
assert(syscallResult.ok === false && syscallResult.error.code === "EINVAL", `sandbox syscall invalid args mismatch: ${JSON.stringify(syscallResult)}`);
syscallResult = sandbox.syscall("fs.readText", { path: "/root/secret.txt" });
assert(syscallResult.ok === false && syscallResult.error.code === "EACCES", `sandbox syscall denied fs mismatch: ${JSON.stringify(syscallResult)}`);
syscallResult = sandbox.syscall("package.list", {});
assert(syscallResult.ok === false && syscallResult.error.code === "EACCES", `sandbox syscall denied package mismatch: ${JSON.stringify(syscallResult)}`);
syscallResult = sandbox.syscall("storage.status", {});
assert(syscallResult.ok === false && syscallResult.error.code === "EACCES", `sandbox syscall denied storage mismatch: ${JSON.stringify(syscallResult)}`);
syscallResult = sandbox.syscall("mount.mount", { path: "/mnt/sandbox", driver: "memfs" });
assert(syscallResult.ok === false && syscallResult.error.code === "EACCES", `sandbox syscall denied mount mismatch: ${JSON.stringify(syscallResult)}`);
const appStateAtomicEvents = [];
os.fs.onChange = (event) => appStateAtomicEvents.push(event);
sandbox.state.set("prefs", { theme: "dark", count: 1 });
assert(sandbox.state.path() === "/var/lib/dindbos/app-state/guest/limited.json", "app state path was not namespaced by user and app id");
assert(sandbox.state.get("prefs").theme === "dark", "app state did not read back its own value");
assert(appStateAtomicEvents.some((event) => event.action === "atomic-create" && event.path === sandbox.state.path()), "app state did not atomically create its record");
assert(sandbox.state.keys().includes("prefs"), "app state keys did not include saved key");
const sameAppSandbox = new AppSandbox(os, { ...process, pid: 101 });
assert(sameAppSandbox.state.get("prefs").count === 1, "app state did not persist across same-app sandbox instances");
const otherAppSandbox = new AppSandbox(os, { ...process, pid: 102, appId: "other" });
assert(otherAppSandbox.state.get("prefs", "missing") === "missing", "app state leaked across app ids");
const otherUserSandbox = new AppSandbox(os, { ...process, pid: 104, user: "ada-lovelace" });
assert(otherUserSandbox.state.path() === "/var/lib/dindbos/app-state/ada-lovelace/limited.json", "app state path was not namespaced by user");
assert(otherUserSandbox.state.get("prefs", "missing") === "missing", "app state leaked across users");
assert(sandbox.state.remove("prefs") === true, "app state remove did not report existing key");
assert(!sandbox.state.keys().includes("prefs"), "app state key remained after remove");
assert(appStateAtomicEvents.some((event) => event.action === "atomic-replace" && event.path === sandbox.state.path()), "app state did not atomically replace its record");
const broadSandbox = new AppSandbox(os, {
  ...process,
  pid: 103,
  appId: "broad",
  manifest: { capabilities: [], fileSystem: { read: ["/"], write: [] } },
});
await assertRejects(() => broadSandbox.fs.stat("/root/public.txt"), "permission denied");
await assertRejects(() => broadSandbox.fs.resolve("/root/public.txt"), "permission denied");
await assertRejects(() => broadSandbox.fs.exists("/root/public.txt"), "permission denied");
await assertRejects(() => sandbox.state.set("bad", undefined), "JSON serializable");
await assertRejects(() => sandbox.fs.readFile("/root/secret.txt"), "sandbox denied");
await assertRejects(() => sandbox.fs.writeOrCreateFile("/root/new.txt", "nope"), "sandbox denied");
await assertRejects(() => sandbox.processes.list(), "capability denied: process.read");
await assertRejects(() => sandbox.packages.installFromRegistry("hello-notes"), "capability denied: package.manage");
await assertRejects(() => sandbox.localMounts.mountLocal("disk"), "capability denied: localMount.manage");
const storageManagerSandbox = new AppSandbox(os, {
  ...process,
  pid: 105,
  appId: "settings-storage",
  manifest: { capabilities: ["storage.manage"], fileSystem: { read: [], write: [] } },
});
await assertRejects(() => storageManagerSandbox.storage.flush(), "administrator required");
await assertRejects(() => storageManagerSandbox.storage.resetFileSystem(), "administrator required");
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:storage-flush decision=denied"), "security audit missing denied storage flush");
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:resetfs decision=denied"), "security audit missing denied resetfs");
const adminStorageSandbox = new AppSandbox(os, {
  ...process,
  pid: 106,
  appId: "settings-storage",
  user: "admin-user",
  groups: ["users", "admins"],
  manifest: { capabilities: ["storage.manage"], fileSystem: { read: [], write: [] } },
});
await adminStorageSandbox.storage.flush();
adminStorageSandbox.storage.resetFileSystem();
assert(os.storageFlushes === 1, "admin storage flush did not reach runtime");
assert(os.storageResets === 1, "admin resetfs did not reach runtime");
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:storage-flush decision=allowed"), "security audit missing allowed storage flush");
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:resetfs decision=allowed"), "security audit missing allowed resetfs");
await assertRejects(() => openNonExecutableAppLauncher(), "permission denied");
await assertRejects(() => os.fs.readFile("/root/public.txt", "/", os.permissions.principal(os.session)), "permission denied");

console.log("permissions smoke ok shell sandbox denials admin-storage");

async function openNonExecutableAppLauncher() {
  const runtime = new DindbOS({ root: {}, storage: createRuntimeStorage() });
  const system = runtime.permissions.systemPrincipal();
  runtime.fs.createDirectory("/usr", "/", { owner: "root", group: "root" }, system);
  runtime.fs.createDirectory("/usr/share", "/", { owner: "root", group: "root" }, system);
  runtime.fs.createDirectory("/usr/share/applications", "/", { owner: "root", group: "root" }, system);
  runtime.fs.createApp(
    "/usr/share/applications/Locked.app",
    "locked",
    "app",
    "/",
    { owner: "root", group: "root", permissions: "-rw-r--r--" },
    system,
  );
  runtime.openPath("/usr/share/applications/Locked.app");
}

function bootOs() {
  const permissions = new PermissionPolicy();
  let os;
  const fs = new VirtualFileSystem(null, {
    home: "/home/guest",
    policy: permissions,
    onAccessDenied: (event) => os?.auditDeniedFileSystemAccess?.(event),
  });
  const system = permissions.systemPrincipal();
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  fs.createDirectory("/home/guest/Documents", "/", { owner: "guest", group: "users" }, system);
  fs.writeOrCreateFile("/home/guest/readable.txt", "ok", "/", { owner: "guest", group: "users", permissions: "-rw-r--r--" }, system);
  fs.writeOrCreateFile("/home/guest/private.txt", "private", "/", { owner: "root", group: "root", permissions: "-rw-------" }, system);
  fs.createDirectory("/root", "/", { owner: "root", group: "root", permissions: "drwx------" }, system);
  fs.writeOrCreateFile("/root/secret.txt", "secret", "/", { owner: "root", group: "root", permissions: "-rw-------" }, system);
  fs.writeOrCreateFile("/root/public.txt", "public", "/", { owner: "root", group: "root", permissions: "-rw-r--r--" }, system);
  os = {
    fs,
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    apps: { list: () => [] },
    packages: {
      list: () => [],
      installFromRegistry: async () => null,
    },
    processes: {
      list: () => [],
      get: () => null,
      readLog: () => "",
      kill: () => null,
      formatTable: () => "",
      table: () => "",
    },
    localMounts: {
      isMountedPath: () => false,
      mountLocal: async () => null,
    },
    storage: {
      status: () => ({ backend: "memory", bytes: 0 }),
      estimate: async () => ({ backend: "memory", bytes: 0 }),
    },
    storageFlushes: 0,
    storageResets: 0,
    flushPersistentFileSystem: async () => {
      os.storageFlushes += 1;
      return { flushed: true };
    },
    resetPersistentFileSystem: () => {
      os.storageResets += 1;
    },
    assertAdminOperation(action, context = {}) {
      const principal = context.principal || this.permissions.principal(this.session);
      const allowed = principal.system || principal.user === "root" || (principal.groups || []).includes("admins");
      this.auditSecurity(action, allowed ? "allowed" : "denied", { principal, target: context.target || "", reason: allowed ? "" : "admin-required" });
      if (!allowed) throw new Error(`${action}: denied: administrator required`);
      return true;
    },
    auditSecurity(action, decision, details = {}) {
      ["/var", "/var/log", "/var/log/dindbos"].forEach((path) => {
        if (!this.fs.exists(path)) this.fs.createDirectory(path, "/", { owner: "root", group: "root" }, system);
      });
      const principal = details.principal || {};
      const line = `action=${action} decision=${decision} user=${principal.user || "guest"} groups=${(principal.groups || []).join(",") || "-"} target=${details.target || "-"}${details.reason ? ` reason=${details.reason}` : ""}\n`;
      if (this.fs.exists("/var/log/dindbos/security-audit.log")) this.fs.appendFile("/var/log/dindbos/security-audit.log", line, "/", system);
      else this.fs.writeOrCreateFile("/var/log/dindbos/security-audit.log", line, "/", { owner: "root", group: "root", permissions: "-rw-r--r--" }, system);
      return { action, decision };
    },
    auditDeniedFileSystemAccess(event = {}) {
      const principal = event.principal || {};
      if (principal.system || principal.user === "root") return null;
      return this.auditSecurity(`fs-access:${event.access || "unknown"}`, "denied", {
        principal,
        target: event.path || "",
        reason: event.reason || "permission-denied",
      });
    },
    openPath: () => null,
    openNode: () => null,
    launch: () => null,
  };
  os.syscalls = new SyscallDispatcher(os);
  os.syscall = (name, args = {}, context = {}) => os.syscalls.call(name, args, context);
  return os;
}

function createRuntimeStorage() {
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

async function assertRejects(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected rejection: ${error.message}`);
  }
  throw new Error(`expected rejection containing ${expectedMessage}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
