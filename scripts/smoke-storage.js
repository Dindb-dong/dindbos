#!/usr/bin/env node
import { VirtualFileSystem } from "../src/dindbos/vfs.js";
import { parseFileContentRecord, serializeFileContentRecord } from "../src/dindbos/file-data.js";

const fs = bootVfs();
const textPath = "/home/guest/Documents/readme.txt";
const binaryPath = "/home/guest/Documents/payload.bin";
const copyPath = "/tmp/payload-copy.bin";
const text = "DindbOS storage smoke\nline=2\n";
const bytes = new Uint8Array([0, 1, 2, 3, 4, 31, 32, 64, 127, 128, 200, 255]);

fs.writeOrCreateFile(textPath, text, "/", { mime: "text/plain" });
fs.writeOrCreateFileBytes(binaryPath, bytes, "/", { mime: "application/octet-stream" });
fs.copy(binaryPath, copyPath);

assert(fs.readFile(textPath) === text, "text content changed before snapshot");
assertBytes(fs.readFileBytes(binaryPath), bytes, "binary content changed before snapshot");
assertBytes(fs.readFileBytes(copyPath), bytes, "binary copy changed before snapshot");

const binaryNode = fs.resolve(binaryPath);
const record = serializeFileContentRecord(binaryNode.content);
assertBytes(contentBytes(parseFileContentRecord(record)), bytes, "content record changed bytes");

const reloaded = new VirtualFileSystem(fs.snapshot(), { home: "/home/guest" });
assert(reloaded.readFile(textPath) === text, "text content changed after snapshot reload");
assertBytes(reloaded.readFileBytes(binaryPath), bytes, "binary content changed after snapshot reload");
assertBytes(reloaded.readFileBytes(copyPath), bytes, "binary copy changed after snapshot reload");

const replacement = new Uint8Array([255, 128, 64, 32, 0]);
reloaded.writeFileBytes(binaryPath, replacement, "/", { mime: "application/octet-stream" });
assertBytes(reloaded.readFileBytes(binaryPath), replacement, "binary replacement changed");

const atomicPath = "/home/guest/Documents/atomic.txt";
reloaded.writeOrCreateFile(atomicPath, "stable", "/", { mime: "text/plain", owner: "guest", group: "users", permissions: "-rw-------" });
const atomicBefore = reloaded.stat(atomicPath);
await assertRejects(
  () => reloaded.atomicWriteFile(atomicPath, "broken", "/", {
    beforeCommit() {
      throw new Error("simulated commit failure");
    },
  }),
  "simulated commit failure",
);
assert(reloaded.readFile(atomicPath) === "stable", "failed atomic write changed existing file");
assert(!reloaded.list("/home/guest/Documents").some((entry) => entry.name.includes(".atomic.txt.dindbos-tmp")), "failed atomic write leaked staged file");
const atomicAfterFailure = reloaded.stat(atomicPath);
assert(atomicAfterFailure.permissions === atomicBefore.permissions, "failed atomic write changed permissions");
assert(atomicAfterFailure.owner === atomicBefore.owner, "failed atomic write changed owner");
reloaded.atomicWriteFile(atomicPath, "committed", "/", { mime: "text/plain" });
assert(reloaded.readFile(atomicPath) === "committed", "atomic write did not commit replacement");
const atomicAfterCommit = reloaded.stat(atomicPath);
assert(atomicAfterCommit.permissions === "-rw-------", "atomic write did not preserve permissions");
assert(atomicAfterCommit.owner === "guest", "atomic write did not preserve owner");

const atomicCreatePath = "/home/guest/Documents/atomic-created.txt";
reloaded.atomicWriteOrCreateFile(atomicCreatePath, "created atomically", "/", { mime: "text/plain" });
assert(reloaded.readFile(atomicCreatePath) === "created atomically", "atomic write-or-create did not create file");

console.log(`storage smoke ok textBytes=${text.length} binaryBytes=${bytes.byteLength}`);

function bootVfs() {
  const vfs = new VirtualFileSystem(null, { home: "/home/guest" });
  vfs.createDirectory("/home", "/", { owner: "root", group: "root" });
  vfs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" });
  vfs.createDirectory("/home/guest/Documents", "/", { owner: "guest", group: "users" });
  vfs.createDirectory("/tmp", "/", { owner: "root", group: "root", permissions: "drwxrwxrwx" });
  return vfs;
}

function contentBytes(content) {
  const temp = new VirtualFileSystem(null);
  temp.createDirectory("/tmp");
  temp.writeOrCreateFile("/tmp/value.bin", content);
  return temp.readFileBytes("/tmp/value.bin");
}

function assertBytes(actual, expected, message) {
  assert(actual.byteLength === expected.byteLength, `${message}: length ${actual.byteLength} !== ${expected.byteLength}`);
  for (let index = 0; index < expected.byteLength; index += 1) {
    assert(actual[index] === expected[index], `${message}: byte ${index} ${actual[index]} !== ${expected[index]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejects(fn, expected) {
  try {
    await fn();
  } catch (error) {
    if (!String(error?.message || "").includes(expected)) {
      throw new Error(`expected rejection including ${expected}, received ${error?.message}`);
    }
    return;
  }
  throw new Error(`expected rejection including ${expected}`);
}
