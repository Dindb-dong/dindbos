#!/usr/bin/env node
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { ShellSession } from "../src/dindbos/shell.js";
import { createDindbOSTestRuntime } from "./helpers/dindbos-test-runtime.js";

const os = createDindbOSTestRuntime();
const shell = new ShellSession(os);

let result = await shell.executeAsync("keychain status");
assert(result.status === 0 && result.output.includes("locked=false"), `keychain status mismatch: ${JSON.stringify(result)}`);

result = await shell.executeAsync("keychain set registry.token s3cr3t-token");
assert(result.status === 0 && result.output === "keychain secret set registry.token", `keychain set mismatch: ${JSON.stringify(result)}`);
result = await shell.executeAsync("keychain get registry.token");
assert(result.status === 0 && result.output === "s3cr3t-token", `keychain get mismatch: ${JSON.stringify(result)}`);
assert(!os.fs.readFile("/var/lib/dindbos/keychain/guest/records.json").includes("s3cr3t-token"), "keychain metadata exposed raw secret value");
assert(!os.fs.readFile("/var/log/dindbos/keychain.log").includes("s3cr3t-token"), "keychain audit log exposed raw secret value");

result = await shell.executeAsync("keychain lock");
assert(result.status === 0, `keychain lock status mismatch: ${result.status}`);
result = await shell.executeAsync("keychain get registry.token");
assert(result.status === 1 && result.output.includes("vault locked"), `locked keychain get mismatch: ${JSON.stringify(result)}`);
result = await shell.executeAsync("keychain unlock fallback-passphrase");
assert(result.status === 0 && result.output.includes("password-derived-fallback"), `keychain unlock mismatch: ${JSON.stringify(result)}`);

const appProcess = processFor("credential-app", ["keychain.read", "keychain.write"]);
const appSandbox = new AppSandbox(os, appProcess);
appSandbox.keychain.set("api.token", "app-secret");
assert(appSandbox.keychain.get("api.token") === "app-secret", "app-scoped keychain read failed");

const otherSandbox = new AppSandbox(os, processFor("other-app", ["keychain.read"]));
await assertRejects(() => otherSandbox.keychain.get("api.token"), "access denied");

os.keychain.grant("api.token", "other-app", { ttlMs: 10 }, { process: appProcess, principal: os.permissions.principal(os.session) });
assert(otherSandbox.keychain.get("api.token") === "app-secret", "granted keychain read failed");
await new Promise((resolve) => setTimeout(resolve, 20));
await assertRejects(() => otherSandbox.keychain.get("api.token"), "access denied");

os.keychain.grant("api.token", "other-app", { ttlMs: 1000 }, { process: appProcess, principal: os.permissions.principal(os.session) });
assert(otherSandbox.keychain.get("api.token") === "app-secret", "regranted keychain read failed");
os.keychain.revoke("api.token", "other-app", { process: appProcess, principal: os.permissions.principal(os.session) });
await assertRejects(() => otherSandbox.keychain.get("api.token"), "access denied");

result = await shell.executeAsync("keychain signing create package.sign com.example");
assert(result.status === 0 && result.output.includes("ed25519-pub:v1:"), `signing create mismatch: ${JSON.stringify(result)}`);
result = await shell.executeAsync("keychain signing lookup package.sign");
assert(result.status === 0 && result.output.includes("publisher=com.example") && result.output.includes("ref=secret:"), `signing lookup mismatch: ${JSON.stringify(result)}`);

const audit = os.keychain.auditEntries({ appId: "shell", principal: os.permissions.principal(os.session) });
assert(audit.some((entry) => entry.action === "get" && entry.result === "denied"), "keychain audit missing denied access");
assert(audit.some((entry) => entry.action === "grant" && entry.result === "allowed"), "keychain audit missing grant");
assert(audit.some((entry) => entry.action === "revoke" && entry.result === "allowed"), "keychain audit missing revoke");

console.log("keychain smoke ok vault grants signing audit");

function processFor(appId, capabilities) {
  return {
    pid: Math.floor(Math.random() * 10000) + 100,
    appId,
    user: "guest",
    cwd: "/home/guest",
    manifest: {
      capabilities,
      fileSystem: { read: ["/home/guest"], write: ["/home/guest"] },
    },
  };
}

async function assertRejects(action, expected) {
  try {
    await action();
  } catch (error) {
    if (String(error.message || "").includes(expected)) return;
    throw new Error(`expected rejection containing ${expected}, got ${error.message}`);
  }
  throw new Error(`expected rejection containing ${expected}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
