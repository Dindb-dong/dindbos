#!/usr/bin/env node
import { ShellSession } from "../src/dindbos/shell.js";
import { DescriptorManager } from "../src/dindbos/descriptors.js";
import { EventBus } from "../src/dindbos/event-bus.js";
import { KernelObjectRegistry } from "../src/dindbos/kernel-objects.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { ProcessManager } from "../src/dindbos/process-manager.js";
import { SyscallDispatcher } from "../src/dindbos/syscalls.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const shell = new ShellSession(bootOs());
let descriptorPipeCalls = 0;
const originalPipe = shell.os.descriptors.pipe.bind(shell.os.descriptors);
shell.os.descriptors.pipe = (...args) => {
  descriptorPipeCalls += 1;
  return originalPipe(...args);
};

let result = await shell.executeAsync('echo "alpha|beta" | grep "|"');
assert(result.status === 0, `quoted pipe pipeline status mismatch: ${result.status}`);
assert(result.output === "alpha|beta", `quoted pipe output mismatch: ${JSON.stringify(result.output)}`);
assert(descriptorPipeCalls >= 2, `pipeline did not use descriptor pipes: ${descriptorPipeCalls}`);
const pipelineExit = shell.os.processes.history.find((entry) => entry.appId === "shell:pipeline" && entry.state === "pipeline-exit");
assert(pipelineExit, "shell pipeline process exit was not recorded");
assert(!shell.os.descriptors.tables.has(pipelineExit.pid), "shell pipeline descriptor table remained after exit");
assert(!shell.os.fs.exists(`/proc/${pipelineExit.pid}/fd.json`), "shell pipeline fd procfs remained after exit");

shell.os.fs.writeOrCreateFile("/home/guest/handle-note.txt", "handle smoke", "/", {
  owner: "guest",
  group: "users",
  permissions: "-rw-r--r--",
}, shell.os.permissions.systemPrincipal());
const handleProcess = shell.os.processes.spawn({
  id: "handle-smoke",
  name: "Handle Smoke",
  manifest: { capabilities: [], fileSystem: { read: ["/home/guest"], write: ["/home/guest"] } },
}, { cwd: "/home/guest" });
const handleDescriptor = shell.os.descriptors.open(handleProcess, { path: "handle-note.txt", flags: "r" }, {
  process: handleProcess,
  principal: shell.os.permissions.principal(shell.os.session),
  assertFileSystem: (path) => {
    if (path === "/home/guest" || path.startsWith("/home/guest/")) return;
    throw new Error(`handle-smoke denied ${path}`);
  },
});
result = await shell.executeAsync(`handlectl list ${handleProcess.pid}`);
assert(result.status === 0 && result.output.includes(handleDescriptor.handleId), `handlectl list missing handle: ${result.output}`);
result = await shell.executeAsync(`handlectl stat ${handleDescriptor.handleId}`);
assert(result.status === 0 && result.output.includes(`Handle:\t${handleDescriptor.handleId}`) && result.output.includes("ObjectStatus:\tactive"), `handlectl stat mismatch: ${result.output}`);
result = await shell.executeAsync(`lsof ${handleProcess.pid}`);
assert(result.status === 0 && result.output.includes(handleDescriptor.handleId) && result.output.includes("descriptor"), `lsof missing descriptor handle: ${result.output}`);
result = await shell.executeAsync("handlectl stat kh-missing");
assert(result.status === 1 && result.output.includes("no such handle"), `handlectl missing status mismatch: ${result.output}`);
shell.os.processes.kill(handleProcess.pid, "handlectl-smoke-exit");
result = await shell.executeAsync(`handlectl list ${handleProcess.pid} --all`);
assert(result.status === 0 && result.output.includes(handleDescriptor.handleId) && result.output.includes("revoked"), `handlectl all missing revoked handle: ${result.output}`);
result = await shell.executeAsync(`lsof ${handleProcess.pid} --all`);
assert(result.status === 0 && result.output.includes(handleDescriptor.handleId) && result.output.includes("revoked"), `lsof all missing revoked handle: ${result.output}`);

result = await shell.executeAsync('echo "left;right"; echo done');
assert(result.status === 0, `quoted semicolon command status mismatch: ${result.status}`);
assert(result.output === "left;right\ndone", `quoted semicolon output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("echo \"say \\\"hello\\\"\" | grep \"hello\"");
assert(result.status === 0, `escaped quote pipeline status mismatch: ${result.status}`);
assert(result.output === 'say "hello"', `escaped quote pipeline output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("echo '' \"\" tail");
assert(result.status === 0, `empty string token status mismatch: ${result.status}`);
assert(result.output === "  tail", `empty string token output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("echo persisted > note.txt && cat note.txt");
assert(result.status === 0, `redirection chain status mismatch: ${result.status}`);
assert(result.output === "persisted\n", `redirection chain output mismatch: ${JSON.stringify(result.output)}`);
assert(shell.os.storageReservations.some((entry) => entry.scope === "shell-write" && entry.path === "/home/guest/note.txt" && entry.operation === "redirect-write"), "shell redirection did not reserve storage before VFS write");
shell.os.denyNextStorageReservation("simulated shell quota denial");
result = await shell.executeAsync("echo blocked > denied-quota.txt");
assert(result.status === 1, `shell quota denial status mismatch: ${result.status}`);
assert(result.output.includes("simulated shell quota denial"), `shell quota denial output mismatch: ${result.output}`);
assert(!shell.os.fs.exists("/home/guest/denied-quota.txt"), "shell quota denial mutated the VFS");

result = await shell.executeAsync("echo alpha>compact.txt && grep alpha < compact.txt | grep alpha > filtered.txt && cat filtered.txt");
assert(result.status === 0, `mixed redirection pipeline status mismatch: ${result.status}`);
assert(result.output === "alpha\n", `mixed redirection pipeline output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("missing-command && echo should-not-run || echo fallback");
assert(result.status === 0, `fallback chain final status mismatch: ${result.status}`);
assert(result.output === "command not found: missing-command\nfallback", `fallback chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("missing-command || echo recovered && echo final");
assert(result.status === 0, `recovery chain final status mismatch: ${result.status}`);
assert(result.output === "command not found: missing-command\nrecovered\nfinal", `recovery chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("cat missing.txt");
assert(result.status === 1, `missing file status mismatch: ${result.status}`);
assert(result.output.includes("File not found"), `missing file output mismatch: ${result.output}`);

result = await shell.executeAsync("echo alpha | grep beta && echo should-not-run || echo no-match");
assert(result.status === 0, `grep no-match chain status mismatch: ${result.status}`);
assert(result.output === "no-match", `grep no-match chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("which not-installed && echo should-not-run || echo missing-path");
assert(result.status === 0, `which missing chain status mismatch: ${result.status}`);
assert(result.output === "missing-path", `which missing chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("npm && echo should-not-run || echo usage-status");
assert(result.status === 0, `usage chain final status mismatch: ${result.status}`);
assert(result.output === "npm: usage: npm install <package...>\nusage-status", `usage chain output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("npm");
assert(result.status === 2, `usage status code mismatch: ${result.status}`);
assert(result.output === "npm: usage: npm install <package...>", `usage output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("kill");
assert(result.status === 2, `kill usage status mismatch: ${result.status}`);
assert(result.output === "kill: usage: kill <pid>", `kill usage output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("kill 999");
assert(result.status === 1, `kill missing pid status mismatch: ${result.status}`);
assert(result.output.includes("no such process"), `kill missing pid output mismatch: ${result.output}`);

result = await shell.executeAsync("stat /missing");
assert(result.status === 1, `stat missing path status mismatch: ${result.status}`);
assert(result.output === "stat: no such file or directory", `stat missing path output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("find /missing needle");
assert(result.status === 1, `find missing path status mismatch: ${result.status}`);
assert(result.output.includes("no such file or directory"), `find missing path output mismatch: ${result.output}`);

result = await shell.executeAsync("man no-such-command");
assert(result.status === 1, `man missing entry status mismatch: ${result.status}`);
assert(result.output.includes("no manual entry"), `man missing entry output mismatch: ${result.output}`);

result = await shell.executeAsync("manifest missing-app");
assert(result.status === 1, `manifest missing app status mismatch: ${result.status}`);
assert(result.output.includes("no such app"), `manifest missing app output mismatch: ${result.output}`);

result = await shell.executeAsync("sudo echo elevated && echo should-not-run || echo no-escalation");
assert(result.status === 0, `sudo unsupported chain status mismatch: ${result.status}`);
assert(
  result.output === "sudo: unsupported in DindbOS browser runtime; session user is fixed to guest\nno-escalation",
  `sudo unsupported chain output mismatch: ${JSON.stringify(result.output)}`,
);

result = await shell.executeAsync("su root");
assert(result.status === 1, `su unsupported status mismatch: ${result.status}`);
assert(result.output === "su: unsupported in DindbOS browser runtime; session user is fixed to guest", `su unsupported output mismatch: ${JSON.stringify(result.output)}`);
let securityAuditLog = shell.os.fs.readFile("/var/log/dindbos/security-audit.log");
assert(securityAuditLog.includes("action=permission-escalation:sudo decision=denied"), "security audit missing denied sudo escalation");
assert(securityAuditLog.includes("action=permission-escalation:su decision=denied"), "security audit missing denied su escalation");
assert(securityAuditLog.includes("reason=unsupported-browser-runtime"), "security audit missing privilege escalation reason");

result = await shell.executeAsync('echo "cat: no such text is still file content" > literal.txt && cat literal.txt');
assert(result.status === 0, `literal content status mismatch: ${result.status}`);
assert(result.output === "cat: no such text is still file content\n", `literal content output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("opne");
assert(result.status === 1, `unknown builtin typo status mismatch: ${result.status}`);
assert(result.output.includes("Did you mean: open"), `builtin suggestion mismatch: ${result.output}`);

result = await shell.executeAsync("calculatr");
assert(result.status === 1, `unknown app typo status mismatch: ${result.status}`);
assert(result.output.includes("open Calculator"), `app suggestion mismatch: ${result.output}`);

result = await shell.executeAsync("hello-note");
assert(result.status === 1, `unknown package typo status mismatch: ${result.status}`);
assert(result.output.includes("pkg info hello-notes"), `package suggestion mismatch: ${result.output}`);

result = await shell.executeAsync("doctor");
assert(result.status === 0, `doctor status mismatch: ${result.status}`);
assert(result.output.includes("DindbOS doctor"), `doctor heading missing: ${result.output}`);
assert(result.output.includes("session user=guest"), `doctor session output missing: ${result.output}`);
assert(result.output.includes("sessionCoord role=primary owner=runtime-smoke readonly=false"), `doctor session coordination output missing: ${result.output}`);
assert(result.output.includes("sessionHandoff active=handoff-1 mode=control peer=remote-tab last=accept relayFrames=3 relayInputs=2"), `doctor session handoff output missing: ${result.output}`);
assert(result.output.includes("storage backend=memory"), `doctor storage output missing: ${result.output}`);
assert(result.output.includes("localMounts supported=false mounted=0"), `doctor mount output missing: ${result.output}`);
assert(result.output.includes("helper=unavailable rename=false"), `doctor helper output missing: ${result.output}`);
assert(result.output.includes("packages installed=1"), `doctor package output missing: ${result.output}`);
assert(result.output.includes("processes running=0"), `doctor process output missing: ${result.output}`);
assert(result.output.includes("compositor focused=settings pid=100 surfaces=2 lastInput=keydown"), `doctor compositor output missing: ${result.output}`);
assert(result.output.includes("lifecycle state=active"), `doctor lifecycle output missing: ${result.output}`);
assert(result.output.includes("closedPagePersistent=false"), `doctor recovery output missing: ${result.output}`);
assert(result.output.includes("sync backend=storage-value encrypted=true lastSnapshot=2026-05-05T00:02:00.000Z files=2 cache=1 settings=1 lastApplied=2026-05-05T00:03:00.000Z conflicts=1 refused=2 lastRetry=2026-05-05T00:04:00.000Z retryApplied=1 retryRefused=0"), `doctor sync output missing: ${result.output}`);
assert(result.output.includes("syncMerge planner=offline-first rules=6"), `doctor sync merge output missing: ${result.output}`);
assert(result.output.includes("docs/support.md"), `doctor troubleshooting output missing: ${result.output}`);

result = await shell.executeAsync("recovery status");
assert(result.status === 0, `recovery status mismatch: ${result.status}`);
assert(result.output.includes("serviceWorker=available-but-not-registered"), `recovery status service worker missing: ${result.output}`);
assert(result.output.includes("safeBootProfiles=normal,safe-mode,offline"), `recovery status safe profiles missing: ${result.output}`);

result = await shell.executeAsync("recovery profiles");
assert(result.output.includes("safe-mode status=available disables=packages,services"), `recovery profiles output missing: ${result.output}`);

result = await shell.executeAsync("recovery queue storage.flush");
assert(result.output.includes("queued offline-smoke storage.flush"), `recovery queue output missing: ${result.output}`);

result = await shell.executeAsync("conformance");
assert(result.status === 0, `conformance status mismatch: ${result.status}`);
assert(result.output.includes("package-platform level=supported"), `conformance package platform missing: ${result.output}`);

result = await shell.executeAsync("conformance matrix");
assert(result.output.includes("installed-pwa level=degraded"), `conformance matrix missing PWA profile: ${result.output}`);

result = await shell.executeAsync("doctor compat");
assert(result.status === 0, `doctor compat status mismatch: ${result.status}`);
assert(result.output.includes("DindbOS compatibility"), `doctor compat heading missing: ${result.output}`);
assert(result.output.includes("tier A supported dindbos-js"), `doctor compat tier A missing: ${result.output}`);
assert(result.output.includes("tier C planned wasi-wasm"), `doctor compat tier C missing: ${result.output}`);
assert(result.output.includes("serviceWorker=false periodicSync=false"), `doctor compat background browser probes missing: ${result.output}`);
assert(result.output.includes("isolation current=degraded-shared-memory crossOriginIsolated=false sharedMemory=degraded"), `doctor compat isolation output missing: ${result.output}`);
assert(result.output.includes("background serviceWorker=false periodicSync=false registered=false closedPagePersistent=false decision=unsupported-in-this-runtime"), `doctor compat background boundary missing: ${result.output}`);
assert(result.output.includes("unsupported native=kernel-mode execution"), `doctor compat unsupported native boundary missing: ${result.output}`);

result = await shell.executeAsync("doctor isolation");
assert(result.status === 0, `doctor isolation status mismatch: ${result.status}`);
assert(result.output.includes("DindbOS isolation"), `doctor isolation heading missing: ${result.output}`);
assert(result.output.includes("headers COOP=same-origin COEP=require-corp"), `doctor isolation headers missing: ${result.output}`);
assert(result.output.includes("workerMemory status=copy-fallback transfer=ArrayBuffer copy fallback"), `doctor isolation worker memory missing: ${result.output}`);
assert(result.output.includes("profile origin-isolated status=requires-headers"), `doctor isolation profile missing: ${result.output}`);

result = await shell.executeAsync("doctor browser");
assert(result.status === 0, `doctor browser status mismatch: ${result.status}`);
assert(result.output.includes("DindbOS browser brokers"), `doctor browser heading missing: ${result.output}`);
assert(result.output.includes("summary available=2/2 ledger=1 revoked=1"), `doctor browser summary missing: ${result.output}`);
assert(result.output.includes("screen.capture available broker=screen-capture device=/dev/browser/screen access=1 revoked=1"), `doctor browser broker line missing: ${result.output}`);

result = await shell.executeAsync("mount");
assert(result.status === 0, `mount status mismatch: ${result.status}`);
assert(result.output.includes("rootfs / rootfs rw"), `mount output missing rootfs entry: ${result.output}`);
assert(result.output.includes("procfs /proc procfs ro"), `mount output missing procfs entry: ${result.output}`);
assert(result.output.includes("usedBytes="), `mount output missing used bytes: ${result.output}`);
assert(result.output.includes("support="), `mount output missing support boundary: ${result.output}`);
result = await shell.executeAsync("df");
assert(result.status === 0, `df status mismatch: ${result.status}`);
assert(result.output.includes("Filesystem     Driver"), `df mount-table header missing: ${result.output}`);
assert(result.output.includes("browser-storage"), `df quota policy missing: ${result.output}`);
assert(result.output.includes("browser-vfs"), `df support boundary missing: ${result.output}`);
result = await shell.executeAsync("mount -t memfs /mnt/scratch --readonly");
assert(result.status === 0, `memfs mount status mismatch: ${result.status}`);
assert(result.output.includes("mounted /mnt/scratch memfs ro"), `memfs mount output mismatch: ${result.output}`);
assert(shell.os.fs.exists("/mnt/scratch"), "memfs mount did not create VFS mount root");
result = await shell.executeAsync("syscall mount.list '{}'");
assert(result.status === 0, `mount.list status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value.some((entry) => entry.root === "/mnt/scratch" && entry.readonly === true), `mount.list missing memfs entry: ${result.output}`);
result = await shell.executeAsync("syscall mount.mount '{\"path\":\"/mnt/sysmem\",\"driver\":\"memfs\"}'");
assert(result.status === 0, `mount.mount status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value.root === "/mnt/sysmem", `mount.mount output mismatch: ${result.output}`);
result = await shell.executeAsync("syscall mount.unmount '{\"path\":\"/mnt/sysmem\"}'");
assert(result.status === 0, `mount.unmount status mismatch: ${result.status}`);
assert(!shell.os.fs.exists("/mnt/sysmem"), "mount.unmount left VFS mount root");
result = await shell.executeAsync("umount /mnt/scratch");
assert(result.status === 0, `shell umount status mismatch: ${result.status}`);
assert(!shell.os.fs.exists("/mnt/scratch"), "shell umount left VFS mount root");

result = await shell.executeAsync("mount-local --helper");
assert(result.status === 0, `mount helper status mismatch: ${result.status}`);
assert(result.output.includes("protocol=dindbos-file-helper-v1"), `mount helper protocol missing: ${result.output}`);
assert(result.output.includes("rename=false"), `mount helper rename output missing: ${result.output}`);

result = await shell.executeAsync("sync status");
assert(result.status === 0, `sync status mismatch: ${result.status}`);
assert(result.output.includes("pendingConflicts=1"), `sync status did not show pending conflicts: ${result.output}`);
assert(result.output.includes("applyRun=interrupted next=2/5"), `sync status did not show interrupted apply run: ${result.output}`);
assert(result.output.includes("lastRetry=2026-05-05T00:04:00.000Z applied=1 refused=0"), `sync status did not show retry result: ${result.output}`);
result = await shell.executeAsync("sync conflicts");
assert(result.status === 0 && result.output.includes("/home/guest/Documents/.sync-conflicts/note.txt.2026.remote -> /home/guest/Documents/note.txt"), `sync conflicts output mismatch: ${result.output}`);
result = await shell.executeAsync("sync resolve keep-local /home/guest/Documents/.sync-conflicts/note.txt.2026.remote");
assert(result.status === 0 && result.output.includes("action=keep-local"), `sync resolve output mismatch: ${result.output}`);

result = await shell.executeAsync("syscall fs.writeText '{\"path\":\"syscall-note.txt\",\"content\":\"via syscall\"}'");
assert(result.status === 0, `syscall write status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value.path === "/home/guest/syscall-note.txt", `syscall write path mismatch: ${result.output}`);
result = await shell.executeAsync("syscall fs.readText '{\"path\":\"syscall-note.txt\"}'");
assert(result.status === 0, `syscall read status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value === "via syscall", `syscall read output mismatch: ${result.output}`);
result = await shell.executeAsync("syscall env.get '{\"key\":\"PWD\"}'");
assert(result.status === 0, `syscall env.get status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value === "/home/guest", `syscall env.get output mismatch: ${result.output}`);
result = await shell.executeAsync("syscall package.info '{\"packageId\":\"hello-notes\"}'");
assert(result.status === 0, `syscall package.info status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value.id === "hello-notes", `syscall package.info output mismatch: ${result.output}`);
result = await shell.executeAsync("syscall app.list '{}'");
assert(result.status === 0, `syscall app.list status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value[0].id === "calculator", `syscall app.list output mismatch: ${result.output}`);
result = await shell.executeAsync("syscall storage.status '{}'");
assert(result.status === 0, `syscall storage.status status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value.backend === "memory", `syscall storage.status output mismatch: ${result.output}`);
const beforeStorageSyncFlushes = shell.os.storageFlushes;
result = await shell.executeAsync("syscall storage.sync '{}'");
assert(result.status === 0, `syscall storage.sync status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value.synced === true, `syscall storage.sync output mismatch: ${result.output}`);
assert(shell.os.storageFlushes === beforeStorageSyncFlushes + 1, "syscall storage.sync did not reach runtime flush");
shell.os.fs.resolve("/home/guest/syscall-note.txt").size = 12345;
result = await shell.executeAsync("fsck --dry-run");
assert(result.status === 0, `fsck dry-run status mismatch: ${result.status}`);
assert(result.output.includes("ok=false") && result.output.includes("size-mismatch"), `fsck dry-run output mismatch: ${result.output}`);
assert(shell.os.fs.stat("/home/guest/syscall-note.txt").size === 12345, "fsck dry-run mutated file size");
assert(shell.os.fs.readFile("/var/log/dindbos/fsck.log").includes("codes=size-mismatch"), "fsck dry-run did not write fsck log");
let fsckAudit = shell.os.fs.readFile("/var/log/dindbos/fsck-audit.log");
assert(fsckAudit.includes('"action":"repair-planned"') && fsckAudit.includes('"action":"mutation-planned"'), "fsck dry-run did not write planned audit records");
result = await shell.executeAsync("fsck --dry-run --explain");
assert(result.status === 0, `fsck explain status mismatch: ${result.status}`);
assert(result.output.includes("explain size-mismatch") && result.output.includes("safe repair recalculates size only"), `fsck explain output mismatch: ${result.output}`);
result = await shell.executeAsync("fsck --repair");
assert(result.status === 0, `fsck repair status mismatch: ${result.status}`);
assert(result.output.includes("repaired=true") || result.output.includes("dryRun=false"), `fsck repair output mismatch: ${result.output}`);
assert(shell.os.fs.stat("/home/guest/syscall-note.txt").size === "via syscall".length, "fsck repair did not fix file size");
assert(shell.os.fs.readFile("/var/log/dindbos/fsck.log").includes("repaired=true"), "fsck repair did not write repaired fsck log");
fsckAudit = shell.os.fs.readFile("/var/log/dindbos/fsck-audit.log");
assert(fsckAudit.includes('"action":"mutation-applied"') && fsckAudit.includes('"kind":"size"'), "fsck repair did not write applied audit record");
shell.os.setStorageFsckProblem("storage-journal-partial", "dindbos:vfs:journal:active", "transaction=storage-tx-smoke replay=missing");
result = await shell.executeAsync("fsck --dry-run --explain");
assert(result.status === 0, `storage fsck status mismatch: ${result.status}`);
assert(result.output.includes("storage=1") && result.output.includes("storage-journal-partial"), `storage fsck output mismatch: ${result.output}`);
assert(result.output.includes("last complete manifest remains authoritative"), `storage fsck explanation mismatch: ${result.output}`);
assert(shell.os.fs.readFile("/var/log/dindbos/fsck.log").includes("codes=storage-journal-partial"), "storage fsck did not write partial journal code");
shell.os.setLocalMountFsckProblem("local-mount-stale-metadata", "/mnt/stale", "persisted local mount record is missing a directory handle or mount path");
result = await shell.executeAsync("fsck --dry-run --explain");
assert(result.status === 0, `local mount fsck status mismatch: ${result.status}`);
assert(result.output.includes("localMounts=1") && result.output.includes("local-mount-stale-metadata"), `local mount fsck output mismatch: ${result.output}`);
assert(result.output.includes("safe repair removes only that stale record"), `local mount fsck explanation mismatch: ${result.output}`);
result = await shell.executeAsync("fsck --salvage");
assert(result.status === 0, `fsck salvage status mismatch: ${result.status}`);
const salvageLine = result.output.split("\n").find((line) => line.startsWith("salvage "));
assert(salvageLine, `fsck salvage output missing: ${result.output}`);
const salvagePath = salvageLine.split(" ")[1];
assert(shell.os.fs.exists(salvagePath), "fsck salvage archive file was not written");
const salvageArchive = JSON.parse(shell.os.fs.readFile(salvagePath));
assert(salvageArchive.kind === "dindbos-fsck-salvage-v1", "fsck salvage archive kind mismatch");
assert(salvageArchive.entries.some((entry) => entry.path === "/home/guest/note.txt"), "fsck salvage archive missing user file");
assert(salvageArchive.skipped.some((entry) => entry.path === "/var/recovery" && entry.reason === "recovery-output"), "fsck salvage archive did not skip recovery output");
result = await shell.executeAsync("syscall localMount.status '{}'");
assert(result.status === 0, `syscall localMount.status status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value.supported === false, `syscall localMount.status output mismatch: ${result.output}`);
result = await shell.executeAsync("syscall future.native '{}'");
assert(result.status === 1, `unsupported syscall status mismatch: ${result.status}`);
assert(JSON.parse(result.output).error.code === "ENOSYS", `unsupported syscall errno mismatch: ${result.output}`);

const trustKey = "ed25519-pub:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
result = await shell.executeAsync("storage flush");
assert(result.status === 1, `non-admin storage flush status mismatch: ${result.status}`);
assert(result.output.includes("administrator required"), `non-admin storage flush output mismatch: ${result.output}`);
assert(shell.os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:storage-flush decision=denied"), "security audit missing denied storage flush");
result = await shell.executeAsync("storage persist");
assert(result.status === 1, `non-admin storage persist status mismatch: ${result.status}`);
assert(result.output.includes("administrator required"), `non-admin storage persist output mismatch: ${result.output}`);
assert(shell.os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:storage-persist decision=denied"), "security audit missing denied storage persist");
result = await shell.executeAsync("resetfs");
assert(result.status === 1, `non-admin resetfs status mismatch: ${result.status}`);
assert(result.output.includes("administrator required"), `non-admin resetfs output mismatch: ${result.output}`);
assert(shell.os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:resetfs decision=denied"), "security audit missing denied resetfs");
result = await shell.executeAsync(`pkg trust add com.example ${trustKey} Example Publisher`);
assert(result.status === 1, `non-admin pkg trust add status mismatch: ${result.status}`);
assert(result.output.includes("administrator required"), `non-admin pkg trust add output mismatch: ${result.output}`);
assert(shell.os.fs.readFile("/var/log/dindbos/security-audit.log").includes("decision=denied"), "security audit missing denied package trust change");
shell.os.session.groups = ["users", "admins"];
shell.principal = shell.os.permissions.principal(shell.os.session);
const beforeAdminFlushes = shell.os.storageFlushes;
result = await shell.executeAsync("storage flush");
assert(result.status === 0, `admin storage flush status mismatch: ${result.status}`);
assert(result.output.includes("backend=memory"), `admin storage flush output mismatch: ${result.output}`);
assert(shell.os.storageFlushes === beforeAdminFlushes + 1, "admin storage flush did not reach runtime");
assert(shell.os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:storage-flush decision=allowed"), "security audit missing allowed storage flush");
result = await shell.executeAsync("storage persist");
assert(result.status === 0, `admin storage persist status mismatch: ${result.status}`);
assert(result.output.includes("persisted=true"), `admin storage persist output mismatch: ${result.output}`);
assert(shell.os.storagePersists === 1, "admin storage persist did not reach runtime");
assert(shell.os.fs.readFile("/var/log/dindbos/security-audit.log").includes("action=system-settings:storage-persist decision=allowed"), "security audit missing allowed storage persist");
result = await shell.executeAsync(`pkg trust add com.example ${trustKey} Example Publisher`);
assert(result.status === 0, `pkg trust add status mismatch: ${result.status}`);
assert(result.output === "trusted publisher added com.example", `pkg trust add output mismatch: ${result.output}`);
assert(shell.os.fs.readFile("/var/log/dindbos/security-audit.log").includes("decision=allowed"), "security audit missing allowed package trust change");
result = await shell.executeAsync("pkg trust list");
assert(result.status === 0, `pkg trust list status mismatch: ${result.status}`);
assert(result.output.includes("com.example"), `pkg trust list missing publisher: ${result.output}`);
result = await shell.executeAsync("pkg trust remove com.example");
assert(result.status === 0, `pkg trust remove status mismatch: ${result.status}`);
assert(result.output === "trusted publisher removed com.example", `pkg trust remove output mismatch: ${result.output}`);

const system = shell.os.permissions.systemPrincipal();
shell.os.fs.createDirectory("/home/guest/bin", "/", { owner: "guest", group: "users" }, system);
shell.os.fs.writeOrCreateFile(
  "/home/guest/bin/hello",
  "#!/bin/dindbsh\n# comment lines are skipped\necho hello $1\necho args:$@\n",
  "/",
  { owner: "guest", group: "users", permissions: "-rw-r--r--" },
  system,
);
shell.os.fs.writeOrCreateFile(
  "/home/guest/bin/pick",
  "#!/usr/bin/env dindbsh\ngrep $1\n",
  "/",
  { owner: "guest", group: "users", permissions: "-rw-r--r--" },
  system,
);
shell.os.fs.writeOrCreateFile(
  "/home/guest/bin/locked",
  "#!/bin/dindbsh\necho should-not-run\n",
  "/",
  { owner: "guest", group: "users", permissions: "-rw-r--r--" },
  system,
);
shell.os.fs.writeOrCreateFile(
  "/home/guest/bin/pythonish",
  "#!/usr/bin/python3\necho should-not-run\n",
  "/",
  { owner: "guest", group: "users", permissions: "-rwxr-xr-x" },
  system,
);

result = await shell.executeAsync("export PATH=$PATH:/home/guest/bin && chmod 755 /home/guest/bin/hello && which hello && hello max kim");
assert(result.status === 0, `script path execution status mismatch: ${result.status}`);
assert(
  result.output === "/home/guest/bin/hello\nhello max\nargs:max kim",
  `script path execution output mismatch: ${JSON.stringify(result.output)}`,
);

result = await shell.executeAsync("chmod 755 /home/guest/bin/pick && echo alpha beta | pick beta");
assert(result.status === 0, `script stdin pipeline status mismatch: ${result.status}`);
assert(result.output === "alpha beta", `script stdin pipeline output mismatch: ${JSON.stringify(result.output)}`);

result = await shell.executeAsync("/home/guest/bin/locked");
assert(result.status === 1, `non-executable script status mismatch: ${result.status}`);
assert(result.output.includes("permission denied"), `non-executable script output mismatch: ${result.output}`);

result = await shell.executeAsync("/home/guest/bin/pythonish");
assert(result.status === 1, `unsupported shebang status mismatch: ${result.status}`);
assert(result.output.includes("unsupported interpreter"), `unsupported shebang output mismatch: ${result.output}`);

const textSystem = shell.os.permissions.systemPrincipal();
for (const [name, content] of Object.entries({
  "text-lines.txt": "pear\napple\napple\nlast",
  "unicode.txt": "한글 café\n",
  "empty.txt": "",
  "text-errors.txt": "head: usage: ordinary content\n",
  "numbers.txt": "12\n2\n-3\n",
})) shell.os.fs.writeOrCreateFile(`/home/guest/${name}`, content, "/", { owner: "guest", group: "users" }, textSystem);

const textCases = [
  ["head -n 2 text-lines.txt", "pear\napple\n"],
  ["tail -n 2 text-lines.txt", "apple\nlast"],
  ["tail -n 0 text-lines.txt", ""],
  ["head -n 0 text-lines.txt", ""],
  ["head empty.txt", ""],
  ["tail empty.txt", ""],
  ["wc unicode.txt", "1 2 13 unicode.txt"],
  ["wc -wc < unicode.txt", "2 13"],
  ["wc -l text-lines.txt", "3 text-lines.txt"],
  ["wc -lwc empty.txt", "0 0 0 empty.txt"],
  ["cat text-lines.txt | sort | uniq -c", "2 apple\n1 last\n1 pear\n"],
  ["sort -nr numbers.txt", "12\n2\n-3\n"],
  ["uniq text-lines.txt", "pear\napple\nlast\n"],
  ["echo final | tail -n 1 -", "final"],
  ["echo repeated | uniq -c", "1 repeated\n"],
  ["sort empty.txt", ""],
  ["uniq -c empty.txt", ""],
  ["head text-errors.txt", "head: usage: ordinary content\n"],
  ["basename '/some folder/file.txt' .txt", "file"],
  ["basename /some/path/", "path"],
  ["basename /", "/"],
  ["basename ''", ""],
  ["dirname /some/path/", "/some"],
  ["dirname file.txt", "."],
  ["dirname /", "/"],
  ["dirname ''", "."],
];
for (const run of [(line) => shell.execute(line), (line) => shell.executeAsync(line)]) {
  for (const [line, expected] of textCases) {
    const actual = await run(line);
    assert(actual.status === 0 && actual.output === expected, `${line}: ${JSON.stringify(actual)}`);
  }
  for (const line of ["head -n -1", "head -n", "tail -n 1.5", "head -n 9007199254740992", "tail -f", "wc -z", "sort --random", "uniq -d", "basename", "dirname a b", "head a b"]) {
    const actual = await run(line);
    assert(actual.status === 2 && actual.output.includes(": usage:"), `${line} must return usage status: ${JSON.stringify(actual)}`);
  }
  assert((await run("head -n invalid || echo recovered")).output.endsWith("recovered"), "usage status must drive ||");
  assert((await run("tail missing.txt")).status === 1, "text file read failure must return 1");
}
result = await shell.executeAsync("head -n 2 < text-lines.txt > first-lines.txt");
assert(result.status === 0 && shell.os.fs.readFile("/home/guest/first-lines.txt") === "pear\napple\n", "head input/output redirection preserves lines");
shell.os.fs.writeOrCreateFile("/home/guest/private.txt", "private", "/", { owner: "root", group: "root", permissions: "-rw-------" }, textSystem);
for (const command of ["head", "tail", "wc", "sort", "uniq"]) {
  const denied = await shell.executeAsync(`${command} private.txt`);
  assert(denied.status === 1 && /denied/i.test(denied.output), `${command} must retain read permission checks`);
  assert(shell.execute(`which ${command}`).output === `shell builtin: ${command}`, `${command} must be discoverable with which`);
  assert(shell.execute(`man ${command}`).status === 0, `${command} must have help`);
}
const previousMountCheck = shell.os.localMounts.isMountedPath;
shell.os.localMounts.isMountedPath = (path) => path.startsWith("/mnt/text/");
shell.os.localMounts.readFile = async (path) => {
  if (path.endsWith("missing")) throw new Error("mounted file not found");
  return "b\na\na\n";
};
for (const [line, expected] of [["head -n 1 /mnt/text/source", "b\n"], ["tail -n 1 /mnt/text/source", "a\n"], ["wc -l /mnt/text/source", "3 /mnt/text/source"], ["sort /mnt/text/source | uniq -c", "2 a\n1 b\n"]]) {
  const actual = await shell.executeAsync(line);
  assert(actual.status === 0 && actual.output === expected, `async mount ${line}: ${JSON.stringify(actual)}`);
}
assert((await shell.executeAsync("head /mnt/text/missing")).status === 1, "mounted read rejection propagates");
shell.os.localMounts.isMountedPath = previousMountCheck;
delete shell.os.localMounts.readFile;

console.log("shell smoke ok parser chaining status scripts and text utilities (sync, async mounts, Unicode, permissions)");

function bootOs() {
  const permissions = new PermissionPolicy();
  let os;
  const fs = new VirtualFileSystem(null, {
    home: "/home/guest",
    policy: permissions,
    onAccessDenied: (event) => os?.auditDeniedFileSystemAccess?.(event),
  });
  const trustedPublishers = [];
  let storageFlushes = 0;
  let storagePersists = 0;
  const storageReservations = [];
  let nextStorageDenial = "";
  let storageFsckProblem = null;
  let localMountFsckProblem = null;
  const system = permissions.systemPrincipal();
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  fs.createDirectory("/mnt", "/", { owner: "root", group: "root" }, system);
  const virtualMounts = new Map();
  os = {
    fs,
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    localMounts: {
      isMountedPath: () => false,
      supported: () => false,
      listMounts: () => [],
      copyPolicy: () => ({ actions: [] }),
      status: async () => [],
      nativeHelperStatus: () => ({
        configured: false,
        status: "unavailable",
        protocol: "dindbos-file-helper-v1",
        capabilities: [],
        renameSupported: false,
      }),
      checkIntegrity: ({ dryRun = true } = {}) => {
        const problems = localMountFsckProblem ? [{ ...localMountFsckProblem }] : [];
        localMountFsckProblem = null;
        return {
          ok: problems.length === 0,
          dryRun: Boolean(dryRun),
          checkedLocalMounts: 1,
          problemCount: problems.length,
          repairCount: 0,
          problems,
          repairs: [],
        };
      },
    },
    mountTable() {
      return [
        { id: "rootfs", root: "/", driver: "rootfs", readonly: false, owner: "root", durability: "persistent", quotaPolicy: "browser-storage", capabilities: [], usedBytes: 0, support: "browser-vfs" },
        { id: "procfs", root: "/proc", driver: "procfs", readonly: true, owner: "root", durability: "runtime", quotaPolicy: "generated", capabilities: [], usedBytes: 0, support: "generated" },
        ...virtualMounts.values(),
      ];
    },
    mountLines() {
      return this.mountTable().map((entry) => `${entry.id} ${entry.root} ${entry.driver} ${entry.readonly ? "ro" : "rw"} owner=${entry.owner} durability=${entry.durability} quota=${entry.quotaPolicy} usedBytes=${Number(entry.usedBytes || 0)} support=${entry.support || "browser-vfs"} caps=${entry.capabilities?.join(",") || "-"}`);
    },
    mountVirtual(path, options = {}, principal = system) {
      const normalized = this.fs.normalize(path);
      this.fs.createMount(normalized, {
        mountType: options.driver || "memfs",
        permissions: options.readonly ? "dr-xr-xr-x" : "drwxrwxrwx",
        owner: principal.user || "guest",
        group: principal.groups?.[0] || "users",
      }, system);
      const record = {
        id: `virtual:${normalized}`,
        root: normalized,
        driver: options.driver || "memfs",
        readonly: Boolean(options.readonly),
        owner: principal.user || "guest",
        durability: "runtime",
        quotaPolicy: "memory",
        capabilities: ["mount.manage"],
        usedBytes: 0,
        support: "browser-vfs",
      };
      virtualMounts.set(normalized, record);
      return record;
    },
    unmountVirtual(path) {
      const normalized = this.fs.normalize(path);
      const record = virtualMounts.get(normalized);
      if (!record) throw new Error(`umount: ${normalized}: not a virtual mount`);
      this.fs.remove(normalized, "/", { recursive: true }, system);
      virtualMounts.delete(normalized);
      return record;
    },
    storage: {
      reserveStorageBytes: (bytes, details = {}) => {
        if (nextStorageDenial) {
          const message = nextStorageDenial;
          nextStorageDenial = "";
          throw new Error(message);
        }
        storageReservations.push({ bytes, ...details });
        return true;
      },
      status: () => ({ backend: "memory", bytes: 0 }),
      estimate: async () => ({ backend: "memory", bytes: 0 }),
      checkIntegrity: ({ dryRun = true } = {}) => {
        const problems = storageFsckProblem ? [{ ...storageFsckProblem }] : [];
        storageFsckProblem = null;
        return {
          ok: problems.length === 0,
          dryRun: Boolean(dryRun),
          checkedStorage: 1,
          problemCount: problems.length,
          repairCount: 0,
          problems,
          repairs: [],
        };
      },
      persist: async () => {
        storagePersists += 1;
        return { backend: "memory", bytes: 0, persisted: true };
      },
    },
    get storageFlushes() {
      return storageFlushes;
    },
    get storagePersists() {
      return storagePersists;
    },
    get storageReservations() {
      return storageReservations;
    },
    denyNextStorageReservation(message) {
      nextStorageDenial = message || "simulated storage quota denial";
    },
    setStorageFsckProblem(code, path, message) {
      storageFsckProblem = { code, path, message, repairable: false };
    },
    setLocalMountFsckProblem(code, path, message) {
      localMountFsckProblem = { code, path, message, repairable: true };
    },
    flushPersistentFileSystem: async () => {
      storageFlushes += 1;
      return { flushed: true };
    },
    sessionStatus: () => ({
      locked: false,
      coordination: {
        role: "primary",
        lockOwner: "runtime-smoke",
        readonly: false,
        handoff: {
          activeOfferId: "handoff-1",
          activeMode: "control",
          activePeerInstanceId: "remote-tab",
          lastPeerAction: "accept",
          relay: {
            framesSent: 1,
            framesReceived: 2,
            inputsSent: 1,
            inputsReceived: 1,
          },
        },
      },
    }),
    lifecycleStatus: () => ({ state: "active", reason: "boot-complete", updatedAt: "2026-05-05T00:00:00.000Z" }),
    recoveryStatus: () => ({
      lastShutdown: { recordedAt: "2026-05-04T23:59:59.000Z" },
      lastRecovery: null,
      closedPagePersistence: false,
      serviceWorkerBoot: {
        decision: "available-but-not-registered",
        registered: false,
        manifest: { recoveryShell: "/var/recovery/shell/recovery.dindbsh" },
      },
      safeBootProfiles: [
        { id: "normal", status: "available", disables: [], reason: "standard boot path" },
        { id: "safe-mode", status: "available", disables: ["packages", "services"], reason: "minimal recovery" },
        { id: "offline", status: "degraded", disables: ["remote-network"], reason: "no Service Worker support" },
      ],
      offlineMaintenanceQueue: { queued: 0, tasks: [] },
      panic: { reason: "none", recoveryShell: "/var/recovery/shell/recovery.dindbsh", safeBootProfiles: ["normal"] },
    }),
    queueOfflineMaintenanceTask: () => ({
      id: "offline-smoke",
      type: "storage.flush",
      status: "queued",
      requestedBy: "guest",
    }),
    remoteSyncStatus: () => ({
      backend: "storage-value",
      encrypted: true,
      mergeRuleCount: 6,
      lastSuccessfulSnapshot: {
        createdAt: "2026-05-05T00:02:00.000Z",
        fileCount: 2,
        cacheRecords: 1,
        settingsRecords: 1,
      },
      lastAppliedSnapshot: {
        appliedAt: "2026-05-05T00:03:00.000Z",
        conflicts: 1,
        refused: 2,
      },
      lastApplyRun: {
        status: "interrupted",
        nextIndex: 2,
        totalFiles: 5,
      },
      lastRetry: {
        retriedAt: "2026-05-05T00:04:00.000Z",
        applied: 1,
        refused: 0,
      },
    }),
    remoteSyncMergePolicy: () => ({
      planner: "offline-first",
      rules: [
        { scope: "user-documents" },
        { scope: "app-state" },
        { scope: "package-metadata" },
        { scope: "search-indexes" },
        { scope: "settings" },
        { scope: "cache-metadata" },
      ],
    }),
    listRemoteSyncConflicts: () => [{
      path: "/home/guest/Documents/.sync-conflicts/note.txt.2026.remote",
      targetPath: "/home/guest/Documents/note.txt",
      bytes: 12,
    }],
    resolveRemoteSyncConflict: (path, options = {}) => ({
      path,
      targetPath: "/home/guest/Documents/note.txt",
      action: options.action || "use-conflict",
      remainingConflicts: 0,
    }),
    compatibilitySnapshot: () => ({
      runtime: "DindbOS.js",
      version: "0.2.0",
      mode: "browser-native",
      tiers: [
        { id: "A", key: "dindbos-js", name: "DindbOS JavaScript GUI/CLI apps", status: "supported" },
        { id: "C", key: "wasi-wasm", name: "WASI-style WASM CLI programs", status: "planned" },
      ],
      browser: { workers: false, webAssembly: true, opfs: false, indexedDB: false, cacheApi: false, fileSystemAccess: false, serviceWorker: false, periodicSync: false },
      isolation: {
        current: "degraded-shared-memory",
        crossOriginIsolated: false,
        sharedMemory: {
          sharedArrayBuffer: true,
          atomics: true,
          available: false,
          status: "degraded",
          decision: "requires-coop-coep-and-browser-support",
        },
        deployment: {
          requiredHeaders: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Resource-Policy": "same-origin or explicit cross-origin for allowed assets",
          },
        },
        profiles: [
          { id: "origin-isolated", status: "requires-headers", coop: "same-origin", coep: "require-corp", sharedMemory: "blocked" },
        ],
        workerMemory: {
          status: "copy-fallback",
          transfer: "ArrayBuffer copy fallback",
          maxRegionBytes: 16777216,
        },
        degradedModes: ["crossOriginIsolated=false"],
        memoryRegions: [],
      },
      backgroundMaintenance: {
        serviceWorkerSupported: false,
        periodicSyncSupported: false,
        registered: false,
        closedPagePersistence: false,
        decision: "unsupported-in-this-runtime",
      },
      storage: { backend: "memory", structuredBackend: "memory", persisted: false, buckets: "fallback" },
      companions: { browserProviderUrl: "ws://127.0.0.1:8787/browser", localMounts: 0 },
      unsupportedNative: ["kernel-mode execution"],
    }),
    browserBrokerStatus: () => ({
      capabilities: [
        { id: "notifications.show", available: true, broker: "notifications", device: "/dev/browser/notifications", accessCount: 0, revoked: 0 },
        { id: "screen.capture", available: true, broker: "screen-capture", device: "/dev/browser/screen", accessCount: 1, revoked: 1 },
      ],
      ledgerEntries: [
        { capability: "screen.capture", operation: "request", result: "brokered", pid: 100 },
      ],
      revokedGrants: [
        { capability: "screen.capture", pid: 100, appId: "recorder" },
      ],
    }),
    apps: {
      list: () => [{ id: "calculator", name: "Calculator" }],
      manifests: () => [],
      getManifest: () => null,
    },
    packages: {
      list: () => [{ id: "hello-notes", name: "Hello Notes", version: "0.1.0", installPath: "/opt/hello-notes" }],
      info: (packageId) => packageId === "hello-notes" ? { id: "hello-notes", name: "Hello Notes", version: "0.1.0", installPath: "/opt/hello-notes" } : null,
      trustedPublishers: () => [...trustedPublishers],
      addTrustedPublisher: (publisher) => {
        trustedPublishers.push(publisher);
        return publisher;
      },
      removeTrustedPublisher: (idOrKey) => {
        const index = trustedPublishers.findIndex((publisher) => publisher.id === idOrKey || publisher.publicKey === idOrKey);
        if (index >= 0) trustedPublishers.splice(index, 1);
        return idOrKey;
      },
    },
    assertAdminOperation(action, context = {}) {
      const principal = context.principal || this.permissions.principal(this.session);
      const allowed = principal.system || principal.user === "root" || (principal.groups || []).includes("admins");
      this.auditSecurity(action, allowed ? "allowed" : "denied", { principal, target: context.target || "", reason: allowed ? "" : "admin-required" });
      if (!allowed) throw new Error(`${action}: denied: administrator required`);
      return true;
    },
    auditSecurity(action, decision, details = {}) {
      const principal = details.principal || {};
      ["/var", "/var/log", "/var/log/dindbos"].forEach((path) => {
        if (!this.fs.exists(path)) this.fs.createDirectory(path, "/", { owner: "root", group: "root" }, system);
      });
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
  };
  os.bus = new EventBus();
  os.objects = new KernelObjectRegistry(os);
  os.windows = {
    has: () => false,
    close: () => null,
    compositorStatus: () => ({
      activeWindowId: "settings",
      focusedPid: 100,
      surfaceCount: 2,
      lastInputEvent: { type: "keydown" },
    }),
  };
  os.processes = new ProcessManager(os);
  os.descriptors = new DescriptorManager(os);
  os.syscalls = new SyscallDispatcher(os);
  os.syscall = (name, args = {}, context = {}) => os.syscalls.call(name, args, context);
  os.syscallAsync = (name, args = {}, context = {}) => os.syscalls.callAsync(name, args, context);
  return os;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
