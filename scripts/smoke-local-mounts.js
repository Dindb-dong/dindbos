#!/usr/bin/env node
import { LocalFolderMountManager } from "../src/dindbos/local-folder-mount.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const os = bootOs();
const deniedHandle = {
  kind: "directory",
  name: "denied",
  async queryPermission() {
    return "denied";
  },
  async requestPermission() {
    return "denied";
  },
};

const mounts = new LocalFolderMountManager(os);
await assertRejects(
  () => mounts.mountLocal("denied", { handle: deniedHandle }),
  "mount-local: permission denied",
);

assert(mounts.listMounts().length === 0, "denied handle created a runtime mount");
assert(!os.fs.exists("/mnt/denied"), "denied handle created a VFS mount node");

console.log("local mounts smoke ok permission-denied");

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  return {
    fs,
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
    storage: {
      async readValue() {
        return null;
      },
      writeValue() {},
      async flush() {},
    },
  };
}

async function assertRejects(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected rejection: ${error.message}`);
  }
  throw new Error(`expected rejection: ${expectedMessage}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
