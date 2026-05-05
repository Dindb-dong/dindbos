#!/usr/bin/env node
import { readFileSync } from "node:fs";

const declaration = readFileSync("src/dindbos/sdk.d.ts", "utf8");
const implementation = readFileSync("src/dindbos/sdk.js", "utf8");

[
  "DindbOSSDKResult",
  "DindbOSSDKError",
  "createDindbOSSDK",
  "syscall",
  "clock",
  "entropy",
  "fs",
  "fd",
  "env",
  "apps",
  "packages",
  "storage",
  "localMounts",
  "processes",
].forEach((name) => {
  assert(declaration.includes(name), `SDK declaration missing ${name}`);
});

[
  "clock.now",
  "entropy.randomBytes",
  "fs.readText",
  "fs.writeText",
  "fd.open",
  "env.list",
  "app.launch",
  "package.info",
  "process.log",
].forEach((syscall) => {
  assert(implementation.includes(syscall), `SDK implementation missing ${syscall}`);
});

assert(declaration.includes("code: string"), "SDK error code type missing");
assert(declaration.includes("syscall: string"), "SDK error syscall type missing");

console.log("sdk types smoke ok helper groups declarations");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
