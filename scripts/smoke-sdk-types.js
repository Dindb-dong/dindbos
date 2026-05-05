#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createDindbOSSDK } from "../src/dindbos/sdk.js";

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
  "rawAsync",
  "callAsync",
].forEach((name) => {
  assert(declaration.includes(name), `SDK declaration missing ${name}`);
});

[
  "clock.now",
  "entropy.randomBytes",
  "fs.readText",
  "fs.writeText",
  "fd.open",
  "fd.sync",
  "env.list",
  "app.launch",
  "package.info",
  "storage.sync",
  "process.log",
].forEach((syscall) => {
  assert(implementation.includes(syscall), `SDK implementation missing ${syscall}`);
});

assert(declaration.includes("code: string"), "SDK error code type missing");
assert(declaration.includes("syscall: string"), "SDK error syscall type missing");
assert(declaration.includes("sync<T = unknown>()"), "SDK storage sync type missing");

const asyncSdk = createDindbOSSDK({
  syscall: (name, args = {}) => ({ ok: true, value: { name, args, mode: "sync" } }),
  syscallAsync: async (name, args = {}) => ({ ok: true, value: { name, args, mode: "async" } }),
});
const syncResult = await asyncSdk.storage.sync();
assert(syncResult.name === "storage.sync" && syncResult.mode === "async", "SDK storage.sync did not use async syscall path");
const fdSyncResult = await asyncSdk.fd.sync(3);
assert(fdSyncResult.name === "fd.sync" && fdSyncResult.args.fd === 3 && fdSyncResult.mode === "async", "SDK fd.sync did not use async syscall path");
const callAsyncResult = await asyncSdk.syscall.callAsync("clock.now");
assert(callAsyncResult.name === "clock.now" && callAsyncResult.mode === "async", "SDK syscall.callAsync did not unwrap async results");
const rawAsyncResult = await asyncSdk.syscall.rawAsync("storage.status");
assert(rawAsyncResult.ok === true && rawAsyncResult.value.mode === "async", "SDK syscall.rawAsync did not return raw async result");

console.log("sdk types smoke ok helper groups declarations");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
