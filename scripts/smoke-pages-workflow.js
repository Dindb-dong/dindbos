#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";

const workflowPath = ".github/workflows/pages.yml";
const workflow = read(workflowPath);
const ciWorkflow = read(".github/workflows/ci.yml");
const index = read("index.html");
const main = read("src/main.js");

assert(workflow.includes("runs-on: ubuntu-24.04") && ciWorkflow.includes("runs-on: ubuntu-24.04"), "Browser jobs must use the Ubuntu image supported by the locked Playwright version");
assert(existsSync(".nojekyll"), "GitHub Pages demo is missing .nojekyll");
assert(workflow.includes("actions/configure-pages@v5"), "Pages workflow does not configure GitHub Pages");
assert(workflow.includes("actions/upload-pages-artifact@v3"), "Pages workflow does not upload a Pages artifact");
assert(workflow.includes("actions/deploy-pages@v4"), "Pages workflow does not deploy Pages");
assert(workflow.includes("run: npm ci"), "Pages workflow does not install dependencies before verification");
assert(
  workflow.includes("command -v google-chrome || command -v chromium || command -v chromium-browser"),
  "Pages workflow does not locate the runner browser for smoke tests",
);
assert(workflow.includes('if [ -z "$chrome_path" ]; then') && workflow.includes("            exit 1"), "Pages workflow must fail when the runner browser is absent");
assert(workflow.includes('echo "CHROME_PATH=$chrome_path" >> "$GITHUB_ENV"'), "Pages workflow does not export the discovered browser executable");
assert(workflow.indexOf("Use the runner's existing Chrome") < workflow.indexOf("run: npm run smoke"), "Pages must prepare the browser before smoke tests");
assert(workflow.includes("run: npm run smoke"), "Pages workflow does not gate deployment on npm run smoke");
assert(workflow.includes("run: npm run build"), "Pages workflow does not build the static demo");
assert(workflow.includes("Check Pages Availability"), "Pages workflow does not preflight Pages availability");
assert(workflow.includes("/repos/${GITHUB_REPOSITORY}/pages"), "Pages workflow does not check the repository Pages endpoint");
assert(workflow.includes("steps.pages.outputs.enabled == 'true'"), "Pages workflow does not guard Pages-only deployment steps");
assert(workflow.includes("path: dist-demo"), "Pages must upload the demo independently of SDK output");
assert(index.includes('src="./src/main.js"'), "Demo entry must use Vite's content-hashed build");
assert(main.includes("./sdk/react.js"), "Demo must consume the public React SDK adapter");
assert(main.includes("./demo/portfolio-demo.js"), "Demo filesystem seed import is missing");

assert(ciWorkflow.includes("run: npx playwright install ffmpeg"), "Browser verification requires the Playwright video recording runtime");
assert(ciWorkflow.indexOf("run: npx playwright install ffmpeg") < ciWorkflow.indexOf("run: npm run verify:ui"), "Prepare the video runtime before browser verification");

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
