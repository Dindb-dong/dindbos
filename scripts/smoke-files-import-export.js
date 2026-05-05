#!/usr/bin/env node
import {
  assertFilesOperationActive,
  buildFilesDiagnostics,
  collectExportEntries,
  copyPathIntoDirectory,
  createFilesOperationScheduler,
  filesActionTargets,
  importDroppedFiles,
  limitFilesColumnEntries,
  movePathIntoDirectory,
  moveFilesKeyboardSelection,
  parseFilesSearchQuery,
  recordFilesOperationHistory,
  resolveFilesConflict,
  resolveFilesExportName,
  searchFileEntries,
  sortFilesEntries,
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

const abortController = new AbortController();
let abortSteps = 0;
await assertRejects(
  () => collectExportEntries(os, sourceRoot, {
    signal: abortController.signal,
    step: () => {
      abortSteps += 1;
      abortController.abort();
    },
  }),
  "Files operation cancelled",
);
assert(abortSteps === 1, `expected export cancellation after first step, got ${abortSteps}`);
await assertRejects(
  () => assertFilesOperationActive(abortController.signal),
  "Files operation cancelled",
);

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

const quotaUploadOs = bootOs();
const quotaUploadReservations = [];
quotaUploadOs.storage = {
  reserveStorageBytes(bytes, details = {}) {
    quotaUploadReservations.push({ bytes, details });
    throw new Error("storage quota exceeded: upload refused");
  },
};
quotaUploadOs.fs.writeOrCreateFile("/home/guest/Documents/quota.txt", "existing", "/", { mime: "text/plain" });
await assertRejects(
  () => importDroppedFiles(quotaUploadOs, "/home/guest/Documents", [fileLike("quota.txt", "replacement")], null, {
    conflictPolicy: "replace",
  }),
  "storage quota exceeded",
);
assert(quotaUploadReservations.length === 1 && quotaUploadReservations[0].details.scope === "files-import", "file import did not reserve quota before mutation");
assert(quotaUploadOs.fs.readFile("/home/guest/Documents/quota.txt") === "existing", "quota-denied file import replaced an existing file");

os.fs.createDirectory("/home/guest/Documents/import-scheduled");
const importSchedulerReporter = operationReporter("Scheduled Import");
importSchedulerReporter.scheduler = createFilesOperationScheduler({
  stepInterval: 1,
  intervalMs: 0,
  yield: async () => {
    importSchedulerReporter.yields += 1;
  },
});
await importDroppedFiles(os, "/home/guest/Documents/import-scheduled", [archiveFile], importSchedulerReporter);
assert(importSchedulerReporter.yields >= 3, `large import did not yield often enough: ${importSchedulerReporter.yields}`);
assertBytes(os.fs.readFileBytes("/home/guest/Documents/import-scheduled/nested/payload.bin"), binary, "scheduled import binary bytes changed");

const archiveNote = entries.find((entry) => entry.path === "note.txt");
assert(archiveNote, "archive note fixture missing");
const archiveNestedEntries = entries.filter((entry) => entry.path !== "note.txt");
const atomicArchiveFile = archiveFileWithEntries([archiveNote, ...archiveNestedEntries]);
const quotaArchiveOs = bootOs();
const quotaArchiveReservations = [];
quotaArchiveOs.storage = {
  reserveStorageBytes(bytes, details = {}) {
    quotaArchiveReservations.push({ bytes, details });
    throw new Error("storage quota exceeded: archive refused");
  },
};
await assertRejects(
  () => importDroppedFiles(quotaArchiveOs, "/home/guest/Documents", [atomicArchiveFile]),
  "storage quota exceeded",
);
assert(quotaArchiveReservations.length === 1 && quotaArchiveReservations[0].details.source === "archive", "archive import did not reserve quota before staging");
assert(!quotaArchiveOs.fs.exists("/home/guest/Documents/note.txt"), "quota-denied archive import wrote target file");
assert(!quotaArchiveOs.fs.exists("/tmp/dindbos/archive-import-staging"), "quota-denied archive import created staging directory");
const atomicRoot = "/home/guest/Documents/import-atomic";
os.fs.createDirectory(atomicRoot);
os.fs.writeOrCreateFile(`${atomicRoot}/note.txt`, "atomic existing", "/", { mime: "text/plain" });
await assertRejects(
  () => importDroppedFiles(os, atomicRoot, [atomicArchiveFile], null, {
    conflictPolicy: "prompt",
    resolveConflict: () => "replace",
    afterArchiveCommitStep: () => {
      throw new Error("archive activation failed");
    },
  }),
  "archive activation failed",
);
assert(os.fs.readFile(`${atomicRoot}/note.txt`) === "atomic existing", "failed archive activation changed existing file");
assert(!os.fs.exists(`${atomicRoot}/nested/payload.bin`), "failed archive activation left a nested file behind");
assert(
  !os.fs.exists("/tmp/dindbos/archive-import-staging") || os.fs.list("/tmp/dindbos/archive-import-staging").length === 0,
  "failed archive activation left staging roots behind",
);
const atomicImported = await importDroppedFiles(os, atomicRoot, [atomicArchiveFile], null, {
  conflictPolicy: "prompt",
  resolveConflict: () => "replace",
});
assert(atomicImported.includes(`${atomicRoot}/note.txt`), "atomic archive import missing replaced note path");
assert(atomicImported.includes(`${atomicRoot}/nested/payload.bin`), "atomic archive import missing nested path");
assert(os.fs.readFile(`${atomicRoot}/note.txt`) === text, "atomic archive import did not replace note after successful activation");
assertBytes(os.fs.readFileBytes(`${atomicRoot}/nested/payload.bin`), binary, "atomic archive import changed nested binary bytes");

os.fs.createDirectory("/home/guest/Documents/large-source");
os.fs.createDirectory("/home/guest/Documents/large-source/nested");
os.fs.createDirectory("/home/guest/Documents/large-target");
for (let index = 0; index < 6; index += 1) {
  os.fs.writeOrCreateFile(`/home/guest/Documents/large-source/nested/file-${index}.txt`, `large-${index}`, "/", { mime: "text/plain" });
}
const schedulerReporter = operationReporter("Large Copy");
schedulerReporter.scheduler = createFilesOperationScheduler({
  stepInterval: 1,
  intervalMs: 0,
  yield: async () => {
    schedulerReporter.yields += 1;
  },
});
await copyPathIntoDirectory(
  os,
  "/home/guest/Documents/large-source",
  "/home/guest/Documents/large-target",
  schedulerReporter,
  { conflictPolicy: "rename" },
);
assert(schedulerReporter.yields >= 3, `large copy did not yield often enough: ${schedulerReporter.yields}`);
assert(os.fs.readFile("/home/guest/Documents/large-target/large-source/nested/file-5.txt") === "large-5", "large scheduled copy lost nested file bytes");

os.fs.createDirectory("/home/guest/Documents/conflicts");
os.fs.createDirectory("/home/guest/Documents/conflicts/source");
os.fs.createDirectory("/home/guest/Documents/conflicts/target");
os.fs.writeOrCreateFile("/home/guest/Documents/conflicts/source/note.txt", "copy source", "/", { mime: "text/plain" });
os.fs.writeOrCreateFile("/home/guest/Documents/conflicts/target/note.txt", "copy existing", "/", { mime: "text/plain" });
const renamedCopy = await copyPathIntoDirectory(
  os,
  "/home/guest/Documents/conflicts/source/note.txt",
  "/home/guest/Documents/conflicts/target",
  null,
  { conflictPolicy: "rename" },
);
assert(renamedCopy === "/home/guest/Documents/conflicts/target/note-2.txt", `copy rename path mismatch: ${renamedCopy}`);
assert(os.fs.readFile("/home/guest/Documents/conflicts/target/note.txt") === "copy existing", "copy rename overwrote existing file");
assert(os.fs.readFile(renamedCopy) === "copy source", "copy rename did not preserve source bytes");

os.fs.writeOrCreateFile("/home/guest/Documents/conflicts/source/replace.txt", "copy replacement", "/", { mime: "text/plain" });
os.fs.writeOrCreateFile("/home/guest/Documents/conflicts/target/replace.txt", "copy old", "/", { mime: "text/plain" });
const replacedCopy = await copyPathIntoDirectory(
  os,
  "/home/guest/Documents/conflicts/source/replace.txt",
  "/home/guest/Documents/conflicts/target",
  null,
  { conflictPolicy: "replace" },
);
assert(replacedCopy === "/home/guest/Documents/conflicts/target/replace.txt", "copy replace path mismatch");
assert(os.fs.readFile(replacedCopy) === "copy replacement", "copy replace did not overwrite target");

os.fs.writeOrCreateFile("/home/guest/Documents/conflicts/source/skip.txt", "move source", "/", { mime: "text/plain" });
os.fs.writeOrCreateFile("/home/guest/Documents/conflicts/target/skip.txt", "move existing", "/", { mime: "text/plain" });
const skippedMove = await movePathIntoDirectory(
  os,
  "/home/guest/Documents/conflicts/source/skip.txt",
  "/home/guest/Documents/conflicts/target",
  null,
  { conflictPolicy: "skip" },
);
assert(skippedMove === null, "move skip should return null");
assert(os.fs.exists("/home/guest/Documents/conflicts/source/skip.txt"), "move skip removed the source");
assert(os.fs.readFile("/home/guest/Documents/conflicts/target/skip.txt") === "move existing", "move skip changed existing target");

const promptConflict = await resolveFilesConflict(os, "/home/guest/Documents/conflicts/target/note.txt", {
  conflictPolicy: "prompt",
  resolveConflict: () => "rename:manual-name.txt",
});
assert(promptConflict.action === "rename", "prompt conflict did not normalize rename action");
assert(promptConflict.path === "/home/guest/Documents/conflicts/target/manual-name.txt", "prompt conflict custom rename path mismatch");

const skippedUpload = await importDroppedFiles(os, importRoot, [fileLike("note.txt", "skipped upload")], null, {
  conflictPolicy: "prompt",
  resolveConflict: () => "skip",
});
assert(skippedUpload.length === 0, "import skip should not return imported paths");
assert(os.fs.readFile(`${importRoot}/note.txt`) === text, "import skip overwrote existing import target");
const renamedUpload = await importDroppedFiles(os, importRoot, [fileLike("note.txt", "renamed upload")], null, {
  conflictPolicy: "prompt",
  resolveConflict: () => "rename:uploaded-note.txt",
});
assert(renamedUpload[0] === `${importRoot}/uploaded-note.txt`, "import prompt rename path mismatch");
assert(os.fs.readFile(`${importRoot}/uploaded-note.txt`) === "renamed upload", "import prompt rename content mismatch");
const replacedUpload = await importDroppedFiles(os, importRoot, [fileLike("note.txt", "replaced upload")], null, {
  conflictPolicy: "prompt",
  resolveConflict: () => "replace",
});
assert(replacedUpload[0] === `${importRoot}/note.txt`, "import prompt replace path mismatch");
assert(os.fs.readFile(`${importRoot}/note.txt`) === "replaced upload", "import prompt replace content mismatch");
assert(resolveFilesExportName("source.dindbos-export.json", {
  conflictPolicy: "prompt",
  resolveExportName: () => "renamed-export.json",
}) === "renamed-export.json", "export filename dialog result mismatch");

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
const limitedSearchRoot = "/home/guest/Documents/search-limit";
os.fs.createDirectory(limitedSearchRoot);
for (let index = 0; index < 20; index += 1) {
  os.fs.writeOrCreateFile(`${limitedSearchRoot}/match-${index}.txt`, `match-${index}`, "/", { mime: "text/plain" });
}
const limitedResults = searchFileEntries(os, limitedSearchRoot, "match", { limit: 6 });
assert(limitedResults.length === 6, `limited search expected 6 entries, got ${limitedResults.length}`);
os.fs.createDirectory(`${sourceRoot}/aaa-folder`);
os.fs.writeOrCreateFile(`${sourceRoot}/zeta.txt`, "z", "/", { mime: "text/plain" });
os.fs.writeOrCreateFileBytes(`${sourceRoot}/big.bin`, new Uint8Array(128), "/", { mime: "application/octet-stream" });
os.fs.writeOrCreateFile(`${sourceRoot}/fresh.txt`, "fresh", "/", { mime: "text/plain" });
os.fs.resolve(`${sourceRoot}/fresh.txt`).modified = "2099-01-01T00:00:00.000Z";
const sortEntries = os.fs.list(sourceRoot);
const kindSorted = sortFilesEntries(os, sortEntries, "kind-name").map((entry) => entry.name);
assert(kindSorted.indexOf("aaa-folder") < kindSorted.indexOf("big.bin"), "kind sort did not keep folders before files");
const nameSorted = sortFilesEntries(os, sortEntries, "name").map((entry) => entry.name);
assert(nameSorted.indexOf("aaa-folder") < nameSorted.indexOf("big.bin"), "name sort did not sort alphabetically");
const sizeSorted = sortFilesEntries(os, sortEntries, "size").map((entry) => entry.name);
assert(sizeSorted[0] === "big.bin", `size sort did not put largest file first: ${sizeSorted.join(",")}`);
const modifiedSorted = sortFilesEntries(os, sortEntries, "modified").map((entry) => entry.name);
assert(modifiedSorted[0] === "fresh.txt", `modified sort did not put newest file first: ${modifiedSorted.join(",")}`);
const cappedEntries = Array.from({ length: 12 }, (_, index) => ({
  path: `${sourceRoot}/cap-${index}.txt`,
  name: `cap-${index}.txt`,
}));
const cappedColumn = limitFilesColumnEntries(cappedEntries, `${sourceRoot}/cap-10.txt`, 5);
assert(cappedColumn.capped === true, "column cap did not mark capped result");
assert(cappedColumn.entries.length === 5, `column cap expected 5 visible entries, got ${cappedColumn.entries.length}`);
assert(cappedColumn.total === 12 && cappedColumn.hidden === 7, "column cap counts mismatch");
assert(cappedColumn.entries.some((entry) => entry.path.endsWith("cap-10.txt")), "column cap did not preserve selected entry");
const uncappedColumn = limitFilesColumnEntries(cappedEntries.slice(0, 3), "", 5);
assert(uncappedColumn.capped === false && uncappedColumn.entries.length === 3, "column cap changed uncapped entries");

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
history = recordFilesOperationHistory(history, {
  id: "op-4",
  label: "Copy",
  status: "cancelled",
  detail: "Cancelled",
  finishedAt: "2026-05-04T00:03:00.000Z",
}, { limit: 2 });
assert(history.length === 2, `expected operation history limit 2, got ${history.length}`);
assert(history[0].id === "op-4", "operation history did not put cancelled item first");
assert(history[0].status === "cancelled", "operation history lost cancelled status");
assert(history[1].id === "op-3", "operation history did not evict older items after cancellation");

const largeDiagnosticsRoot = "/home/guest/Documents/diagnostics";
os.fs.createDirectory(largeDiagnosticsRoot);
for (let index = 0; index < 151; index += 1) {
  os.fs.writeOrCreateFile(`${largeDiagnosticsRoot}/item-${index}.txt`, `item-${index}`, "/", { mime: "text/plain" });
}
let diagnostics = buildFilesDiagnostics(os, largeDiagnosticsRoot, [
  `${largeDiagnosticsRoot}/item-1.txt`,
  `${largeDiagnosticsRoot}/item-2.txt`,
], []);
assert(diagnostics.items === 151, `diagnostics item count mismatch: ${diagnostics.items}`);
assert(diagnostics.files === 151, `diagnostics file count mismatch: ${diagnostics.files}`);
assert(diagnostics.selected === 2, `diagnostics selection count mismatch: ${diagnostics.selected}`);
assert(diagnostics.advice.includes("search filters"), `large folder advice mismatch: ${diagnostics.advice}`);

diagnostics = buildFilesDiagnostics(
  os,
  "/mnt/disk",
  ["/mnt/disk/note.txt"],
  history,
  { label: "Sync", status: "error", error: "local mount sync conflict" },
  { path: "/mnt/disk", status: "conflict", conflicts: [{ path: "/mnt/disk/note.txt" }] },
);
assert(diagnostics.localMountActive === true, "diagnostics did not mark local mount path active");
assert(diagnostics.conflicts === 1, `diagnostics conflict count mismatch: ${diagnostics.conflicts}`);
assert(diagnostics.lastStatus === "error", `diagnostics last status mismatch: ${diagnostics.lastStatus}`);
assert(diagnostics.advice.includes("Resolve local mount sync conflicts"), `conflict advice mismatch: ${diagnostics.advice}`);

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
    storage: {
      reserveStorageBytes: () => true,
    },
    localMounts: {
      isMountedPath: (path) => String(path || "").startsWith("/mnt/disk"),
      conflictStatus: () => [{ path: "/mnt/disk/note.txt" }],
    },
  };
}

function assertBytes(actual, expected, message) {
  assert(actual.byteLength === expected.byteLength, `${message}: length ${actual.byteLength} !== ${expected.byteLength}`);
  for (let index = 0; index < expected.byteLength; index += 1) {
    assert(actual[index] === expected[index], `${message}: byte ${index} ${actual[index]} !== ${expected[index]}`);
  }
}

function fileLike(name, content, type = "text/plain") {
  const bytes = new TextEncoder().encode(content);
  return {
    name,
    size: bytes.byteLength,
    type,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function archiveFileWithEntries(archiveEntries) {
  return {
    name: "atomic-export.dindbos-export.json",
    async text() {
      return JSON.stringify({
        kind: "dindbos-export-v1",
        exportedAt: new Date().toISOString(),
        root: sourceRoot,
        entries: archiveEntries,
      });
    },
  };
}

function operationReporter(label) {
  return {
    label,
    signal: null,
    scheduler: null,
    started: false,
    state: null,
    yields: 0,
    start(total = 0, detail = "") {
      this.started = true;
      this.state = { label: this.label, total, done: 0, detail, status: "running" };
    },
    step(detail = "", increment = 1) {
      if (!this.started) this.start(0, detail);
      this.state.done += increment;
      this.state.detail = detail || this.state.detail;
    },
    progress(operation = {}) {
      if (!this.started) this.start(operation.total || 0, operation.detail || "");
      this.state = { ...this.state, ...operation };
    },
    complete(detail = "Complete") {
      if (!this.started) this.start(1, detail);
      this.state.status = "complete";
      this.state.detail = detail;
      return this.state;
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejects(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected rejection: ${error.message}`);
  }
  throw new Error(`expected rejection containing ${expectedMessage}`);
}
