#!/usr/bin/env node
import { AppRegistry } from "../src/dindbos/app-registry.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const os = bootOs();
const registry = new AppRegistry(os);

registry.register({
  id: "settings",
  name: "Settings",
  pinned: true,
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

assert(os.fs.exists("/usr/share/dindbos/manifests/settings.json"), "app registry did not write settings manifest");
assert(os.fs.exists("/usr/share/applications/Settings.app"), "app registry did not write settings launcher");
assert(os.fs.exists("/home/guest/Desktop/Settings.app"), "app registry did not write pinned app desktop launcher");
assert(!os.fs.exists("/home/guest/Desktop/Note.app"), "app registry wrote unpinned app desktop launcher");
const originalCreateApp = os.fs.createApp.bind(os.fs);
os.fs.createApp = (path, ...args) => {
  if (path.endsWith("/Broken.app")) throw new Error("launcher failed");
  return originalCreateApp(path, ...args);
};
assertThrows(() => registry.register({ id: "broken", name: "Broken", render: () => "" }), "launcher failed");
os.fs.createApp = originalCreateApp;
assert(!registry.has("broken"), "failed app registry transaction left app registered");
assert(!os.fs.exists("/usr/share/dindbos/manifests/broken.json"), "failed app registry transaction left manifest file");

registry.register({ id: "todo", name: "Todo", render: () => "" });
assert(registry.has("todo"), "todo app did not register");
assert(os.fs.exists("/usr/share/dindbos/manifests/todo.json"), "todo manifest missing before unregister transaction");
assert(os.fs.exists("/usr/share/applications/Todo.app"), "todo launcher missing before unregister transaction");
assert(!os.fs.exists("/home/guest/Desktop/Todo.app"), "unpinned todo desktop launcher was created");
const originalRemove = os.fs.remove.bind(os.fs);
os.fs.remove = (path, ...args) => {
  if (path.endsWith("/Todo.app")) throw new Error("launcher remove failed");
  return originalRemove(path, ...args);
};
assertThrows(() => registry.unregister("todo"), "launcher remove failed");
os.fs.remove = originalRemove;
assert(registry.has("todo"), "failed app unregister transaction removed app from registry");
assert(os.fs.exists("/usr/share/dindbos/manifests/todo.json"), "failed app unregister transaction did not restore manifest");
assert(os.fs.exists("/usr/share/applications/Todo.app"), "failed app unregister transaction did not restore launcher");
assert(registry.unregister("todo") === true, "app unregister did not return true");
assert(!registry.has("todo"), "app unregister left app registered");
assert(!os.fs.exists("/usr/share/dindbos/manifests/todo.json"), "app unregister left manifest file");
assert(!os.fs.exists("/usr/share/applications/Todo.app"), "app unregister left launcher file");

registry.register({ id: "sticky", name: "Sticky", pinned: true, render: () => "" });
assert(os.fs.exists("/home/guest/Desktop/Sticky.app"), "pinned sticky desktop launcher missing before unregister");
assert(registry.unregister("sticky") === true, "pinned sticky unregister did not return true");
assert(!os.fs.exists("/home/guest/Desktop/Sticky.app"), "pinned sticky unregister left desktop launcher");

registry.register({ id: "editor-a", name: "Shared Editor", pinned: true, render() {} });
registry.register({ id: "editor-b", name: "Shared Editor", pinned: true, render() {} });
const firstEditorPath = registry.applicationPathFor(registry.apps.get("editor-a"));
const secondEditorPath = registry.applicationPathFor(registry.apps.get("editor-b"));
const secondDesktopPath = registry.desktopApplicationPathFor(registry.apps.get("editor-b"));
assert(firstEditorPath !== secondEditorPath, "same-name apps must have distinct launchers");
assert(os.fs.resolve(firstEditorPath)?.appId === "editor-a" && os.fs.resolve(secondEditorPath)?.appId === "editor-b", "launcher collision replaced an app's identity");
registry.unregister("editor-a");
assert(os.fs.resolve(secondEditorPath)?.appId === "editor-b", "unregistering a same-name app removed its neighbor's launcher");
assert(os.fs.resolve(secondDesktopPath)?.appId === "editor-b", "unregistering a same-name app removed its neighbor's desktop launcher");
registry.register({ id: "editor-b", name: "Renamed Editor", pinned: true, render() {} });
assert(!os.fs.exists(secondEditorPath), "renaming a collided app left its old launcher");
assert(os.fs.resolve("/usr/share/applications/Renamed Editor.app")?.appId === "editor-b", "renamed app lost its launcher");
os.fs.remove("/usr/share/applications/Renamed Editor.app");
os.fs.createFile("/usr/share/applications/Renamed Editor.app", "/", { content: "User document" });
registry.unregister("editor-b");
assert(os.fs.readFile("/usr/share/applications/Renamed Editor.app") === "User document", "unregister removed a replacement user file");

console.log("app registry smoke ok singleton non-singleton crash-isolation transactions");

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const system = permissions.systemPrincipal();
  fs.createDirectory("/usr", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/usr/share", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/usr/share/applications", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  fs.createDirectory("/home/guest/Desktop", "/", { owner: "guest", group: "users" }, system);
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

function assertThrows(action, expectedMessage) {
  try {
    action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected error: ${error.message}`);
  }
  throw new Error(`expected error containing ${expectedMessage}`);
}
