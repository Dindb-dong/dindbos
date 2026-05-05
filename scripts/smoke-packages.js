#!/usr/bin/env node
import { createDindbOSTestRuntime, waitForRuntime as waitFor } from "./helpers/dindbos-test-runtime.js";
import { base64UrlFromBytes, canonicalPackageManifestPayload } from "../src/dindbos/package-manager.js";
import { ShellSession } from "../src/dindbos/shell.js";

const os = createDindbOSTestRuntime();
const packages = os.packages;
const lifecycleEvents = [];
const activationEvents = [];
let packageServiceFlushes = 0;
let signedRemoteManifest = null;
let trustedPublisher = null;
os.flushPersistentFileSystem = async () => {
  packageServiceFlushes += 1;
  return { flushed: true, packageServiceFlushes };
};
["install", "update", "first-run", "uninstall-cleanup", "uninstall"].forEach((type) => {
  os.bus.on(`app:${type}`, (event) => lifecycleEvents.push(`${type}:${event.packageId}:${event.appId}`));
});
os.bus.on("package:activation", (event) => activationEvents.push(`${event.type}:${event.packageId}:${event.phase?.phase || event.activation.status}`));

const installed = packages.install(packageManifest("rollback-demo", "0.1.0", [
  { path: "app.js", mime: "text/javascript", content: "export const version = '0.1.0';\n" },
]));

assert(installed.id === "rollback-demo", "valid package install returned wrong id");
assert(installed.compatibility.tier === "A", `default compatibility tier mismatch: ${installed.compatibility.tier}`);
assert(os.fs.exists("/opt/rollback-demo/app.js"), "valid package file missing");
const rollbackNamespace = installed.namespace;
assert(rollbackNamespace.packageRoot === "/opt/rollback-demo", `package namespace root mismatch: ${JSON.stringify(rollbackNamespace)}`);
assert(rollbackNamespace.stateRoot === "/var/lib/dindbos/package-state/rollback-demo", `package namespace state root mismatch: ${JSON.stringify(rollbackNamespace)}`);
assert(rollbackNamespace.cacheRoot === "/var/cache/dindbos/packages/rollback-demo", `package namespace cache root mismatch: ${JSON.stringify(rollbackNamespace)}`);
assert(rollbackNamespace.tempRoot === "/tmp/dindbos/packages/rollback-demo", `package namespace temp root mismatch: ${JSON.stringify(rollbackNamespace)}`);
assert(rollbackNamespace.processGroup === "package:rollback-demo", `package namespace process group mismatch: ${JSON.stringify(rollbackNamespace)}`);
assert(os.fs.exists(rollbackNamespace.stateRoot), "package namespace state root missing");
assert(os.fs.exists(rollbackNamespace.cacheRoot), "package namespace cache root missing");
assert(os.fs.exists(rollbackNamespace.tempRoot), "package namespace temp root missing");
assert(os.apps.getManifest("rollback-demo").namespace.processGroup === "package:rollback-demo", "package namespace was not exposed through app manifest");
const sandboxPolicy = {
  rootPolicy: "readonly-strict",
  statePolicy: "private-encrypted",
  cachePolicy: "private-evictable-test",
  tempPolicy: "private-runtime-test",
  deviceGrants: ["clipboard.read"],
  networkHosts: ["api.example.test"],
  ipcEndpoints: ["sandbox-policy.echo"],
  childProcessLimit: 2,
};
const sandboxPackage = packages.install(packageManifest("sandbox-policy", "0.1.0", [
  { path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" },
], { sandbox: sandboxPolicy }));
assert(sandboxPackage.sandbox.rootPolicy === "readonly-strict", "package sandbox root policy was not normalized");
assert(sandboxPackage.sandbox.deviceGrants.includes("clipboard.read"), "package sandbox device grants missing");
assert(sandboxPackage.namespace.rootPolicy === "readonly-strict", "package namespace root policy did not use sandbox policy");
assert(sandboxPackage.namespace.childProcessLimit === 2, "package namespace child process limit mismatch");
const sandboxManifest = os.apps.getManifest("sandbox-policy");
assert(sandboxManifest.sandbox.networkHosts.includes("api.example.test"), "app manifest sandbox network hosts missing");
assert(sandboxManifest.namespace.ipcEndpoints.includes("sandbox-policy.echo"), "app manifest namespace IPC endpoints missing");
packages.remove("sandbox-policy");
const rollbackRoot = os.fs.stat("/opt/rollback-demo");
assert(rollbackRoot.type === "mount" && rollbackRoot.resolvedType === "directory", `package root was not mounted as a directory: ${JSON.stringify(rollbackRoot)}`);
assert(rollbackRoot.permissions === "dr-xr-xr-x", `package image mount permissions mismatch: ${rollbackRoot.permissions}`);
assert(packages.packageImageMounts().some((entry) => entry.root === "/opt/rollback-demo" && entry.driver === "pkgfs" && entry.readonly), "package image mount table missing rollback-demo");
assert(os.fs.exists("/var/lib/dindbos/packages/rollback-demo.json"), "valid package record missing");
assert(os.fs.exists("/usr/share/applications/Rollback Demo.app"), "valid package launcher missing");
assert(os.apps.apps.has("rollback-demo"), "valid package app was not registered");
assert(lifecycleEvents.includes("install:rollback-demo:rollback-demo"), "app:install lifecycle event missing");
["package-root", "package-record", "launcher", "app-registry", "services"].forEach((phase) => {
  assert(activationEvents.includes(`phase-complete:rollback-demo:${phase}`), `package activation phase missing: ${phase}`);
});
assert(activationEvents.includes("complete:rollback-demo:complete"), "package activation completion event missing");
assert(!packages.info("rollback-demo").stagingPath, "package record persisted staging path");
assert(os.fs.list("/tmp/dindbos/package-staging").length === 0, "successful package activation left staging root entries");

await assertRejects(
  () => packages.install(packageManifest("broken-pkg", "0.1.0", [
    { path: "app.js", mime: "text/javascript", content: "export const ok = true;\n" },
    { path: "../escape.js", mime: "text/javascript", content: "escape\n" },
  ])),
  "invalid package file path",
);

assert(!os.fs.exists("/opt/broken-pkg"), "failed local install left install directory");
assert(!os.fs.exists("/var/lib/dindbos/packages/broken-pkg.json"), "failed local install left package record");
assert(!os.fs.exists("/usr/share/applications/Broken Pkg.app"), "failed local install left launcher");
assert(!os.apps.apps.has("broken-pkg"), "failed local install registered app");
assert(!lifecycleEvents.some((event) => event.includes("broken-pkg")), "failed local install emitted lifecycle event");

const activationFailOs = createDindbOSTestRuntime();
const activationFailureEvents = [];
activationFailOs.bus.on("package:activation", (event) => activationFailureEvents.push(`${event.type}:${event.packageId}:${event.phase?.phase || event.activation.status}`));
const originalRegisterApp = activationFailOs.registerApp;
activationFailOs.registerApp = (app) => {
  if (app.id === "activation-fail") throw new Error("activation app registry failed");
  return originalRegisterApp(app);
};
await assertRejects(
  () => activationFailOs.packages.install(packageManifest("activation-fail", "0.1.0", [
    { path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" },
  ])),
  "activation app registry failed",
);
assert(activationFailureEvents.includes("phase-error:activation-fail:app-registry"), "activation failure did not report app-registry phase error");
assert(activationFailureEvents.includes("error:activation-fail:error"), "activation failure did not report activation error");
assert(!activationFailOs.fs.exists("/opt/activation-fail"), "failed activation left install root");
assert(activationFailOs.fs.list("/tmp/dindbos/package-staging").length === 0, "failed activation left staging root entries");
assert(!activationFailOs.fs.exists("/var/lib/dindbos/packages/activation-fail.json"), "failed activation left package record");
assert(!activationFailOs.fs.exists("/usr/share/applications/Activation Fail.app"), "failed activation left launcher");
assert(!activationFailOs.apps.apps.has("activation-fail"), "failed activation registered app");
assert(!activationFailOs.readRuntimeOperationLock("package-db"), "failed activation left package DB operation lock");

const quotaOs = createDindbOSTestRuntime();
const quotaReservations = [];
quotaOs.storage = {
  reserveStorageBytes(bytes, details = {}) {
    quotaReservations.push({ bytes, details });
    throw new Error(`storage quota exceeded: required=${bytes} available=1 quota=1`);
  },
};
await assertRejects(
  () => quotaOs.packages.install(packageManifest("quota-denied", "0.1.0", [
    { path: "app.js", mime: "text/javascript", content: "export const quota = true;\n" },
  ])),
  "storage quota exceeded",
);
assert(quotaReservations.length === 1 && quotaReservations[0].details.packageId === "quota-denied", "package install did not reserve quota before mutation");
assert(!quotaOs.fs.exists("/opt/quota-denied"), "quota-denied package mutated install directory");
assert(!quotaOs.fs.exists("/var/lib/dindbos/packages/quota-denied.json"), "quota-denied package wrote package record");
assert(!quotaOs.apps.apps.has("quota-denied"), "quota-denied package registered app");

packages.install(packageManifest("namespace-target", "0.1.0", [
  {
    path: "app.js",
    mime: "text/javascript",
    content: [
      "export function mount({ content, os }) {",
      "  os.ipc.register('namespace-target.echo', (message) => ({ ok: true, from: message.fromAppId }));",
      "  content.innerHTML = '<main data-namespace-target>ipc-ready</main>';",
      "}",
    ].join("\n"),
  },
  { path: "secret.txt", mime: "text/plain", content: "target secret\n" },
], { namespace: { ipcEndpoints: ["namespace-target.echo"] } }));
const namespaceTargetWindow = os.apps.launch("namespace-target");
await namespaceTargetWindow.rendered;
await waitFor(() => namespaceTargetWindow.content.innerHTML.includes("data-namespace-target"), `namespace target did not render: ${namespaceTargetWindow.content.innerHTML}`);
os.registerApp({
  id: "namespace-child",
  name: "Namespace Child",
  manifest: { capabilities: [], fileSystem: { read: [], write: [] } },
  render: ({ content }) => {
    content.innerHTML = "<main data-namespace-child>child</main>";
  },
});
packages.install(packageManifest("namespace-probe", "0.1.0", [
  {
    path: "app.js",
    mime: "text/javascript",
    content: [
      "export function mount({ content, os, pkg }) {",
      "  let rootIsolation = 'not-denied';",
      "  try { os.fs.readFile('/opt/namespace-target/secret.txt'); }",
      "  catch (error) { rootIsolation = error.message.includes('sandbox denied') ? 'root-denied' : error.message; }",
      "  let dependencyIsolation = 'not-denied';",
      "  try { os.node.evaluate(\"const secret = require('secret-lib'); console.log(secret);\", pkg.installPath); }",
      "  catch (error) { dependencyIsolation = error.message.includes('dependency not declared') ? 'dependency-denied' : error.message; }",
      "  let directDependencyIsolation = 'not-denied';",
      "  try { os.fs.readFile('/opt/namespace-probe/node_modules/secret-lib/index.js'); }",
      "  catch (error) { directDependencyIsolation = error.message.includes('dependency view denied') ? 'direct-dependency-denied' : error.message; }",
      "  const declaredDependency = os.fs.readFile('/opt/namespace-probe/node_modules/declared-lib/index.js').includes('declared') ? 'declared-ok' : 'declared-missing';",
      "  const visibleDependencies = os.fs.list('/opt/namespace-probe/node_modules').map((entry) => entry.name).join(',');",
      "  const dependencyView = os.packages.dependencyView();",
      "  let ipcIsolation = 'not-denied';",
      "  try { os.ipc.send('namespace-target.echo', { probe: true }); }",
      "  catch (error) { ipcIsolation = error.message.includes('send denied') ? 'ipc-denied' : error.message; }",
      "  const child = os.launch('namespace-child');",
      "  content.innerHTML = `<main data-namespace-probe data-child-pid=\"${child.pid}\">${rootIsolation}:${dependencyIsolation}:${directDependencyIsolation}:${declaredDependency}:${visibleDependencies}:${dependencyView.allowedPackages.join(',')}:${ipcIsolation}</main>`;",
      "}",
    ].join("\n"),
  },
  { path: "node_modules/declared-lib/index.js", mime: "text/javascript", content: "module.exports = 'declared';\n" },
  { path: "node_modules/secret-lib/index.js", mime: "text/javascript", content: "module.exports = 'undeclared secret';\n" },
], {
  dependencies: { npm: { "declared-lib": "1.0.0" } },
  permissions: { capabilities: ["app.launch", "node.execute", "package.read"] },
}));
const namespaceProbeWindow = os.apps.launch("namespace-probe");
await namespaceProbeWindow.rendered;
await waitFor(() => namespaceProbeWindow.content.innerHTML.includes("data-namespace-probe"), `namespace probe did not render: ${namespaceProbeWindow.content.innerHTML}`);
assert(namespaceProbeWindow.content.innerHTML.includes("root-denied:dependency-denied:direct-dependency-denied:declared-ok:declared-lib:declared-lib:ipc-denied"), `package namespace isolation mismatch: ${namespaceProbeWindow.content.innerHTML}`);
const namespaceProbeRecord = packages.info("namespace-probe");
assert(packages.dependencyView("namespace-probe").allowedPaths.includes("/opt/namespace-probe/node_modules/declared-lib"), "package dependency view missing declared dependency path");
const namespaceChild = os.processes.list().find((process) => process.parentPid === namespaceProbeWindow.pid && process.appId === "namespace-child");
assert(namespaceChild?.manifest?.namespace?.processGroup === "package:namespace-probe", `child process did not inherit package namespace: ${JSON.stringify(namespaceChild)}`);
const wasmPolicyApp = os.wasm.processApp({
  path: "/opt/namespace-probe/tool.wasm",
  cwd: "/opt/namespace-probe",
  manifest: {
    namespace: namespaceProbeRecord.namespace,
    fileSystem: { read: [namespaceProbeRecord.installPath], write: [] },
  },
});
os.wasm.assertFileSystem("/opt/namespace-probe/node_modules/declared-lib/index.js", "read", { manifest: wasmPolicyApp.manifest });
await assertRejects(
  () => os.wasm.assertFileSystem("/opt/namespace-probe/node_modules/secret-lib/index.js", "read", { manifest: wasmPolicyApp.manifest }),
  "dependency view denied",
);
const namespaceChildStatus = os.fs.readFile(`/proc/${namespaceChild.pid}/status`);
assert(namespaceChildStatus.includes("Namespace:\tpackage:namespace-probe"), "child /proc status missing inherited package namespace");
assert(JSON.parse(os.fs.readFile("/proc/processes.json")).some((entry) => entry.pid === namespaceChild.pid && entry.namespace?.processGroup === "package:namespace-probe"), "/proc processes JSON missing inherited package namespace");
assert(os.fs.readFile(`/proc/${namespaceChild.pid}/root`).trim() === "/opt/namespace-probe", "child /proc root did not expose package namespace root");
assert(os.fs.readFile(`/proc/${namespaceChild.pid}/cwd`).trim() === "/home/guest", "child /proc cwd did not expose process cwd");
const namespaceMounts = os.fs.readFile(`/proc/${namespaceChild.pid}/mounts`);
assert(namespaceMounts.includes("/opt/namespace-probe pkgfs"), "child /proc mounts missing package root mount");
assert(namespaceMounts.includes("/var/lib/dindbos/package-state/namespace-probe statefs"), "child /proc mounts missing namespace state root");
assert(namespaceMounts.includes("namespace=package:namespace-probe"), "child /proc mounts missing namespace label");
const namespaceLimits = JSON.parse(os.fs.readFile(`/proc/${namespaceChild.pid}/limits`));
assert(namespaceLimits.processGroup === "package:namespace-probe", "child /proc limits missing process group");
os.processes.kill(namespaceChild.pid, "namespace-test-cleanup");
os.processes.kill(namespaceProbeWindow.pid, "namespace-test-cleanup");
os.processes.kill(namespaceTargetWindow.pid, "namespace-test-cleanup");
assert(!os.ipcEndpoints.has("namespace-target.echo"), "package IPC endpoint remained after owner process exit");
packages.remove("namespace-probe");
packages.remove("namespace-target");

packages.install(packageManifest("cli-namespace", "0.1.0", [
  {
    path: "bin/cli.js",
    mime: "text/javascript",
    content: [
      "import fs from 'fs';",
      "export async function main(argv = []) {",
      "  let rootIsolation = 'not-denied';",
      "  try { fs.readFileSync('/opt/rollback-demo/app.js', 'utf8'); }",
      "  catch (error) { rootIsolation = error.message.includes('sandbox denied') ? 'root-denied' : error.message; }",
      "  let dependencyIsolation = 'not-denied';",
      "  try { await import('secret-lib'); }",
      "  catch (error) { dependencyIsolation = error.message.includes('dependency not declared') ? 'dependency-denied' : error.message; }",
      "  console.log(`argv=${argv.join(':')}`);",
      "  return `cli=${argv.join(':')}:${rootIsolation}:${dependencyIsolation}`;",
      "}",
    ].join("\n"),
  },
  { path: "node_modules/secret-lib/index.js", mime: "text/javascript", content: "export default 'undeclared secret';\n" },
]));
const cliRun = await packages.runCli("cli-namespace", ["alpha", "beta"]);
assert(cliRun.output.includes("argv=alpha:beta"), `package CLI did not capture console output: ${cliRun.output}`);
assert(cliRun.output.includes("cli=alpha:beta:root-denied:dependency-denied"), `package CLI namespace policy mismatch: ${cliRun.output}`);
assert(cliRun.namespace.processGroup === "package:cli-namespace", "package CLI result did not expose namespace");
const cliHistory = os.processes.history.filter((process) => process.appId === "package:cli-namespace:cli").pop();
assert(cliHistory?.manifest?.namespace?.processGroup === "package:cli-namespace", `package CLI process history missing namespace: ${JSON.stringify(cliHistory)}`);
assert(cliHistory.executorKind === "package-cli", "package CLI process history missing executor kind");
const shell = new ShellSession(os);
const strictCli = packages.strictNamespaceCheck("cli-namespace");
assert(strictCli.strict === true, `installed package strict namespace check failed: ${JSON.stringify(strictCli)}`);
const strictShellRun = await shell.executeAsync("pkg strict cli-namespace");
assert(strictShellRun.status === 0 && strictShellRun.output.includes("strict=ok package=cli-namespace"), `pkg strict installed package mismatch: ${JSON.stringify(strictShellRun)}`);
os.fs.writeOrCreateFile("/home/guest/strict-broad.json", JSON.stringify(packageManifest("strict-broad", "0.1.0", [
  { path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" },
], { permissions: { fileSystem: { read: ["/"], write: ["/opt/strict-broad"] } } })), "/", {}, os.permissions.systemPrincipal());
const strictBroad = packages.strictNamespaceCheckFromManifestPath("/home/guest/strict-broad.json");
assert(strictBroad.strict === false, "strict namespace check did not reject broad manifest scopes");
const strictBroadShell = await shell.executeAsync("pkg strict /home/guest/strict-broad.json");
assert(strictBroadShell.status === 1 && strictBroadShell.output.includes("pkg: strict failed"), `pkg strict broad manifest status mismatch: ${JSON.stringify(strictBroadShell)}`);
const cliNamespaceRecord = packages.info("cli-namespace");
os.fs.writeOrCreateFile(`${cliNamespaceRecord.namespace.cacheRoot}/cached.txt`, "cached", "/", {}, os.permissions.systemPrincipal());
const cacheClearShell = await shell.executeAsync("pkg cache clear cli-namespace");
assert(cacheClearShell.status === 0 && cacheClearShell.output.includes("package cache cleared cli-namespace"), `pkg cache clear output mismatch: ${JSON.stringify(cacheClearShell)}`);
assert(os.fs.exists(cliNamespaceRecord.namespace.cacheRoot), "package cache clear removed namespace cache root");
assert(!os.fs.exists(`${cliNamespaceRecord.namespace.cacheRoot}/cached.txt`), "package cache clear left cached file");
assert(os.fs.exists(cliNamespaceRecord.namespace.stateRoot), "package cache clear removed namespace state root");
assert(os.fs.exists(cliNamespaceRecord.namespace.tempRoot), "package cache clear removed namespace temp root");
assert(os.fs.exists(cliNamespaceRecord.installPath), "package cache clear removed package root");
const cliShellRun = await shell.executeAsync("pkg run cli-namespace shell");
assert(cliShellRun.status === 0, `pkg run shell status mismatch: ${JSON.stringify(cliShellRun)}`);
assert(cliShellRun.output.includes("cli=shell:root-denied:dependency-denied"), `pkg run did not execute package CLI in namespace: ${cliShellRun.output}`);
packages.remove("cli-namespace");

packages.install(packageManifest("cleanup-demo", "0.1.0", [
  {
    path: "app.js",
    mime: "text/javascript",
    content: [
      "export function mount({ content, os }) {",
      "  os.ipc.register('cleanup-demo.echo', () => ({ ok: true }));",
      "  const child = os.launch('namespace-child');",
      "  content.innerHTML = `<main data-cleanup-demo data-child-pid=\"${child.pid}\">cleanup</main>`;",
      "}",
    ].join("\n"),
  },
], { permissions: { capabilities: ["app.launch"] }, namespace: { ipcEndpoints: ["cleanup-demo.echo"] } }));
const cleanupWindow = os.apps.launch("cleanup-demo");
await cleanupWindow.rendered;
await waitFor(() => cleanupWindow.content.innerHTML.includes("data-cleanup-demo"), `cleanup demo did not render: ${cleanupWindow.content.innerHTML}`);
const cleanupChild = os.processes.list().find((process) => process.parentPid === cleanupWindow.pid && process.appId === "namespace-child");
assert(cleanupChild?.manifest?.namespace?.processGroup === "package:cleanup-demo", "cleanup child did not inherit package namespace");
assert(os.ipcEndpoints.has("cleanup-demo.echo"), "cleanup demo IPC endpoint was not registered");
const cleanupRecord = packages.info("cleanup-demo");
os.ipcEndpoints.set("cleanup-demo.daemon", {
  endpoint: "cleanup-demo.daemon",
  ownerPid: 0,
  ownerAppId: "",
  ownerNamespace: cleanupRecord.namespace.processGroup,
  ownerPackageId: cleanupRecord.id,
  handler: () => ({ ok: true }),
  createdAt: new Date().toISOString(),
});
packages.remove("cleanup-demo");
assert(!os.processes.get(cleanupWindow.pid), "package uninstall left package app process running");
assert(!os.processes.get(cleanupChild.pid), "package uninstall left namespace child process running");
assert(!os.ipcEndpoints.has("cleanup-demo.echo"), "package uninstall left namespace IPC endpoint registered");
assert(!os.ipcEndpoints.has("cleanup-demo.daemon"), "package uninstall left non-process namespace IPC endpoint registered");
assert(!os.fs.exists("/var/lib/dindbos/package-state/cleanup-demo"), "package uninstall left cleanup namespace state root");
assert(!os.fs.exists("/var/cache/dindbos/packages/cleanup-demo"), "package uninstall left cleanup namespace cache root");
assert(!os.fs.exists("/tmp/dindbos/packages/cleanup-demo"), "package uninstall left cleanup namespace temp root");

await assertRejects(
  () => packages.install(packageManifest("wasm-future", "0.1.0", [
    { path: "app.wasm", mime: "application/wasm", base64: "AGFzbQEAAA==" },
  ], { compatibility: { tier: "C" } })),
  "requires unsupported compatibility tier C",
);
assert(!os.fs.exists("/opt/wasm-future"), "unsupported compatibility package mutated install directory");
assert(!os.apps.apps.has("wasm-future"), "unsupported compatibility package registered app");

const apiCompatible = packages.install(packageManifest("api-compatible", "0.1.0", [
  { path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" },
], { api: { minVersion: 1, targetVersion: 2, maxVersion: 2 } }));
assert(apiCompatible.api.negotiatedVersion === 1, "compatible API range did not negotiate to runtime API v1");
assert(apiCompatible.api.status === "downgraded", `compatible API range status mismatch: ${apiCompatible.api.status}`);
assert(os.apps.getManifest("api-compatible").api.negotiatedVersion === 1, "negotiated API version was not exposed in app manifest");
packages.remove("api-compatible");

await assertRejects(
  () => packages.install(packageManifest("api-future", "0.1.0", [
    { path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" },
  ], { apiVersion: 2 })),
  "requires unsupported API version 2",
);
assert(!os.fs.exists("/opt/api-future"), "unsupported API package mutated install directory");
assert(!os.fs.exists("/var/lib/dindbos/packages/api-future.json"), "unsupported API package wrote package record");
assert(!os.apps.apps.has("api-future"), "unsupported API package registered app");

await assertRejects(
  () => packages.install(packageManifest("rollback-demo", "0.2.0", [
    { path: "app.js", mime: "text/javascript", content: "export const version = '0.2.0';\n" },
    { path: "../bad.js", mime: "text/javascript", content: "bad\n" },
  ])),
  "invalid package file path",
);

assert(os.fs.readFile("/opt/rollback-demo/app.js").includes("0.1.0"), "failed update did not preserve previous app file");
assert(packages.info("rollback-demo")?.version === "0.1.0", "failed update did not preserve previous package record");
assert(os.fs.exists("/usr/share/applications/Rollback Demo.app"), "failed update removed previous launcher");
assert(os.apps.apps.has("rollback-demo"), "failed update removed previous app registration");

const updated = packages.install(packageManifest("rollback-demo", "0.2.0", [
  { path: "app.js", mime: "text/javascript", content: "export const version = '0.2.0';\n" },
]));
assert(updated.version === "0.2.0", "valid update returned wrong version");
assert(updated.lifecycle.updateCount === 1, "valid update did not increment lifecycle update count");
assert(lifecycleEvents.includes("update:rollback-demo:rollback-demo"), "app:update lifecycle event missing");
assert(lifecycleEvents.filter((event) => event === "install:rollback-demo:rollback-demo").length === 1, "valid update emitted a second install event");

await assertRejects(() => packages.remove("missing-package"), "package not installed");
assert(packages.info("rollback-demo")?.version === "0.2.0", "missing remove mutated installed package record");

const removed = packages.remove("rollback-demo");
assert(removed.id === "rollback-demo", "remove returned wrong package id");
assert(!os.fs.exists("/opt/rollback-demo"), "remove left install directory");
assert(!os.fs.exists(rollbackNamespace.stateRoot), "remove left package namespace state root");
assert(!os.fs.exists(rollbackNamespace.cacheRoot), "remove left package namespace cache root");
assert(!os.fs.exists(rollbackNamespace.tempRoot), "remove left package namespace temp root");
assert(!os.fs.exists("/var/lib/dindbos/packages/rollback-demo.json"), "remove left package record");
assert(!os.fs.exists("/usr/share/applications/Rollback Demo.app"), "remove left launcher");
assert(!os.apps.apps.has("rollback-demo"), "remove left app registration");
assert(lifecycleEvents.includes("uninstall:rollback-demo:rollback-demo"), "app:uninstall lifecycle event missing");
assert(lifecycleEvents.includes("uninstall-cleanup:rollback-demo:rollback-demo"), "app:uninstall-cleanup lifecycle event missing");

const remoteFetch = countedFetch(fakeFetch);
await assertRejects(
  () => packages.installFromUrl("https://packages.example/unsigned/dindbos.app.json", { fetch: remoteFetch }),
  "signature missing",
);
assert(!os.fs.exists("/opt/remote-unsigned"), "unsigned remote install mutated package directory");

await assertRejects(
  () => packages.installFromUrl("https://packages.example/broken/dindbos.app.json", { fetch: remoteFetch, allowUntrusted: true }),
  "integrity mismatch",
);

assert(!os.fs.exists("/opt/remote-broken"), "failed remote install left install directory");
assert(!os.fs.exists("/var/lib/dindbos/packages/remote-broken.json"), "failed remote install left package record");
assert(!os.fs.exists("/usr/share/applications/Remote Broken.app"), "failed remote install left launcher");
assert(!os.apps.apps.has("remote-broken"), "failed remote install registered app");

const signed = await signedPackageManifest(packageManifest("remote-good", "0.1.0", [
  {
    path: "app.js",
    mime: "text/javascript",
    content: "export const signed = true;\n",
    integrity: await sha256Integrity("export const signed = true;\n"),
  },
]));
signedRemoteManifest = signed.manifest;
trustedPublisher = signed.publisher;

await assertRejects(
  () => packages.installFromUrl("https://packages.example/signed/dindbos.app.json", { fetch: remoteFetch, registry: "community" }),
  "is not trusted",
);
assert(!os.fs.exists("/opt/remote-good"), "untrusted signed package mutated install directory");

const addedPublisher = packages.addTrustedPublisher(trustedPublisher);
assert(addedPublisher.id === trustedPublisher.id, "trusted publisher add returned wrong id");
assert(packages.trustedPublishers().some((publisher) => publisher.publicKey === trustedPublisher.publicKey), "trusted publisher was not persisted");

const remoteQuotaSigned = await signedPackageManifest(packageManifest("remote-quota", "0.1.0", [
  {
    path: "app.js",
    mime: "text/javascript",
    url: "quota-app.js",
    size: 8_192,
    integrity: await sha256Integrity("export const quota = true;\n"),
  },
]));
let remoteQuotaManifest = remoteQuotaSigned.manifest;
const remoteQuotaOs = createDindbOSTestRuntime();
remoteQuotaOs.storage = {
  reservations: [],
  reserveStorageBytes(bytes, details = {}) {
    this.reservations.push({ bytes, details });
    throw new Error(`storage quota exceeded: required=${bytes} available=1 quota=1`);
  },
};
remoteQuotaOs.packages.addTrustedPublisher(remoteQuotaSigned.publisher);
const remoteQuotaFetch = countedFetch(async (url) => {
  if (url.endsWith("dindbos.app.json")) return response(JSON.stringify(remoteQuotaManifest));
  if (url.endsWith("quota-app.js")) return response("export const quota = true;\n");
  return { ok: false, status: 404, headers: new Map(), text: async () => "" };
});
await assertRejects(
  () => remoteQuotaOs.packages.installFromUrl("https://packages.example/quota/dindbos.app.json", { fetch: remoteQuotaFetch, registry: "community" }),
  "storage quota exceeded",
);
assert(remoteQuotaOs.storage.reservations.length === 1 && remoteQuotaOs.storage.reservations[0].details.source === "remote", "remote package install did not reserve quota");
assert(remoteQuotaFetch.count === 1, `remote quota denial fetched package file: ${remoteQuotaFetch.count}`);
assert(!remoteQuotaOs.fs.exists("/opt/remote-quota"), "remote quota denial mutated install directory");
assert(!remoteQuotaOs.fs.exists("/var/lib/dindbos/packages/remote-quota.json"), "remote quota denial wrote package record");
assert(!remoteQuotaOs.apps.apps.has("remote-quota"), "remote quota denial registered app");

await assertRejects(
  () => packages.installFromUrl("https://packages.example/tampered/dindbos.app.json", { fetch: remoteFetch, registry: "community" }),
  "signature invalid",
);
assert(!os.fs.exists("/opt/remote-tampered"), "invalid signature install mutated package directory");

const remoteGood = await packages.installFromUrl("https://packages.example/signed/dindbos.app.json", { fetch: remoteFetch, registry: "community" });
assert(remoteGood.trust.source === "remote", "remote package trust source mismatch");
assert(remoteGood.trust.registry === "community", "remote package trust registry mismatch");
assert(remoteGood.trust.trusted === true, "trusted signed package was not marked trusted");
assert(remoteGood.trust.signature.status === "valid", "trusted signed package signature status mismatch");
assert(remoteGood.trust.signature.publisherId === trustedPublisher.id, "trusted signed package publisher id mismatch");
assert(packages.info("remote-good").trust.trusted === true, "trusted signed package metadata was not persisted");
const remoteFetchCountAfterFirstInstall = remoteFetch.count;
const cacheHitsBeforeRepeat = os.cache.status().hits;
await packages.installFromUrl("https://packages.example/signed/dindbos.app.json", { fetch: remoteFetch, registry: "community" });
assert(remoteFetch.count === remoteFetchCountAfterFirstInstall, "package cache did not avoid repeated manifest/file fetches");
assert(os.cache.status().hits > cacheHitsBeforeRepeat, "package cache did not report repeated install hits");

assert(packages.removeTrustedPublisher(trustedPublisher.id) === trustedPublisher.id, "trusted publisher remove returned wrong id");
assert(!packages.trustedPublishers().some((publisher) => publisher.id === trustedPublisher.id), "trusted publisher remove did not persist");

const flow = packages.install(packageManifest("flow-demo", "1.0.0", [
  {
    path: "app.js",
    mime: "text/javascript",
    content: [
      "export async function mount({ content, os, pkg }) {",
      "  const note = os.fs.readFile('/opt/flow-demo/data.txt');",
      "  content.innerHTML = `<main data-flow-run>${pkg.id}:${note}</main>`;",
      "}",
    ].join("\n"),
  },
  { path: "data.txt", mime: "text/plain", content: "runtime-ok" },
]));
assert(flow.id === "flow-demo", "flow package install returned wrong id");
const flowWrite = os.syscall("fs.writeText", { path: "/opt/flow-demo/blocked.txt", content: "blocked" });
assert(flowWrite.ok === false && flowWrite.error.code === "EACCES", `package image mount write was not denied with EACCES: ${JSON.stringify(flowWrite)}`);
const flowEntry = os.fs.stat("/opt/flow-demo/app.js");
assert(flowEntry.permissions === "-rw-r--r--", `package JS entry permissions mismatch: ${flowEntry.permissions}`);
assert(!flowEntry.permissions.includes("x"), "package JS entry unexpectedly has execute bits");
const launched = os.apps.launch("flow-demo");
await waitFor(() => launched.content.innerHTML.includes("flow-demo:runtime-ok"), "package app did not run through AppRegistry launch");
assert(lifecycleEvents.includes("first-run:flow-demo:flow-demo"), "app:first-run lifecycle event missing");
const firstRunEventCount = lifecycleEvents.filter((event) => event === "first-run:flow-demo:flow-demo").length;
os.apps.launch("flow-demo");
assert(lifecycleEvents.filter((event) => event === "first-run:flow-demo:flow-demo").length === firstRunEventCount, "app:first-run emitted more than once");
assert(packages.info("flow-demo").lifecycle.firstRunAt, "first-run timestamp was not persisted");
assert(os.processes.get(launched.pid), "package launch did not create process");
assert(launched.content.innerHTML.includes("data-flow-run"), "package app did not render mounted UI");
const removedFlow = packages.remove("flow-demo");
assert(removedFlow.id === "flow-demo", "flow package remove returned wrong id");
assert(!os.apps.has("flow-demo"), "flow package app remained registered after remove");
assert(!os.fs.exists("/opt/flow-demo"), "flow package install path remained after remove");
assert(!os.fs.exists("/usr/share/applications/Flow Demo.app"), "flow package launcher remained after remove");

const wasmTool = packages.install({
  id: "wasm-tool",
  name: "WASM Tool",
  version: "0.1.0",
  description: "A package app rendered by a DindbOS ABI WebAssembly entry point.",
  app: {
    id: "wasm-tool",
    name: "WASM Tool",
    title: "WASM Tool.app",
    icon: "app",
    width: 560,
    height: 360,
    entry: "tool.wasm",
    runtime: "wasm",
  },
  files: [
    {
      path: "tool.wasm",
      mime: "application/wasm",
      base64: Buffer.from(packageWasm()).toString("base64"),
      permissions: "-rwxr-xr-x",
    },
  ],
  permissions: {
    capabilities: [],
    fileSystem: {
      read: ["/opt/wasm-tool"],
      write: ["/home/guest"],
    },
  },
});
assert(wasmTool.app.runtime === "wasm", "WASM package runtime was not normalized");
assert(os.apps.getManifest("wasm-tool").runtime === "wasm", "WASM package app manifest did not expose runtime");
assert(os.fs.stat("/opt/wasm-tool/tool.wasm").mime === "application/wasm", "WASM package file mime mismatch");
const wasmWindow = os.apps.launch("wasm-tool");
await wasmWindow.rendered;
await waitFor(() => wasmWindow.content.innerHTML.includes("data-wasm-package"), `WASM package did not render launch result: ${wasmWindow.content.innerHTML}`);
assert(wasmWindow.content.innerHTML.includes("wasm package ok"), "WASM package stdout was not rendered");
assert(os.fs.readFile("/home/guest/wasm-package-output.txt") === "from package wasm", "WASM package did not write through syscall-backed VFS");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("app=package:wasm-tool:wasm fs.writeText OK"), "WASM package syscall trace missing package wasm app id");
const wasmHistory = os.processes.history.find((process) => process.appId === "package:wasm-tool:wasm" && process.manifest?.namespace?.processGroup === "package:wasm-tool");
assert(wasmHistory, "WASM package child process did not inherit package namespace");
assert(lifecycleEvents.includes("first-run:wasm-tool:wasm-tool"), "WASM package did not emit app:first-run lifecycle event");
const removedWasmTool = packages.remove("wasm-tool");
assert(removedWasmTool.id === "wasm-tool", "WASM package remove returned wrong id");
assert(!os.apps.has("wasm-tool"), "WASM package app remained registered after remove");
assert(!os.fs.exists("/opt/wasm-tool"), "WASM package install path remained after remove");

packages.bootstrap();
assert(os.fs.exists("/opt/dindbos/packages/api-lab/dindbos.app.json"), "API Lab sample manifest was not bootstrapped");
assert(os.fs.exists("/opt/dindbos/packages/paint-sample/dindbos.app.json"), "Paint sample manifest was not bootstrapped");
assert(os.fs.exists("/opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json"), "PDF Viewer sample manifest was not bootstrapped");
assert(os.fs.exists("/opt/dindbos/templates/template-gui-app/dindbos.app.json"), "GUI app template manifest was not bootstrapped");
assert(os.fs.exists("/opt/dindbos/templates/template-cli-app/dindbos.app.json"), "CLI app template manifest was not bootstrapped");
assert(os.fs.exists("/opt/dindbos/templates/template-wasm-cli/dindbos.app.json"), "WASM CLI template manifest was not bootstrapped");
assert(os.fs.exists("/opt/dindbos/templates/template-background-worker/dindbos.app.json"), "Background worker template manifest was not bootstrapped");
const cliTemplateStrict = packages.strictNamespaceCheckFromManifestPath("/opt/dindbos/templates/template-cli-app/dindbos.app.json");
assert(cliTemplateStrict.strict === true, `CLI template strict namespace check failed: ${JSON.stringify(cliTemplateStrict)}`);
const localSamples = await packages.search("sample");
assert(localSamples.some((entry) => entry.id === "paint-sample"), "local registry search did not include Paint sample");
assert(localSamples.some((entry) => entry.id === "pdf-viewer-sample"), "local registry search did not include PDF Viewer sample");
const guiTemplate = packages.installFromManifestPath("/opt/dindbos/templates/template-gui-app/dindbos.app.json");
assert(guiTemplate.app.entryPath === "/opt/template-gui-app/app.js", "GUI template entry path mismatch");
const guiTemplateWindow = os.apps.launch("template-gui-app");
await guiTemplateWindow.rendered;
await waitFor(() => guiTemplateWindow.content.innerHTML.includes("data-template-gui"), "GUI template did not render");
const cliTemplate = packages.installFromManifestPath("/opt/dindbos/templates/template-cli-app/dindbos.app.json");
assert(os.fs.exists("/opt/template-cli-app/bin/cli.js"), "CLI template did not install bin/cli.js");
const cliTemplateRun = await packages.runCli("template-cli-app", ["ready"]);
assert(cliTemplateRun.output.includes("template cli ready"), `CLI template did not run through package CLI: ${cliTemplateRun.output}`);
const cliTemplateWindow = os.apps.launch("template-cli-app");
await cliTemplateWindow.rendered;
await waitFor(() => cliTemplateWindow.content.innerHTML.includes("data-template-cli"), "CLI template did not render");
const wasmCliTemplate = packages.installFromManifestPath("/opt/dindbos/templates/template-wasm-cli/dindbos.app.json");
assert(wasmCliTemplate.app.runtime === "wasm", "WASM CLI template runtime mismatch");
const wasmCliTemplateWindow = os.apps.launch("template-wasm-cli");
await wasmCliTemplateWindow.rendered;
await waitFor(() => wasmCliTemplateWindow.content.innerHTML.includes("template wasm ok"), `WASM CLI template did not render stdout: ${wasmCliTemplateWindow.content.innerHTML}`);
const workerTemplate = packages.installFromManifestPath("/opt/dindbos/templates/template-background-worker/dindbos.app.json");
assert(workerTemplate.app.capabilities.includes("process.execute"), "Background worker template did not declare process.execute");
assert(workerTemplate.app.capabilities.includes("process.read"), "Background worker template did not declare process.read");
assert(os.fs.exists("/opt/template-background-worker/worker.js"), "Background worker template did not install worker.js");
const workerTemplateWindow = os.apps.launch("template-background-worker");
await workerTemplateWindow.rendered;
await waitFor(() => workerTemplateWindow.content.innerHTML.includes("data-template-worker"), "Background worker template did not render");
const workerNamespace = packages.install(packageManifest("worker-namespace", "0.1.0", [
  {
    path: "app.js",
    mime: "text/javascript",
    content: [
      "export async function mount({ content, os }) {",
      "  const result = await os.executor.runCpuTask({ appId: 'worker-namespace:cpu', name: 'Worker Namespace CPU', durationMs: 5 });",
      "  content.innerHTML = `<main data-worker-namespace data-worker-pid=\"${result.pid}\">${result.backend}:${result.status}</main>`;",
      "}",
    ].join("\n"),
  },
], { permissions: { capabilities: ["process.execute", "process.read"] } }));
assert(workerNamespace.namespace.processGroup === "package:worker-namespace", "worker namespace package metadata mismatch");
const workerNamespaceWindow = os.apps.launch("worker-namespace");
await workerNamespaceWindow.rendered;
await waitFor(() => workerNamespaceWindow.content.innerHTML.includes("data-worker-namespace"), `worker namespace package did not render: ${workerNamespaceWindow.content.innerHTML}`);
const workerNamespaceHistory = os.processes.history.filter((process) => process.appId === "worker-namespace:cpu").pop();
assert(workerNamespaceHistory?.parentPid === workerNamespaceWindow.pid, `worker executor parent pid mismatch: ${JSON.stringify(workerNamespaceHistory)}`);
assert(workerNamespaceHistory?.manifest?.namespace?.processGroup === "package:worker-namespace", `worker executor did not inherit package namespace: ${JSON.stringify(workerNamespaceHistory)}`);
assert(workerNamespaceHistory.executorKind === "cpu-task", "worker executor history missing cpu-task kind");
packages.remove("worker-namespace");
const serviceNamespace = packages.install({
  ...packageManifest("service-namespace", "0.1.0", [
    { path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" },
    { path: "node_modules/service-lib/index.js", mime: "text/javascript", content: "module.exports = 'service';\n" },
    { path: "node_modules/secret-lib/index.js", mime: "text/javascript", content: "module.exports = 'secret';\n" },
  ]),
  dependencies: { npm: { "service-lib": "1.0.0" } },
  services: [
    {
      id: "sync",
      name: "Service Namespace Sync",
      fileSystem: { read: ["/opt/service-namespace"], write: [] },
      capabilities: ["process.read"],
    },
  ],
});
assert(serviceNamespace.services[0].id === "package:service-namespace:sync", "package service id was not namespaced");
const serviceId = "package:service-namespace:sync";
assert(os.services.get(serviceId)?.packageId === "service-namespace", "package service was not registered with package id");
assert(os.services.manifest(serviceId).namespace.processGroup === "package:service-namespace", "package service manifest missing namespace");
const beforePackageServiceStartFlushes = packageServiceFlushes;
const packageService = await os.services.start(serviceId);
assert(packageServiceFlushes === beforePackageServiceStartFlushes + 1, "package service start did not wait for durability sync");
const packageServiceProcess = os.processes.get(packageService.pid);
assert(packageServiceProcess?.manifest?.namespace?.processGroup === "package:service-namespace", `package service process missing namespace: ${JSON.stringify(packageServiceProcess)}`);
assert(packageServiceProcess.executorKind === "service", "package service process missing service executor kind");
const serviceContext = os.services.serviceContext(os.services.definitions.get(serviceId), os.services.records.get(serviceId));
assert(serviceContext.dependencyView.allowedPackages.includes("service-lib"), "package service dependency view missing declared dependency");
assert(serviceContext.fs.readFile("/opt/service-namespace/node_modules/service-lib/index.js").includes("service"), "package service dependency view blocked declared dependency");
const beforePackageServiceContextFlushes = packageServiceFlushes;
const packageServiceSync = await serviceContext.sync("namespace-smoke");
assert(packageServiceSync.reason === `service:${serviceId}:namespace-smoke`, "package service context sync reason mismatch");
assert(packageServiceFlushes === beforePackageServiceContextFlushes + 1, "package service context sync did not reach durability barrier");
await assertRejects(
  () => serviceContext.fs.readFile("/opt/service-namespace/node_modules/secret-lib/index.js"),
  "dependency view denied",
);
packages.remove("service-namespace");
assert(!os.services.get(serviceId), "package uninstall left package service registered");
assert(!os.processes.get(packageService.pid), "package uninstall left package service process running");
const paintSample = packages.installFromManifestPath("/opt/dindbos/packages/paint-sample/dindbos.app.json");
assert(paintSample.app.entryPath === "/opt/paint-sample/app.js", "Paint sample entry path mismatch");
const paintWindow = os.apps.launch("paint-sample");
await paintWindow.rendered;
await waitFor(() => paintWindow.content.innerHTML.includes("data-sample-paint"), "Paint sample did not render packaged canvas UI");
const pdfViewerSample = packages.installFromManifestPath("/opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json");
assert(pdfViewerSample.app.accepts.includes("application/pdf"), "PDF Viewer sample did not declare PDF association");
const pdfViewerWindow = os.apps.launch("pdf-viewer-sample");
await pdfViewerWindow.rendered;
await waitFor(() => pdfViewerWindow.content.innerHTML.includes("data-sample-pdf-viewer"), "PDF Viewer sample did not render packaged viewer UI");
const packageAtomicEvents = [];
os.fs.onChange = (event) => packageAtomicEvents.push(event);
const apiLab = packages.installFromManifestPath("/opt/dindbos/packages/api-lab/dindbos.app.json");
assert(apiLab.id === "api-lab", "API Lab sample install returned wrong id");
assert(apiLab.app.capabilities.includes("package.read"), "API Lab sample did not declare package.read capability");
assert(packageAtomicEvents.some((event) => event.action === "atomic-create" && event.path === "/var/lib/dindbos/packages/api-lab.json"), "package install did not atomically create package DB record");
assert(packageAtomicEvents.some((event) => event.action === "atomic-create" && event.path === "/usr/share/dindbos/manifests/api-lab.json"), "package install did not atomically create app registry manifest");
const apiSource = os.fs.readFile("/opt/api-lab/app.js");
assert(apiSource.includes("sdk.packages.info"), "API Lab sample does not use the DindbOS syscall SDK fixture");
assert(apiSource.includes("sdk.fs.writeText"), "API Lab sample does not use SDK-backed VFS writes");
assert(apiSource.includes("atomicWriteOrCreateFile"), "API Lab sample does not use sandbox atomic VFS writes");
const apiModule = await import(`data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`);
assert(typeof apiModule.mount === "function", "API Lab sample entry did not export mount");
os.unregisterApp(apiLab.app.id);
const packageAppFsck = packages.checkIntegrity({ repair: true, dryRun: true });
assert(packageAppFsck.problems.some((entry) => entry.code === "package-app-missing" && entry.path.endsWith("/api-lab.json")), "package fsck did not detect missing package app registry entry");
assert(packageAppFsck.repairs.some((entry) => entry.kind === "register-package-app" && entry.dryRun), "package fsck dry-run did not report app registry repair plan");
const packageAppRepair = packages.checkIntegrity({ repair: true, dryRun: false });
assert(packageAppRepair.repairs.some((entry) => entry.kind === "register-package-app"), "package fsck repair did not report app registry restoration");
assert(os.apps.has(apiLab.app.id), "package fsck repair did not restore app registry entry");
assert(os.fs.exists("/usr/share/dindbos/manifests/api-lab.json"), "package fsck repair did not restore app manifest file");
assert(os.fs.exists("/usr/share/applications/API Lab.app"), "package fsck repair did not restore app launcher file");
const apiWindow = os.apps.launch("api-lab");
await apiWindow.rendered;
await waitFor(() => apiWindow.content.innerHTML.includes("package=api-lab"), `API Lab sample did not render sandbox API report: ${apiWindow.content.innerHTML}`);
assert(os.fs.readFile("/home/guest/DindbOS API Lab/report.txt").includes("launches=1"), "API Lab sample did not write first app-state value through sandbox fs");
assert(os.fs.readFile("/home/guest/DindbOS API Lab/atomic.txt").includes("atomic=1"), "API Lab sample did not write through sandbox atomic VFS API");
assert(os.processes.readLog(apiWindow.pid).includes("api-lab wrote"), "API Lab sample did not log through process facade");
assert(os.fs.readFile(`/proc/${apiWindow.pid}/syscalls`).includes("fs.writeText OK"), "API Lab sample did not write syscall trace under /proc");
assert(os.fs.readFile(`/proc/${apiWindow.pid}/syscalls`).includes("package.info OK"), "API Lab sample did not read package info through syscall");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("process.log OK"), "API Lab sample did not write global syscall log");
assert(os.fs.readFile("/var/lib/dindbos/app-state/guest/api-lab.json").includes('"launches": 1'), "API Lab sample did not persist app state under per-user app-state");
os.fs.remove(apiLab.app.entryPath, "/", {}, os.permissions.systemPrincipal());
const packageBrokenMountFsck = packages.checkIntegrity({ dryRun: true });
assert(packageBrokenMountFsck.problems.some((entry) => entry.code === "package-entry-missing" && entry.path === apiLab.app.entryPath), "package fsck did not report missing package entry file");
os.fs.writeOrCreateFile(apiLab.app.entryPath, apiSource, "/", { mime: "application/javascript" }, os.permissions.systemPrincipal());
const beforePackageFsck = os.fs.snapshot();
os.fs.remove(apiLab.installPath, "/", { recursive: true }, os.permissions.systemPrincipal());
os.fs.createMount("/opt/orphan-pkg", {
  mountType: "pkgfs",
  owner: "root",
  group: "root",
  permissions: "dr-xr-xr-x",
}, os.permissions.systemPrincipal());
const packageFsck = packages.checkIntegrity({ dryRun: true });
assert(!packageFsck.ok, "package fsck did not detect package DB drift");
assert(packageFsck.problems.some((entry) => entry.code === "package-root-missing" && entry.path === apiLab.installPath), "package fsck did not report missing package root");
assert(packageFsck.problems.some((entry) => entry.code === "package-record-missing" && entry.path === "/opt/orphan-pkg"), "package fsck did not report orphan pkgfs root");
const packageFsckShell = await shell.executeAsync("fsck --dry-run");
assert(packageFsckShell.output.includes("package-root-missing") && packageFsckShell.output.includes("package-record-missing"), `shell fsck did not include package drift: ${packageFsckShell.output}`);
const packageFsckRepair = packages.checkIntegrity({ repair: true, dryRun: false });
assert(packageFsckRepair.repairs.some((entry) => entry.kind === "remove-orphan-pkgfs" && entry.path === "/opt/orphan-pkg"), "package fsck repair did not report orphan pkgfs removal");
assert(!os.fs.exists("/opt/orphan-pkg"), "package fsck repair did not remove orphan pkgfs root");
assert(!packageFsckRepair.repairs.some((entry) => entry.path === apiLab.installPath), "package fsck repair tried to recreate/remove missing package root");
const packageRepairFallback = await shell.executeAsync("fsck --repair");
assert(packageRepairFallback.output.includes("package-root-missing"), `shell fsck repair did not report failed package repair fallback: ${packageRepairFallback.output}`);
assert(os.fs.exists("/var/lib/dindbos/packages/api-lab.json"), "failed package root repair fallback removed package DB record");
const packageRepairAudit = os.fs.readFile("/var/log/dindbos/fsck-audit.log");
assert(packageRepairAudit.includes('"action":"repair-refused"') && packageRepairAudit.includes('"code":"package-root-missing"'), "failed package root repair fallback was not audited as refused");
os.fs.root = beforePackageFsck;
const apiWindowAgain = os.apps.launch("api-lab");
await apiWindowAgain.rendered;
await waitFor(() => apiWindowAgain.content.innerHTML.includes("launches=2"), `API Lab sample did not restore app state on relaunch: ${apiWindowAgain.content.innerHTML}`);
const reloadedOs = createDindbOSTestRuntime(os.fs.snapshot());
const reloadedPackages = reloadedOs.packages;
reloadedPackages.registerInstalledPackages();
const reloadedApiWindow = reloadedOs.apps.launch("api-lab");
await reloadedApiWindow.rendered;
await waitFor(() => reloadedApiWindow.content.innerHTML.includes("launches=3"), `API Lab sample did not restore app state after VFS reload: ${reloadedApiWindow.content.innerHTML}`);
const removedApiLab = packages.remove("api-lab");
assert(removedApiLab.id === "api-lab", "API Lab package remove returned wrong id");
assert(!os.fs.exists("/var/lib/dindbos/app-state/guest/api-lab.json"), "API Lab app state remained after package remove");

console.log("packages smoke ok transaction rollback launch run state remove runtime-testbed");

function packageManifest(id, version, files, extra = {}) {
  const title = titleFor(id);
  return {
    id,
    name: title.replace(/\.app$/, ""),
    version,
    app: {
      id,
      name: title.replace(/\.app$/, ""),
      title,
      entry: "app.js",
    },
    files,
    ...extra,
  };
}

function titleFor(id) {
  if (id === "rollback-demo") return "Rollback Demo.app";
  if (id === "flow-demo") return "Flow Demo.app";
  if (id === "api-compatible") return "API Compatible.app";
  if (id === "api-future") return "API Future.app";
  if (id === "namespace-target") return "Namespace Target.app";
  if (id === "namespace-probe") return "Namespace Probe.app";
  if (id === "remote-broken") return "Remote Broken.app";
  return "Broken Pkg.app";
}

async function fakeFetch(url) {
  if (url.endsWith("dindbos.app.json")) {
    if (url.includes("/unsigned/")) return response(JSON.stringify(packageManifest("remote-unsigned", "0.1.0", [
      { path: "app.js", mime: "text/javascript", content: "export const unsigned = true;\n" },
    ])));
    if (url.includes("/signed/")) return response(JSON.stringify(signedRemoteManifest));
    if (url.includes("/tampered/")) return response(JSON.stringify({ ...signedRemoteManifest, id: "remote-tampered" }));
    return response(JSON.stringify(packageManifest("remote-broken", "0.1.0", [
      {
        path: "app.js",
        mime: "text/javascript",
        url: "app.js",
        integrity: "sha256-deadbeef",
      },
    ])));
  }
  if (url.endsWith("app.js")) return response("export const remote = true;\n");
  return { ok: false, status: 404, headers: new Map(), text: async () => "" };
}

async function signedPackageManifest(manifest) {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const publisher = {
    id: "com.example",
    name: "Example Publisher",
    publicKey: `ed25519-pub:v1:${base64UrlFromBytes(publicKeyBytes)}`,
  };
  const unsigned = {
    ...manifest,
    publisher,
  };
  const signatureBytes = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    keyPair.privateKey,
    new TextEncoder().encode(canonicalPackageManifestPayload(unsigned)),
  ));
  return {
    manifest: {
      ...unsigned,
      signature: {
        algorithm: "ed25519",
        keyId: publisher.publicKey,
        payload: "dindbos-manifest-v1",
        value: `ed25519-sig:v1:${base64UrlFromBytes(signatureBytes)}`,
      },
    },
    publisher,
  };
}

async function sha256Integrity(content) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return `sha256-${Buffer.from(new Uint8Array(digest)).toString("base64")}`;
}

function packageWasm() {
  const stdout = encodeText("wasm package ok\n");
  const request = encodeText(JSON.stringify({
    name: "fs.writeText",
    args: { path: "/home/guest/wasm-package-output.txt", content: "from package wasm" },
  }));
  const data = new Uint8Array([...stdout, ...request]);
  return wasmModule({
    types: [
      { params: ["i32", "i32"], results: [] },
      { params: ["i32", "i32"], results: ["i32"] },
      { params: [], results: [] },
    ],
    imports: [
      { name: "write", type: 0 },
      { name: "syscall", type: 1 },
    ],
    startType: 2,
    body: [
      0x41, 0x00, 0x41, ...signedI32(stdout.length), 0x10, 0x00,
      0x41, ...signedI32(stdout.length), 0x41, ...signedI32(request.length), 0x10, 0x01, 0x1a,
      0x0b,
    ],
    data,
  });
}

function wasmModule({ types, imports, startType, body, data }) {
  const importCount = imports.length;
  const sections = [
    wasmSection(1, [types.length, ...types.flatMap(wasmTypeBytes)]),
    wasmSection(2, [imports.length, ...imports.flatMap((entry) => [...wasmStringBytes("dindbos"), ...wasmStringBytes(entry.name), 0x00, ...unsignedI32(entry.type)])]),
    wasmSection(3, [0x01, ...unsignedI32(startType)]),
    wasmSection(5, [0x01, 0x00, 0x01]),
    wasmSection(7, [
      0x02,
      ...wasmStringBytes("memory"), 0x02, 0x00,
      ...wasmStringBytes("_start"), 0x00, ...unsignedI32(importCount),
    ]),
    wasmSection(10, [0x01, ...wasmVector([0x00, ...body])]),
  ];
  if (data.length) sections.push(wasmSection(11, [0x01, 0x00, 0x41, 0x00, 0x0b, ...unsignedI32(data.length), ...data]));
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections.flat()]);
}

function wasmTypeBytes(type) {
  return [0x60, type.params.length, ...type.params.map(wasmValueType), type.results.length, ...type.results.map(wasmValueType)];
}

function wasmValueType(value) {
  if (value === "i32") return 0x7f;
  throw new Error(`unsupported wasm value type: ${value}`);
}

function wasmSection(id, payload) {
  return [id, ...unsignedI32(payload.length), ...payload];
}

function wasmVector(payload) {
  return [...unsignedI32(payload.length), ...payload];
}

function wasmStringBytes(value) {
  const encoded = encodeText(value);
  return [...unsignedI32(encoded.length), ...encoded];
}

function encodeText(value) {
  return new TextEncoder().encode(String(value));
}

function unsignedI32(value) {
  const out = [];
  let cursor = Number(value >>> 0);
  do {
    let byte = cursor & 0x7f;
    cursor >>>= 7;
    if (cursor) byte |= 0x80;
    out.push(byte);
  } while (cursor);
  return out;
}

function signedI32(value) {
  const out = [];
  let cursor = Number(value | 0);
  let more = true;
  while (more) {
    let byte = cursor & 0x7f;
    cursor >>= 7;
    const signBit = byte & 0x40;
    more = !((cursor === 0 && signBit === 0) || (cursor === -1 && signBit !== 0));
    if (more) byte |= 0x80;
    out.push(byte);
  }
  return out;
}

function countedFetch(fetcher) {
  const wrapped = async (...args) => {
    wrapped.count += 1;
    return fetcher(...args);
  };
  wrapped.count = 0;
  return wrapped;
}

function response(text) {
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-length", String(Buffer.byteLength(text))]]),
    text: async () => text,
  };
}

async function assertRejects(fn, expected) {
  try {
    await fn();
  } catch (error) {
    if (!String(error.message).includes(expected)) {
      throw new Error(`expected error containing ${expected}, got ${error.message}`);
    }
    return;
  }
  throw new Error(`expected rejection containing ${expected}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
