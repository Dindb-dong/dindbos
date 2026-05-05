#!/usr/bin/env node
import { readFileSync } from "node:fs";

const guide = readFileSync("docs/developer-guide.md", "utf8");

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

console.log("docs smoke ok developer guide coverage");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
