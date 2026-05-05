#!/usr/bin/env node
import { ShellSession } from "../src/dindbos/shell.js";
import { DescriptorManager } from "../src/dindbos/descriptors.js";
import { EventBus } from "../src/dindbos/event-bus.js";
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
assert(result.output.includes("sessionHandoff active=handoff-1 mode=control peer=remote-tab last=accept"), `doctor session handoff output missing: ${result.output}`);
assert(result.output.includes("storage backend=memory"), `doctor storage output missing: ${result.output}`);
assert(result.output.includes("localMounts supported=false mounted=0"), `doctor mount output missing: ${result.output}`);
assert(result.output.includes("helper=unavailable rename=false"), `doctor helper output missing: ${result.output}`);
assert(result.output.includes("packages installed=1"), `doctor package output missing: ${result.output}`);
assert(result.output.includes("processes running=0"), `doctor process output missing: ${result.output}`);
assert(result.output.includes("lifecycle state=active"), `doctor lifecycle output missing: ${result.output}`);
assert(result.output.includes("closedPagePersistent=false"), `doctor recovery output missing: ${result.output}`);
assert(result.output.includes("sync backend=storage-value encrypted=true lastSnapshot=2026-05-05T00:02:00.000Z files=2 cache=1 settings=1"), `doctor sync output missing: ${result.output}`);
assert(result.output.includes("syncMerge planner=offline-first rules=6"), `doctor sync merge output missing: ${result.output}`);
assert(result.output.includes("docs/support.md"), `doctor troubleshooting output missing: ${result.output}`);

result = await shell.executeAsync("doctor compat");
assert(result.status === 0, `doctor compat status mismatch: ${result.status}`);
assert(result.output.includes("DindbOS compatibility"), `doctor compat heading missing: ${result.output}`);
assert(result.output.includes("tier A supported dindbos-js"), `doctor compat tier A missing: ${result.output}`);
assert(result.output.includes("tier C planned wasi-wasm"), `doctor compat tier C missing: ${result.output}`);
assert(result.output.includes("serviceWorker=false periodicSync=false"), `doctor compat background browser probes missing: ${result.output}`);
assert(result.output.includes("background serviceWorker=false periodicSync=false registered=false closedPagePersistent=false decision=unsupported-in-this-runtime"), `doctor compat background boundary missing: ${result.output}`);
assert(result.output.includes("unsupported native=kernel-mode execution"), `doctor compat unsupported native boundary missing: ${result.output}`);

result = await shell.executeAsync("mount-local --helper");
assert(result.status === 0, `mount helper status mismatch: ${result.status}`);
assert(result.output.includes("protocol=dindbos-file-helper-v1"), `mount helper protocol missing: ${result.output}`);
assert(result.output.includes("rename=false"), `mount helper rename output missing: ${result.output}`);

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
result = await shell.executeAsync("syscall localMount.status '{}'");
assert(result.status === 0, `syscall localMount.status status mismatch: ${result.status}`);
assert(JSON.parse(result.output).value.supported === false, `syscall localMount.status output mismatch: ${result.output}`);
result = await shell.executeAsync("syscall future.native '{}'");
assert(result.status === 1, `unsupported syscall status mismatch: ${result.status}`);
assert(JSON.parse(result.output).error.code === "ENOSYS", `unsupported syscall errno mismatch: ${result.output}`);

const trustKey = "ed25519-pub:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
result = await shell.executeAsync(`pkg trust add com.example ${trustKey} Example Publisher`);
assert(result.status === 0, `pkg trust add status mismatch: ${result.status}`);
assert(result.output === "trusted publisher added com.example", `pkg trust add output mismatch: ${result.output}`);
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

console.log("shell smoke ok parser chaining status scripts");

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const trustedPublishers = [];
  const system = permissions.systemPrincipal();
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  const os = {
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
    },
    storage: {
      status: () => ({ backend: "memory", bytes: 0 }),
      estimate: async () => ({ backend: "memory", bytes: 0 }),
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
        },
      },
    }),
    lifecycleStatus: () => ({ state: "active", reason: "boot-complete", updatedAt: "2026-05-05T00:00:00.000Z" }),
    recoveryStatus: () => ({
      lastShutdown: { recordedAt: "2026-05-04T23:59:59.000Z" },
      lastRecovery: null,
      closedPagePersistence: false,
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
    compatibilitySnapshot: () => ({
      runtime: "DindbOS.js",
      version: "0.2.0",
      mode: "browser-native",
      tiers: [
        { id: "A", key: "dindbos-js", name: "DindbOS JavaScript GUI/CLI apps", status: "supported" },
        { id: "C", key: "wasi-wasm", name: "WASI-style WASM CLI programs", status: "planned" },
      ],
      browser: { workers: false, webAssembly: true, opfs: false, indexedDB: false, cacheApi: false, fileSystemAccess: false, serviceWorker: false, periodicSync: false },
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
    openPath: () => null,
  };
  os.bus = new EventBus();
  os.windows = {
    has: () => false,
    close: () => null,
  };
  os.processes = new ProcessManager(os);
  os.descriptors = new DescriptorManager(os);
  os.syscalls = new SyscallDispatcher(os);
  os.syscall = (name, args = {}, context = {}) => os.syscalls.call(name, args, context);
  return os;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
