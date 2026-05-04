#!/usr/bin/env node
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { DindbOS } from "../src/dindbos/index.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { ShellSession } from "../src/dindbos/shell.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const os = bootOs();
const shell = new ShellSession(os);

let result = await shell.executeAsync("cat /root/secret.txt");
assert(result.status === 1, `shell denied read status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `shell denied read output mismatch: ${result.output}`);

result = await shell.executeAsync("echo nope > /root/new.txt");
assert(result.status === 1, `shell denied write status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `shell denied write output mismatch: ${result.output}`);

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
sandbox.state.set("prefs", { theme: "dark", count: 1 });
assert(sandbox.state.path() === "/var/lib/dindbos/app-state/limited.json", "app state path was not namespaced by app id");
assert(sandbox.state.get("prefs").theme === "dark", "app state did not read back its own value");
assert(sandbox.state.keys().includes("prefs"), "app state keys did not include saved key");
const sameAppSandbox = new AppSandbox(os, { ...process, pid: 101 });
assert(sameAppSandbox.state.get("prefs").count === 1, "app state did not persist across same-app sandbox instances");
const otherAppSandbox = new AppSandbox(os, { ...process, pid: 102, appId: "other" });
assert(otherAppSandbox.state.get("prefs", "missing") === "missing", "app state leaked across app ids");
assert(sandbox.state.remove("prefs") === true, "app state remove did not report existing key");
assert(!sandbox.state.keys().includes("prefs"), "app state key remained after remove");
await assertRejects(() => sandbox.state.set("bad", undefined), "JSON serializable");
await assertRejects(() => sandbox.fs.readFile("/root/secret.txt"), "sandbox denied");
await assertRejects(() => sandbox.fs.writeOrCreateFile("/root/new.txt", "nope"), "sandbox denied");
await assertRejects(() => sandbox.processes.list(), "capability denied: process.read");
await assertRejects(() => sandbox.packages.installFromRegistry("hello-notes"), "capability denied: package.manage");
await assertRejects(() => sandbox.localMounts.mountLocal("disk"), "capability denied: localMount.manage");
await assertRejects(() => openNonExecutableAppLauncher(), "permission denied");

console.log("permissions smoke ok shell sandbox denials");

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
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const system = permissions.systemPrincipal();
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  fs.createDirectory("/home/guest/Documents", "/", { owner: "guest", group: "users" }, system);
  fs.writeOrCreateFile("/home/guest/readable.txt", "ok", "/", { owner: "guest", group: "users", permissions: "-rw-r--r--" }, system);
  fs.createDirectory("/root", "/", { owner: "root", group: "root", permissions: "drwx------" }, system);
  fs.writeOrCreateFile("/root/secret.txt", "secret", "/", { owner: "root", group: "root", permissions: "-rw-------" }, system);
  return {
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
    openPath: () => null,
    openNode: () => null,
    launch: () => null,
  };
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
