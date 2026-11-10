#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const expectedDistFiles = [
  "index.js",
  "desktop.js",
  "builtins.js",
  "testing.js",
  "react.js",
  "create.js",
  "styles.css",
  "index.d.ts",
  "desktop.d.ts",
  "builtins.d.ts",
  "testing.d.ts",
  "react.d.ts",
  "create.d.ts",
  "create-template/package.json",
];

execFileSync("npm", ["run", "build:sdk"], { stdio: "inherit" });

for (const file of expectedDistFiles) {
  assert(existsSync(join("dist", file)), `SDK dist file missing: ${file}`);
}

const index = readFileSync("dist/index.js", "utf8");
const declarations = readFileSync("dist/index.d.ts", "utf8");
const styles = readFileSync("dist/styles.css", "utf8");
assert(index.includes("createDindbOS"), "dist/index.js missing createDindbOS export");
assert(declarations.includes("createDindbOS"), "dist/index.d.ts missing createDindbOS declaration");
assert(styles.includes(".dos-shell"), "dist/styles.css missing desktop shell styles");
assert(styles.includes(".glass-panel"), "dist/styles.css missing Liquid Glass panel utility");
assert(styles.includes("-webkit-backdrop-filter"), "dist/styles.css missing Safari glass blur support");
assert(styles.includes('data-appearance="dark"'), "dist/styles.css missing instance-scoped dark appearance");
for (const selector of [".dos-recent-apps.dos-recent-apps", ".dos-recents-rail", ".dos-window-layer:has(> .trusted-ui-surface)"]) {
  assert(styles.includes(selector), `dist/styles.css missing mobile recents layout: ${selector}`);
}
assert(styles.includes("transform: var(--mobile-swipe-transform, none)"), "dist/styles.css missing interactive mobile Home motion");
assert(!index.includes("portfolio-demo"), "SDK root bundle should not import demo portfolio data");

const pack = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }))[0];
const files = new Set(pack.files.map((entry) => entry.path));
[
  "dist/index.js",
  "dist/desktop.js",
  "dist/builtins.js",
  "dist/testing.js",
  "dist/react.js",
  "dist/create.js",
  "dist/create-template/package.json",
  "dist/styles.css",
  "dist/index.d.ts",
  "package.json",
  "README.md",
].forEach((file) => assert(files.has(file), `npm pack missing ${file}`));
assert(![...files].some((file) => file.startsWith("src/")), "npm pack included src files");
assert(![...files].some((file) => file.startsWith("scripts/")), "npm pack included scripts files");
assert(pack.size > 0, "npm pack reported empty package size");

console.log(`sdk build smoke ok files=${files.size} size=${pack.size}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
