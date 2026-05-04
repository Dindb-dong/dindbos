#!/usr/bin/env node
import { PackageManager } from "../src/dindbos/package-manager.js";
import { AppRegistry } from "../src/dindbos/app-registry.js";
import { RuntimeCacheStore } from "../src/dindbos/cache-store.js";
import { EventBus } from "../src/dindbos/event-bus.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const os = bootOs();
const packages = new PackageManager(os);
const lifecycleEvents = [];
["install", "uninstall"].forEach((type) => {
  os.bus.on(`app:${type}`, (event) => lifecycleEvents.push(`${type}:${event.packageId}:${event.appId}`));
});

const installed = packages.install(packageManifest("rollback-demo", "0.1.0", [
  { path: "app.js", mime: "text/javascript", content: "export const version = '0.1.0';\n" },
]));

assert(installed.id === "rollback-demo", "valid package install returned wrong id");
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

await assertRejects(() => packages.remove("missing-package"), "package not installed");
assert(packages.info("rollback-demo")?.version === "0.1.0", "missing remove mutated installed package record");

const removed = packages.remove("rollback-demo");
assert(removed.id === "rollback-demo", "remove returned wrong package id");
assert(!os.fs.exists("/opt/rollback-demo"), "remove left install directory");
assert(!os.fs.exists("/var/lib/dindbos/packages/rollback-demo.json"), "remove left package record");
assert(!os.fs.exists("/usr/share/applications/Rollback Demo.app"), "remove left launcher");
assert(!os.apps.apps.has("rollback-demo"), "remove left app registration");
assert(lifecycleEvents.includes("uninstall:rollback-demo:rollback-demo"), "app:uninstall lifecycle event missing");

const remoteFetch = countedFetch(fakeFetch);
await assertRejects(
  () => packages.installFromUrl("https://packages.example/broken/dindbos.app.json", { fetch: remoteFetch }),
  "integrity mismatch",
);

assert(!os.fs.exists("/opt/remote-broken"), "failed remote install left install directory");
assert(!os.fs.exists("/var/lib/dindbos/packages/remote-broken.json"), "failed remote install left package record");
assert(!os.fs.exists("/usr/share/applications/Remote Broken.app"), "failed remote install left launcher");
assert(!os.apps.apps.has("remote-broken"), "failed remote install registered app");

const remoteGood = await packages.installFromUrl("https://packages.example/good/dindbos.app.json", { fetch: remoteFetch, registry: "community" });
assert(remoteGood.trust.source === "remote", "remote package trust source mismatch");
assert(remoteGood.trust.registry === "community", "remote package trust registry mismatch");
assert(remoteGood.trust.trusted === false, "remote package was marked trusted before signatures");
assert(remoteGood.trust.warnings[0].includes("untrusted"), "remote package trust warning missing");
assert(packages.info("remote-good").trust.trusted === false, "remote package trust metadata was not persisted");
const remoteFetchCountAfterFirstInstall = remoteFetch.count;
const cacheHitsBeforeRepeat = os.cache.status().hits;
await packages.installFromUrl("https://packages.example/good/dindbos.app.json", { fetch: remoteFetch, registry: "community" });
assert(remoteFetch.count === remoteFetchCountAfterFirstInstall, "package cache did not avoid repeated manifest/file fetches");
assert(os.cache.status().hits > cacheHitsBeforeRepeat, "package cache did not report repeated install hits");

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
assert(os.processes.records.has(launched.pid), "package launch did not create process");
assert(launched.content.innerHTML.includes("data-flow-run"), "package app did not render mounted UI");
const removedFlow = packages.remove("flow-demo");
assert(removedFlow.id === "flow-demo", "flow package remove returned wrong id");
assert(!os.apps.has("flow-demo"), "flow package app remained registered after remove");
assert(!os.fs.exists("/opt/flow-demo"), "flow package install path remained after remove");
assert(!os.fs.exists("/usr/share/applications/Flow Demo.app"), "flow package launcher remained after remove");

console.log("packages smoke ok transaction rollback launch run remove");

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const os = {
    fs,
    permissions,
    bus: new EventBus(),
    cache: new RuntimeCacheStore({ cacheApi: null }),
    apps: null,
    windows: null,
    processes: null,
    createSandbox: () => ({
      fs: {
        basename: (...args) => fs.basename(...args),
        list: (...args) => fs.list(...args),
        readFile: (...args) => fs.readFile(...args),
      },
    }),
    registerApp: (app) => os.apps.register(app),
    unregisterApp: (appId) => os.apps.unregister(appId),
  };
  os.apps = new AppRegistry(os);
  os.processes = fakeProcesses();
  os.windows = fakeWindows();
  return os;
}

function packageManifest(id, version, files) {
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
      const process = { pid: nextPid++, appId: app.id, context, state: "running" };
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
      options.render(content, windowApi);
      return windowRecord;
    },
  };
}

async function waitFor(check, label) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(label);
}

async function fakeFetch(url) {
  if (url.endsWith("dindbos.app.json")) {
    if (url.includes("/good/")) {
      return response(JSON.stringify(packageManifest("remote-good", "0.1.0", [
        { path: "app.js", mime: "text/javascript", content: "export const good = true;\n" },
      ])));
    }
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
