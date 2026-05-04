#!/usr/bin/env node
import { DindbOS, normalizeSession } from "../src/dindbos/index.js";
import { installBuiltinApps } from "../src/dindbos/apps/builtins.js";
import { ShellSession } from "../src/dindbos/shell.js";
import { portfolioData } from "../src/demo/portfolio-demo.js";

const normalized = normalizeSession({ user: "Ada Lovelace", groups: ["users", "Research Team"] });
assert(normalized.user === "ada-lovelace", `session user was not sanitized: ${normalized.user}`);
assert(normalized.home === "/home/ada-lovelace", `session home was not generated: ${normalized.home}`);
assert(normalized.groups.includes("research-team"), `session groups were not sanitized: ${normalized.groups.join(",")}`);
const fallbackGroups = normalizeSession({ user: "operator", groups: [" ", "admins"] });
assert(fallbackGroups.groups.join(",") === "admins", `blank session groups were not pruned: ${fallbackGroups.groups.join(",")}`);

const os = new DindbOS({
  root: null,
  fileSystem: null,
  storage: createStorage(),
  persistDelayMs: 0,
  session: { user: "Ada Lovelace", groups: ["users", "Research Team"] },
});

await os.loadPersistentFileSystem();
installBuiltinApps(os, { portfolioData });

assert(os.session.user === "ada-lovelace", "runtime session user mismatch");
assert(os.session.home === "/home/ada-lovelace", "runtime session home mismatch");
["Desktop", "Documents", "Downloads", ".Trash"].forEach((name) => {
  const path = os.fs.join(os.session.home, name);
  const stat = os.fs.stat(path);
  assert(stat.type === "directory", `session home directory missing: ${path}`);
  assert(stat.owner === "ada-lovelace", `session home directory owner mismatch for ${path}: ${stat.owner}`);
  assert(stat.group === "users", `session home directory group mismatch for ${path}: ${stat.group}`);
});

const profile = os.fs.stat(os.fs.join(os.session.home, ".profile"));
assert(profile.owner === "ada-lovelace", "session .profile owner mismatch");
assert(os.fs.readFile(os.fs.join(os.session.home, ".profile")).includes("export HOME=/home/ada-lovelace"), "session .profile HOME mismatch");

const shell = new ShellSession(os);
assert(shell.cwd === "/home/ada-lovelace", `shell cwd did not use generated home: ${shell.cwd}`);
assert(shell.env.USER === "ada-lovelace", `shell USER mismatch: ${shell.env.USER}`);
let result = await shell.executeAsync("echo hello > Documents/session.txt");
assert(result.status === 0, `session shell write failed: ${result.output}`);
const sessionFile = os.fs.stat("/home/ada-lovelace/Documents/session.txt");
assert(sessionFile.owner === "ada-lovelace", `created file owner mismatch: ${sessionFile.owner}`);
assert(sessionFile.group === "users", `created file group mismatch: ${sessionFile.group}`);
assert(os.fs.readFile("/home/ada-lovelace/Documents/session.txt") === "hello\n", "created file content mismatch");

result = await shell.executeAsync("mkdir Projects");
assert(result.status === 0, `session shell mkdir failed: ${result.output}`);
const projects = os.fs.stat("/home/ada-lovelace/Projects");
assert(projects.owner === "ada-lovelace", `created directory owner mismatch: ${projects.owner}`);

const textManifest = os.apps.getManifest("text");
assert(textManifest.fileSystem.read.includes("/home/ada-lovelace"), "TextEdit read scope did not use generated home");
assert(textManifest.fileSystem.write.includes("/home/ada-lovelace"), "TextEdit write scope did not use generated home");
assert(!textManifest.fileSystem.read.includes("/home/guest"), "TextEdit read scope still used hard-coded guest home");
const viewerManifest = os.apps.getManifest("viewer");
assert(viewerManifest.fileSystem.read.includes("/home/ada-lovelace"), "Viewer read scope did not use generated home");
const settingsManifest = os.apps.getManifest("settings");
assert(settingsManifest.fileSystem.read.includes("/home/ada-lovelace"), "Settings read scope did not use generated home");

console.log("sessions smoke ok generated-home user-scopes ownership");

function createStorage() {
  return {
    async loadFileSystem() {
      return null;
    },
    saveFileSystem() {},
    async flush() {},
    async readValue() {
      return null;
    },
    writeValue() {},
    status: () => ({ backend: "memory" }),
    estimate: async () => ({ backend: "memory" }),
    resetFileSystem() {},
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
