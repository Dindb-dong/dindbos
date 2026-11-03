#!/usr/bin/env node
import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = dirname(fileURLToPath(import.meta.url));
const templates = { vanilla: join(cliDirectory, "create-template"), react: join(cliDirectory, "create-templates/react") };

export async function createDindbOSProject(targetDir = "my-desktop", options = {}) {
  const root = resolve(targetDir);
  const name = normalizeProjectName(options.name || root.split(/[\\/]/).at(-1));
  const template = options.template || "vanilla";
  if (!Object.hasOwn(templates, template)) throw new Error(`Unknown template: ${template}. Choose react or vanilla.`);
  const entries = await readDirectory(root);
  if (entries.length && !options.force) throw new Error(`Target directory is not empty: ${root}. Choose another directory or explicitly use --force.`);
  const variables = { name, sdkVersion: await sdkVersion() };
  const files = await collectTemplate(templates[template]);
  const result = { root, name, template, files: files.map(({ path }) => path), dryRun: Boolean(options.dryRun) };
  if (options.dryRun) return result;
  await mkdir(root, { recursive: true });
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content.replaceAll("__PROJECT_NAME__", name).replaceAll("__DINDBOS_VERSION__", variables.sdkVersion), { flag: options.force ? "w" : "wx" });
  }
  return result;
}

export async function addDindbOSApp(name, options = {}) {
  const root = resolve(options.root || ".");
  const id = String(name || "").trim();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error("App name must start with a lowercase letter and use lowercase letters/numbers separated by single hyphens.");
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const template = options.template || pkg.dindbos?.template;
  if (!Object.hasOwn(templates, template)) throw new Error("Cannot determine this project's template. Supply --template react or --template vanilla.");
  const registryPath = join(root, "src/apps/index.js");
  const registry = await readFile(registryPath, "utf8");
  if (!registry.includes("// dindbos:imports") || !registry.includes("// dindbos:apps")) throw new Error("App registry markers are missing from src/apps/index.js. Add the app manually; no files were changed.");
  if (new RegExp(`id:\\s*["']${id}["']`).test(registry) || registry.includes(`./${id}.`)) throw new Error(`App ${id} is already registered.`);
  const component = id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("") + "App";
  const path = `src/apps/${id}.${template === "react" ? "jsx" : "js"}`;
  if ((await readDirectory(join(root, "src/apps"))).includes(path.split("/").at(-1)) && !options.force) throw new Error(`App file already exists: ${path}`);
  const importLine = template === "react" ? `import ${component} from "./${id}.jsx";` : `import { ${component} } from "./${id}.js";`;
  const definition = template === "react" ? `  { id: "${id}", name: "${component.replace(/App$/, "")}", Component: ${component} },` : `  ${component},`;
  const nextRegistry = registry.replace("// dindbos:imports", `${importLine}\n// dindbos:imports`).replace("// dindbos:apps", `${definition}\n  // dindbos:apps`);
  const content = template === "react"
    ? `import React from "react";\n\nexport default function ${component}() {\n  return <main className="starter-app"><h1>${component.replace(/App$/, "")}</h1><p>Edit ${path} to build your app.</p></main>;\n}\n`
    : `import { defineApp } from "dindbos";\n\nexport const ${component} = defineApp({\n  id: "${id}", name: "${component.replace(/App$/, "")}", icon: "app", pinned: true, desktop: true,\n  render({ content }) {\n    const title = document.createElement("h1");\n    title.textContent = "${component.replace(/App$/, "")}";\n    content.replaceChildren(title);\n  },\n});\n`;
  const result = { root, id, template, files: [path, "src/apps/index.js"], dryRun: Boolean(options.dryRun) };
  if (options.dryRun) return result;
  await writeFile(join(root, path), content, { flag: options.force ? "w" : "wx" });
  await writeFile(registryPath, nextRegistry);
  return result;
}

export async function doctorDindbOSProject(root = ".") {
  const directory = resolve(root);
  const checks = [];
  let pkg;
  try { pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8")); } catch { checks.push({ name: "package.json", ok: false, detail: "Missing or invalid package.json" }); }
  if (pkg) {
    checks.push({ name: "dindbos dependency", ok: Boolean(pkg.dependencies?.dindbos || pkg.devDependencies?.dindbos), detail: "Declare dindbos in package.json" });
    const template = pkg.dindbos?.template || (pkg.dependencies?.react ? "react" : "vanilla");
    for (const path of ["index.html", "dindbos.config.js", "src/apps/index.js", template === "react" ? "src/main.jsx" : "src/main.js"]) {
      let ok = false;
      try { await readFile(join(directory, path)); ok = true; } catch { /* Report a missing generated file. */ }
      checks.push({ name: path, ok, detail: ok ? "Present" : "Missing; check your host project's entrypoints" });
    }
  }
  return { root: directory, ok: checks.every((check) => check.ok), checks };
}

export function normalizeProjectName(value) {
  return String(value || "my-desktop").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "my-desktop";
}

async function readDirectory(root) {
  try { return await readdir(root); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function collectTemplate(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collectTemplate(root, path));
    else files.push({ path, content: await readFile(join(root, path), "utf8") });
  }
  return files;
}

async function sdkVersion() {
  for (const path of [join(cliDirectory, "../package.json"), join(cliDirectory, "../../package.json")]) {
    try { const pkg = JSON.parse(await readFile(path, "utf8")); if (pkg.name === "dindbos") return pkg.version; } catch { /* Source and packed CLI have different parent paths. */ }
  }
  throw new Error("Cannot locate dindbos package metadata.");
}

function parseArguments(args) {
  const options = {};
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--yes", "-y"].includes(arg)) continue;
    if (["--force", "--json", "--dry-run", "--help", "-h"].includes(arg)) { options[arg === "-h" ? "help" : arg.slice(2).replace("dry-run", "dryRun")] = true; continue; }
    const match = arg.match(/^--(template|root|name)(?:=(.*))?$/);
    if (match) {
      const value = match[2] ?? args[++index];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for --${match[1]}`);
      options[match[1]] = value;
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { options, positional };
}

export async function runDindbOSCLI(args = process.argv.slice(2)) {
  let json = args.includes("--json");
  try {
    const { options, positional } = parseArguments(args);
    json = options.json;
    if (options.help) {
      console.log("create-dindbos [directory] [--template react|vanilla] [--yes] [--json] [--dry-run]\ncreate-dindbos add app <name> [--root directory] [--template react|vanilla] [--json]\ncreate-dindbos doctor [directory] [--json]\n\nExisting files are preserved unless --force is explicit. No packages are installed automatically.");
      return;
    }
    let result;
    if (positional[0] === "add") {
      if (positional[1] !== "app" || !positional[2] || positional.length !== 3) throw new Error("Usage: create-dindbos add app <name> [--root directory]");
      result = await addDindbOSApp(positional[2], options);
    } else if (positional[0] === "doctor") {
      if (positional.length > 2) throw new Error("Usage: create-dindbos doctor [directory]");
      result = await doctorDindbOSProject(positional[1] || options.root || ".");
      if (!result.ok) process.exitCode = 1;
    } else {
      if (positional.length > 1) throw new Error("Supply one target directory.");
      result = await createDindbOSProject(positional[0] || "my-desktop", options);
    }
    if (json) console.log(JSON.stringify({ ok: result.ok ?? true, ...result }));
    else if (result.checks) console.log(result.checks.map((check) => `${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`).join("\n"));
    else if (result.id) console.log(`${result.dryRun ? "Would add" : "Added"} ${result.id}: ${result.files.join(", ")}`);
    else console.log(`${result.dryRun ? "Would create" : "Created"} ${result.template} desktop at ${result.root}\n\nNext steps:\n  cd ${result.root}\n  npm install\n  npm run dev`);
    return result;
  } catch (error) {
    if (json) console.log(JSON.stringify({ ok: false, error: error.message }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1]) {
  realpath(process.argv[1]).then((entry) => {
    if (entry === fileURLToPath(import.meta.url)) return runDindbOSCLI();
  }).catch(() => {});
}
