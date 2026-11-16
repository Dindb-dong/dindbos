import assert from "node:assert/strict";
import { createDindbOS, prepareDindbOSHost } from "../src/sdk/index.js";
import { nestedDesktopOptions } from "../src/demo/apps/nested-desktop.js";

async function createRuntime(options) {
  const os = await createDindbOS(options);
  try {
    await os.loadPersistentFileSystem();
    await prepareDindbOSHost(os, options);
    return os;
  } catch (error) {
    await os.destroy();
    throw error;
  }
}

const parent = await createRuntime({
  storage: { backend: "memory", name: "nested-smoke-parent" },
  serviceWorker: false,
  bootstrapPackages: false,
});
try {
  const path = "/home/guest/isolation.txt";
  parent.fs.writeOrCreateFile(path, "parent");
  parent.setAppearance({ dockSize: 60 });
  parent.registerApp({ id: "parent-only", name: "Parent Only", render() {} });

  const child = await createRuntime(nestedDesktopOptions);
  try {
    for (const key of ["apps", "fs", "storage", "processes", "windows"]) {
      assert.notEqual(child[key], parent[key], key);
    }
    assert.equal(child.storage.status().backend, "memory");
    assert.notEqual(child.sessionChannelName, parent.sessionChannelName);
    for (const id of ["files", "terminal", "settings", "applications"]) {
      assert.equal(child.apps.has(id), true, id);
    }
    for (const id of ["portfolio", "nested-desktop", "parent-only"]) {
      assert.equal(child.apps.has(id), false, id);
    }
    assert.equal(child.fs.exists(path), false);
    child.fs.writeOrCreateFile(path, "child");
    assert.equal(child.fs.readFile(path), "child");
    assert.notEqual(child.appearance.dockSize, parent.appearance.dockSize);
    child.setAppearance({ dockSize: 44 });
    assert.equal(child.appearance.dockSize, 44);
  } finally {
    await child.destroy();
  }
  assert.equal(child.destroyed, true);
  assert.equal(parent.destroyed, false);
  assert.equal(parent.fs.readFile(path), "parent");
  assert.equal(parent.appearance.dockSize, 60);
  assert.equal(parent.apps.has("parent-only"), true);

  const reopened = await createRuntime(nestedDesktopOptions);
  try {
    assert.equal(reopened.fs.exists(path), false);
    assert.notEqual(reopened.appearance.dockSize, 44);
  } finally {
    await reopened.destroy();
  }
} finally {
  await parent.destroy();
}

console.log("nested desktop runtime smoke ok: isolated registry, storage, appearance, processes and windows; destroy and reset");
