#!/usr/bin/env node
import { readFileSync } from "node:fs";

const guide = readFileSync("docs/developer-guide.md", "utf8");
const services = readFileSync("docs/services.md", "utf8");
const conformance = readFileSync("docs/conformance.md", "utf8");
const packageSignatures = readFileSync("docs/package-signatures.md", "utf8");
const shell = readFileSync("docs/shell.md", "utf8");
const serviceWorkerRecovery = readFileSync("docs/service-worker-recovery.md", "utf8");
const syscalls = readFileSync("docs/syscalls.md", "utf8");

[
  "## Runtime Contract",
  "## Permissions",
  "## Filesystem Scopes",
  "## Process Lifecycle",
  "## App State",
  "## Package Signing And Trust",
  "## Compatibility And API Versions",
  "## SDK And Syscalls",
  "## Browser And Companion Limits",
  "## Verification For Package Authors",
].forEach((heading) => {
  assert(guide.includes(heading), `developer guide missing ${heading}`);
});

[
  "package.read",
  "sandbox denied",
  "/var/lib/dindbos/app-state/<appId>.json",
  "dindbos-manifest-v1",
  "api.negotiatedVersion",
  "src/dindbos/sdk.d.ts",
  "scripts/helpers/dindbos-test-runtime.js",
].forEach((term) => {
  assert(guide.includes(term), `developer guide missing ${term}`);
});

[
  "## Service Manifest",
  "## States",
  "## Process Boundary",
  "## Permission Boundary",
  "## Browser Lifecycle Limits",
  "/var/run/dindbos/services.json",
  "service: manage denied",
].forEach((term) => {
  assert(services.includes(term), `services doc missing ${term}`);
});

[
  "## Certification Areas",
  "conformance evidence",
  "/proc/conformance-evidence",
  "durable-disk",
  "cross-origin-isolation",
  "npm run smoke:conformance",
].forEach((term) => {
  assert(conformance.includes(term), `conformance doc missing ${term}`);
});

[
  "policyctl prove [package]",
  "bootctl verify",
  "/proc/policy/proofs",
].forEach((term) => {
  assert(packageSignatures.includes(term), `package signatures doc missing ${term}`);
});

[
  "bootctl status",
  "policyctl prove [package]",
  "recovery profile [profile]",
  "/proc/policy/proofs",
].forEach((term) => {
  assert(shell.includes(term), `shell doc missing ${term}`);
});

[
  "safeBootEnforcement",
  "recovery profile [normal|safe-mode|package-disabled|service-disabled|companion-disabled|offline|storage-repair]",
  "`packages` disables package bootstrap",
].forEach((term) => {
  assert(serviceWorkerRecovery.includes(term), `service worker recovery doc missing ${term}`);
});

[
  "pending-user-gesture",
  "userGesture: true",
  "/proc/browser-brokers.json",
].forEach((term) => {
  assert(syscalls.includes(term), `syscalls doc missing ${term}`);
});

console.log("docs smoke ok developer guide service coverage");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
