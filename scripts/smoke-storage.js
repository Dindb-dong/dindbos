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
