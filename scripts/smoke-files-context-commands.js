import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { executeFilesContextCommand, readFilesTags, remapFilesTags, forgetFilesTags } from "../src/dindbos/apps/files-context-commands.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { normalizeAppManifest } from "../src/dindbos/app-manifest.js";

const permissions = new PermissionPolicy();
const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
const system = permissions.systemPrincipal();
for (const path of ["/home", "/home/guest", "/home/guest/Documents", "/home/guest/Documents/사진", "/home/guest/Documents/사진/empty", "/secret"]) fs.createDirectory(path, "/", { owner: "guest", group: "users" }, system);
const bytes = new Uint8Array([0, 1, 127, 128, 255]);
fs.writeOrCreateFileBytes("/home/guest/Documents/사진/payload.bin", bytes, "/", {}, system);
fs.writeOrCreateFile("/home/guest/Documents/notes.txt", "Hello ZIP\n", "/", {}, system);
fs.writeOrCreateFile("/secret/private.txt", "do not read", "/", {}, system);
const raw = { fs, permissions, session: { user: "guest", groups: ["users"], home: "/home/guest" }, localMounts: { isMountedPath: () => false } };
const app = { id: "files-context-smoke", fileSystem: { read: ["/home/guest"], write: ["/home/guest"] } };
const os = new AppSandbox(raw, { appId: app.id, user: "guest", groups: ["users"], cwd: "/home/guest", manifest: normalizeAppManifest(app) });
const directory = "/home/guest/Documents";
const folder = `${directory}/사진`;
const text = `${directory}/notes.txt`;
const result = await executeFilesContextCommand(os, directory, folder, "compress");
assert.equal(result.selectedPath, `${folder}.zip`);
const zipped = fs.readFileBytes(result.selectedPath);
const python = spawnSync("python3", ["-c", `import sys,io,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
 assert archive.testzip() is None
 assert set(archive.namelist()) == {'사진/','사진/empty/','사진/payload.bin'}
 assert archive.read('사진/payload.bin') == bytes([0,1,127,128,255])
 assert all(item.compress_type == zipfile.ZIP_STORED for item in archive.infolist())
`], { input: zipped });
assert.equal(python.status, 0, python.stderr.toString());
assert.equal((await executeFilesContextCommand(os, directory, folder, "compress")).selectedPath, `${folder} 2.zip`);
const multi = await executeFilesContextCommand(os, directory, text, "compress", { selectedPaths: [text, folder] });
assert.equal(multi.selectedPath, `${directory}/Archive.zip`);
await assert.rejects(() => executeFilesContextCommand(os, directory, "/secret/private.txt", "compress"), /sandbox denied/);
assert.equal(fs.exists("/secret/private.txt.zip"), false);
fs.createSymlink("/secret/private.txt", `${folder}/external-link`, "/", {}, system);
await assert.rejects(() => executeFilesContextCommand(os, directory, folder, "compress"), /alias/);
assert.equal(fs.exists(`${folder} 3.zip`), false);
await assert.rejects(() => executeFilesContextCommand(os, directory, text, "make-alias"), /unavailable/);
const abort = new AbortController(); abort.abort();
await assert.rejects(() => executeFilesContextCommand(os, directory, text, "compress", { reporter: { signal: abort.signal } }), { name: "AbortError" });
await executeFilesContextCommand(os, directory, text, "tag:red");
assert.deepEqual(readFilesTags(os, text), ["red"]);
await executeFilesContextCommand(os, directory, folder, "tag:blue");
assert.deepEqual(readFilesTags(os, text), ["red"]);
await executeFilesContextCommand(os, directory, text, "tag:red");
assert.deepEqual(readFilesTags(os, text), []);
await executeFilesContextCommand(os, directory, text, "tag:green", { selectedPaths: [text, folder] });
assert.deepEqual(readFilesTags(os, folder), ["blue", "green"]);
await executeFilesContextCommand(os, directory, folder, "tag:none");
assert.deepEqual(readFilesTags(os, folder), []);
await executeFilesContextCommand(os, directory, `${folder}/payload.bin`, "tag:blue");
await executeFilesContextCommand(os, directory, folder, "tag:yellow");
const renamed = `${directory}/Renamed`;
os.fs.move(folder, renamed);
remapFilesTags(os, folder, renamed);
assert.deepEqual(readFilesTags(os, renamed), ["yellow"]);
assert.deepEqual(readFilesTags(os, `${renamed}/payload.bin`), ["blue"]);
assert.deepEqual(readFilesTags(os, folder), []);
const moved = "/home/guest/Moved Folder";
os.fs.move(renamed, moved);
remapFilesTags(os, renamed, moved);
assert.deepEqual(readFilesTags(os, `${moved}/payload.bin`), ["blue"]);
assert.deepEqual(readFilesTags(os, text), ["green"]);
os.fs.remove(moved, "/", { recursive: true });
forgetFilesTags(os, moved);
assert.deepEqual(readFilesTags(os, `${moved}/payload.bin`), []);
const store = "/home/guest/.config/dindbos/file-tags.json";
fs.writeFile(store, "original invalid data");
await assert.rejects(() => executeFilesContextCommand(os, directory, text, "tag:red"), /original data was preserved/);
assert.equal(fs.readFile(store), "original invalid data");
assert.equal(await executeFilesContextCommand(os, directory, text, "unknown-command"), null);
console.log("Files context commands smoke passed: interoperable UTF-8 binary ZIP, empty folders, unique/multi selection, permissions, alias/cancel rejection and persistent tags through rename/move/delete");
