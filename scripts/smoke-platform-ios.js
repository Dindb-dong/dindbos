#!/usr/bin/env node
import assert from "node:assert/strict";
import { mountIOSShell } from "../src/ui/platforms/ios.js";

const elements = [];
function element() {
  const listeners = new Map();
  const button = {
    dataset: {}, attributes: {}, listeners, removed: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
    remove() { this.removed = true; },
    focus(options) { this.focusOptions = options; },
  };
  elements.push(button);
  return button;
}
const minimized = [];
let panelsClosed = 0;
const tasks = new Map([["draft", { id: "draft", minimized: false, text: "unsaved" }], ["other", { id: "other", minimized: false }], ["asleep", { id: "asleep", minimized: true }]]);
const shell = {
  root: { ownerDocument: { createElement: element } },
  refs: { shell: { appendChild() {} } },
  os: { windows: { windows: tasks, minimize(id) { tasks.get(id).minimized = true; minimized.push(id); } } },
  closePanel(returnFocus) { assert.equal(returnFocus, false); panelsClosed++; },
};
const cleanup = mountIOSShell(shell);
const [home, search] = elements;
assert.equal(home.attributes["aria-label"], "Home");
assert.equal(search.dataset.shellPanel, "launcher");
shell.os.windows.hasVisibleTrustedSurface = () => true;
home.listeners.get("click")();
assert.equal(panelsClosed, 0, "Home must not dismiss or steal focus from trusted prompts");
assert.deepEqual(minimized, []);
assert.equal(home.focusOptions, undefined);
shell.os.windows.hasVisibleTrustedSurface = () => false;
home.listeners.get("click")();
assert.deepEqual(minimized, ["draft", "other"], "Home backgrounds all visible windows exactly once");
assert.equal(tasks.size, 3, "Home must preserve running windows");
assert.equal(tasks.get("draft").text, "unsaved", "Home must preserve drafts");
assert.equal(panelsClosed, 1);
assert.deepEqual(home.focusOptions, { preventScroll: true });
home.listeners.get("click")();
assert.equal(minimized.length, 2, "Repeated Home must not restart minimization");
cleanup();
assert.equal(home.listeners.size, 0, "Style transition must remove its listener");
assert.ok(home.removed && search.removed, "Style transition must remove added chrome");
elements.length = 0;
shell.os.uiOptions = { slots: { desktop() {} } };
mountIOSShell(shell)();
assert.equal(elements.length, 1, "Custom desktop slots retain their own search UI");
console.log("iOS shell smoke ok: Home preserves drafts and trusted prompts, repeat activation, cleanup, custom slot");
