#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const workspace = await mkdtemp(join(tmpdir(), "dindbos-sdk-frameworks-"));
let tarball = "";

const examples = [
  { name: "vanilla-vite", build: true, imports: ["dindbos", "dindbos/styles.css"] },
  { name: "react-vite", build: true, imports: ["dindbos/react", "dindbos/styles.css"] },
  { name: "next-client", build: false, imports: ["dindbos/react", "dindbos/styles.css"] },
  { name: "astro-island", build: false, imports: ["dindbos/react", "dindbos/styles.css"] },
];

try {
  execFileSync("npm", ["run", "build:sdk"], { cwd: repoRoot, stdio: "inherit" });
  const pack = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: repoRoot, encoding: "utf8" }))[0];
  tarball = resolve(repoRoot, pack.filename);
  assert(existsSync(tarball), `npm pack tarball missing: ${tarball}`);

  for (const example of examples) {
    await verifyExample(example);
  }

  console.log(`sdk frameworks smoke ok examples=${examples.length} tarball=${pack.filename}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
  if (tarball) await rm(tarball, { force: true });
}

async function verifyExample(example) {
  const source = join(repoRoot, "examples", example.name);
  const target = join(workspace, example.name);
  await cp(source, target, { recursive: true });
  const pkgPath = join(target, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  pkg.dependencies = {
    ...(pkg.dependencies || {}),
    dindbos: `file:${tarball}`,
  };
  applyLocalDependency(pkg.dependencies, "react");
  applyLocalDependency(pkg.dependencies, "react-dom");
  pkg.devDependencies = pkg.devDependencies || {};
  applyLocalDependency(pkg.devDependencies, "vite");
  applyLocalDependency(pkg.devDependencies, "@vitejs/plugin-react");
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  const sourceText = await readExampleSource(target);
  for (const specifier of example.imports) {
    assert(sourceText.includes(`"${specifier}"`) || sourceText.includes(`'${specifier}'`), `${example.name} missing import ${specifier}`);
  }
  assert(pkg.dependencies.dindbos === `file:${tarball}`, `${example.name} did not point dindbos at packed tarball`);

  if (!example.build) return;
  execFileSync("npm", ["install", "--no-audit", "--ignore-scripts", "--package-lock=false"], { cwd: target, stdio: "inherit" });
  execFileSync("npm", ["run", "build"], { cwd: target, stdio: "inherit" });
}

function applyLocalDependency(target, name) {
  if (!target || !target[name]) return;
  const localPath = resolve(repoRoot, "node_modules", name);
  if (existsSync(localPath)) target[name] = `file:${localPath}`;
}

async function readExampleSource(dir) {
  const chunks = [];
  await visit(dir, chunks);
  return chunks.join("\n");
}

async function visit(dir, chunks) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await visit(path, chunks);
      continue;
    }
    if (/\.(js|jsx|ts|tsx|astro|html|json)$/.test(entry.name)) {
      chunks.push(await readFile(path, "utf8"));
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
