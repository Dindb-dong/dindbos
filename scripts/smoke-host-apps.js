#!/usr/bin/env node
import assert from "node:assert/strict";
import { defineApp } from "../src/sdk/app-definition.js";
import { normalizeDindbOSHostConfig } from "../src/sdk/host-config.js";
import { createDindbOSTestRuntime } from "./helpers/dindbos-test-runtime.js";
assert.equal(normalizeDindbOSHostConfig({ ui: { liquidGlass: false } }).ui.liquidGlass, false);
assert.throws(() => normalizeDindbOSHostConfig({ ui: { liquidGlass: { strength: NaN } } }), /liquidGlass strength/);

class Notes {
  id = "host-notes";
  name = "Notes";
  prefix = "class instance";
  closed = 0;
  get width() { return 640; }
  title() { return this.prefix; }
  menus() { return { file: [{ label: this.prefix, run: () => {} }] }; }
  render({ content }) {
    content.innerHTML = this.prefix;
    return () => { this.closed += 1; };
  }
  dispose() { this.closed += 1; }
}

const notes = new Notes();
const app = defineApp(notes);
assert.equal(app.title({}), "class instance");
assert.equal(app.menus({}).file[0].label, "class instance", "class menu factories retain their instance binding");
assert.equal(app.width, 640, "class getters remain part of the app contract");
assert.equal(defineApp({ id: "function-app" }, () => {}).id, "function-app");
assert.throws(() => defineApp({ id: "invalid id", render() {} }), /invalid id/);
assert.throws(() => defineApp({ id: "missing-render" }), /render function/);
assert.throws(() => normalizeDindbOSHostConfig({ apps: [app, app] }), /duplicate app id/);
assert.throws(() => normalizeDindbOSHostConfig({ ui: { slots: { dock: "invalid" } } }), /Invalid DindbOS UI slot/);
assert.equal(normalizeDindbOSHostConfig({ storage: { backend: "memory", name: "isolated" } }).storage.runtimeOptions.storageBackend, "memory");

const os = createDindbOSTestRuntime();
os.registerApp(notes);
const launched = os.launch(notes.id);
const cleanup = await launched.rendered;
assert.equal(launched.content.innerHTML, "class instance");
cleanup();
assert.equal(notes.closed, 2, "returned cleanup and class dispose retain their instance binding");

os.windows.windows = os.windows.records;
const close = os.windows.close;
let closedWindow = "";
os.windows.close = (id) => { closedWindow = id; return close(id); };
os.unregisterApp(notes.id);
assert.equal(closedWindow, launched.id, "unregister closes a running app window");
assert.equal(os.apps.has(notes.id), false);
assert.equal(os.windows.records.size, 0);

console.log("host apps smoke ok class binding getters cleanup unregister duplicate ids UI slots memory config");
