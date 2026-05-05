#!/usr/bin/env node
import { DindbOS, normalizeSession } from "../src/dindbos/index.js";
import { installBuiltinApps } from "../src/dindbos/apps/builtins.js";
import { ShellSession } from "../src/dindbos/shell.js";
import { portfolioData } from "../src/demo/portfolio-demo.js";

const normalized = normalizeSession({ user: "Ada Lovelace", groups: ["users", "Research Team"] });
assert(normalized.user === "ada-lovelace", `session user was not sanitized: ${normalized.user}`);
assert(normalized.home === "/home/ada-lovelace", `session home was not generated: ${normalized.home}`);
assert(normalized.groups.includes("research-team"), `session groups were not sanitized: ${normalized.groups.join(",")}`);
const fallbackGroups = normalizeSession({ user: "operator", groups: [" ", "admins"] });
assert(fallbackGroups.groups.join(",") === "admins", `blank session groups were not pruned: ${fallbackGroups.groups.join(",")}`);

const os = new DindbOS({
  root: null,
  fileSystem: null,
  storage: createStorage(),
  persistDelayMs: 0,
  session: { user: "Ada Lovelace", groups: ["users", "Research Team"] },
});

await os.loadPersistentFileSystem();
installBuiltinApps(os, { portfolioData });

assert(os.session.user === "ada-lovelace", "runtime session user mismatch");
assert(os.session.home === "/home/ada-lovelace", "runtime session home mismatch");
["Desktop", "Documents", "Downloads", ".Trash"].forEach((name) => {
  const path = os.fs.join(os.session.home, name);
  const stat = os.fs.stat(path);
  assert(stat.type === "directory", `session home directory missing: ${path}`);
  assert(stat.owner === "ada-lovelace", `session home directory owner mismatch for ${path}: ${stat.owner}`);
  assert(stat.group === "users", `session home directory group mismatch for ${path}: ${stat.group}`);
});

const profile = os.fs.stat(os.fs.join(os.session.home, ".profile"));
assert(profile.owner === "ada-lovelace", "session .profile owner mismatch");
assert(os.fs.readFile(os.fs.join(os.session.home, ".profile")).includes("export HOME=/home/ada-lovelace"), "session .profile HOME mismatch");

const shell = new ShellSession(os);
assert(shell.cwd === "/home/ada-lovelace", `shell cwd did not use generated home: ${shell.cwd}`);
assert(shell.env.USER === "ada-lovelace", `shell USER mismatch: ${shell.env.USER}`);
let result = await shell.executeAsync("echo hello > Documents/session.txt");
assert(result.status === 0, `session shell write failed: ${result.output}`);
const sessionFile = os.fs.stat("/home/ada-lovelace/Documents/session.txt");
assert(sessionFile.owner === "ada-lovelace", `created file owner mismatch: ${sessionFile.owner}`);
assert(sessionFile.group === "users", `created file group mismatch: ${sessionFile.group}`);
assert(os.fs.readFile("/home/ada-lovelace/Documents/session.txt") === "hello\n", "created file content mismatch");

result = await shell.executeAsync("mkdir Projects");
assert(result.status === 0, `session shell mkdir failed: ${result.output}`);
const projects = os.fs.stat("/home/ada-lovelace/Projects");
assert(projects.owner === "ada-lovelace", `created directory owner mismatch: ${projects.owner}`);

const textManifest = os.apps.getManifest("text");
assert(textManifest.fileSystem.read.includes("/home/ada-lovelace"), "TextEdit read scope did not use generated home");
assert(textManifest.fileSystem.write.includes("/home/ada-lovelace"), "TextEdit write scope did not use generated home");
assert(!textManifest.fileSystem.read.includes("/home/guest"), "TextEdit read scope still used hard-coded guest home");
const viewerManifest = os.apps.getManifest("viewer");
assert(viewerManifest.fileSystem.read.includes("/home/ada-lovelace"), "Viewer read scope did not use generated home");
const settingsManifest = os.apps.getManifest("settings");
assert(settingsManifest.fileSystem.read.includes("/home/ada-lovelace"), "Settings read scope did not use generated home");

const sessionStatus = os.sessionStatus();
assert(sessionStatus.state === "authenticated" && sessionStatus.locked === false, "initial session was not authenticated");
assert(sessionStatus.instanceId, "session status missing runtime instance id");
const persistedSession = JSON.parse(os.fs.readFile("/var/run/dindbos/session.json"));
assert(persistedSession.user === "ada-lovelace", "session status file user mismatch");
assert(persistedSession.state === "authenticated", "session status file state mismatch");
assert(persistedSession.coordination.role === "primary", "session status file missing primary coordination");
assert(JSON.parse(os.fs.readFile("/proc/sessions")).role === "primary", "/proc/sessions did not record primary role");
const initialUsers = os.listUsers();
assert(initialUsers.some((user) => user.user === "ada-lovelace"), "active session user was not registered");
assert(os.listGroups().some((group) => group.group === "research-team" && group.members.includes("ada-lovelace")), "active session group membership was not registered");
const operators = os.createGroup("Operators");
assert(operators.group === "operators", "createGroup did not sanitize group name");
const grace = os.createUser("Grace Hopper", { groups: ["users", "Operators"] });
assert(grace.user === "grace-hopper", `createUser did not sanitize user: ${grace.user}`);
assert(os.fs.stat("/home/grace-hopper/Documents").owner === "grace-hopper", "createUser did not create owned home workspace");
assert(os.listGroups().find((group) => group.group === "operators").members.includes("grace-hopper"), "createUser did not add user to group membership");
const release = os.addUserToGroup("Grace Hopper", "Release Team");
assert(release.user.groups.includes("release-team"), "addUserToGroup did not update user groups");
assert(release.group.members.includes("grace-hopper"), "addUserToGroup did not update group members");
const removed = os.removeUserFromGroup("Grace Hopper", "Operators");
assert(!removed.groups.includes("operators"), "removeUserFromGroup did not remove user group");
const userDb = JSON.parse(os.fs.readFile("/etc/dindbos/users.json"));
assert(userDb.users["grace-hopper"].home === "/home/grace-hopper", "user database did not persist created user");
assertRejects(() => os.createUser("Grace Hopper"), "already exists");

const events = [];
os.bus.on("session:lock", (event) => events.push(`lock:${event.state}:${event.reason}`));
os.bus.on("session:unlock", (event) => events.push(`unlock:${event.state}`));
const locked = os.lockSession("smoke-test");
assert(locked.locked === true && locked.reason === "smoke-test", "lockSession did not report locked state");
assert(JSON.parse(os.fs.readFile("/var/run/dindbos/session.json")).state === "locked", "session status file did not record locked state");
result = await shell.executeAsync("whoami");
assert(result.status === 1, `locked shell status mismatch: ${result.status}`);
assert(result.output.includes("session locked for ada-lovelace"), `locked shell output mismatch: ${result.output}`);
assertRejects(() => os.openPath("/home/ada-lovelace/.profile"), "open: session locked");
assertRejects(() => os.apps.launch("settings"), "launch: session locked");
const unlocked = os.unlockSession();
assert(unlocked.locked === false && unlocked.state === "authenticated", "unlockSession did not restore authenticated state");
assert(events.join(",") === "lock:locked:smoke-test,unlock:authenticated", `session events mismatch: ${events.join(",")}`);
result = await shell.executeAsync("whoami");
assert(result.status === 0 && result.output === "ada-lovelace", `unlocked shell output mismatch: ${result.output}`);

const sharedStorage = createStorage(new Map());
const primary = new DindbOS({ root: null, storage: sharedStorage, instanceId: "primary-tab", sessionLockTtlMs: 1000 });
await primary.loadPersistentFileSystem();
assert(primary.sessionCoordinationStatus().role === "primary", "first runtime did not become primary");
const secondary = new DindbOS({ root: null, storage: sharedStorage, instanceId: "secondary-tab", sessionLockTtlMs: 1000 });
await secondary.loadPersistentFileSystem();
assert(secondary.sessionCoordinationStatus().role === "secondary", "second runtime did not become secondary");
assert(secondary.sessionCoordinationStatus().readonly === true, "secondary runtime did not enter readonly fallback");
assert(JSON.parse(secondary.fs.readFile("/proc/sessions")).lockOwner === "primary-tab", "/proc/sessions did not expose primary owner");
sharedStorage.writeValue("dindbos:session-lock", JSON.stringify({
  owner: "stale-tab",
  user: "guest",
  acquiredAt: "2026-05-05T00:00:00.000Z",
  updatedAt: "2026-05-05T00:00:00.000Z",
  expiresAt: "2026-05-05T00:00:01.000Z",
  expiresAtMs: Date.now() - 1,
}));
const recoveredPrimary = new DindbOS({ root: null, storage: sharedStorage, instanceId: "recovered-tab", sessionLockTtlMs: 1000 });
await recoveredPrimary.loadPersistentFileSystem();
assert(recoveredPrimary.sessionCoordinationStatus().role === "primary", "stale lock recovery did not elect primary");
assert(recoveredPrimary.sessionCoordinationStatus().staleRecovered === true, "stale lock recovery was not recorded");

const channelFactory = createBroadcastChannelFactory();
const eventStorage = createStorage(new Map());
const tabA = new DindbOS({ root: null, storage: eventStorage, instanceId: "tab-a", broadcastChannelFactory: channelFactory });
await tabA.loadPersistentFileSystem();
const tabB = new DindbOS({ root: null, storage: eventStorage, instanceId: "tab-b", broadcastChannelFactory: channelFactory });
await tabB.loadPersistentFileSystem();
const fileEvents = [];
tabB.bus.on("session:file-change", (event) => fileEvents.push(`${event.source}:${event.action}:${event.path}`));
tabA.fs.writeOrCreateFile("/home/guest/Documents/cross-tab.txt", "event", "/", {}, tabA.permissions.systemPrincipal());
assert(fileEvents.some((event) => event.includes("tab-a") && event.includes("/home/guest/Documents/cross-tab.txt")), "cross-tab file event was not delivered");
assert(tabB.sessionCoordinationStatus().channel.received > 0, "session channel receive count was not recorded");
const conflicts = [];
tabA.bus.on("session:conflict", (event) => conflicts.push(`${event.path}:${event.firstSource}->${event.secondSource}`));
tabB.fs.writeOrCreateFile("/home/guest/Documents/cross-tab.txt", "peer edit", "/", {}, tabB.permissions.systemPrincipal());
assert(tabB.sessionCoordinationStatus().conflicts.pending === 1, "local same-path session conflict was not recorded");
assert(conflicts.some((event) => event.includes("/home/guest/Documents/cross-tab.txt:tab-a->tab-b")), "peer same-path session conflict was not delivered");
assert(JSON.parse(tabB.fs.readFile("/proc/sessions")).conflicts.pending === 1, "/proc/sessions did not expose pending session conflicts");
const flushEvents = [];
tabB.bus.on("session:storage-flush", (event) => flushEvents.push(`${event.source}:${event.phase}`));
await tabA.flushPersistentFileSystem();
assert(flushEvents.includes("tab-a:start") && flushEvents.includes("tab-a:complete"), "peer storage flush events were not delivered");
assert(tabB.sessionCoordinationStatus().storageFlush.lastPeerPhase === "complete", "peer storage flush status was not recorded");
const appStateEvents = [];
tabB.bus.on("session:app-state", (event) => appStateEvents.push(`${event.source}:${event.appId}:${event.action}:${event.key}`));
const sandbox = tabA.createSandbox({ appId: "session-state-app", user: "guest", manifest: {}, cwd: "/" });
sandbox.state.set("prefs", { theme: "dark" });
assert(appStateEvents.includes("tab-a:session-state-app:set:prefs"), "peer app-state event was not delivered");
assert(tabB.sessionCoordinationStatus().appState.lastPeerAppId === "session-state-app", "peer app-state status was not recorded");
const packageEvents = [];
tabB.bus.on("session:package-operation", (event) => packageEvents.push(`${event.source}:${event.packageId}:${event.operation}:${event.phase}`));
tabA.packages.install({
  id: "session-pkg",
  name: "Session Package",
  version: "1.0.0",
  app: { id: "session-pkg", name: "Session Package", entry: "app.js" },
  files: [{ path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" }],
});
assert(packageEvents.includes("tab-a:session-pkg:install:start") && packageEvents.includes("tab-a:session-pkg:install:complete"), "peer package install events were not delivered");
assert(tabB.sessionCoordinationStatus().packageOperation.lastPeerPackageId === "session-pkg", "peer package operation status was not recorded");

console.log("sessions smoke ok generated-home user-scopes ownership login-lock coordination file-events conflicts storage-flush app-state packages");

function createStorage(values = new Map()) {
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {},
    async readValue(key) {
      return values.get(key) ?? null;
    },
    writeValue(key, value) {
      values.set(key, value);
    },
    status: () => ({ backend: "memory" }),
    estimate: async () => ({ backend: "memory" }),
    resetFileSystem() {},
  };
}

function createBroadcastChannelFactory() {
  const channels = [];
  return class TestBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.listener = null;
      channels.push(this);
    }

    postMessage(message) {
      channels
        .filter((channel) => channel !== this && channel.name === this.name)
        .forEach((channel) => {
          const event = { data: message };
          if (channel.listener) channel.listener(event);
          if (channel.onmessage) channel.onmessage(event);
        });
    }

    addEventListener(type, listener) {
      if (type === "message") this.listener = listener;
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertRejects(action, expectedMessage) {
  try {
    action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected rejection: ${error.message}`);
  }
  throw new Error(`expected rejection: ${expectedMessage}`);
}
