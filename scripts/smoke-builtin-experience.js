#!/usr/bin/env node
import assert from "node:assert/strict";
import { installBuiltinApps, safeCalculate, saveTextDocument } from "../src/dindbos/apps/builtins.js";
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { createDindbOSTestRuntime } from "./helpers/dindbos-test-runtime.js";
import { removeLegacyWelcomeLaunchers } from "../src/demo/portfolio-demo.js";
import { appearanceMarkup } from "../src/dindbos/apps/appearance.js";

for (const [expression, expected] of [
  ["2+3", "5"], ["2+3*4", "14"], ["(2+3)*4", "20"],
  ["0.1+0.2", "0.3"], ["1e13+1", "10000000000001"], ["1e-3*2", "0.002"], ["2*-3", "-6"], ["-(2+3)", "-5"],
  ["1/0", "Error"], ["2**3", "Error"], ["1..2", "Error"],
  ["alert(1)", "Error"], ["", "Error"], ["(2+3", "Error"],
]) assert.equal(safeCalculate(expression), expected, expression);

const installed = [];
const os = { session: { home: "/home/guest" }, registerApp: (app) => installed.push(app) };
installBuiltinApps(os, { includePortfolio: false, include: ["files", "calculator"], exclude: ["calculator"] });
assert.deepEqual(installed.map((app) => app.id), ["files"]);
assert.equal(typeof installed[0].render, "function");
const appearance = appearanceMarkup({ mode: "dark", wallpaper: "coast", dockSize: 1000 });
assert.match(appearance, /data-appearance-mode="dark" aria-pressed="true"/);
assert.match(appearance, /data-appearance-wallpaper="coast" aria-pressed="true"/);
assert.match(appearance, /value="72"/);
console.log("builtin experience smoke ok: arithmetic, selective installation, appearance choices");

const runtime = createDindbOSTestRuntime();
runtime.fs.createDirectory("/home/guest/Documents", "/", { owner: "guest", group: "users" });
for (const path of ["/usr", "/usr/share", "/usr/share/applications"]) if (!runtime.fs.exists(path)) runtime.fs.createDirectory(path);
runtime.fs.createDirectory("/home/guest/Desktop", "/", { owner: "guest", group: "users" });
runtime.fs.createApp("/usr/share/applications/Welcome.app", "welcome", "welcome");
runtime.fs.createApp("/home/guest/Desktop/Welcome.app", "host-welcome", "app");
removeLegacyWelcomeLaunchers(runtime);
assert.equal(runtime.fs.exists("/usr/share/applications/Welcome.app"), false, "retired showcase launcher is removed");
assert.equal(runtime.fs.resolve("/home/guest/Desktop/Welcome.app").appId, "host-welcome", "a host-owned app with the same display name survives");
let syncs = 0;
runtime.localMounts = { isMountedPath: () => false };
runtime.storage = { status: () => ({ enabled: true }) };
runtime.flushPersistentFileSystem = async () => { syncs += 1; };
runtime.assertAdminOperation = () => { throw new Error("administrator required"); };
runtime.syscallAsync = (name, args, context) => runtime.syscalls.callAsync(name, args, context);
installBuiltinApps(runtime, { include: ["text"], includePortfolio: false });
const textManifest = runtime.apps.getManifest("text");
const sandbox = new AppSandbox(runtime, { pid: 1, appId: "text", user: "guest", groups: ["users"], cwd: "/home/guest", manifest: textManifest });
sandbox.fs.createFile("/home/guest/Documents/note.txt", "/", { content: "before", mime: "text/plain" });
await assert.rejects(() => sandbox.storage.flush(), /administrator required/);
await saveTextDocument(sandbox, { path: "/home/guest/Documents/note.txt" }, "saved by guest");
assert.equal(sandbox.fs.readFile("/home/guest/Documents/note.txt"), "saved by guest");
assert.equal(syncs, 1, "guest document save must use scoped storage sync, not admin flush");
console.log("builtin guest save smoke ok: atomic contents and non-admin persistence sync");
