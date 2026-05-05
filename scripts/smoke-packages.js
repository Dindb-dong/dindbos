#!/usr/bin/env node
import { createDindbOSTestRuntime, waitForRuntime as waitFor } from "./helpers/dindbos-test-runtime.js";
import { base64UrlFromBytes, canonicalPackageManifestPayload } from "../src/dindbos/package-manager.js";

const os = createDindbOSTestRuntime();
const packages = os.packages;
const lifecycleEvents = [];
let signedRemoteManifest = null;
let trustedPublisher = null;
["install", "update", "first-run", "uninstall-cleanup", "uninstall"].forEach((type) => {
  os.bus.on(`app:${type}`, (event) => lifecycleEvents.push(`${type}:${event.packageId}:${event.appId}`));
});

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
const rollbackRoot = os.fs.stat("/opt/rollback-demo");
assert(rollbackRoot.type === "mount" && rollbackRoot.resolvedType === "directory", `package root was not mounted as a directory: ${JSON.stringify(rollbackRoot)}`);
assert(rollbackRoot.permissions === "dr-xr-xr-x", `package image mount permissions mismatch: ${rollbackRoot.permissions}`);
assert(packages.packageImageMounts().some((entry) => entry.root === "/opt/rollback-demo" && entry.driver === "pkgfs" && entry.readonly), "package image mount table missing rollback-demo");
assert(os.fs.exists("/var/lib/dindbos/packages/rollback-demo.json"), "valid package record missing");
assert(os.fs.exists("/usr/share/applications/Rollback Demo.app"), "valid package launcher missing");
assert(os.apps.apps.has("rollback-demo"), "valid package app was not registered");
assert(lifecycleEvents.includes("install:rollback-demo:rollback-demo"), "app:install lifecycle event missing");

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

packages.install(packageManifest("namespace-target", "0.1.0", [
  { path: "app.js", mime: "text/javascript", content: "export function mount() {}\n" },
  { path: "secret.txt", mime: "text/plain", content: "target secret\n" },
]));
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
      "  content.innerHTML = `<main data-namespace-probe>${rootIsolation}:${dependencyIsolation}</main>`;",
      "}",
    ].join("\n"),
  },
  { path: "node_modules/secret-lib/index.js", mime: "text/javascript", content: "module.exports = 'undeclared secret';\n" },
], { permissions: { capabilities: ["node.execute"] } }));
const namespaceProbeWindow = os.apps.launch("namespace-probe");
await namespaceProbeWindow.rendered;
await waitFor(() => namespaceProbeWindow.content.innerHTML.includes("data-namespace-probe"), `namespace probe did not render: ${namespaceProbeWindow.content.innerHTML}`);
assert(namespaceProbeWindow.content.innerHTML.includes("root-denied:dependency-denied"), `package namespace isolation mismatch: ${namespaceProbeWindow.content.innerHTML}`);
packages.remove("namespace-probe");
packages.remove("namespace-target");

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
const cliTemplateWindow = os.apps.launch("template-cli-app");
await cliTemplateWindow.rendered;
await waitFor(() => cliTemplateWindow.content.innerHTML.includes("data-template-cli"), "CLI template did not render");
const wasmCliTemplate = packages.installFromManifestPath("/opt/dindbos/templates/template-wasm-cli/dindbos.app.json");
assert(wasmCliTemplate.app.runtime === "wasm", "WASM CLI template runtime mismatch");
const wasmCliTemplateWindow = os.apps.launch("template-wasm-cli");
await wasmCliTemplateWindow.rendered;
await waitFor(() => wasmCliTemplateWindow.content.innerHTML.includes("template wasm ok"), `WASM CLI template did not render stdout: ${wasmCliTemplateWindow.content.innerHTML}`);
const workerTemplate = packages.installFromManifestPath("/opt/dindbos/templates/template-background-worker/dindbos.app.json");
assert(workerTemplate.app.capabilities.includes("process.read"), "Background worker template did not declare process.read");
assert(os.fs.exists("/opt/template-background-worker/worker.js"), "Background worker template did not install worker.js");
const workerTemplateWindow = os.apps.launch("template-background-worker");
await workerTemplateWindow.rendered;
await waitFor(() => workerTemplateWindow.content.innerHTML.includes("data-template-worker"), "Background worker template did not render");
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
const apiLab = packages.installFromManifestPath("/opt/dindbos/packages/api-lab/dindbos.app.json");
assert(apiLab.id === "api-lab", "API Lab sample install returned wrong id");
assert(apiLab.app.capabilities.includes("package.read"), "API Lab sample did not declare package.read capability");
const apiSource = os.fs.readFile("/opt/api-lab/app.js");
assert(apiSource.includes("sdk.packages.info"), "API Lab sample does not use the DindbOS syscall SDK fixture");
assert(apiSource.includes("sdk.fs.writeText"), "API Lab sample does not use SDK-backed VFS writes");
const apiModule = await import(`data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`);
assert(typeof apiModule.mount === "function", "API Lab sample entry did not export mount");
const apiWindow = os.apps.launch("api-lab");
await apiWindow.rendered;
await waitFor(() => apiWindow.content.innerHTML.includes("package=api-lab"), `API Lab sample did not render sandbox API report: ${apiWindow.content.innerHTML}`);
assert(os.fs.readFile("/home/guest/DindbOS API Lab/report.txt").includes("launches=1"), "API Lab sample did not write first app-state value through sandbox fs");
assert(os.processes.readLog(apiWindow.pid).includes("api-lab wrote"), "API Lab sample did not log through process facade");
assert(os.fs.readFile(`/proc/${apiWindow.pid}/syscalls`).includes("fs.writeText OK"), "API Lab sample did not write syscall trace under /proc");
assert(os.fs.readFile(`/proc/${apiWindow.pid}/syscalls`).includes("package.info OK"), "API Lab sample did not read package info through syscall");
assert(os.fs.readFile("/var/log/dindbos/syscall.log").includes("process.log OK"), "API Lab sample did not write global syscall log");
assert(os.fs.readFile("/var/lib/dindbos/app-state/api-lab.json").includes('"launches": 1'), "API Lab sample did not persist app state under app-state");
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
assert(!os.fs.exists("/var/lib/dindbos/app-state/api-lab.json"), "API Lab app state remained after package remove");

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
