#!/usr/bin/env node
import { DindbOS, BOOT_PHASES } from "../src/dindbos/index.js";
import { ShellSession } from "../src/dindbos/shell.js";
import { installBuiltinApps } from "../src/dindbos/apps/builtins.js";
import { demoFileSystem, portfolioData } from "../src/demo/portfolio-demo.js";

const restoreGlobals = installDomShim();
try {
  await verifySuccessfulBootPhases();
  await verifySafeBootProfileEnforcement();
  await verifyDirtyShutdownRecoveryRecord();
  await verifyBootPhaseFailure();
} finally {
  restoreGlobals();
}

console.log(`boot smoke ok phases=${BOOT_PHASES.length}`);

async function verifySuccessfulBootPhases() {
  const os = new DindbOS({
    root: createElement("root"),
    fileSystem: demoFileSystem,
    storage: createStorage(),
    persistDelayMs: 0,
  });
  const events = [];
  os.bus.on("boot:phase", (phase) => events.push(`${phase.id}:${phase.status}`));

  await os.loadPersistentFileSystem();
  await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
  await os.runBootPhase("app-registry-load", () => installBuiltinApps(os, { portfolioData }));
  os.boot();

  const status = os.bootStatus();
  assert(status.map((phase) => phase.id).join(",") === BOOT_PHASES.map((phase) => phase.id).join(","), "boot phase order changed");
  status.forEach((phase) => {
    assert(phase.status === "complete", `boot phase ${phase.id} did not complete: ${phase.status}`);
    assert(phase.startedAt, `boot phase ${phase.id} missing startedAt`);
    assert(phase.finishedAt, `boot phase ${phase.id} missing finishedAt`);
    assert(phase.detail, `boot phase ${phase.id} missing detail`);
  });
  assert(events.includes("storage-load:running"), "storage-load running event missing");
  assert(events.includes("desktop-render:complete"), "desktop-render complete event missing");
  assert(os.apps.has("files"), "built-in apps were not registered during app-registry-load");
  assert(os.packages.info("hello-notes"), "package registry did not bootstrap sample package");
  assert(os.fs.exists("/opt/dindbos/packages/api-lab/dindbos.app.json"), "package registry did not bootstrap API Lab sample source");
  assert(os.fs.exists("/opt/dindbos/packages/paint-sample/dindbos.app.json"), "package registry did not bootstrap Paint sample source");
  assert(os.fs.exists("/opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json"), "package registry did not bootstrap PDF Viewer sample source");
  const localRegistry = os.fs.readFile("/opt/dindbos/registry/index.json");
  assert(localRegistry.includes('"id": "paint-sample"'), "local registry missing Paint sample");
  assert(localRegistry.includes('"id": "pdf-viewer-sample"'), "local registry missing PDF Viewer sample");
  assert(os.fs.exists("/proc/processes.json"), "process init did not write /proc/processes.json");
  assert(os.fs.exists("/var/log/dindbos/boot.json"), "boot diagnostics JSON was not written");
  assert(os.fs.exists("/var/log/dindbos/boot.log"), "boot diagnostics log was not written");
  assert(os.fs.exists("/var/run/dindbos/lifecycle.json"), "lifecycle diagnostics JSON was not written");
  assert(os.fs.exists("/var/log/dindbos/lifecycle.log"), "lifecycle diagnostics log was not written");
  assert(os.fs.exists("/var/cache"), "cache policy root /var/cache was not created");
  assert(os.diskPolicyForPath("/home/guest/Documents").type === "user", "/home did not resolve to user disk policy");
  assert(os.diskPolicyForPath("/opt/hello-notes").type === "packages", "/opt did not resolve to package disk policy");
  assert(os.diskPolicyForPath("/var/cache/npm").type === "cache", "/var/cache did not resolve to cache disk policy");
  assert(os.diskPolicyForPath("/tmp/payload.bin").type === "temporary", "/tmp did not resolve to temporary disk policy");
  assert(os.diskPolicyForPath("/mnt/portfolio").type === "external", "/mnt did not resolve to external disk policy");
  assert(os.diskPolicyAreas().every((area) => area.exists), "not all disk policy roots exist");
  assert(os.fs.exists("/proc/mounts"), "/proc/mounts was not written");
  assert(os.fs.exists("/proc/mounts.json"), "/proc/mounts.json was not written");
  assert(os.fs.exists("/proc/browser-capabilities"), "/proc/browser-capabilities was not written");
  assert(os.fs.exists("/proc/browser-capabilities.json"), "/proc/browser-capabilities.json was not written");
  assert(os.fs.exists("/proc/device-tree"), "/proc/device-tree was not written");
  assert(os.fs.exists("/proc/device-tree.json"), "/proc/device-tree.json was not written");
  assert(os.fs.exists("/proc/isolation"), "/proc/isolation was not written");
  assert(os.fs.exists("/proc/isolation.json"), "/proc/isolation.json was not written");
  assert(os.fs.exists("/proc/service-worker-boot"), "/proc/service-worker-boot was not written");
  assert(os.fs.exists("/proc/service-worker-boot.json"), "/proc/service-worker-boot.json was not written");
  assert(os.fs.exists("/proc/conformance"), "/proc/conformance was not written");
  assert(os.fs.exists("/proc/conformance.json"), "/proc/conformance.json was not written");
  assert(os.fs.exists("/proc/conformance-evidence"), "/proc/conformance-evidence was not written");
  assert(os.fs.exists("/proc/conformance-evidence.json"), "/proc/conformance-evidence.json was not written");
  assert(os.fs.exists("/proc/secure-boot"), "/proc/secure-boot was not written");
  assert(os.fs.exists("/proc/secure-boot.json"), "/proc/secure-boot.json was not written");
  assert(os.fs.exists("/var/run/dindbos/secure-boot.json"), "secure boot runtime record was not written");
  assert(os.fs.exists("/var/recovery/shell/recovery.dindbsh"), "recovery shell asset was not written");
  assert(os.fs.exists("/var/run/dindbos/panic.json"), "panic diagnostics were not written");
  assert(os.fs.exists("/dev/browser"), "/dev/browser device root was not created");
  assert(os.mountTable().some((entry) => entry.root === "/home" && entry.driver === "browserfs"), "mount table missing /home browserfs entry");
  assert(os.mountTable().some((entry) => entry.root === "/opt/hello-notes" && entry.driver === "pkgfs" && entry.readonly), "mount table missing readonly package image entry");
  assert(os.mountTable().some((entry) => entry.root === "/proc" && entry.driver === "procfs" && entry.readonly), "mount table missing readonly procfs entry");
  assert(os.fs.readFile("/proc/mounts").includes("disk:/opt /opt pkgfs"), "/proc/mounts missing package filesystem entry");
  assert(os.fs.readFile("/proc/mounts").includes("usedBytes="), "/proc/mounts missing used byte diagnostics");
  assert(os.fs.readFile("/proc/mounts").includes("support="), "/proc/mounts missing browser support diagnostics");
  assert(JSON.parse(os.fs.readFile("/proc/mounts.json")).mounts.some((entry) => entry.root === "/var/cache" && entry.driver === "cachefs"), "/proc/mounts.json missing cachefs entry");
  const browserCapabilities = JSON.parse(os.fs.readFile("/proc/browser-capabilities.json"));
  assert(browserCapabilities.brokerRequired === true, "browser capabilities did not require brokers");
  assert(browserCapabilities.capabilities.some((entry) => entry.id === "clipboard.read" && entry.available), "browser capabilities missing clipboard read probe");
  assert(browserCapabilities.capabilities.some((entry) => entry.id === "screen.capture" && entry.available), "browser capabilities missing screen capture probe");
  assert(browserCapabilities.capabilities.some((entry) => entry.id === "webhid.device" && entry.available), "browser capabilities missing WebHID probe");
  assert(os.fs.readFile("/proc/browser-capabilities").includes("screen.capture available screen-capture /dev/browser/screen"), "/proc/browser-capabilities text missing screen capture broker");
  const deviceTree = JSON.parse(os.fs.readFile("/proc/device-tree.json"));
  assert(deviceTree.devices.some((device) => device.path === "/dev/browser/clipboard" && device.capabilities.includes("clipboard.write")), "device tree missing clipboard device capabilities");
  assert(deviceTree.devices.some((device) => device.path === "/dev/browser/hid" && device.status === "available"), "device tree missing available WebHID device");
  assert(os.fs.readFile("/proc/device-tree").includes("/dev/browser/gpu available webgpu-broker"), "/proc/device-tree text missing WebGPU broker");
  const isolation = JSON.parse(os.fs.readFile("/proc/isolation.json"));
  assert(isolation.sharedMemory.status === "degraded", `isolation shared memory status mismatch: ${JSON.stringify(isolation)}`);
  assert(isolation.deployment.requiredHeaders["Cross-Origin-Opener-Policy"] === "same-origin", "isolation profile missing COOP header");
  const memoryRegion = os.createWorkerMemoryRegion({ size: 64, name: "boot-smoke-region" });
  assert(memoryRegion.bytes === 64 && memoryRegion.handleId, `worker memory region handle mismatch: ${JSON.stringify(memoryRegion)}`);
  assert(memoryRegion.buffer instanceof ArrayBuffer, "degraded worker memory region did not return ArrayBuffer fallback");
  const updatedIsolation = JSON.parse(os.fs.readFile("/proc/isolation.json"));
  assert(updatedIsolation.memoryRegions.some((entry) => entry.id === memoryRegion.id && entry.transfer === "copy-fallback"), "isolation procfs missing worker memory region");
  const serviceWorkerBoot = JSON.parse(os.fs.readFile("/proc/service-worker-boot.json"));
  assert(serviceWorkerBoot.manifest.protocol === "dindbos-sw-boot.v1", "service worker boot manifest protocol mismatch");
  assert(serviceWorkerBoot.safeBootProfiles.some((profile) => profile.id === "offline" && profile.status === "degraded"), "safe boot profiles missing degraded offline profile");
  const conformance = JSON.parse(os.fs.readFile("/proc/conformance.json"));
  assert(conformance.categories.some((entry) => entry.id === "package-platform" && entry.level === "supported"), "conformance procfs missing package platform support");
  assert(os.fs.readFile("/proc/conformance").includes("policy-trust level=supported"), "conformance procfs text missing policy trust support");
  const evidenceRecord = os.addConformanceEvidence({
    profile: "chromium-tab",
    status: "pass",
    runner: "boot-smoke",
    categories: ["package-platform", "policy-trust"],
    artifacts: ["/var/log/dindbos/boot.json"],
  });
  assert(evidenceRecord.profile === "chromium-tab", "conformance evidence record returned wrong profile");
  const conformanceWithEvidence = JSON.parse(os.fs.readFile("/proc/conformance.json"));
  assert(conformanceWithEvidence.evidenceSummary.total === 1, "conformance procfs did not include evidence summary");
  assert(conformanceWithEvidence.browserMatrix.some((entry) => entry.profile === "chromium-tab" && entry.evidenceStatus === "pass"), "conformance browser matrix did not include evidence status");
  assert(os.fs.readFile("/proc/conformance-evidence").includes("chromium-tab status=pass runner=boot-smoke"), "conformance evidence text missing boot smoke record");
  const secureBoot = JSON.parse(os.fs.readFile("/proc/secure-boot.json"));
  assert(secureBoot.ok && secureBoot.summary.packageCount >= 1, `secure boot measurement mismatch: ${JSON.stringify(secureBoot.summary)}`);
  assert(secureBoot.measurements.some((entry) => entry.kind === "package-record" && entry.target.includes("hello-notes")), "secure boot missing package record measurement");
  assert(secureBoot.measurements.some((entry) => entry.kind === "app-registry" && entry.target === "files"), "secure boot missing app registry measurement");
  assert(secureBoot.policyProofs.ok, "secure boot missing passing policy proofs");
  const shell = new ShellSession(os);
  const bootctlVerify = await shell.executeAsync("bootctl verify");
  assert(bootctlVerify.output.includes("secure-boot ok=true") && bootctlVerify.output.includes("proofs ok=true"), `bootctl verify output mismatch: ${bootctlVerify.output}`);
  const queued = os.queueOfflineMaintenanceTask({ type: "storage.flush", permissioned: true, requestedBy: "smoke" });
  assert(queued.type === "storage.flush", "offline maintenance task queue returned wrong type");
  const queue = JSON.parse(os.fs.readFile("/var/run/dindbos/offline-maintenance-queue.json"));
  assert(queue.queued === 1 && queue.tasks[0].type === "storage.flush", "offline maintenance queue was not persisted");
  const readonlyMount = os.syscall("mount.mount", { path: "/mnt/readonly-smoke", driver: "memfs", readonly: true });
  assert(readonlyMount.ok && readonlyMount.value.root === "/mnt/readonly-smoke", `readonly memfs mount failed: ${JSON.stringify(readonlyMount)}`);
  const readonlyWrite = os.syscall("fs.writeText", { path: "/mnt/readonly-smoke/blocked.txt", content: "blocked" });
  assert(readonlyWrite.ok === false && readonlyWrite.error.code === "EACCES", `readonly memfs write was not denied with EACCES: ${JSON.stringify(readonlyWrite)}`);
  const unsupportedMount = os.syscall("mount.mount", { path: "/mnt/tar-smoke", driver: "tarfs" });
  assert(unsupportedMount.ok === false && unsupportedMount.error.code === "ENOTSUP", `unsupported mount driver was not normalized to ENOTSUP: ${JSON.stringify(unsupportedMount)}`);
  assert(unsupportedMount.error.message.includes("unsupported driver: tarfs"), `unsupported mount driver message mismatch: ${JSON.stringify(unsupportedMount)}`);
  const system = os.permissions.systemPrincipal();
  os.fs.createDirectory("/home/guest/lower-smoke", "/", { owner: "guest", group: "users" }, system);
  os.fs.writeOrCreateFile("/home/guest/lower-smoke/base.txt", "lower-base", "/", { owner: "guest", group: "users" }, system);
  os.fs.writeOrCreateFile("/home/guest/lower-smoke/shared.txt", "lower-shared", "/", { owner: "guest", group: "users" }, system);
  os.fs.createDirectory("/home/guest/upper-smoke", "/", { owner: "guest", group: "users" }, system);
  os.fs.writeOrCreateFile("/home/guest/upper-smoke/shared.txt", "upper-shared", "/", { owner: "guest", group: "users" }, system);
  os.fs.writeOrCreateFile("/home/guest/upper-smoke/new.txt", "upper-new", "/", { owner: "guest", group: "users" }, system);
  const overlayMount = os.syscall("mount.mount", { path: "/mnt/overlay-smoke", driver: "overlayfs", lower: "/home/guest/lower-smoke", upper: "/home/guest/upper-smoke" });
  assert(overlayMount.ok && overlayMount.value.driver === "overlayfs" && overlayMount.value.precedence === "upper", `overlay mount failed: ${JSON.stringify(overlayMount)}`);
  assert(os.fs.readFile("/mnt/overlay-smoke/base.txt") === "lower-base", "overlayfs did not expose lower-only file");
  assert(os.fs.readFile("/mnt/overlay-smoke/shared.txt") === "upper-shared", "overlayfs upper file did not override lower file");
  assert(os.fs.readFile("/mnt/overlay-smoke/new.txt") === "upper-new", "overlayfs did not expose upper-only file");
  assert(os.mountTable().some((entry) => entry.root === "/mnt/overlay-smoke" && entry.driver === "overlayfs" && entry.precedence === "upper"), "mount table missing overlayfs precedence entry");
  os.fs.writeOrCreateFileBytes("/home/guest/archive.zip", storedZip([
    ["README.txt", "zip-root"],
    ["docs/guide.txt", "zip-nested"],
  ]), "/", { mime: "application/zip", owner: "guest", group: "users" }, system);
  const zipMount = os.syscall("mount.mount", { path: "/mnt/zip-smoke", driver: "zipfs", archive: "/home/guest/archive.zip" });
  assert(zipMount.ok && zipMount.value.driver === "zipfs" && zipMount.value.entries === 2, `zipfs mount failed: ${JSON.stringify(zipMount)}`);
  assert(os.fs.list("/mnt/zip-smoke").some((entry) => entry.name === "README.txt"), "zipfs root listing missing README.txt");
  assert(os.fs.list("/mnt/zip-smoke/docs").some((entry) => entry.name === "guide.txt"), "zipfs nested listing missing guide.txt");
  assert(os.fs.readFile("/mnt/zip-smoke/docs/guide.txt") === "zip-nested", "zipfs nested file content mismatch");
  assert(os.mountTable().some((entry) => entry.root === "/mnt/zip-smoke" && entry.driver === "zipfs" && entry.entries === 2), "mount table missing zipfs entry count");
  const mountStats = [
    os.fs.stat("/mnt/readonly-smoke"),
    os.fs.stat("/mnt/overlay-smoke/shared.txt"),
    os.fs.stat("/mnt/zip-smoke/docs/guide.txt"),
    os.fs.stat("/opt/hello-notes/app.js"),
  ];
  mountStats.forEach((stat) => {
    assert(stat.path && stat.name && stat.type && stat.resolvedType && stat.mime && stat.permissions && stat.owner && stat.group, `mounted driver stat shape incomplete: ${JSON.stringify(stat)}`);
    assert(Number.isFinite(stat.size), `mounted driver stat size missing: ${JSON.stringify(stat)}`);
    assert(Number.isFinite(stat.linkCount), `mounted driver stat linkCount missing: ${JSON.stringify(stat)}`);
  });
  assert(mountStats[0].type === "mount" && mountStats[0].resolvedType === "directory", `memfs mount stat mismatch: ${JSON.stringify(mountStats[0])}`);
  assert(mountStats[1].type === "file" && mountStats[1].size === "upper-shared".length, `overlayfs file stat mismatch: ${JSON.stringify(mountStats[1])}`);
  assert(mountStats[2].type === "file" && mountStats[2].mime === "text/plain", `zipfs file stat mismatch: ${JSON.stringify(mountStats[2])}`);
  assert(mountStats[3].type === "file" && mountStats[3].path === "/opt/hello-notes/app.js", `pkgfs file stat mismatch: ${JSON.stringify(mountStats[3])}`);
  os.fs.writeOrCreateFileBytes("/home/guest/compressed.zip", storedZip([["compressed.txt", "compressed", 8]]), "/", { mime: "application/zip", owner: "guest", group: "users" }, system);
  const compressedZip = os.syscall("mount.mount", { path: "/mnt/compressed-smoke", driver: "zipfs", archive: "/home/guest/compressed.zip" });
  assert(compressedZip.ok === false && compressedZip.error.code === "ENOTSUP", `zipfs compression error was not normalized to ENOTSUP: ${JSON.stringify(compressedZip)}`);
  assert(compressedZip.error.message.includes("compression method 8"), `zipfs compression error message mismatch: ${JSON.stringify(compressedZip)}`);
  assert(os.diskPolicyForPath("/tmp/payload.bin").bucket === "session", "/tmp did not report session bucket policy");
  assert(os.diskPolicyForPath("/var/cache/npm").bucket === "cache", "/var/cache did not report cache bucket policy");
  const bucketPolicy = os.storageBucketPolicy();
  assert(bucketPolicy.decision === "fallback-to-current-storage-stack", `unexpected storage bucket policy: ${bucketPolicy.decision}`);
  assert(bucketPolicy.areas.some((area) => area.root === "/tmp" && area.bucket === "session"), "storage bucket policy missing /tmp session area");
  const bootDiagnostics = JSON.parse(os.fs.readFile("/var/log/dindbos/boot.json"));
  assert(bootDiagnostics.phases.length === BOOT_PHASES.length, "boot diagnostics did not include all phases");
  assert(bootDiagnostics.phases.every((phase) => phase.status === "complete"), "boot diagnostics included incomplete phases");
  assert(bootDiagnostics.storageBuckets.decision === "fallback-to-current-storage-stack", "boot diagnostics missing storage bucket policy");
  assert(bootDiagnostics.secureBoot.ok && bootDiagnostics.secureBoot.summary.measurementCount >= secureBoot.summary.measurementCount, "boot diagnostics missing secure boot measurements");
  assert(bootDiagnostics.serviceWorkerBoot.manifest.protocol === "dindbos-sw-boot.v1", "boot diagnostics missing service worker boot manifest");
  assert(bootDiagnostics.safeBootProfiles.some((profile) => profile.id === "safe-mode"), "boot diagnostics missing safe boot profiles");
  assert(os.fs.readFile("/var/log/dindbos/boot.log").includes("[complete] desktop-render"), "boot log missing desktop-render completion");
  const lifecycleDiagnostics = JSON.parse(os.fs.readFile("/var/run/dindbos/lifecycle.json"));
  assert(lifecycleDiagnostics.state === "active", `boot lifecycle state mismatch: ${lifecycleDiagnostics.state}`);
  assert(lifecycleDiagnostics.transitions.some((entry) => entry.reason === "boot-complete"), "boot lifecycle transition missing boot-complete");
  assert(os.fs.readFile("/var/log/dindbos/lifecycle.log").includes("boot-complete"), "lifecycle log missing boot-complete");
}

async function verifySafeBootProfileEnforcement() {
  const packageDisabled = new DindbOS({
    root: createElement("safe-package-root"),
    fileSystem: demoFileSystem,
    storage: createStorage(),
    persistDelayMs: 0,
    safeBootProfile: "package-disabled",
  });
  await packageDisabled.loadPersistentFileSystem();
  await packageDisabled.runBootPhase("package-registry-load", () => packageDisabled.packages.bootstrap());
  assert(!packageDisabled.apps.has("hello-notes"), "package-disabled profile registered sample package app");
  assert(packageDisabled.recoveryStatus().safeBootEnforcement.activeProfile === "package-disabled", "package-disabled profile was not active");
  assert(JSON.parse(packageDisabled.fs.readFile("/proc/service-worker-boot.json")).safeBootEnforcement.activeProfile === "package-disabled", "service worker boot procfs missing active package-disabled profile");
  await assertRejects(() => packageDisabled.packages.install({
    id: "blocked-safe-package",
    name: "Blocked Safe Package",
    version: "0.1.0",
    app: { entry: "app.js" },
    files: [{ path: "app.js", content: "export function mount() {}\n" }],
  }), "safe-boot: profile package-disabled disables packages");

  const serviceDisabled = new DindbOS({
    root: createElement("safe-service-root"),
    fileSystem: demoFileSystem,
    storage: createStorage(),
    persistDelayMs: 0,
    safeBootProfile: "service-disabled",
  });
  await serviceDisabled.loadPersistentFileSystem();
  serviceDisabled.services.register({ id: "safe-boot-service", name: "Safe Boot Service", start: () => {} });
  await assertRejects(() => serviceDisabled.services.start("safe-boot-service"), "safe-boot: profile service-disabled disables services");

  const companionDisabled = new DindbOS({
    root: createElement("safe-companion-root"),
    fileSystem: demoFileSystem,
    storage: createStorage(),
    persistDelayMs: 0,
    safeBootProfile: "companion-disabled",
  });
  await companionDisabled.loadPersistentFileSystem();
  await assertRejects(() => companionDisabled.grantCompanionPermission("browserd", "dindbos-browserd-v1", ["browser"]), "safe-boot: profile companion-disabled disables companions");
  const shell = new ShellSession(companionDisabled);
  const switched = await shell.executeAsync("recovery profile normal");
  assert(switched.output.includes("safeBoot active=normal"), `recovery profile command did not switch to normal: ${switched.output}`);
  const granted = companionDisabled.grantCompanionPermission("browserd", "dindbos-browserd-v1", ["browser"], { principal: companionDisabled.permissions.systemPrincipal() });
  assert(granted.approved, "normal profile did not allow companion grant after recovery profile switch");
}

async function verifyDirtyShutdownRecoveryRecord() {
  const previousOs = new DindbOS({
    root: createElement("root"),
    fileSystem: demoFileSystem,
    storage: createStorage(),
    persistDelayMs: 0,
  });
  await previousOs.loadPersistentFileSystem();
  previousOs.persistPending = true;
  previousOs.persistenceStats.lastAction = "dirty-smoke";
  previousOs.persistenceStats.lastPath = "/home/guest/Documents/recovery.txt";
  const shutdownRecord = previousOs.writeRecoveryRecord("smoke-dirty", { dirty: true });
  assert(shutdownRecord.dirtyShutdown, "dirty shutdown record did not mark dirty shutdown");
  assert(shutdownRecord.pendingPersistence, "dirty shutdown record did not capture pending persistence");
  assert(previousOs.fs.exists("/var/run/dindbos/recovery/last-shutdown.json"), "dirty shutdown record was not written");

  const recoveredOs = new DindbOS({
    root: createElement("root"),
    fileSystem: previousOs.fs.snapshot(),
    storage: createStorage(),
    persistDelayMs: 0,
  });
  await recoveredOs.loadPersistentFileSystem();
  assert(recoveredOs.lifecycleStatus().state === "recovered", "dirty shutdown did not transition OS lifecycle to recovered");
  assert(recoveredOs.fs.exists("/var/run/dindbos/recovery/last-recovery.json"), "dirty shutdown recovery record was not written");
  const recovery = JSON.parse(recoveredOs.fs.readFile("/var/run/dindbos/recovery/last-recovery.json"));
  assert(recovery.previousShutdown.reason === "smoke-dirty", "recovery record did not include previous shutdown reason");
  assert(recovery.previousShutdown.safeBootProfiles.some((profile) => profile.id === "storage-repair"), "shutdown recovery record missing safe boot profiles");
  const acknowledged = JSON.parse(recoveredOs.fs.readFile("/var/run/dindbos/recovery/last-shutdown.json"));
  assert(acknowledged.recoveredAt, "last shutdown record was not acknowledged");
  assert(!acknowledged.dirtyShutdown, "acknowledged shutdown record still marked dirty");
}

async function verifyBootPhaseFailure() {
  const os = new DindbOS({
    root: createElement("root"),
    fileSystem: demoFileSystem,
    storage: createFailingStorage("storage unavailable"),
  });
  await os.loadPersistentFileSystem();
  const storagePhase = os.bootStatus().find((phase) => phase.id === "storage-load");
  assert(storagePhase.status === "recovered", `failed storage phase status mismatch: ${storagePhase.status}`);
  assert(storagePhase.error === "storage unavailable", `failed storage phase error mismatch: ${storagePhase.error}`);
  assert(storagePhase.detail.includes("recovered"), `failed storage phase recovery detail mismatch: ${storagePhase.detail}`);
  await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
  await os.runBootPhase("app-registry-load", () => installBuiltinApps(os, { portfolioData }));
  os.boot();
  assert(os.fs.exists("/var/log/dindbos/boot.json"), "recovered boot did not write diagnostics");
  const diagnostics = JSON.parse(os.fs.readFile("/var/log/dindbos/boot.json"));
  assert(diagnostics.phases.some((phase) => phase.id === "storage-load" && phase.status === "recovered"), "boot diagnostics missing recovered phase");

  const strictOs = new DindbOS({
    root: createElement("root"),
    fileSystem: demoFileSystem,
    storage: createFailingStorage("strict storage unavailable"),
  });
  await assertRejects(() => strictOs.loadPersistentFileSystem({ recover: false }), "strict storage unavailable");
  const strictStoragePhase = strictOs.bootStatus().find((phase) => phase.id === "storage-load");
  assert(strictStoragePhase.status === "error", `strict failed storage phase status mismatch: ${strictStoragePhase.status}`);
}

function installDomShim() {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalNotification = Object.getOwnPropertyDescriptor(globalThis, "Notification");
  const originalPeerConnection = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  const originalOpenFile = Object.getOwnPropertyDescriptor(globalThis, "showOpenFilePicker");
  const originalSaveFile = Object.getOwnPropertyDescriptor(globalThis, "showSaveFilePicker");
  const originalDirectory = Object.getOwnPropertyDescriptor(globalThis, "showDirectoryPicker");
  globalThis.document = {
    createElement: (tagName) => createElement(tagName),
    addEventListener() {},
    visibilityState: "visible",
  };
  globalThis.window = {
    addEventListener() {},
    setInterval() {
      return 1;
    },
    matchMedia: () => ({ matches: false }),
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: { readText() {}, writeText() {} },
      mediaDevices: { getDisplayMedia() {}, getUserMedia() {}, enumerateDevices() {} },
      share() {},
      gpu: {},
      usb: {},
      serial: {},
      hid: {},
    },
  });
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: function Notification() {} });
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: function RTCPeerConnection() {} });
  Object.defineProperty(globalThis, "showOpenFilePicker", { configurable: true, value() {} });
  Object.defineProperty(globalThis, "showSaveFilePicker", { configurable: true, value() {} });
  Object.defineProperty(globalThis, "showDirectoryPicker", { configurable: true, value() {} });
  return () => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    restoreGlobalDescriptor("navigator", originalNavigator);
    restoreGlobalDescriptor("Notification", originalNotification);
    restoreGlobalDescriptor("RTCPeerConnection", originalPeerConnection);
    restoreGlobalDescriptor("showOpenFilePicker", originalOpenFile);
    restoreGlobalDescriptor("showSaveFilePicker", originalSaveFile);
    restoreGlobalDescriptor("showDirectoryPicker", originalDirectory);
  };
}

function restoreGlobalDescriptor(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

function createElement(tagName) {
  const children = [];
  const element = {
    tagName,
    children,
    dataset: {},
    style: {},
    hidden: false,
    className: "",
    textContent: "",
    _innerHTML: "",
    classList: {
      toggle() {},
      add() {},
      remove() {},
    },
    set innerHTML(value) {
      this._innerHTML = String(value);
    },
    get innerHTML() {
      return this._innerHTML;
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
    append(...items) {
      items.forEach((item) => children.push(item));
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(selector) {
      if (!this._queries) this._queries = new Map();
      if (!this._queries.has(selector)) this._queries.set(selector, createElement(selector));
      return this._queries.get(selector);
    },
    querySelectorAll() {
      return [];
    },
  };
  return element;
}

function createStorage() {
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {},
    async readValue() {
      return null;
    },
    writeValue() {},
    status: () => ({ backend: "memory" }),
    estimate: async () => ({ backend: "memory" }),
    resetFileSystem() {},
  };
}

function createFailingStorage(message) {
  return {
    async loadFileSystem() {
      throw new Error(message);
    },
    saveFileSystem() {},
    async flush() {},
    async readValue() {
      return null;
    },
    writeValue() {},
    status: () => ({ backend: "memory" }),
    estimate: async () => ({ backend: "memory" }),
    resetFileSystem() {},
  };
}

function storedZip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  entries.forEach(([name, content, method = 0]) => {
    const nameBytes = encoder.encode(name);
    const contentBytes = encoder.encode(content);
    const local = concatBytes(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(contentBytes.length),
      u32(contentBytes.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      contentBytes,
    );
    chunks.push(local);
    central.push(concatBytes(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(contentBytes.length),
      u32(contentBytes.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ));
    offset += local.length;
  });
  const centralOffset = offset;
  const centralBytes = concatBytes(...central);
  const end = concatBytes(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(centralOffset),
    u16(0),
  );
  return concatBytes(...chunks, centralBytes, end);
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function u16(value) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function u32(value) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]);
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
