#!/usr/bin/env node
import { AppRegistry } from "../src/dindbos/app-registry.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const os = bootOs();
const registry = new AppRegistry(os);

registry.register({
  id: "settings",
  name: "Settings",
  singleton: true,
  render: () => "",
});
registry.register({
  id: "note",
  name: "Note",
  singleton: false,
  render: () => "",
});
registry.register({
  id: "crashy",
  name: "Crashy",
  singleton: false,
  render: () => {
    throw new Error("boom registry smoke");
  },
});

const firstSingleton = registry.launch("settings");
const secondSingleton = registry.launch("settings");
assert(firstSingleton.id === "settings", "singleton first launch id mismatch");
assert(secondSingleton.activated === "settings", "singleton second launch did not activate existing window");
assert(os.spawned.filter((entry) => entry.appId === "settings").length === 1, "singleton spawned more than once");

const firstNote = registry.launch("note");
const secondNote = registry.launch("note");
assert(firstNote.id !== secondNote.id, "non-singleton windows reused the same id");
assert(os.spawned.filter((entry) => entry.appId === "note").length === 2, "non-singleton did not spawn twice");

registry.launch("crashy");
assert(os.crashed?.appId === "crashy", "crashed app was not reported to process manager");
assert(os.crashed?.message === "boom registry smoke", "crashed app message mismatch");
assert(os.crashContent.innerHTML.includes("Process crashed"), "crash panel was not rendered");
assert(os.crashWindowTitle === "Crashy - crashed", "crash window title was not updated");

console.log("app registry smoke ok singleton non-singleton crash-isolation");

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const opened = new Map();
  const os = {
    fs,
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    spawned: [],
    crashed: null,
    crashContent: null,
    crashWindowTitle: "",
    processes: {
      spawn: (app) => {
        const process = { pid: os.spawned.length + 100, appId: app.id, user: "guest", cwd: "/home/guest", manifest: app.manifest };
        os.spawned.push(process);
        return process;
      },
      attachWindow: () => {},
      crash: (pid, error) => {
        const process = os.spawned.find((entry) => entry.pid === pid);
        os.crashed = { ...process, message: error.message };
      },
      kill: () => {},
    },
    createSandbox: () => os,
    windows: {
      has: (id) => opened.has(id),
      activate: (id) => ({ activated: id }),
      open: (config) => {
        opened.set(config.id, config);
        const content = { innerHTML: "" };
        const windowApi = {
          setTitle: (title) => {
            os.crashWindowTitle = title;
          },
        };
        config.render(content, windowApi);
        if (config.appId === "crashy") os.crashContent = content;
        return { id: config.id };
      },
    },
  };
  return os;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
