#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const hostDir = await mkdtemp(join(tmpdir(), "dindbos-sdk-host-"));
let tarball = "";

try {
  execFileSync("npm", ["run", "build:sdk"], { cwd: repoRoot, stdio: "inherit" });
  const pack = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: repoRoot, encoding: "utf8" }))[0];
  tarball = resolve(repoRoot, pack.filename);
  assert(existsSync(tarball), `npm pack tarball missing: ${tarball}`);

  await createHostProject(hostDir, tarball);
  execFileSync("npm", ["install", "--no-audit", "--ignore-scripts", "--package-lock=false"], {
    cwd: hostDir,
    stdio: "inherit",
  });
  execFileSync("npm", ["run", "build"], { cwd: hostDir, stdio: "inherit" });
  execFileSync("node", ["smoke-runtime.mjs"], { cwd: hostDir, stdio: "inherit" });

  const built = await readBuiltHostAssets(hostDir);
  assert(built.includes("host import ok") || built.includes("DindbOS"), "host Vite build did not include SDK import marker");
  console.log(`sdk pack smoke ok tarball=${pack.filename} host=${hostDir}`);
} finally {
  await rm(hostDir, { recursive: true, force: true });
  if (tarball) await rm(tarball, { force: true });
}

async function createHostProject(targetDir, tarball) {
  await mkdir(join(targetDir, "src"), { recursive: true });
  const dependencies = {
    dindbos: `file:${tarball}`,
    react: `file:${resolve(repoRoot, "node_modules/react")}`,
    "react-dom": `file:${resolve(repoRoot, "node_modules/react-dom")}`,
  };
  const devDependencies = {
    vite: `file:${resolve(repoRoot, "node_modules/vite")}`,
    "@vitejs/plugin-react": `file:${resolve(repoRoot, "node_modules/@vitejs/plugin-react")}`,
  };
  await writeFile(join(targetDir, "package.json"), `${JSON.stringify({
    name: "dindbos-sdk-host-smoke",
    private: true,
    type: "module",
    scripts: { build: "vite build" },
    dependencies,
    devDependencies,
  }, null, 2)}\n`, "utf8");
  await writeFile(join(targetDir, "index.html"), [
    "<!doctype html>",
    "<html>",
    "  <head><meta charset=\"UTF-8\"><title>DindbOS SDK Host Smoke</title></head>",
    "  <body><div id=\"app\"></div><script type=\"module\" src=\"/src/main.js\"></script></body>",
    "</html>",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(targetDir, "src", "main.js"), [
    "import { createDindbOS, normalizeDindbOSHostConfig } from \"dindbos\";",
    "import \"dindbos/styles.css\";",
    "",
    "window.__DINDBOS_HOST_IMPORT__ = { create: typeof createDindbOS, config: typeof normalizeDindbOSHostConfig };",
    "document.querySelector(\"#app\").textContent = \"host import ok\";",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(targetDir, "smoke-runtime.mjs"), [
    "import { createDindbOS, prepareDindbOSHost } from \"dindbos\";",
    "",
    "const os = await createDindbOS({",
    "  root: null,",
    "  fileSystem: { \"/home/guest/readme.md\": \"# Host smoke\\n\" },",
    "  storage: { backend: \"indexeddb\", name: \"host-pack-smoke\" },",
    "});",
    "await os.loadPersistentFileSystem();",
    "await os.runBootPhase(\"package-registry-load\", () => os.packages.bootstrap());",
    "await os.runBootPhase(\"app-registry-load\", () => prepareDindbOSHost(os, { builtins: { includePortfolio: false } }));",
    "os.fs.writeOrCreateFile(\"/home/guest/created.txt\", \"created by host smoke\", \"/\", {}, os.permissions.systemPrincipal());",
    "if (!os.apps.getManifest(\"files\")) throw new Error(\"Files.app missing after packed install\");",
    "if (!os.apps.getManifest(\"terminal\")) throw new Error(\"Terminal.app missing after packed install\");",
    "if (!os.fs.exists(\"/proc/conformance.json\")) throw new Error(\"conformance procfs missing\");",
    "if (!os.fs.readFile(\"/home/guest/created.txt\").includes(\"host smoke\")) throw new Error(\"VFS write failed\");",
    "console.log(\"packed host runtime smoke ok\");",
    "",
  ].join("\n"), "utf8");
}

async function readBuiltHostAssets(hostDir) {
  const assetsDir = join(hostDir, "dist", "assets");
  const names = await readdir(assetsDir).catch(() => []);
  const chunks = await Promise.all(names
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFile(join(assetsDir, name), "utf8")));
  return chunks.join("\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
