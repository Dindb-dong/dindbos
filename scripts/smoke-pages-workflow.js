#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const workflowPath = ".github/workflows/pages.yml";
const workflow = read(workflowPath);
const index = read("index.html");
const main = read("src/main.js");

assert(existsSync(".nojekyll"), "GitHub Pages demo is missing .nojekyll");
assert(workflow.includes("actions/configure-pages@v5"), "Pages workflow does not configure GitHub Pages");
assert(workflow.includes("actions/upload-pages-artifact@v3"), "Pages workflow does not upload a Pages artifact");
assert(workflow.includes("actions/deploy-pages@v4"), "Pages workflow does not deploy Pages");
assert(workflow.includes("run: npm run smoke"), "Pages workflow does not gate deployment on npm run smoke");
assert(workflow.includes("path: ."), "Pages workflow does not upload the static runtime root");
assert(index.includes("./src/main.js?v=20260504-runtime"), "index.html cache buster does not point at the latest runtime demo");
assert(main.includes("./dindbos/index.js?v=20260504-runtime"), "main.js DindbOS import cache buster is stale");
assert(main.includes("./dindbos/apps/builtins.js?v=20260504-runtime"), "main.js builtins import cache buster is stale");
assert(main.includes("./demo/portfolio-demo.js?v=20260504-runtime"), "main.js demo import cache buster is stale");

console.log("pages workflow smoke ok");

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
