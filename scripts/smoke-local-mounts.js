#!/usr/bin/env node
import { LocalFolderMountManager } from "../src/dindbos/local-folder-mount.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

class MemoryDirectoryHandle {
  constructor(name, entries = {}) {
    this.kind = "directory";
    this.name = name;
    this.files = new Map();
    this.directories = new Map();
    Object.entries(entries).forEach(([entryName, handle]) => {
      if (handle.kind === "directory") this.directories.set(entryName, handle);
      else this.files.set(entryName, handle);
    });
  }

  async queryPermission() {
    return "granted";
  }

  async requestPermission() {
    return "granted";
  }

  async *entries() {
    for (const entry of [...this.directories.entries(), ...this.files.entries()]) yield entry;
  }

  async getFileHandle(name, options = {}) {
    if (!this.files.has(name) && options.create) this.files.set(name, new MemoryFileHandle(name, "", "text/plain", Date.now()));
    if (!this.files.has(name)) throw new Error(`file not found: ${name}`);
    return this.files.get(name);
  }

  async getDirectoryHandle(name, options = {}) {
    if (!this.directories.has(name) && options.create) this.directories.set(name, new MemoryDirectoryHandle(name));
    if (!this.directories.has(name)) throw new Error(`directory not found: ${name}`);
    return this.directories.get(name);
  }

  async removeEntry(name) {
    if (this.files.delete(name) || this.directories.delete(name)) return;
    throw new Error(`entry not found: ${name}`);
  }
}

class MemoryFileHandle {
  constructor(name, content, type = "text/plain", lastModified = Date.now()) {
    this.kind = "file";
    this.name = name;
    this.type = type;
    this.replace(content, lastModified);
  }

  async getFile() {
    const content = this.content;
    const bytes = new TextEncoder().encode(content);
    return {
      type: this.type,
      size: bytes.byteLength,
      lastModified: this.lastModified,
      text: async () => content,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  }

  async createWritable() {
    return {
      write: async (value) => {
        if (value instanceof Uint8Array) this.content = new TextDecoder().decode(value);
        else this.content = String(value ?? "");
      },
      close: async () => {
        this.lastModified += 1_000;
      },
    };
  }

  replace(content, lastModified = this.lastModified + 1_000) {
    this.content = String(content ?? "");
    this.lastModified = lastModified;
  }
}

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

const handle = new MemoryDirectoryHandle("disk", {
  "note.txt": new MemoryFileHandle("note.txt", "external v1", "text/plain", 1_000),
  source: new MemoryDirectoryHandle("source", {
    "keep.txt": new MemoryFileHandle("keep.txt", "source keep", "text/plain", 1_100),
    "new.txt": new MemoryFileHandle("new.txt", "source new", "text/plain", 1_200),
    nested: new MemoryDirectoryHandle("nested", {
      "child.txt": new MemoryFileHandle("child.txt", "source child", "text/plain", 1_300),
    }),
  }),
  target: new MemoryDirectoryHandle("target", {
    source: new MemoryDirectoryHandle("source", {
      "keep.txt": new MemoryFileHandle("keep.txt", "existing keep", "text/plain", 1_400),
    }),
    "skip-source": new MemoryDirectoryHandle("skip-source", {
      "keep.txt": new MemoryFileHandle("keep.txt", "skip existing", "text/plain", 1_500),
    }),
  }),
  "skip-source": new MemoryDirectoryHandle("skip-source", {
    "keep.txt": new MemoryFileHandle("keep.txt", "skip source", "text/plain", 1_600),
  }),
});
const mounted = await mounts.mountLocal("disk", { handle, persist: false });
assert(mounted.path === "/mnt/disk", `mounted path mismatch: ${mounted.path}`);
assert(await mounts.readFile("/mnt/disk/note.txt") === "external v1", "initial local mount mirror did not read external file");
const copyPolicy = mounts.copyPolicy();
assert(copyPolicy.defaultConflictPolicy === "error", "local copy policy default mismatch");
assert(copyPolicy.directoryActions.includes("merge"), "local copy policy does not expose directory merge");
await assertRejects(
  () => mounts.copy("/mnt/disk/source", "/mnt/disk/target", "/", { recursive: true }),
  "cp: /mnt/disk/target/source: file exists",
);
await mounts.copy("/mnt/disk/source", "/mnt/disk/target", "/", { recursive: true, conflictPolicy: "merge" });
assert(await mounts.readFile("/mnt/disk/target/source/keep.txt") === "existing keep", "merge policy overwrote existing child");
assert(await mounts.readFile("/mnt/disk/target/source/new.txt") === "source new", "merge policy did not copy missing child");
assert(await mounts.readFile("/mnt/disk/target/source/nested/child.txt") === "source child", "merge policy did not copy nested child");
await mounts.copy("/mnt/disk/source", "/mnt/disk/target", "/", { recursive: true, conflictPolicy: "replace" });
assert(await mounts.readFile("/mnt/disk/target/source/keep.txt") === "source keep", "replace policy did not overwrite target tree");
await mounts.copy("/mnt/disk/skip-source", "/mnt/disk/target", "/", { recursive: true, conflictPolicy: "skip" });
assert(await mounts.readFile("/mnt/disk/target/skip-source/keep.txt") === "skip existing", "skip policy changed existing directory");
const renamedCopy = await mounts.copy("/mnt/disk/source", "/mnt/disk/target", "/", {
  recursive: true,
  conflictPolicy: "prompt",
  resolveConflict: () => "rename:manual-source",
});
assert(renamedCopy.path === "/mnt/disk/target/manual-source", `prompt rename path mismatch: ${renamedCopy.path}`);
assert(await mounts.readFile("/mnt/disk/target/manual-source/keep.txt") === "source keep", "prompt rename did not copy directory bytes");
handle.files.get("note.txt").replace("external v2", 2_000);
await assertRejects(
  () => mounts.writeFile("/mnt/disk/note.txt", "local v2"),
  "local mount sync conflict",
);
assert(await mounts.readFile("/mnt/disk/note.txt") === "external v2", "sync conflict overwrote external disk changes");
const conflicts = mounts.conflictStatus("/mnt/disk");
assert(conflicts.length === 1, `expected one sync conflict, got ${conflicts.length}`);
assert(conflicts[0].path === "/mnt/disk/note.txt", "sync conflict path mismatch");
assert(conflicts[0].reason === "modified-both", `sync conflict reason mismatch: ${conflicts[0].reason}`);
assert(mounts.operationStatus().some((operation) => operation.kind === "sync-conflict" && operation.status === "conflict"), "sync conflict operation was not reported");
const status = await mounts.status();
assert(status[0].conflicts.length === 1, "mount status did not expose sync conflict");

console.log("local mounts smoke ok permission-denied directory-copy-policy sync-conflict");

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
