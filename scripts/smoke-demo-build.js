#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
execFileSync("npm", ["run", "build"], { stdio: "inherit" });

for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  assert.equal(readFileSync(`dist-demo/${name}`, "utf8"), readFileSync(name, "utf8"), `Demo must ship the complete ${name}`);
}

const notices = readFileSync("dist-demo/THIRD_PARTY_NOTICES.md", "utf8");
for (const dependency of ["react", "react-dom", "scheduler"]) {
  const license = readFileSync(join(dirname(require.resolve(`${dependency}/package.json`)), "LICENSE"), "utf8");
  assert(notices.includes(license.trim()), `Demo notices must include the complete ${dependency} license`);
}
assert(notices.includes("Copyright (c) 2025 Shu Ding"), "Demo notices must credit Liquid Glass");
console.log("demo build smoke ok with project and third-party license notices");
