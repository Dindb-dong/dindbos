#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const workspace = await mkdtemp(join(tmpdir(), "create-dindbos-smoke-"));
const originalNpmCache = process.env.npm_config_cache;
process.env.npm_config_cache = join(workspace, "npm-cache");
let tarball = "";

try {
  execFileSync("npm", ["run", "build:sdk"], { cwd: repoRoot, stdio: "inherit" });
  const pack = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", workspace], { cwd: repoRoot, encoding: "utf8" }))[0];
  for (const path of ["dist/pages-workflow.yml", "skills/dindbos-portfolio/SKILL.md", "docs/deployment.md"]) {
    assert(pack.files.some((file) => file.path === path), `npm package missing ${path}`);
  }
  tarball = resolve(workspace, pack.filename);
  assert(existsSync(tarball), `npm pack tarball missing: ${tarball}`);

  const cliHost = join(workspace, "cli-host");
  await mkdir(cliHost, { recursive: true });
  await writeFile(join(cliHost, "package.json"), `${JSON.stringify({
    private: true,
    type: "module",
    dependencies: { dindbos: `file:${tarball}`, react: `file:${resolve(repoRoot, "node_modules/react")}`, "react-dom": `file:${resolve(repoRoot, "node_modules/react-dom")}` },
    overrides: { react: "$react", "react-dom": "$react-dom" },
  }, null, 2)}\n`, "utf8");
  execFileSync("npm", ["install", "--offline", "--no-audit", "--ignore-scripts", "--package-lock=false"], { cwd: cliHost, stdio: "inherit" });
  for (const template of ["vanilla", "react"]) {
    const directory = `generated-${template}`;
    execFileSync("node", ["node_modules/dindbos/dist/create.js", directory, "--template", template, "--pages", "--yes", "--json"], { cwd: cliHost, stdio: "inherit" });
    const generated = join(cliHost, directory);
    await assertGeneratedProject(generated, template);
    execFileSync("node", ["node_modules/dindbos/dist/create.js", "add", "app", "notes", "--root", directory, "--json"], { cwd: cliHost, stdio: "inherit" });
    await rewriteGeneratedDependencies(generated);
    execFileSync("npm", ["install", "--offline", "--no-audit", "--ignore-scripts"], { cwd: generated, stdio: "inherit" });
    const lock = JSON.parse(await readFile(join(generated, "package-lock.json"), "utf8"));
    assert(lock.packages["node_modules/dindbos"].resolved === "file:vendor/dindbos.tgz", "SDK lockfile must use the committed relative tarball");
    execFileSync("npm", ["ci", "--offline", "--no-audit", "--ignore-scripts"], { cwd: generated, stdio: "inherit" });
    execFileSync("npm", ["run", "build"], { cwd: generated, stdio: "inherit" });
    const rootHTML = await readFile(join(generated, "dist/index.html"), "utf8");
    assert(rootHTML.includes('src="/assets/'), "root Pages asset URL missing");
    execFileSync("npm", ["run", "build", "--", "--base", "/portfolio-check/"], { cwd: generated, stdio: "inherit" });
    const projectHTML = await readFile(join(generated, "dist/index.html"), "utf8");
    const urls = [...projectHTML.matchAll(/(?:src|href)="(\/portfolio-check\/[^"?#]+)/g)].map((match) => match[1]);
    assert(urls.length >= 2, "project Pages JS/CSS URLs missing");
    for (const url of urls) assert(existsSync(join(generated, "dist", url.slice("/portfolio-check/".length))), `built asset missing: ${url}`);
    execFileSync("node", ["node_modules/dindbos/dist/create.js", "doctor", directory, "--json"], { cwd: cliHost, stdio: "inherit" });
  }

  console.log(`create-dindbos smoke ok tarball=${pack.filename}`);
} finally {
  if (originalNpmCache === undefined) delete process.env.npm_config_cache;
  else process.env.npm_config_cache = originalNpmCache;
  await rm(workspace, { recursive: true, force: true });
}

async function assertGeneratedProject(root, template) {
  const react = template === "react";
  const entry = react ? "src/main.jsx" : "src/main.js";
  for (const file of ["package.json", "index.html", entry, react ? "src/apps/hello.jsx" : "src/apps/hello.js", "src/apps/index.js", "dindbos.config.js", "AGENTS.md", ".github/workflows/pages.yml", ".gitignore"]) {
    assert(existsSync(join(root, file)), `generated project missing ${file}`);
  }
  const main = await readFile(join(root, entry), "utf8");
  assert(main.includes(react ? "DindbOSApp" : "createAndBootDindbOS"), "generated app does not boot through SDK");
  const registry = await readFile(join(root, "src/apps/index.js"), "utf8");
  assert(registry.includes(react ? "HelloApp" : "helloApp"), "generated app registry does not include sample app");
}

async function rewriteGeneratedDependencies(root) {
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  await mkdir(join(root, "vendor"), { recursive: true });
  await copyFile(tarball, join(root, "vendor/dindbos.tgz"));
  pkg.dependencies.dindbos = "file:vendor/dindbos.tgz";
  for (const name of ["react", "react-dom"]) pkg.dependencies[name] = `file:${resolve(repoRoot, "node_modules", name)}`;
  pkg.overrides = { react: "$react", "react-dom": "$react-dom" };
  for (const name of ["vite", "@vitejs/plugin-react"]) if (pkg.devDependencies[name]) pkg.devDependencies[name] = `file:${resolve(repoRoot, "node_modules", name)}`;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
