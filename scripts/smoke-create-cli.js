#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDindbOSProject, addDindbOSApp, doctorDindbOSProject } from "../src/sdk/create.js";

const workspace = await mkdtemp(join(tmpdir(), "dindbos-cli-unit-"));
const cli = resolve("src/sdk/create.js");
try {
  for (const template of ["react", "vanilla"]) {
    const root = join(workspace, template);
    const dry = await createDindbOSProject(root, { template, dryRun: true });
    assert(dry.files.includes("AGENTS.md"));
    assert(!(await readdir(workspace)).includes(template), "dry-run created a directory");
    const result = await createDindbOSProject(root, { template });
    assert.equal(result.template, template);
    assert.equal((await doctorDindbOSProject(root)).ok, true);
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    assert.equal(pkg.dindbos.template, template);
    assert(!pkg.dependencies.dindbos.includes("__"));
    await assert.rejects(createDindbOSProject(root, { template }), /not empty/);
    const before = await readFile(join(root, "src/apps/index.js"), "utf8");
    await addDindbOSApp("notes", { root, dryRun: true });
    assert.equal(await readFile(join(root, "src/apps/index.js"), "utf8"), before);
    await addDindbOSApp("notes", { root });
    const after = await readFile(join(root, "src/apps/index.js"), "utf8");
    assert(after.includes(template === "react" ? "Component: NotesApp" : "  NotesApp,"));
    assert(after.includes("// dindbos:imports") && after.includes("// dindbos:apps"));
    await assert.rejects(addDindbOSApp("notes", { root }), /already registered/);
    assert.equal(await readFile(join(root, "src/apps/index.js"), "utf8"), after);
    await assert.rejects(addDindbOSApp("../unsafe", { root }), /lowercase/);
    for (const id of ["a--b", "a-"]) await assert.rejects(addDindbOSApp(id, { root }), /single hyphens/);
    assert.equal(await readFile(join(root, "src/apps/index.js"), "utf8"), after, "invalid hyphenated IDs leave the project unchanged");
    await writeFile(join(root, "src/apps/index.js"), "export const apps = [];\n");
    await assert.rejects(addDindbOSApp("incomplete", { root }), /markers/);
    assert(!(await readdir(join(root, "src/apps"))).some((file) => file.startsWith("incomplete.")));
  }
  const jsonRoot = join(workspace, "json-project");
  const result = JSON.parse(execFileSync(process.execPath, [cli, "--template", "react", jsonRoot, "--yes", "--json"], { encoding: "utf8" }));
  assert.equal(result.ok, true);
  assert.equal(result.root, jsonRoot, "option value was parsed as target");
  assert.equal(result.template, "react");
  const error = spawnSync(process.execPath, [cli, "--template", "--json"], { encoding: "utf8" });
  assert.equal(error.status, 1);
  assert.equal(JSON.parse(error.stdout).ok, false);
  const link = join(workspace, "create-dindbos");
  await symlink(cli, link);
  assert(execFileSync(process.execPath, [link, "--help"], { encoding: "utf8" }).includes("add app"), "symlink bin did not execute");
  const missing = await doctorDindbOSProject(join(workspace, "missing"));
  assert.equal(missing.ok, false);
  console.log("create CLI smoke ok: templates, dry-run, registry add, no overwrite, JSON errors, symlink bin, doctor");
} finally {
  await rm(workspace, { recursive: true, force: true });
}
