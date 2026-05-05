#!/usr/bin/env node
import { base64UrlFromBytes, canonicalPackageManifestPayload, PackageManager } from "../src/dindbos/package-manager.js";
import { AppRegistry } from "../src/dindbos/app-registry.js";
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { RuntimeCacheStore } from "../src/dindbos/cache-store.js";
import { EventBus } from "../src/dindbos/event-bus.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const os = bootOs();
const packages = new PackageManager(os);
os.packages = packages;
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

await assertRejects(
  () => packages.install(packageManifest("wasm-future", "0.1.0", [
    { path: "app.wasm", mime: "application/wasm", base64: "AGFzbQEAAA==" },
  ], { compatibility: { tier: "C" } })),
  "requires unsupported compatibility tier C",
);
assert(!os.fs.exists("/opt/wasm-future"), "unsupported compatibility package mutated install directory");
assert(!os.apps.apps.has("wasm-future"), "unsupported compatibility package registered app");

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
assert(os.processes.records.has(launched.pid), "package launch did not create process");
assert(launched.content.innerHTML.includes("data-flow-run"), "package app did not render mounted UI");
const removedFlow = packages.remove("flow-demo");
assert(removedFlow.id === "flow-demo", "flow package remove returned wrong id");
assert(!os.apps.has("flow-demo"), "flow package app remained registered after remove");
assert(!os.fs.exists("/opt/flow-demo"), "flow package install path remained after remove");
assert(!os.fs.exists("/usr/share/applications/Flow Demo.app"), "flow package launcher remained after remove");

packages.bootstrap();
assert(os.fs.exists("/opt/dindbos/packages/api-lab/dindbos.app.json"), "API Lab sample manifest was not bootstrapped");
assert(os.fs.exists("/opt/dindbos/packages/paint-sample/dindbos.app.json"), "Paint sample manifest was not bootstrapped");
assert(os.fs.exists("/opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json"), "PDF Viewer sample manifest was not bootstrapped");
const localSamples = await packages.search("sample");
assert(localSamples.some((entry) => entry.id === "paint-sample"), "local registry search did not include Paint sample");
assert(localSamples.some((entry) => entry.id === "pdf-viewer-sample"), "local registry search did not include PDF Viewer sample");
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
const apiModule = await import(`data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`);
assert(typeof apiModule.mount === "function", "API Lab sample entry did not export mount");
const apiWindow = os.apps.launch("api-lab");
await apiWindow.rendered;
await waitFor(() => apiWindow.content.innerHTML.includes("package=api-lab"), `API Lab sample did not render sandbox API report: ${apiWindow.content.innerHTML}`);
assert(os.fs.readFile("/home/guest/DindbOS API Lab/report.txt").includes("launches=1"), "API Lab sample did not write first app-state value through sandbox fs");
const apiProcess = os.processes.get(apiWindow.pid);
assert(apiProcess.logs.some((entry) => entry.message.includes("api-lab wrote")), "API Lab sample did not log through process facade");
assert(os.fs.readFile("/var/lib/dindbos/app-state/api-lab.json").includes('"launches": 1'), "API Lab sample did not persist app state under app-state");
const apiWindowAgain = os.apps.launch("api-lab");
await apiWindowAgain.rendered;
await waitFor(() => apiWindowAgain.content.innerHTML.includes("launches=2"), `API Lab sample did not restore app state on relaunch: ${apiWindowAgain.content.innerHTML}`);
const reloadedOs = bootOs(os.fs.snapshot());
const reloadedPackages = new PackageManager(reloadedOs);
reloadedOs.packages = reloadedPackages;
reloadedPackages.registerInstalledPackages();
const reloadedApiWindow = reloadedOs.apps.launch("api-lab");
await reloadedApiWindow.rendered;
await waitFor(() => reloadedApiWindow.content.innerHTML.includes("launches=3"), `API Lab sample did not restore app state after VFS reload: ${reloadedApiWindow.content.innerHTML}`);
const removedApiLab = packages.remove("api-lab");
assert(removedApiLab.id === "api-lab", "API Lab package remove returned wrong id");
assert(!os.fs.exists("/var/lib/dindbos/app-state/api-lab.json"), "API Lab app state remained after package remove");

console.log("packages smoke ok transaction rollback launch run state remove");

function bootOs(root = null) {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(root, { home: "/home/guest", policy: permissions });
  const system = permissions.systemPrincipal();
  if (!fs.exists("/home")) fs.createDirectory("/home", "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, system);
  if (!fs.exists("/home/guest")) fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users", permissions: "drwxr-xr-x" }, system);
  const os = {
    fs,
    permissions,
    bus: new EventBus(),
    cache: new RuntimeCacheStore({ cacheApi: null }),
    apps: null,
    packages: null,
    windows: null,
    processes: null,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    createSandbox: (process) => new AppSandbox(os, process),
    registerApp: (app) => os.apps.register(app),
    unregisterApp: (appId) => os.apps.unregister(appId),
  };
  os.apps = new AppRegistry(os);
  os.processes = fakeProcesses();
  os.windows = fakeWindows();
  return os;
}

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
  if (id === "remote-broken") return "Remote Broken.app";
  return "Broken Pkg.app";
}

function fakeProcesses() {
  let nextPid = 100;
  const records = new Map();
  return {
    records,
    spawn: (app, context) => {
      const process = {
        pid: nextPid++,
        appId: app.id,
        context,
        cwd: "/home/guest",
        logs: [],
        manifest: app.manifest || {},
        name: app.name || app.id,
        state: "running",
        user: "guest",
      };
      records.set(process.pid, process);
      return process;
    },
    attachWindow: (pid, windowId) => {
      const process = records.get(pid);
      if (process) process.windowId = windowId;
    },
    kill: (pid, state = "killed") => {
      const process = records.get(pid);
      if (process) process.state = state;
      records.delete(pid);
      return process || { pid, appId: "unknown" };
    },
    crash: (pid, error) => {
      const process = records.get(pid);
      if (process) process.error = error.message;
    },
    get: (pid) => records.get(pid) || null,
    log: (pid, message, level = "info") => {
      const process = records.get(pid);
      if (process) process.logs.push({ level, message });
    },
  };
}

function fakeWindows() {
  const records = new Map();
  return {
    has: (windowId) => records.has(windowId),
    activate: (windowId) => records.get(windowId),
    open: (options) => {
      const content = { innerHTML: "" };
      const windowApi = { setTitle: (title) => { options.title = title; } };
      const windowRecord = { ...options, content };
      records.set(options.id, windowRecord);
      windowRecord.rendered = options.render(content, windowApi);
      return windowRecord;
    },
  };
}

async function waitFor(check, label) {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(label);
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
