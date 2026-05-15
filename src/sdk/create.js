#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const templateRoot = resolve(dirname(fileURLToPath(import.meta.url)), "create-template");

export async function createDindbOSProject(targetDir, options = {}) {
  const root = resolve(targetDir || "my-web-os");
  const name = normalizeProjectName(options.name || root.split(/[\\/]/).filter(Boolean).at(-1) || "my-web-os");
  await assertWritableTarget(root, options);
  await copyTemplate(templateRoot, root, { name });
  return { root, name };
}

export function normalizeProjectName(value) {
  const name = String(value || "my-web-os")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name || "my-web-os";
}

async function assertWritableTarget(root, options) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root);
  if (entries.length && !options.force) {
    throw new Error(`create-dindbos: target directory is not empty: ${root}`);
  }
}

async function copyTemplate(source, target, variables) {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyTemplate(from, to, variables);
      continue;
    }
    const raw = await readFile(from, "utf8");
    await writeFile(to, renderTemplate(raw, variables), "utf8");
  }
}

function renderTemplate(raw, variables) {
  return raw.replaceAll("__PROJECT_NAME__", variables.name);
}

async function runCli() {
  const args = process.argv.slice(2);
  const target = args.find((arg) => !arg.startsWith("-")) || "my-web-os";
  const force = args.includes("--force");
  const result = await createDindbOSProject(target, { force });
  console.log(`Created DindbOS host app at ${result.root}`);
  console.log("Next steps:");
  console.log(`  cd ${result.root}`);
  console.log("  npm install");
  console.log("  npm run dev");
}

if (isCliEntry()) {
  runCli().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
