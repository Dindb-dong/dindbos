#!/usr/bin/env node
import {
  collectExportEntries,
  filesActionTargets,
  importDroppedFiles,
  moveFilesKeyboardSelection,
  parseFilesSearchQuery,
  recordFilesOperationHistory,
  searchFileEntries,
  updateFilesSelection,
} from "../src/dindbos/apps/builtins.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";

const os = bootOs();
const sourceRoot = "/home/guest/Documents/export-source";
const importRoot = "/home/guest/Documents/import-target";
const binaryPath = `${sourceRoot}/nested/payload.bin`;
const textPath = `${sourceRoot}/note.txt`;
const binary = new Uint8Array([0, 5, 10, 15, 31, 63, 127, 128, 191, 255]);
const text = "Files.app import/export smoke\n";

os.fs.createDirectory(sourceRoot);
os.fs.createDirectory(`${sourceRoot}/nested`);
os.fs.createDirectory(importRoot);
os.fs.writeOrCreateFileBytes(binaryPath, binary, "/", { mime: "application/octet-stream" });
os.fs.writeOrCreateFile(textPath, text, "/", { mime: "text/plain" });
os.fs.writeOrCreateFile(`${sourceRoot}/nested/readme.md`, "# readme\n", "/", { mime: "text/markdown" });

const entries = await collectExportEntries(os, sourceRoot);
assert(entries.length === 3, `expected 3 exported entries, got ${entries.length}`);
const exportedBinary = entries.find((entry) => entry.path === "nested/payload.bin");
assert(exportedBinary, "nested binary file was not exported");
assert(exportedBinary.data, "exported binary data is missing");

const archiveFile = {
  name: "export-source.dindbos-export.json",
  async text() {
    return JSON.stringify({
      kind: "dindbos-export-v1",
      exportedAt: new Date().toISOString(),
      root: sourceRoot,
      entries,
    });
  },
};

const imported = await importDroppedFiles(os, importRoot, [archiveFile]);
assert(imported.includes(`${importRoot}/nested/payload.bin`), "imported paths missing nested binary file");
assert(imported.includes(`${importRoot}/note.txt`), "imported paths missing text file");
assertBytes(os.fs.readFileBytes(`${importRoot}/nested/payload.bin`), binary, "imported binary bytes changed");
assert(os.fs.readFile(`${importRoot}/note.txt`) === text, "imported text changed");

const parsedSearch = parseFilesSearchQuery("payload type:file ext:bin min:10b max:1kb modified:>=2020-01-01");
assert(parsedSearch.text[0] === "payload", "search text token parse mismatch");
assert(parsedSearch.type === "file", "search type token parse mismatch");
assert(parsedSearch.ext === "bin", "search extension token parse mismatch");
assert(parsedSearch.min === 10, "search min token parse mismatch");
assert(parsedSearch.max === 1024, "search max token parse mismatch");
const binaryResults = searchFileEntries(os, sourceRoot, "payload type:file ext:bin min:10b max:1kb");
assert(binaryResults.length === 1 && binaryResults[0].path === binaryPath, "binary search filters did not isolate payload.bin");
const markdownResults = searchFileEntries(os, sourceRoot, "type:text ext:md readme");
assert(markdownResults.length === 1 && markdownResults[0].name === "readme.md", "text/ext search filters did not isolate readme.md");
const folderResults = searchFileEntries(os, sourceRoot, "type:folder nested");
assert(folderResults.length === 1 && folderResults[0].path === `${sourceRoot}/nested`, "folder search filter did not isolate nested directory");

const visiblePaths = [
  `${sourceRoot}/alpha.txt`,
  `${sourceRoot}/beta.txt`,
  `${sourceRoot}/gamma.txt`,
  `${sourceRoot}/delta.txt`,
];
let selection = updateFilesSelection([visiblePaths[0]], visiblePaths, visiblePaths[2], {
  mode: "toggle",
  anchorPath: visiblePaths[0],
});
assert(selection.selectedPaths.includes(visiblePaths[0]), "toggle selection lost existing item");
assert(selection.selectedPaths.includes(visiblePaths[2]), "toggle selection did not add target item");
assert(selection.anchorPath === visiblePaths[2], "toggle selection did not move anchor to target");
selection = updateFilesSelection(selection.selectedPaths, visiblePaths, visiblePaths[2], {
  mode: "toggle",
  anchorPath: selection.anchorPath,
});
assert(!selection.selectedPaths.includes(visiblePaths[2]), "toggle selection did not remove selected item");
assert(selection.selectedPaths.includes(visiblePaths[0]), "toggle selection removed the only remaining anchor item");
selection = updateFilesSelection([visiblePaths[0]], visiblePaths, visiblePaths[3], {
  mode: "range",
  anchorPath: visiblePaths[1],
});
assert(selection.selectedPaths.length === 4, `range selection expected 4 unique paths, got ${selection.selectedPaths.length}`);
assert(selection.selectedPaths.includes(visiblePaths[1]) && selection.selectedPaths.includes(visiblePaths[3]), "range selection missed endpoints");
assert(selection.anchorPath === visiblePaths[1], "range selection did not preserve anchor");
const selectedTargets = filesActionTargets(sourceRoot, sourceRoot, [visiblePaths[1], visiblePaths[3], visiblePaths[1]]);
assert(selectedTargets.length === 2, `multi-action target de-dupe expected 2 paths, got ${selectedTargets.length}`);
assert(selectedTargets[0] === visiblePaths[1] && selectedTargets[1] === visiblePaths[3], "multi-action target order changed");
assert(filesActionTargets(sourceRoot, visiblePaths[0], []).join("") === visiblePaths[0], "single-action target fallback failed");
let keyboardSelection = moveFilesKeyboardSelection(visiblePaths[1], visiblePaths, "ArrowDown");
assert(keyboardSelection.selectedPath === visiblePaths[2], "keyboard ArrowDown did not move to next row");
keyboardSelection = moveFilesKeyboardSelection(keyboardSelection.selectedPath, visiblePaths, "ArrowUp");
assert(keyboardSelection.selectedPath === visiblePaths[1], "keyboard ArrowUp did not move to previous row");
keyboardSelection = moveFilesKeyboardSelection(visiblePaths[1], visiblePaths, "Home");
assert(keyboardSelection.selectedPath === visiblePaths[0], "keyboard Home did not move to first row");
keyboardSelection = moveFilesKeyboardSelection(visiblePaths[1], visiblePaths, "End");
assert(keyboardSelection.selectedPath === visiblePaths[3], "keyboard End did not move to last row");
keyboardSelection = moveFilesKeyboardSelection("/missing", visiblePaths, "ArrowDown");
assert(keyboardSelection.selectedPath === visiblePaths[0], "keyboard selection without current row did not recover to first row");

let history = recordFilesOperationHistory([], {
  id: "op-1",
  label: "Import",
  status: "complete",
  detail: `${imported.length} files`,
  done: imported.length,
  total: imported.length,
  finishedAt: "2026-05-04T00:00:00.000Z",
});
history = recordFilesOperationHistory(history, {
  id: "op-2",
  label: "Move",
  status: "error",
  error: "Cannot move a folder into itself",
  finishedAt: "2026-05-04T00:01:00.000Z",
}, { limit: 2 });
history = recordFilesOperationHistory(history, {
  id: "op-3",
  label: "Export",
  status: "complete",
  detail: sourceRoot,
  finishedAt: "2026-05-04T00:02:00.000Z",
}, { limit: 2 });
assert(history.length === 2, `expected operation history limit 2, got ${history.length}`);
assert(history[0].id === "op-3", "operation history did not put newest item first");
assert(history[1].id === "op-2", "operation history did not evict oldest item");
assert(history[1].status === "error", "operation history lost error status");
assert(history[1].detail === "Cannot move a folder into itself", "operation history lost error detail");

console.log(`files import/export smoke ok entries=${entries.length} binaryBytes=${binary.byteLength} history=${history.length}`);

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const system = permissions.systemPrincipal();
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  fs.createDirectory("/home/guest/Documents", "/", { owner: "guest", group: "users" }, system);
  return {
    fs,
    permissions,
    session: { user: "guest", groups: ["users"], home: "/home/guest" },
  };
}

function assertBytes(actual, expected, message) {
  assert(actual.byteLength === expected.byteLength, `${message}: length ${actual.byteLength} !== ${expected.byteLength}`);
  for (let index = 0; index < expected.byteLength; index += 1) {
    assert(actual[index] === expected[index], `${message}: byte ${index} ${actual[index]} !== ${expected[index]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
