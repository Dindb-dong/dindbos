#!/usr/bin/env node
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { collectExportEntries } from "../src/dindbos/apps/builtins.js";
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

result = await shell.executeAsync("keychain grant registry.token secret-package 1000");
assert(result.status === 0 && result.output === "keychain grant registry.token secret-package", `keychain grant package mismatch: ${JSON.stringify(result)}`);
os.packages.install({
  id: "secret-package",
  name: "Secret Package",
  version: "0.1.0",
  secrets: [
    { name: "registry", keychainName: "registry.token", kind: "repository-token", purpose: "registry auth" },
  ],
  permissions: { capabilities: ["keychain.read"] },
  app: { id: "secret-package", name: "Secret Package", title: "Secret Package.app", entry: "app.js" },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export function mount({ content, os, pkg }) {",
        "  const refs = os.keychain.references();",
        "  let undeclared = 'not-denied';",
        "  try { os.keychain.getDeclared('other.token'); }",
        "  catch (error) { undeclared = error.message.includes('not declared') ? 'undeclared-denied' : error.message; }",
        "  const token = os.keychain.getDeclared('registry');",
        "  content.innerHTML = `<main data-secret-package>${refs[0].name}:${refs[0].kind}:${pkg.secrets[0].keychainName}:${token}:${undeclared}</main>`;",
        "}",
      ].join("\n"),
    },
  ],
});
assert(os.packages.info("secret-package").secrets[0].keychainName === "registry.token", "package record did not expose secret reference metadata");
assert(os.apps.getManifest("secret-package").secrets[0].name === "registry", "app manifest did not expose package secret reference");
assert(!os.fs.readFile("/var/lib/dindbos/packages/secret-package.json").includes("s3cr3t-token"), "package record exposed raw keychain secret value");
await assertArchiveDoesNotExposeSecret("/var/lib/dindbos/packages", "s3cr3t-token", "package DB export exposed raw keychain secret value");
await assertArchiveDoesNotExposeSecret("/var/lib/dindbos/keychain", "s3cr3t-token", "keychain metadata export exposed raw keychain secret value");
await assertArchiveDoesNotExposeSecret("/var/log/dindbos", "s3cr3t-token", "audit log export exposed raw keychain secret value");
const secretWindow = os.apps.launch("secret-package");
await secretWindow.rendered;
assert(secretWindow.content.innerHTML.includes("registry:repository-token:registry.token:s3cr3t-token:undeclared-denied"), `package secret reference render mismatch: ${secretWindow.content.innerHTML}`);

await assertRejects(() => os.keychain.exportSecret("registry.token", { appId: "shell", principal: os.permissions.principal(os.session) }), "export denied by policy");
result = await shell.executeAsync("keychain export registry.token");
assert(result.status === 1 && result.output.includes("export denied by policy"), `non-exportable shell export mismatch: ${JSON.stringify(result)}`);
os.keychain.setSecret("portable.token", "portable-secret", { ownerAppId: "shell", exportable: true }, { appId: "shell", principal: os.permissions.principal(os.session) });
const explicitExport = os.keychain.exportSecret("portable.token", { appId: "shell", principal: os.permissions.principal(os.session) });
assert(explicitExport.kind === "dindbos-keychain-export-v1" && explicitExport.value === "portable-secret", "explicit keychain export payload mismatch");
result = await shell.executeAsync("keychain export portable.token");
const shellExport = JSON.parse(result.output);
assert(result.status === 0 && shellExport.value === "portable-secret" && shellExport.record.exportable === true, `shell keychain export mismatch: ${JSON.stringify(result)}`);
await assertArchiveDoesNotExposeSecret("/var/lib/dindbos/packages", "portable-secret", "package DB export exposed explicitly exportable keychain secret value");
await assertArchiveDoesNotExposeSecret("/var/lib/dindbos/keychain", "portable-secret", "keychain metadata export exposed explicitly exportable secret value");

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

console.log("keychain smoke ok vault grants signing audit export-policy");

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

async function assertArchiveDoesNotExposeSecret(path, secret, message) {
  const entries = await collectExportEntries(os, path);
  const serialized = JSON.stringify(entries);
  const decodedPayload = entries.map((entry) => {
    try {
      return Buffer.from(entry.data || "", "base64").toString("utf8");
    } catch {
      return "";
    }
  }).join("\n");
  assert(!serialized.includes(secret) && !decodedPayload.includes(secret), message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
