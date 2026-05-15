#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const workspace = await mkdtemp(join(tmpdir(), "create-dindbos-smoke-"));
let tarball = "";

try {
  execFileSync("npm", ["run", "build:sdk"], { cwd: repoRoot, stdio: "inherit" });
  const pack = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", workspace], { cwd: repoRoot, encoding: "utf8" }))[0];
  tarball = resolve(workspace, pack.filename);
  assert(existsSync(tarball), `npm pack tarball missing: ${tarball}`);

  const cliHost = join(workspace, "cli-host");
  await mkdir(cliHost, { recursive: true });
  await writeFile(join(cliHost, "package.json"), `${JSON.stringify({
    private: true,
    type: "module",
    dependencies: { dindbos: `file:${tarball}` },
  }, null, 2)}\n`, "utf8");
  execFileSync("npm", ["install", "--no-audit", "--ignore-scripts", "--package-lock=false"], { cwd: cliHost, stdio: "inherit" });
  execFileSync("node", ["node_modules/dindbos/dist/create.js", "generated-os", "--force"], { cwd: cliHost, stdio: "inherit" });

  const generated = join(cliHost, "generated-os");
  await assertGeneratedProject(generated);
  await rewriteGeneratedDependencies(generated);
  execFileSync("npm", ["install", "--no-audit", "--ignore-scripts", "--package-lock=false"], { cwd: generated, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: generated, stdio: "inherit" });

  console.log(`create-dindbos smoke ok tarball=${pack.filename}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function assertGeneratedProject(root) {
  for (const file of ["package.json", "index.html", "src/main.js", "src/apps/hello.js", "dindbos.config.js", "public/dindbos-sw.js"]) {
    assert(existsSync(join(root, file)), `generated project missing ${file}`);
  }
  const main = await readFile(join(root, "src/main.js"), "utf8");
  assert(main.includes("createAndBootDindbOS"), "generated app does not boot through SDK");
  assert(main.includes("helloApp"), "generated app does not register sample app");
}

async function rewriteGeneratedDependencies(root) {
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.dependencies.dindbos = `file:${tarball}`;
  pkg.devDependencies.vite = `file:${resolve(repoRoot, "node_modules/vite")}`;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
