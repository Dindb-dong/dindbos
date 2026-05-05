#!/usr/bin/env node
import { DindbOS, normalizeSession } from "../src/dindbos/index.js";
import { installBuiltinApps } from "../src/dindbos/apps/builtins.js";
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
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
const adaHistoryPath = "/var/lib/dindbos/shell-history/ada-lovelace.json";
assert(os.fs.exists(adaHistoryPath), "per-user shell history file was not created");
assert(JSON.parse(os.fs.readFile(adaHistoryPath)).entries.includes("mkdir Projects"), "per-user shell history did not persist command");
const reloadedShell = new ShellSession(os);
assert(reloadedShell.history.includes("mkdir Projects"), "new shell session did not load per-user history");

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
const researchGroup = os.listGroups().find((group) => group.group === "research-team");
assert(researchGroup && Number.isInteger(researchGroup.gid) && researchGroup.members.includes("ada-lovelace"), "active session group membership was not registered with gid");
const adaCredentials = os.credentialsForUser("Ada Lovelace", ["users", "Research Team"]);
assert(adaCredentials.uid >= 1000 && adaCredentials.gid === 100 && adaCredentials.groups.includes("research-team"), "session credentials were not normalized");
assert(JSON.parse(os.fs.readFile("/etc/dindbos/groups.json")).groups["research-team"].gid === researchGroup.gid, "group database mirror did not persist gid");
const operators = os.createGroup("Operators");
assert(operators.group === "operators" && Number.isInteger(operators.gid), "createGroup did not sanitize group name with gid");
const grace = os.createUser("Grace Hopper", { groups: ["users", "Operators"] });
assert(grace.user === "grace-hopper", `createUser did not sanitize user: ${grace.user}`);
assert(Number.isInteger(grace.uid), "createUser did not assign uid");
const admin = os.createUser("Admin User", { groups: ["users", "admins"] });
assert(admin.groups.includes("admins"), "admin user did not retain admins group");
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
result = await shell.executeAsync("id");
assert(result.output.includes("uid=") && result.output.includes("(ada-lovelace)") && result.output.includes("groups=100(users)"), `id did not expose numeric credentials: ${result.output}`);
result = await shell.executeAsync("pkg prefs set api-lab channel beta");
assert(result.status === 0 && result.output.includes('"beta"'), `package preference set failed: ${result.output}`);
assert(JSON.parse(os.fs.readFile("/var/lib/dindbos/package-preferences/ada-lovelace.json")).packages["api-lab"].channel === "beta", "per-user package preference was not persisted");
const userCacheKey = "https://dindbos.cache/session-preview";
await os.cache.rememberBytes(userCacheKey, new Uint8Array([1, 2, 3]));
assert((await os.cache.readBytes(userCacheKey)).byteLength === 3, "active user cache did not read back bytes");
const system = os.permissions.systemPrincipal();
os.ensureDirectoryPath("/home/grace-hopper/Team", { leafOwner: "grace-hopper", leafGroup: "release-team", principal: system });
os.fs.writeOrCreateFile("/home/grace-hopper/Team/plan.txt", "release\n", "/", {
  owner: "root",
  group: "release-team",
  permissions: "-rw-r-----",
}, system);
const credentialProcess = os.processes.spawn({
  id: "credential-smoke",
  name: "Credential Smoke",
  manifest: { fileSystem: { read: ["/home/grace-hopper/Team"], write: [] } },
}, { credentials: os.credentialsForUser("Grace Hopper"), cwd: "/home/grace-hopper" });
assert(os.fs.readFile(`/proc/${credentialProcess.pid}/status`).includes("Uid:\t"), "process /proc status missing uid");
assert(os.fs.readFile(`/proc/${credentialProcess.pid}/status`).includes("Groups:\tusers,release-team"), "process /proc status missing process groups");
assert(JSON.parse(os.fs.readFile("/proc/processes.json")).some((entry) => entry.pid === credentialProcess.pid && entry.uid === credentialProcess.uid && entry.credentials.groups.includes("release-team")), "/proc processes JSON missing credentials");
const credentialSandbox = new AppSandbox(os, credentialProcess);
assert(credentialSandbox.fs.readFile("/home/grace-hopper/Team/plan.txt") === "release\n", "sandbox did not use process credential groups");
const adaPrincipal = os.permissions.principal({ user: "ada-lovelace", groups: ["users", "research-team"] });
assertRejects(() => os.fs.readFile("/home/grace-hopper/Team/plan.txt", "/", adaPrincipal), "permission denied");
result = await shell.executeAsync("loginctl users");
assert(result.status === 0 && result.output.includes("grace-hopper"), `loginctl users did not list created user: ${result.output}`);
result = await shell.executeAsync("loginctl switch grace-hopper");
assert(result.status === 0 && result.output.includes("switched to grace-hopper"), `loginctl switch failed: ${result.output}`);
assert(shell.env.USER === "grace-hopper" && shell.cwd === "/home/grace-hopper", "shell did not adopt switched session user");
assert(!shell.history.includes("mkdir Projects"), "switched session leaked previous user's shell history");
result = await shell.executeAsync("pkg prefs list");
assert(result.status === 0 && result.output === "pkg: no package preferences", `switched user saw another user's package preferences: ${result.output}`);
assert(await os.cache.readBytes(userCacheKey) === null, "switched user saw another user's cache entry");
await os.cache.rememberBytes(userCacheKey, new Uint8Array([9]));
assert((await os.cache.readBytes(userCacheKey)).byteLength === 1, "switched user cache did not read back its own bytes");
result = await shell.executeAsync("pkg prefs set api-lab channel stable");
assert(result.status === 0 && result.output.includes('"stable"'), `switched user package preference set failed: ${result.output}`);
result = await shell.executeAsync("whoami");
assert(result.status === 0 && result.output === "grace-hopper", `switched whoami mismatch: ${result.output}`);
result = await shell.executeAsync("cat Team/plan.txt");
assert(result.status === 0 && result.output === "release\n", `switched user could not read group file: ${result.output}`);
result = await shell.executeAsync("loginctl switch ada-lovelace");
assert(result.status === 0 && shell.env.USER === "ada-lovelace", "loginctl switch did not return to original session user");
const graceHistory = JSON.parse(os.fs.readFile("/var/lib/dindbos/shell-history/grace-hopper.json"));
assert(graceHistory.entries.includes("whoami") && graceHistory.entries.includes("cat Team/plan.txt"), "switched user's shell history was not persisted");
assert(!JSON.parse(os.fs.readFile(adaHistoryPath)).entries.includes("cat Team/plan.txt"), "shell history leaked across users");
assert((await os.cache.readBytes(userCacheKey)).byteLength === 3, "original user cache entry was not restored after session switch");
assert(JSON.parse(os.fs.readFile("/var/lib/dindbos/package-preferences/grace-hopper.json")).packages["api-lab"].channel === "stable", "switched user's package preference was not persisted");
assert(JSON.parse(os.fs.readFile("/var/lib/dindbos/package-preferences/ada-lovelace.json")).packages["api-lab"].channel === "beta", "package preferences leaked across users");
const trustKey = "ed25519-pub:v1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
result = await shell.executeAsync(`pkg trust add org.session ${trustKey} Session Publisher`);
assert(result.status === 1 && result.output.includes("administrator required"), `non-admin package trust change was not denied: ${result.output}`);
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("decision=denied"), "security audit did not record denied package trust change");
result = await shell.executeAsync("companion list");
assert(result.status === 0 && result.output === "companion: no companion permissions", `initial companion list mismatch: ${result.output}`);
result = await shell.executeAsync("companion grant networkd dindbos-networkd-v1 rawTcp rawUdp");
assert(result.status === 1 && result.output.includes("administrator required"), `non-admin companion grant was not denied: ${result.output}`);
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=companion-permission:grant decision=denied"), "security audit did not record denied companion grant");
result = await shell.executeAsync("loginctl switch admin-user");
assert(result.status === 0 && shell.env.USER === "admin-user", "loginctl switch did not enter admin user");
result = await shell.executeAsync(`pkg trust add org.session ${trustKey} Session Publisher`);
assert(result.status === 0, `admin package trust add failed: ${result.output}`);
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("decision=allowed"), "security audit did not record allowed package trust change");
result = await shell.executeAsync("pkg trust remove org.session");
assert(result.status === 0, `admin package trust remove failed: ${result.output}`);
result = await shell.executeAsync("companion grant networkd dindbos-networkd-v1 rawTcp rawUdp");
assert(result.status === 0 && result.output.includes("companion granted networkd"), `admin companion grant failed: ${result.output}`);
assert(os.isCompanionApproved("networkd", "dindbos-networkd-v1", "rawTcp") === true, "companion approval did not allow rawTcp");
assert(JSON.parse(os.fs.readFile("/etc/dindbos/companions.json")).companions.networkd.approved === true, "companion permission was not persisted");
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=companion-permission:grant decision=allowed"), "security audit did not record allowed companion grant");
result = await shell.executeAsync("companion list");
assert(result.status === 0 && result.output.includes("networkd") && result.output.includes("approved=true"), `companion list did not show approval: ${result.output}`);
result = await shell.executeAsync("companion revoke networkd");
assert(result.status === 0 && result.output === "companion revoked networkd", `admin companion revoke failed: ${result.output}`);
assert(os.isCompanionApproved("networkd", "dindbos-networkd-v1", "rawTcp") === false, "companion revoke did not remove approval");
assert(os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=companion-permission:revoke decision=allowed"), "security audit did not record allowed companion revoke");
result = await shell.executeAsync("loginctl switch ada-lovelace");
assert(result.status === 0 && shell.env.USER === "ada-lovelace", "loginctl switch did not return from admin user");

const events = [];
os.bus.on("session:lock", (event) => events.push(`lock:${event.state}:${event.reason}`));
os.bus.on("session:unlock", (event) => events.push(`unlock:${event.state}`));
const locked = os.lockSession("smoke-test");
assert(locked.locked === true && locked.reason === "smoke-test", "lockSession did not report locked state");
assert(JSON.parse(os.fs.readFile("/var/run/dindbos/session.json")).state === "locked", "session status file did not record locked state");
result = await shell.executeAsync("whoami");
assert(result.status === 1, `locked shell status mismatch: ${result.status}`);
assert(result.output.includes("session locked for ada-lovelace"), `locked shell output mismatch: ${result.output}`);
result = await shell.executeAsync("loginctl status");
assert(result.status === 0 && result.output.includes("locked=true"), `loginctl status did not work while locked: ${result.output}`);
assertRejects(() => os.openPath("/home/ada-lovelace/.profile"), "open: session locked");
assertRejects(() => os.apps.launch("settings"), "launch: session locked");
result = await shell.executeAsync("loginctl unlock");
assert(result.status === 0 && result.output.includes("locked=false"), `loginctl unlock did not unlock shell: ${result.output}`);
const unlocked = os.sessionStatus();
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
const handoffEvents = [];
tabB.bus.on("session:handoff", (event) => handoffEvents.push(`${event.source}:${event.action}:${event.mode}:${event.offerId}`));
const handoffOffer = tabA.createSessionHandoffOffer({
  mode: "control",
  targetInstanceId: "tab-b",
  transport: "broadcast-channel",
});
assert(handoffOffer.status === "offered" && handoffOffer.mode === "control", "session handoff offer was not created");
assert(handoffEvents.includes(`tab-a:offer:control:${handoffOffer.offerId}`), "peer session handoff offer event was not delivered");
assert(tabB.sessionCoordinationStatus().handoff.lastPeerOfferId === handoffOffer.offerId, "peer session handoff offer status was not recorded");
const acceptedHandoff = tabB.acceptSessionHandoff(handoffOffer.offerId);
assert(acceptedHandoff.status === "active" && acceptedHandoff.acceptedBy === "tab-b", "session handoff accept did not activate");
assert(tabA.sessionCoordinationStatus().handoff.activeOfferId === handoffOffer.offerId, "source session handoff active status was not recorded");
assert(tabA.sessionCoordinationStatus().handoff.activePeerInstanceId === "tab-b", "source session handoff active peer was not recorded");
assert(JSON.parse(tabA.fs.readFile("/proc/sessions")).handoff.activeOfferId === handoffOffer.offerId, "/proc/sessions did not expose active session handoff");
const relayFrames = [];
const relayInputs = [];
tabB.bus.on("session:handoff-frame", (event) => relayFrames.push(`${event.source}:${event.offerId}:${event.width}x${event.height}:${event.bytes}`));
tabA.bus.on("session:handoff-input", (event) => relayInputs.push(`${event.source}:${event.offerId}:${event.inputType}:${event.x},${event.y}`));
tabA.sendSessionHandoffFrame(handoffOffer.offerId, { width: 800, height: 600, mime: "image/jpeg", bytes: 4096 });
assert(relayFrames.includes(`tab-a:${handoffOffer.offerId}:800x600:4096`), "session handoff frame relay was not delivered");
assert(tabB.sessionCoordinationStatus().handoff.relay.framesReceived === 1, "peer session handoff frame relay status was not recorded");
tabB.sendSessionHandoffInput(handoffOffer.offerId, { inputType: "pointer", x: 24, y: 48, button: "primary" });
assert(relayInputs.includes(`tab-b:${handoffOffer.offerId}:pointer:24,48`), "session handoff input relay was not delivered");
assert(tabA.sessionCoordinationStatus().handoff.relay.inputsReceived === 1, "source session handoff input relay status was not recorded");
assert(JSON.parse(tabA.fs.readFile("/proc/sessions")).handoff.relay.inputsReceived === 1, "/proc/sessions did not expose handoff relay diagnostics");
const cancelledHandoff = tabA.cancelSessionHandoff(handoffOffer.offerId, "smoke-complete");
assert(cancelledHandoff.status === "cancelled", "session handoff cancel status mismatch");
assert(tabB.sessionCoordinationStatus().handoff.activeOfferId === "", "peer session handoff active status was not cleared");
const packageDbLock = tabA.acquireRuntimeOperationLock("package-db", { operation: "install", packageId: "locked-pkg" });
assertRejects(() => tabB.packages.install({
  id: "locked-pkg",
  name: "Locked Package",
  version: "1.0.0",
  app: { id: "locked-pkg", name: "Locked Package", entry: "app.js" },
  files: [{ path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" }],
}), "package-db: operation locked by tab-a");
assert(!tabB.fs.exists("/var/lib/dindbos/packages/locked-pkg.json"), "package DB lock did not prevent package record mutation");
tabA.releaseRuntimeOperationLock("package-db", packageDbLock);
const reloadShutdown = tabB.writeRecoveryRecord("session-reload-smoke", { dirty: true });
assert(reloadShutdown.session.conflicts.pending === 1, "session shutdown record did not capture pending conflicts");
const reloadOs = new DindbOS({ root: null, fileSystem: tabB.fs.snapshot(), storage: createStorage(new Map()), instanceId: "reload-tab" });
await reloadOs.loadPersistentFileSystem();
const reloadRecovery = reloadOs.recoveryStatus().lastRecovery;
assert(reloadRecovery.sessionRecovery.pendingConflicts === 1, "reload recovery did not preserve pending conflict count");
assert(reloadOs.sessionCoordinationStatus().recovery.pendingConflicts === 1, "session coordination did not expose reload recovery");
assert(JSON.parse(reloadOs.fs.readFile("/proc/sessions")).recovery.recovered === true, "/proc/sessions did not expose reload recovery");
ensureDirectory(tabB, "/var/cache/dindbos");
ensureDirectory(tabB, "/etc/dindbos");
ensureDirectory(tabB, "/var/lib/dindbos/packages");
tabB.fs.writeOrCreateFile(
  "/var/lib/dindbos/packages/session-pkg.json",
  JSON.stringify({ id: "session-pkg", version: "1.0.0", marker: "package metadata" }),
  "/",
  { mime: "application/json" },
  tabB.permissions.systemPrincipal(),
);
tabB.fs.writeOrCreateFile(
  "/var/cache/dindbos/package-index.json",
  JSON.stringify({ packages: ["session-pkg"], marker: "cached package index" }),
  "/",
  { mime: "application/json" },
  tabB.permissions.systemPrincipal(),
);
tabB.fs.writeOrCreateFile(
  "/etc/dindbos/sync-settings.json",
  JSON.stringify({ sync: true, marker: "settings coverage" }),
  "/",
  { mime: "application/json" },
  tabB.permissions.systemPrincipal(),
);
const syncSnapshot = await tabB.createRemoteSyncSnapshot({
  passphrase: "session-sync-secret",
});
assert(syncSnapshot.encrypted === true && syncSnapshot.ciphertext, "remote sync snapshot was not encrypted");
assert(syncSnapshot.fileCount >= 1, "remote sync snapshot did not include selected files");
assert(syncSnapshot.cacheRecords >= 1, "remote sync snapshot did not include package cache records");
assert(syncSnapshot.settingsRecords >= 1, "remote sync snapshot did not include settings records");
assert(!syncSnapshot.ciphertext.includes("peer edit"), "remote sync snapshot leaked plaintext content");
assert(!syncSnapshot.ciphertext.includes("cached package index"), "remote sync snapshot leaked cache plaintext content");
assert(!syncSnapshot.ciphertext.includes("settings coverage"), "remote sync snapshot leaked settings plaintext content");
assert(tabB.remoteSyncStatus().lastSuccessfulSnapshot.fileCount === syncSnapshot.fileCount, "remote sync status did not record last snapshot");
assert(tabB.remoteSyncStatus().lastSuccessfulSnapshot.cacheRecords === syncSnapshot.cacheRecords, "remote sync status did not record cache coverage");
assert(tabB.remoteSyncStatus().lastSuccessfulSnapshot.settingsRecords === syncSnapshot.settingsRecords, "remote sync status did not record settings coverage");
const mergePolicy = tabB.remoteSyncMergePolicy();
assert(mergePolicy.rules.some((rule) => rule.scope === "user-documents"), "remote sync merge policy missing user document rule");
assert(mergePolicy.rules.some((rule) => rule.scope === "package-metadata"), "remote sync merge policy missing package metadata rule");
const mergePlan = tabB.planRemoteSyncMerge([
  {
    path: "/home/guest/Documents/notes.txt",
    mime: "text/plain",
    base: "title\n",
    local: "title\nlocal\n",
    remote: "title\nremote\n",
  },
  {
    path: "/var/lib/dindbos/app-state/api-lab.json",
    base: { count: 1 },
    local: { count: 2 },
    remote: { count: 3 },
  },
  {
    path: "/var/lib/dindbos/packages/session-pkg.json",
    base: "{}",
    local: "{\"version\":\"1.0.0\"}",
    remote: "{\"version\":\"2.0.0\"}",
  },
  {
    path: "/var/lib/dindbos/search/index.json",
    remote: "{\"documents\":1}",
  },
  {
    path: "/etc/dindbos/settings.json",
    base: "{\"theme\":\"light\"}",
    local: "{\"theme\":\"blue\"}",
    remote: "{\"theme\":\"dark\"}",
    localModified: "2026-05-05T00:01:00.000Z",
    remoteModified: "2026-05-05T00:02:00.000Z",
  },
]);
assert(mergePlan.summary["three-way-merge"] === 1, "remote sync merge planner did not merge text documents");
assert(mergePlan.changes[0].merged.includes("local\nremote\n"), "remote sync text merge did not preserve both suffixes");
assert(mergePlan.summary["conflict-copy"] === 1, "remote sync merge planner did not preserve app-state conflicts");
assert(mergePlan.summary.refuse === 1, "remote sync merge planner did not refuse package metadata conflicts");
assert(mergePlan.summary.rebuild === 1, "remote sync merge planner did not rebuild search indexes");
assert(mergePlan.summary["last-writer-wins"] === 1 && mergePlan.changes[4].winner === "remote", "remote sync merge planner did not apply settings last-writer-wins");
const syncTarget = new DindbOS({ root: null, storage: createStorage(new Map()), instanceId: "sync-target" });
await syncTarget.loadPersistentFileSystem();
syncTarget.fs.writeOrCreateFile(
  "/home/guest/Documents/cross-tab.txt",
  "local draft",
  "/",
  { mime: "text/plain" },
  syncTarget.permissions.systemPrincipal(),
);
const applyResult = await syncTarget.applyRemoteSyncSnapshot({
  passphrase: "session-sync-secret",
  snapshot: syncSnapshot,
});
assert(applyResult.summary["conflict-copy"] >= 1, "remote sync apply did not preserve document conflict copy");
assert(applyResult.summary.refuse >= 1, "remote sync apply did not refuse package metadata");
assert(syncTarget.fs.readFile("/home/guest/Documents/cross-tab.txt") === "local draft", "remote sync apply overwrote local document conflict");
assert(syncTarget.fs.list("/home/guest/Documents/.sync-conflicts").some((entry) => entry.name.startsWith("cross-tab.txt.")), "remote sync apply did not write document conflict copy");
assert(syncTarget.fs.exists("/var/cache/dindbos/package-index.json"), "remote sync apply did not restore cache metadata");
assert(syncTarget.fs.exists("/etc/dindbos/sync-settings.json"), "remote sync apply did not restore settings metadata");
assert(syncTarget.remoteSyncStatus().lastAppliedSnapshot.conflicts >= 1, "remote sync status did not record apply conflicts");
assert(syncTarget.remoteSyncStatus().lastAppliedSnapshot.refused >= 1, "remote sync status did not record refused apply records");
assert(syncTarget.remoteSyncStatus().lastAppliedSnapshot.refusedRecords.some((record) => record.path === "/var/lib/dindbos/packages/session-pkg.json"), "remote sync status did not retain refused package record details");
const retryResult = await syncTarget.retryRemoteSyncRefusals({
  passphrase: "session-sync-secret",
  snapshot: syncSnapshot,
});
assert(retryResult.applied >= 1 && retryResult.refused === 0, "remote sync refused retry did not apply validated package metadata");
assert(syncTarget.fs.exists("/var/lib/dindbos/packages/session-pkg.json"), "remote sync refused retry did not restore package metadata");
assert(JSON.parse(syncTarget.fs.readFile("/var/lib/dindbos/packages/session-pkg.json")).id === "session-pkg", "remote sync refused retry wrote the wrong package record");
assert(syncTarget.remoteSyncStatus().lastRetry.applied >= 1, "remote sync status did not record refused retry result");
const lockStorage = createStorage(new Map());
const retryLocker = new DindbOS({ root: null, storage: lockStorage, instanceId: "sync-retry-locker" });
const lockedRetryTarget = new DindbOS({ root: null, storage: lockStorage, instanceId: "sync-retry-target" });
await retryLocker.loadPersistentFileSystem();
await lockedRetryTarget.loadPersistentFileSystem();
const retryLock = retryLocker.acquireRuntimeOperationLock("package-db", { operation: "install", packageId: "session-pkg" });
lockedRetryTarget.remoteSync.lastAppliedSnapshot = syncTarget.remoteSyncStatus().lastAppliedSnapshot;
const lockedRetryResult = await lockedRetryTarget.retryRemoteSyncRefusals({
  passphrase: "session-sync-secret",
  snapshot: syncSnapshot,
});
assert(lockedRetryResult.refused >= 1, "remote sync refused retry ignored package-db operation lock");
assert(!lockedRetryTarget.fs.exists("/var/lib/dindbos/packages/session-pkg.json"), "remote sync refused retry wrote package metadata while locked");
retryLocker.releaseRuntimeOperationLock("package-db", retryLock);
const pendingSyncConflicts = syncTarget.listRemoteSyncConflicts();
assert(pendingSyncConflicts.length >= 1, "remote sync conflict repair list did not find conflict copies");
const repairedConflict = syncTarget.resolveRemoteSyncConflict(pendingSyncConflicts[0].path, { action: "use-conflict" });
assert(repairedConflict.action === "use-conflict", "remote sync conflict repair action mismatch");
assert(syncTarget.fs.readFile(repairedConflict.targetPath).includes("peer edit"), "remote sync conflict repair did not apply conflict bytes");
assert(!syncTarget.fs.exists(repairedConflict.path), "remote sync conflict repair did not remove conflict copy");
assert(syncTarget.remoteSyncStatus().lastRepair.remainingConflicts === syncTarget.listRemoteSyncConflicts().length, "remote sync status did not record repair result");
const resumeTarget = new DindbOS({ root: null, storage: createStorage(new Map()), instanceId: "sync-resume-target" });
await resumeTarget.loadPersistentFileSystem();
const interruptedApply = await resumeTarget.applyRemoteSyncSnapshot({
  passphrase: "session-sync-secret",
  snapshot: syncSnapshot,
  maxFiles: 1,
});
assert(interruptedApply.status === "interrupted" && interruptedApply.nextIndex === 1, "remote sync apply did not record interrupted run");
assert(resumeTarget.remoteSyncStatus().lastApplyRun.status === "interrupted", "remote sync status did not expose interrupted apply run");
assert(JSON.parse(resumeTarget.fs.readFile("/var/run/dindbos/remote-sync-apply.json")).nextIndex === 1, "remote sync apply checkpoint was not persisted");
const resumedApply = await resumeTarget.resumeRemoteSyncApply({
  passphrase: "session-sync-secret",
  snapshot: syncSnapshot,
});
assert(resumedApply.status === "complete" && resumedApply.startIndex === 1, "remote sync apply resume did not continue from checkpoint");
assert(resumeTarget.remoteSyncStatus().lastApplyRun.status === "complete", "remote sync status did not record completed resumed apply");
assert(resumeTarget.fs.exists("/etc/dindbos/sync-settings.json"), "remote sync resumed apply did not restore remaining settings file");

console.log("sessions smoke ok generated-home user-scopes ownership credentials session-switch admin-audit login-lock coordination file-events conflicts storage-flush app-state packages handoff handoff-relay package-lock reload-recovery sync-snapshot sync-coverage sync-merge sync-apply sync-repair sync-resume sync-retry");

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
    readValueSync(key) {
      return values.get(key) ?? null;
    },
    writeValue(key, value) {
      values.set(key, value);
    },
    removeValue(key) {
      values.delete(key);
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

function ensureDirectory(os, path) {
  const parts = path.split("/").filter(Boolean);
  let cursor = "";
  parts.forEach((part) => {
    cursor = `${cursor}/${part}`;
    if (!os.fs.exists(cursor)) {
      os.fs.createDirectory(cursor, "/", {
        owner: "root",
        group: "root",
        permissions: "drwxr-xr-x",
      }, os.permissions.systemPrincipal());
    }
  });
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
