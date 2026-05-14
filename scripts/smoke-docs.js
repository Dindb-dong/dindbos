#!/usr/bin/env node
import { readFileSync } from "node:fs";

const guide = readFileSync("docs/developer-guide.md", "utf8");
const services = readFileSync("docs/services.md", "utf8");
const conformance = readFileSync("docs/conformance.md", "utf8");

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
  "durable-disk",
  "cross-origin-isolation",
  "npm run smoke:conformance",
].forEach((term) => {
  assert(conformance.includes(term), `conformance doc missing ${term}`);
});

console.log("docs smoke ok developer guide service coverage");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
