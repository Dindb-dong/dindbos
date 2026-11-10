import assert from "node:assert/strict";
import { androidHome, androidBack } from "../src/ui/platforms/android.js";

const tasks = new Map([["draft", { id: "draft", minimized: false }], ["terminal", { id: "terminal", minimized: true }]]);
const calls = [];
const shell = {
  activePanel: "",
  closePanel(restore) { calls.push(["panel", restore]); this.activePanel = ""; },
  root: { ownerDocument: { defaultView: { CustomEvent } } },
  os: { windows: { windows: tasks, minimize(id) { calls.push(["minimize", id]); tasks.get(id).minimized = true; } } },
  activeTask: () => tasks.get("draft"),
};
androidHome(shell);
assert.deepEqual(calls, [["panel", false], ["minimize", "draft"]]);
assert.equal(tasks.size, 2, "Home preserves running apps and drafts");
calls.length = 0;
shell.activePanel = "launcher";
androidBack(shell);
assert.deepEqual(calls, [["panel", undefined]], "Back dismisses an open shell panel first");
calls.length = 0;
tasks.get("draft").minimized = false;
tasks.get("draft").content = { dispatchEvent(event) { assert.equal(event.type, "dindbos:back"); assert.equal(event.cancelable, true); return false; } };
androidBack(shell);
assert.deepEqual(calls, [], "An app can consume Back without losing its state");
tasks.get("draft").content.dispatchEvent = () => true;
androidBack(shell);
assert.deepEqual(calls, [["panel", false], ["minimize", "draft"]], "Unhandled Back returns safely Home");
calls.length = 0;
shell.os.windows.hasVisibleTrustedSurface = () => true;
androidHome(shell);
androidBack(shell);
assert.deepEqual(calls, [], "System navigation preserves trusted prompt focus");
console.log("Android navigation smoke passed");
