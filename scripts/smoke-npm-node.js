#!/usr/bin/env node
import { NodeCompat } from "../src/dindbos/node-compat.js";
import { NpmInstaller } from "../src/dindbos/npm-installer.js";
import { PermissionPolicy } from "../src/dindbos/permission-policy.js";
import { RuntimeCacheStore } from "../src/dindbos/cache-store.js";
import { VirtualFileSystem } from "../src/dindbos/vfs.js";
import { gzipSync } from "node:zlib";

const cwd = "/home/guest/Documents/npm-smoke";
const os = bootOs();
const installer = new NpmInstaller(os);
const node = new NodeCompat(os);

const records = await installer.install(["is-number@7.0.0"], cwd, { maxPackages: 8 });
assert(records.length === 1, `expected 1 installed package, got ${records.length}`);
assert(records[0].name === "is-number", `unexpected package name: ${records[0].name}`);
assert(records[0].version === "7.0.0", `unexpected package version: ${records[0].version}`);
assert(os.fs.exists(`${cwd}/node_modules/is-number/package.json`), "package.json was not installed");
assert(os.fs.exists(`${cwd}/package-lock.json`), "package-lock.json was not written");

const commonjs = node.evaluate(
  "const isNumber = require('is-number'); console.log(isNumber(7), isNumber({}));",
  cwd,
);
assert(commonjs.status === 0, `CommonJS exited with ${commonjs.status}`);
assert(commonjs.output.trim() === "true false", `unexpected CommonJS output: ${commonjs.output}`);

const esm = await node.evaluate(
  "import isNumber from 'is-number'; console.log(isNumber(7), isNumber({}));",
  cwd,
  { inputType: "module" },
);
assert(esm.status === 0, `ESM exited with ${esm.status}`);
assert(esm.output.trim() === "true false", `unexpected ESM output: ${esm.output}`);

writeFixtureFiles(os);

const cjsFile = node.runFile("./direct.cjs", cwd);
assert(cjsFile.status === 0, `.cjs exited with ${cjsFile.status}`);
assert(cjsFile.output.trim() === "direct-cjs", `unexpected .cjs output: ${cjsFile.output}`);

const mjsFile = await node.runFile("./direct.mjs", cwd);
assert(mjsFile.status === 0, `.mjs exited with ${mjsFile.status}`);
assert(mjsFile.output.trim() === "direct-mjs", `unexpected .mjs output: ${mjsFile.output}`);

const typeModule = await node.runFile("./type-module/app.js", cwd);
assert(typeModule.status === 0, `type=module app exited with ${typeModule.status}`);
assert(typeModule.output.trim() === "type-module-json", `unexpected type=module output: ${typeModule.output}`);

const requireExports = node.evaluate("const pkg = require('exports-pkg'); console.log(pkg.mode);", cwd);
assert(requireExports.status === 0, `exports require exited with ${requireExports.status}`);
assert(requireExports.output.trim() === "cjs", `unexpected exports require output: ${requireExports.output}`);

const importExports = await node.evaluate("import pkg from 'exports-pkg'; console.log(pkg.mode);", cwd, { inputType: "module" });
assert(importExports.status === 0, `exports import exited with ${importExports.status}`);
assert(importExports.output.trim() === "esm", `unexpected exports import output: ${importExports.output}`);

const requireSubpathExports = node.evaluate("const feature = require('exports-pkg/feature'); const fallback = require('exports-pkg/fallback'); console.log(feature.mode, fallback.mode);", cwd);
assert(requireSubpathExports.status === 0, `subpath exports require exited with ${requireSubpathExports.status}`);
assert(requireSubpathExports.output.trim() === "feature-cjs fallback-default", `unexpected subpath exports require output: ${requireSubpathExports.output}`);

const importSubpathExports = await node.evaluate([
  "import feature from 'exports-pkg/feature';",
  "import fallback from 'exports-pkg/fallback';",
  "console.log(feature.mode, fallback.mode);",
].join("\n"), cwd, { inputType: "module" });
assert(importSubpathExports.status === 0, `subpath exports import exited with ${importSubpathExports.status}`);
assert(importSubpathExports.output.trim() === "feature-esm fallback-default", `unexpected subpath exports import output: ${importSubpathExports.output}`);

const reexportModule = await node.runFile("./reexport/consumer.mjs", cwd);
assert(reexportModule.status === 0, `re-export module exited with ${reexportModule.status}`);
assert(reexportModule.output.trim() === "core-value default-value default-value", `unexpected re-export output: ${reexportModule.output}`);

const richEsmModule = await node.runFile("./esm-rich/consumer.mjs", cwd);
assert(richEsmModule.status === 0, `rich ESM module exited with ${richEsmModule.status}`);
assert(richEsmModule.output.trim() === "alpha-value beta-value extra-value alpha-value beta-value", `unexpected rich ESM output: ${richEsmModule.output}`);

const nestedConflict = node.evaluate("const left = require('left'); const shared = require('shared'); console.log(left.shared, shared.name);", cwd);
assert(nestedConflict.status === 0, `nested conflict exited with ${nestedConflict.status}`);
assert(nestedConflict.output.trim() === "nested root", `unexpected nested conflict output: ${nestedConflict.output}`);

const eventsRequire = node.evaluate(
  "const { EventEmitter } = require('events'); const ee = new EventEmitter(); let total = 0; ee.on('tick', (n) => total += n); ee.once('tick', (n) => total += n * 10); ee.emit('tick', 2); ee.emit('tick', 3); console.log(total, ee.listenerCount('tick'));",
  cwd,
);
assert(eventsRequire.status === 0, `events require exited with ${eventsRequire.status}`);
assert(eventsRequire.output.trim() === "25 1", `unexpected events require output: ${eventsRequire.output}`);

const nodeEventsRequire = node.evaluate(
  "const events = require('node:events'); const ee = new events.EventEmitter(); ee.on('ready', () => console.log('node-events-ready')); ee.emit('ready');",
  cwd,
);
assert(nodeEventsRequire.status === 0, `node:events require exited with ${nodeEventsRequire.status}`);
assert(nodeEventsRequire.output.trim() === "node-events-ready", `unexpected node:events output: ${nodeEventsRequire.output}`);

const eventsImport = await node.evaluate(
  "import { EventEmitter } from 'events'; const ee = new EventEmitter(); ee.on('esm', (value) => console.log(value)); ee.emit('esm', 'events-esm');",
  cwd,
  { inputType: "module" },
);
assert(eventsImport.status === 0, `events import exited with ${eventsImport.status}`);
assert(eventsImport.output.trim() === "events-esm", `unexpected events import output: ${eventsImport.output}`);

const browserSafeBuiltins = node.evaluate(
  "const { URL, pathToFileURL, fileURLToPath, parse, format, resolve } = require('url'); const util = require('node:util'); const timers = require('timers'); const u = new URL('/docs?q=1', 'https://dindbos.local'); const legacy = parse('https://example.com/docs?q=1#top', true); console.log(u.pathname, u.searchParams.get('q'), fileURLToPath(pathToFileURL('/home/guest/a b.txt')), util.format('%s:%d', 'v', 7), typeof timers.setTimeout, legacy.hostname, legacy.query.q, format({ protocol: 'https', host: 'example.com', pathname: '/a', query: { b: 2 } }), resolve('/docs/a/', '../b'));",
  cwd,
);
assert(browserSafeBuiltins.status === 0, `browser-safe builtins exited with ${browserSafeBuiltins.status}`);
assert(browserSafeBuiltins.output.trim() === "/docs 1 /home/guest/a b.txt v:7 function example.com 1 https://example.com/a?b=2 /docs/b", `unexpected browser-safe builtins output: ${browserSafeBuiltins.output}`);

const pathPosixRequire = node.evaluate(
  "const posix = require('path/posix'); const path = require('path'); console.log(posix.join('/tmp', 'dindbos'), posix.basename('/tmp/file.txt'), path.posix === posix);",
  cwd,
);
assert(pathPosixRequire.status === 0, `path/posix require exited with ${pathPosixRequire.status}`);
assert(pathPosixRequire.output.trim() === "/tmp/dindbos file.txt true", `unexpected path/posix require output: ${pathPosixRequire.output}`);

const pathWin32Require = node.evaluate(
  "const win32 = require('path/win32'); const path = require('path'); console.log(win32.join('C:/tmp', 'dindbos'), win32.basename('C:/tmp/file.txt'), win32.dirname('C:/tmp/file.txt'), win32.extname('file.txt'), win32.isAbsolute('C:/tmp'), path.win32 === win32);",
  cwd,
);
assert(pathWin32Require.status === 0, `path/win32 require exited with ${pathWin32Require.status}`);
assert(pathWin32Require.output.trim() === "C:\\tmp\\dindbos file.txt C:\\tmp .txt true true", `unexpected path/win32 require output: ${pathWin32Require.output}`);

const builtinImport = await node.evaluate(
  [
    "import { URL, parse, format as urlFormat, resolve } from 'node:url';",
    "import { format } from 'util';",
    "import { setTimeout } from 'timers';",
    "const legacy = parse('/relative/path?x=1');",
    "console.log(new URL('https://dindbos.local/runtime').hostname, format('%s-%d', 'ok', 2), typeof setTimeout, legacy.pathname, resolve('https://example.com/a/b', './c'), urlFormat({ pathname: '/x', query: 'y=1' }));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(builtinImport.status === 0, `builtin import exited with ${builtinImport.status}`);
assert(builtinImport.output.trim() === "dindbos.local ok-2 function /relative/path https://example.com/a/c /x?y=1", `unexpected builtin import output: ${builtinImport.output}`);

const pathPosixImport = await node.evaluate(
  [
    "import posix, { dirname } from 'node:path/posix';",
    "console.log(dirname('/home/guest/readme.md'), posix.extname('readme.md'));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(pathPosixImport.status === 0, `path/posix import exited with ${pathPosixImport.status}`);
assert(pathPosixImport.output.trim() === "/home/guest .md", `unexpected path/posix import output: ${pathPosixImport.output}`);

const pathWin32Import = await node.evaluate(
  [
    "import win32, { relative } from 'node:path/win32';",
    "console.log(win32.normalize('C:/tmp/../app/file.md'), relative('C:/tmp/app', 'C:/tmp/app/nested/file.md'));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(pathWin32Import.status === 0, `path/win32 import exited with ${pathWin32Import.status}`);
assert(pathWin32Import.output.trim() === "C:\\app\\file.md nested\\file.md", `unexpected path/win32 import output: ${pathWin32Import.output}`);

const fsPromisesRequire = node.evaluate(
  "const fs = require('fs'); console.log(typeof fs.promises.readFile, typeof fs.promises.readdir, typeof fs.promises.stat, typeof fs.promises.fsync);",
  cwd,
);
assert(fsPromisesRequire.status === 0, `fs promises require exited with ${fsPromisesRequire.status}`);
assert(fsPromisesRequire.output.trim() === "function function function function", `unexpected fs promises require output: ${fsPromisesRequire.output}`);

const fsPromisesImport = await node.evaluate(
  [
    "import { promises as fs } from 'node:fs';",
    "await fs.mkdir('./async-dir', { recursive: true });",
    "await fs.writeFile('./async-dir/note.txt', 'async note');",
    "const text = await fs.readFile('./async-dir/note.txt', 'utf8');",
    "const entries = await fs.readdir('./async-dir');",
    "const stat = await fs.stat('./async-dir/note.txt');",
    "await fs.access('./async-dir/note.txt');",
    "await fs.rm('./async-dir/note.txt');",
    "console.log(text, entries[0], stat.isFile(), await fs.readdir('./async-dir'));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsPromisesImport.status === 0, `fs promises import exited with ${fsPromisesImport.status}`);
assert(fsPromisesImport.output.trim() === "async note note.txt true []", `unexpected fs promises import output: ${fsPromisesImport.output}`);

const beforePromiseFsyncFlushes = os.storageFlushes;
const fsPromisesFsyncImport = await node.evaluate(
  [
    "import { promises as fs } from 'node:fs';",
    "await fs.writeFile('./async-sync.txt', 'sync me');",
    "await fs.fsync(1);",
    "await fs.fdatasync(1);",
    "console.log('synced', await fs.readFile('./async-sync.txt', 'utf8'));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsPromisesFsyncImport.status === 0, `fs promises fsync import exited with ${fsPromisesFsyncImport.status}`);
assert(fsPromisesFsyncImport.output.trim() === "synced sync me", `unexpected fs promises fsync output: ${fsPromisesFsyncImport.output}`);
assert(os.storageFlushes === beforePromiseFsyncFlushes + 2, "fs.promises fsync/fdatasync did not reach storage barrier");

const fsCallbacksRequire = node.evaluate(
  [
    "const fs = require('fs');",
    "fs.mkdir('./cb-dir', { recursive: true }, (mkdirErr) => {",
    "  if (mkdirErr) throw mkdirErr;",
    "  fs.writeFile('./cb-dir/note.txt', 'callback note', (writeErr) => {",
    "    if (writeErr) throw writeErr;",
    "    fs.readFile('./cb-dir/note.txt', 'utf8', (readErr, text) => {",
    "      if (readErr) throw readErr;",
    "      fs.readdir('./cb-dir', (listErr, entries) => {",
    "        if (listErr) throw listErr;",
    "        fs.stat('./cb-dir/note.txt', (statErr, stat) => {",
    "          if (statErr) throw statErr;",
    "          fs.access('./cb-dir/note.txt', fs.constants.R_OK, (okErr) => {",
    "            if (okErr) throw okErr;",
    "            fs.access('./cb-dir/missing.txt', fs.constants.F_OK, (accessErr) => console.log(text, entries[0], stat.isFile(), accessErr instanceof Error, fs.constants.W_OK));",
    "          });",
    "        });",
    "      });",
    "    });",
    "  });",
    "});",
  ].join("\n"),
  cwd,
);
assert(fsCallbacksRequire.status === 0, `fs callbacks require exited with ${fsCallbacksRequire.status}`);
assert(fsCallbacksRequire.output.trim() === "callback note note.txt true true 2", `unexpected fs callbacks require output: ${fsCallbacksRequire.output}`);

const fsCallbacksImport = await node.evaluate(
  [
    "import { constants, mkdir, writeFile, readFile, readdir, lstat, unlink } from 'node:fs';",
    "const call = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (error, value) => error ? reject(error) : resolve(value)));",
    "await call(mkdir, './cb-esm-dir', { recursive: true });",
    "await call(writeFile, './cb-esm-dir/note.txt', 'esm callback');",
    "const text = await call(readFile, './cb-esm-dir/note.txt', 'utf8');",
    "const entries = await call(readdir, './cb-esm-dir');",
    "const stat = await call(lstat, './cb-esm-dir/note.txt');",
    "await call(unlink, './cb-esm-dir/note.txt');",
    "console.log(text, entries[0], stat.isFile(), constants.R_OK);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsCallbacksImport.status === 0, `fs callbacks import exited with ${fsCallbacksImport.status}`);
assert(fsCallbacksImport.output.trim() === "esm callback note.txt true 4", `unexpected fs callbacks import output: ${fsCallbacksImport.output}`);

const beforeCallbackFsyncFlushes = os.storageFlushes;
const fsCallbackFsyncImport = await node.evaluate(
  [
    "import { fsync, fdatasync } from 'node:fs';",
    "const call = (fn, fd) => new Promise((resolve, reject) => fn(fd, (error) => error ? reject(error) : resolve()));",
    "await call(fsync, 1);",
    "await call(fdatasync, 1);",
    "console.log('callback-sync');",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsCallbackFsyncImport.status === 0, `fs callback fsync import exited with ${fsCallbackFsyncImport.status}`);
assert(fsCallbackFsyncImport.output.trim() === "callback-sync", `unexpected fs callback fsync output: ${fsCallbackFsyncImport.output}`);
assert(os.storageFlushes === beforeCallbackFsyncFlushes + 2, "callback fsync/fdatasync did not reach storage barrier");

const fsSyncFsyncPolicy = node.evaluate(
  [
    "const fs = require('fs');",
    "try { fs.fsyncSync(1); } catch (error) { console.log(error.message); }",
  ].join("\n"),
  cwd,
);
assert(fsSyncFsyncPolicy.status === 0, `fs sync fsync policy exited with ${fsSyncFsyncPolicy.status}`);
assert(fsSyncFsyncPolicy.output.includes("NodeCompat fsyncSync is unavailable"), `unexpected fsyncSync policy output: ${fsSyncFsyncPolicy.output}`);

const fsCopyFileRequire = node.evaluate(
  [
    "const fs = require('fs');",
    "fs.writeFileSync('./copy-src.bin', Buffer.from([1, 2, 3]));",
    "fs.copyFileSync('./copy-src.bin', './copy-dest.bin');",
    "fs.copyFile('./copy-src.bin', './copy-dest.bin', fs.constants.COPYFILE_EXCL, (error) => {",
    "  const bytes = fs.readFileSync('./copy-dest.bin');",
    "  console.log(bytes.length, bytes[1], error instanceof Error);",
    "});",
  ].join("\n"),
  cwd,
);
assert(fsCopyFileRequire.status === 0, `fs copyFile require exited with ${fsCopyFileRequire.status}`);
assert(fsCopyFileRequire.output.trim() === "3 2 true", `unexpected fs copyFile require output: ${fsCopyFileRequire.output}`);

const fsCopyFileImport = await node.evaluate(
  [
    "import { constants, promises as fs, readFileSync, writeFileSync } from 'node:fs';",
    "writeFileSync('./copy-esm-src.txt', 'copy esm');",
    "await fs.copyFile('./copy-esm-src.txt', './copy-esm-dest.txt');",
    "let existsError = false;",
    "try { await fs.copyFile('./copy-esm-src.txt', './copy-esm-dest.txt', constants.COPYFILE_EXCL); } catch (error) { existsError = error instanceof Error; }",
    "console.log(readFileSync('./copy-esm-dest.txt', 'utf8'), existsError);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsCopyFileImport.status === 0, `fs copyFile import exited with ${fsCopyFileImport.status}`);
assert(fsCopyFileImport.output.trim() === "copy esm true", `unexpected fs copyFile import output: ${fsCopyFileImport.output}`);

const fsMutationsRequire = node.evaluate(
  [
    "const fs = require('fs');",
    "fs.writeFileSync('./mut-src.txt', 'start');",
    "fs.appendFileSync('./mut-src.txt', '-sync');",
    "fs.appendFile('./mut-src.txt', '-cb', (appendErr) => {",
    "  if (appendErr) throw appendErr;",
    "  fs.rename('./mut-src.txt', './mut-dest.txt', (renameErr) => {",
    "    if (renameErr) throw renameErr;",
    "    console.log(fs.existsSync('./mut-src.txt'), fs.readFileSync('./mut-dest.txt', 'utf8'));",
    "  });",
    "});",
  ].join("\n"),
  cwd,
);
assert(fsMutationsRequire.status === 0, `fs mutations require exited with ${fsMutationsRequire.status}`);
assert(fsMutationsRequire.output.trim() === "false start-sync-cb", `unexpected fs mutations require output: ${fsMutationsRequire.output}`);

const fsMutationsImport = await node.evaluate(
  [
    "import { promises as fs, readFileSync, existsSync } from 'node:fs';",
    "await fs.writeFile('./mut-esm-src.txt', 'esm');",
    "await fs.appendFile('./mut-esm-src.txt', '-append');",
    "await fs.rename('./mut-esm-src.txt', './mut-esm-dest.txt');",
    "console.log(existsSync('./mut-esm-src.txt'), readFileSync('./mut-esm-dest.txt', 'utf8'));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsMutationsImport.status === 0, `fs mutations import exited with ${fsMutationsImport.status}`);
assert(fsMutationsImport.output.trim() === "false esm-append", `unexpected fs mutations import output: ${fsMutationsImport.output}`);

const fsRealpathRequire = node.evaluate(
  [
    "const fs = require('fs');",
    "fs.mkdirSync('./real-dir', { recursive: true });",
    "fs.writeFileSync('./real-dir/note.txt', 'real');",
    "fs.realpath.native('./real-dir/note.txt', (error, resolved) => {",
    "  if (error) throw error;",
    "  console.log(fs.realpathSync('./real-dir'), resolved.endsWith('/real-dir/note.txt'), fs.realpathSync.native('./real-dir/note.txt').endsWith('/real-dir/note.txt'));",
    "});",
  ].join("\n"),
  cwd,
);
assert(fsRealpathRequire.status === 0, `fs realpath require exited with ${fsRealpathRequire.status}`);
assert(fsRealpathRequire.output.trim() === `${cwd}/real-dir true true`, `unexpected fs realpath require output: ${fsRealpathRequire.output}`);

const fsRealpathImport = await node.evaluate(
  [
    "import fs, { promises } from 'node:fs';",
    "fs.mkdirSync('./real-esm-dir', { recursive: true });",
    "fs.writeFileSync('./real-esm-dir/note.txt', 'real-esm');",
    "const resolved = await promises.realpath('./real-esm-dir/note.txt');",
    "console.log(fs.realpathSync('./real-esm-dir'), resolved.endsWith('/real-esm-dir/note.txt'));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsRealpathImport.status === 0, `fs realpath import exited with ${fsRealpathImport.status}`);
assert(fsRealpathImport.output.trim() === `${cwd}/real-esm-dir true`, `unexpected fs realpath import output: ${fsRealpathImport.output}`);

const fsMkdtempRequire = node.evaluate(
  [
    "const fs = require('fs');",
    "const syncPath = fs.mkdtempSync('/tmp/pkg-');",
    "fs.mkdtemp('/tmp/pkg-', (error, callbackPath) => {",
    "  if (error) throw error;",
    "  console.log(syncPath.startsWith('/tmp/pkg-'), callbackPath.startsWith('/tmp/pkg-'), fs.statSync(callbackPath).isDirectory(), syncPath !== callbackPath);",
    "});",
  ].join("\n"),
  cwd,
);
assert(fsMkdtempRequire.status === 0, `fs mkdtemp require exited with ${fsMkdtempRequire.status}`);
assert(fsMkdtempRequire.output.trim() === "true true true true", `unexpected fs mkdtemp require output: ${fsMkdtempRequire.output}`);

const fsMkdtempImport = await node.evaluate(
  [
    "import { promises as fs, statSync } from 'node:fs';",
    "const path = await fs.mkdtemp('/tmp/pkg-esm-');",
    "console.log(path.startsWith('/tmp/pkg-esm-'), statSync(path).isDirectory());",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsMkdtempImport.status === 0, `fs mkdtemp import exited with ${fsMkdtempImport.status}`);
assert(fsMkdtempImport.output.trim() === "true true", `unexpected fs mkdtemp import output: ${fsMkdtempImport.output}`);

const fsOpendirRequire = node.evaluate(
  [
    "const fs = require('fs');",
    "fs.mkdirSync('./open-dir', { recursive: true });",
    "fs.writeFileSync('./open-dir/a.txt', 'a');",
    "fs.writeFileSync('./open-dir/b.txt', 'b');",
    "const syncDir = fs.opendirSync('./open-dir');",
    "const first = syncDir.readSync();",
    "syncDir.closeSync();",
    "fs.opendir('./open-dir', (error, dir) => {",
    "  if (error) throw error;",
    "  dir.read((readError, entry) => {",
    "    if (readError) throw readError;",
    "    dir.close((closeError) => {",
    "      if (closeError) throw closeError;",
    "      console.log(first.name, first.isFile(), entry.name, dir.path.endsWith('/open-dir'));",
    "    });",
    "  });",
    "});",
  ].join("\n"),
  cwd,
);
assert(fsOpendirRequire.status === 0, `fs opendir require exited with ${fsOpendirRequire.status}`);
assert(fsOpendirRequire.output.trim() === "a.txt true a.txt true", `unexpected fs opendir require output: ${fsOpendirRequire.output}`);

const fsOpendirImport = await node.evaluate(
  [
    "import { promises as fs, writeFileSync, mkdirSync } from 'node:fs';",
    "mkdirSync('./open-esm-dir', { recursive: true });",
    "writeFileSync('./open-esm-dir/a.txt', 'a');",
    "writeFileSync('./open-esm-dir/b.txt', 'b');",
    "const dir = await fs.opendir('./open-esm-dir');",
    "const seen = [];",
    "for await (const entry of dir) seen.push(`${entry.name}:${entry.isFile()}`);",
    "console.log(seen.join(','));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsOpendirImport.status === 0, `fs opendir import exited with ${fsOpendirImport.status}`);
assert(fsOpendirImport.output.trim() === "a.txt:true,b.txt:true", `unexpected fs opendir import output: ${fsOpendirImport.output}`);

const fsStreamsRequire = node.evaluate(
  [
    "const fs = require('fs');",
    "fs.writeFileSync('./stream-in.txt', 'streamed');",
    "let seen = '';",
    "const reader = fs.createReadStream('./stream-in.txt', { encoding: 'utf8' });",
    "reader.on('data', (chunk) => seen += chunk);",
    "reader.on('end', () => {",
    "  const writer = fs.createWriteStream('./stream-out.txt');",
    "  writer.write(seen.slice(0, 6));",
    "  writer.end(seen.slice(6), () => console.log(fs.readFileSync('./stream-out.txt', 'utf8'), reader.bytesRead, writer.bytesWritten));",
    "});",
  ].join("\n"),
  cwd,
);
assert(fsStreamsRequire.status === 0, `fs streams require exited with ${fsStreamsRequire.status}`);
assert(fsStreamsRequire.output.trim() === "streamed 8 8", `unexpected fs streams require output: ${fsStreamsRequire.output}`);

const fsStreamsImport = await node.evaluate(
  [
    "import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs';",
    "writeFileSync('./stream-esm-in.txt', 'esm-stream');",
    "let seen = '';",
    "const reader = createReadStream('./stream-esm-in.txt', 'utf8');",
    "reader.on('data', (chunk) => seen += chunk);",
    "reader.on('end', () => {",
    "  const writer = createWriteStream('./stream-esm-out.txt');",
    "  writer.end(seen, () => console.log(readFileSync('./stream-esm-out.txt', 'utf8'), reader.bytesRead, writer.bytesWritten));",
    "});",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(fsStreamsImport.status === 0, `fs streams import exited with ${fsStreamsImport.status}`);
assert(fsStreamsImport.output.trim() === "esm-stream 10 10", `unexpected fs streams import output: ${fsStreamsImport.output}`);

const processProbeRequire = node.evaluate(
  [
    "const processApi = require('process');",
    "let tick = '';",
    "processApi.nextTick((value) => { tick = value; }, 'tick-ok');",
    "const start = processApi.hrtime();",
    "const diff = processApi.hrtime(start);",
    "const memory = processApi.memoryUsage();",
    "console.log(tick, processApi.browser, processApi.release.name, Array.isArray(diff), typeof processApi.hrtime.bigint(), typeof processApi.uptime(), memory.heapUsed);",
  ].join("\n"),
  cwd,
);
assert(processProbeRequire.status === 0, `process probe require exited with ${processProbeRequire.status}`);
assert(processProbeRequire.output.trim() === "tick-ok true dindbos-nodecompat true bigint number 0", `unexpected process probe require output: ${processProbeRequire.output}`);

const processProbeImport = await node.evaluate(
  [
    "import processApi from 'node:process';",
    "let seen = '';",
    "processApi.nextTick(() => { seen = processApi.execPath; });",
    "console.log(seen, processApi.title, processApi.memoryUsage().arrayBuffers);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(processProbeImport.status === 0, `process probe import exited with ${processProbeImport.status}`);
assert(processProbeImport.output.trim() === "/usr/bin/node dindbos-nodecompat 0", `unexpected process probe import output: ${processProbeImport.output}`);

const utilTypesRequire = node.evaluate(
  [
    "const types = require('util/types');",
    "const util = require('util');",
    "console.log(types.isArrayBuffer(new ArrayBuffer(1)), types.isTypedArray(new Uint8Array(1)), types.isDate(new Date()), types.isRegExp(/x/), types.isMap(new Map()), types.isSet(new Set()), types.isNativeError(new Error('x')), util.types.isUint8Array(new Uint8Array(1)));",
  ].join("\n"),
  cwd,
);
assert(utilTypesRequire.status === 0, `util/types require exited with ${utilTypesRequire.status}`);
assert(utilTypesRequire.output.trim() === "true true true true true true true true", `unexpected util/types require output: ${utilTypesRequire.output}`);

const utilTypesImport = await node.evaluate(
  [
    "import { isArrayBufferView, isDataView, isPromise } from 'node:util/types';",
    "import util from 'node:util';",
    "const view = new DataView(new ArrayBuffer(2));",
    "console.log(isArrayBufferView(view), isDataView(view), isPromise(Promise.resolve()), util.types.isUint16Array(new Uint16Array(1)));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(utilTypesImport.status === 0, `util/types import exited with ${utilTypesImport.status}`);
assert(utilTypesImport.output.trim() === "true true true true", `unexpected util/types import output: ${utilTypesImport.output}`);

const utilDebuglogRequire = node.evaluate(
  [
    "process.env.NODE_DEBUG = 'dindbos';",
    "const util = require('util');",
    "const debug = util.debuglog('dindbos');",
    "const legacy = util.deprecate((value) => `legacy-${value}`, 'legacy api', 'DIND001');",
    "debug('trace %d', 7);",
    "console.log(legacy('one'), legacy('two'));",
  ].join("\n"),
  cwd,
);
assert(utilDebuglogRequire.status === 0, `util debuglog require exited with ${utilDebuglogRequire.status}`);
assert(
  utilDebuglogRequire.output.trim() === "DINDBOS: trace 7\nDeprecationWarning [DIND001]: legacy api\nlegacy-one legacy-two",
  `unexpected util debuglog require output: ${utilDebuglogRequire.output}`,
);

const utilDebuglogImport = await node.evaluate(
  [
    "import { debuglog, deprecate } from 'node:util';",
    "process.env.NODE_DEBUG = '';",
    "let callbackType = '';",
    "debuglog('silent', (logger) => { callbackType = typeof logger; logger('hidden'); });",
    "const passthrough = deprecate((left, right) => left + right, 'sum legacy');",
    "console.log(callbackType, passthrough(2, 3));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(utilDebuglogImport.status === 0, `util debuglog import exited with ${utilDebuglogImport.status}`);
assert(utilDebuglogImport.output.trim() === "DeprecationWarning: sum legacy\nfunction 5", `unexpected util debuglog import output: ${utilDebuglogImport.output}`);

const utilWebApisRequire = node.evaluate(
  [
    "const util = require('util');",
    "const encoded = new util.TextEncoder().encode('hé');",
    "const decoded = new util.TextDecoder().decode(encoded);",
    "console.log(decoded, encoded.byteLength, util.isDeepStrictEqual({ a: [1, { b: true }] }, { a: [1, { b: true }] }), util.isDeepStrictEqual({ a: 1 }, { a: '1' }));",
  ].join("\n"),
  cwd,
);
assert(utilWebApisRequire.status === 0, `util web apis require exited with ${utilWebApisRequire.status}`);
assert(utilWebApisRequire.output.trim() === "hé 3 true false", `unexpected util web apis require output: ${utilWebApisRequire.output}`);

const utilWebApisImport = await node.evaluate(
  [
    "import { TextEncoder, TextDecoder, isDeepStrictEqual } from 'node:util';",
    "const bytes = new TextEncoder().encode('ok');",
    "const same = isDeepStrictEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]));",
    "console.log(new TextDecoder().decode(bytes), same, isDeepStrictEqual(new Date(1), new Date(2)));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(utilWebApisImport.status === 0, `util web apis import exited with ${utilWebApisImport.status}`);
assert(utilWebApisImport.output.trim() === "ok true false", `unexpected util web apis import output: ${utilWebApisImport.output}`);

const hostBuffer = globalThis.Buffer;
globalThis.Buffer = undefined;
try {
  const browserBufferFallback = node.evaluate(
    [
      "const BufferApi = require('buffer').Buffer;",
      "const hex = BufferApi.from('6869', 'hex');",
      "const base64 = BufferApi.from('aGk=', 'base64');",
      "const latin1 = BufferApi.from('Aÿ', 'latin1');",
      "const alloc = BufferApi.alloc(3, 'a');",
      "const unsafe = BufferApi.allocUnsafe(2);",
      "const array = BufferApi.from([1, 258]);",
      "const sliced = BufferApi.from(new Uint8Array([9, 8, 7, 6]).buffer, 1, 2);",
      "const concat = BufferApi.concat([hex, BufferApi.from('!')]);",
      "console.log(BufferApi.isBuffer(hex), hex.toString(), base64.toString('hex'), latin1[1], alloc.toString(), concat.toString(), BufferApi.byteLength('é'), BufferApi.isEncoding('base64url'), BufferApi.compare(BufferApi.from('a'), BufferApi.from('b')), BufferApi.from('x').equals(BufferApi.from('x')), unsafe.length, array.toString('hex'), sliced.toString('hex'));",
    ].join("\n"),
    cwd,
  );
  assert(browserBufferFallback.status === 0, `browser Buffer fallback exited with ${browserBufferFallback.status}`);
  assert(browserBufferFallback.output.trim() === "true hi 6869 255 aaa hi! 2 true -1 true 2 0102 0807", `unexpected browser Buffer fallback output: ${browserBufferFallback.output}`);
} finally {
  globalThis.Buffer = hostBuffer;
}

const perfHooksRequire = node.evaluate(
  [
    "const { performance, PerformanceObserver } = require('perf_hooks');",
    "performance.mark('start', { startTime: 10 });",
    "performance.mark('end', { startTime: 25 });",
    "const measure = performance.measure('work', 'start', 'end');",
    "const buffered = [];",
    "new PerformanceObserver((list) => buffered.push(list.getEntries().length)).observe({ entryTypes: ['measure'], buffered: true });",
    "console.log(measure.duration, performance.getEntriesByType('mark').length, performance.getEntriesByName('work')[0].entryType, buffered[0]);",
  ].join("\n"),
  cwd,
);
assert(perfHooksRequire.status === 0, `perf_hooks require exited with ${perfHooksRequire.status}`);
assert(perfHooksRequire.output.trim() === "15 2 measure 1", `unexpected perf_hooks require output: ${perfHooksRequire.output}`);

const perfHooksImport = await node.evaluate(
  [
    "import perfHooks, { performance, PerformanceObserver } from 'node:perf_hooks';",
    "performance.mark('esm-start', { startTime: 1 });",
    "performance.mark('esm-end', { startTime: 4 });",
    "const measure = performance.measure('esm-work', 'esm-start', 'esm-end');",
    "performance.clearMarks('esm-start');",
    "console.log(measure.duration, performance.getEntriesByName('esm-start').length, PerformanceObserver.supportedEntryTypes.includes('measure'), typeof perfHooks.performance.now());",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(perfHooksImport.status === 0, `perf_hooks import exited with ${perfHooksImport.status}`);
assert(perfHooksImport.output.trim() === "3 0 true number", `unexpected perf_hooks import output: ${perfHooksImport.output}`);

const asyncHooksRequire = node.evaluate(
  [
    "const { AsyncLocalStorage, AsyncResource, createHook, executionAsyncId } = require('async_hooks');",
    "const storage = new AsyncLocalStorage();",
    "const resource = new AsyncResource('pkg-task', { triggerAsyncId: 7 });",
    "let scoped = '';",
    "const result = storage.run({ trace: 'run' }, () => resource.runInAsyncScope(() => { scoped = `${storage.getStore().trace}:${executionAsyncId()}:${resource.triggerAsyncId()}`; return 'done'; }));",
    "const hook = createHook({}).enable();",
    "console.log(result, scoped, hook.enabled, resource.emitDestroy().destroyed);",
  ].join("\n"),
  cwd,
);
assert(asyncHooksRequire.status === 0, `async_hooks require exited with ${asyncHooksRequire.status}`);
assert(asyncHooksRequire.output.trim() === "done run:1:7 true true", `unexpected async_hooks require output: ${asyncHooksRequire.output}`);

const asyncHooksImport = await node.evaluate(
  [
    "import asyncHooks, { AsyncLocalStorage, AsyncResource, triggerAsyncId } from 'node:async_hooks';",
    "const storage = new AsyncLocalStorage();",
    "storage.enterWith('entered');",
    "const outside = storage.exit(() => String(storage.getStore()));",
    "const resource = new AsyncResource('esm-task', { triggerAsyncId: 3 });",
    "const bound = resource.bind(function(value) { return `${this.prefix}:${value}:${triggerAsyncId()}`; }, { prefix: storage.getStore() });",
    "console.log(outside, bound('ok'), typeof asyncHooks.AsyncLocalStorage.snapshot());",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(asyncHooksImport.status === 0, `async_hooks import exited with ${asyncHooksImport.status}`);
assert(asyncHooksImport.output.trim() === "undefined entered:ok:3 function", `unexpected async_hooks import output: ${asyncHooksImport.output}`);

const streamRequire = node.evaluate(
  [
    "const { Readable, Writable, PassThrough, pipeline } = require('stream');",
    "const seen = [];",
    "const sink = new Writable({ write(chunk, enc, done) { seen.push(String(chunk)); done(); } });",
    "pipeline(Readable.from(['a', 'b']), new PassThrough(), sink, (error) => console.log(error ? error.message : seen.join('-')));",
  ].join("\n"),
  cwd,
);
assert(streamRequire.status === 0, `stream require exited with ${streamRequire.status}`);
assert(streamRequire.output.trim() === "a-b", `unexpected stream require output: ${streamRequire.output}`);

const streamImport = await node.evaluate(
  [
    "import { Readable } from 'node:stream';",
    "const stream = Readable.from(['x', 'y']);",
    "const seen = [];",
    "stream.on('data', (chunk) => seen.push(chunk));",
    "stream.on('end', () => console.log(seen.join('')));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(streamImport.status === 0, `stream import exited with ${streamImport.status}`);
assert(streamImport.output.trim() === "xy", `unexpected stream import output: ${streamImport.output}`);

const cryptoRequire = node.evaluate(
  [
    "const crypto = require('crypto');",
    "const digest = crypto.createHash('sha256').update('dindbos').digest('hex');",
    "const bytes = crypto.randomBytes(4);",
    "const values = crypto.getRandomValues(new Uint8Array(2));",
    "console.log(digest, bytes.length, values.length, typeof crypto.randomUUID(), typeof crypto.webcrypto);",
  ].join("\n"),
  cwd,
);
assert(cryptoRequire.status === 0, `crypto require exited with ${cryptoRequire.status}`);
assert(cryptoRequire.output.trim() === "acfd78e1e1c8e1d353c929af27096377c274b7251a7d2bab2e3079a18fca16cd 4 2 string object", `unexpected crypto require output: ${cryptoRequire.output}`);

const cryptoImport = await node.evaluate(
  [
    "import { createHash, randomBytes } from 'node:crypto';",
    "console.log(createHash('sha256').update('runtime').digest('base64url'), randomBytes(3).length);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(cryptoImport.status === 0, `crypto import exited with ${cryptoImport.status}`);
assert(cryptoImport.output.trim() === "2SxqgbL_UAlrzagIhUJ9H1miW19IP3BVUjUEkl0WqyM 3", `unexpected crypto import output: ${cryptoImport.output}`);

const assertQueryRequire = node.evaluate(
  [
    "const assert = require('assert');",
    "const querystring = require('querystring');",
    "const parsed = querystring.parse('name=DindbOS+Runtime&tag=os&tag=browser');",
    "assert.strictEqual(parsed.name, 'DindbOS Runtime');",
    "assert.deepStrictEqual(parsed.tag, ['os', 'browser']);",
    "assert.throws(() => assert.strictEqual(1, 2));",
    "console.log(querystring.stringify({ q: 'browser os', tag: ['runtime', 'vfs'] }));",
  ].join("\n"),
  cwd,
);
assert(assertQueryRequire.status === 0, `assert/querystring require exited with ${assertQueryRequire.status}`);
assert(assertQueryRequire.output.trim() === "q=browser%20os&tag=runtime&tag=vfs", `unexpected assert/querystring require output: ${assertQueryRequire.output}`);

const assertQueryImport = await node.evaluate(
  [
    "import assert, { strictEqual } from 'node:assert';",
    "import { parse, stringify } from 'querystring';",
    "strictEqual(parse('mode=esm').mode, 'esm');",
    "assert.ok(stringify({ ok: true }).includes('ok=true'));",
    "console.log('assert-querystring-esm');",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(assertQueryImport.status === 0, `assert/querystring import exited with ${assertQueryImport.status}`);
assert(assertQueryImport.output.trim() === "assert-querystring-esm", `unexpected assert/querystring import output: ${assertQueryImport.output}`);

const punycodeRequire = node.evaluate(
  [
    "const punycode = require('punycode');",
    "console.log(punycode.encode('mañana'), punycode.decode('maana-pta'), punycode.toASCII('mañana.com'), punycode.toUnicode('xn--maana-pta.com'));",
  ].join("\n"),
  cwd,
);
assert(punycodeRequire.status === 0, `punycode require exited with ${punycodeRequire.status}`);
assert(punycodeRequire.output.trim() === "maana-pta mañana xn--maana-pta.com mañana.com", `unexpected punycode require output: ${punycodeRequire.output}`);

const punycodeImport = await node.evaluate(
  [
    "import punycode, { toASCII, toUnicode, ucs2 } from 'node:punycode';",
    "console.log(toASCII('bücher.example'), toUnicode('xn--bcher-kva.example'), ucs2.encode(ucs2.decode('🍎')), punycode.version);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(punycodeImport.status === 0, `punycode import exited with ${punycodeImport.status}`);
assert(punycodeImport.output.trim() === "xn--bcher-kva.example bücher.example 🍎 2.1.0-dindbos", `unexpected punycode import output: ${punycodeImport.output}`);

const osRequire = node.evaluate(
  [
    "const os = require('os');",
    "console.log(os.platform(), os.homedir(), os.tmpdir(), os.userInfo().username, os.cpus().length >= 1);",
  ].join("\n"),
  cwd,
);
assert(osRequire.status === 0, `os require exited with ${osRequire.status}`);
assert(osRequire.output.trim() === "browser /home/guest /tmp guest true", `unexpected os require output: ${osRequire.output}`);

const osImport = await node.evaluate(
  [
    "import os, { platform, tmpdir } from 'node:os';",
    "console.log(platform(), tmpdir(), os.type(), Array.isArray(os.loadavg()));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(osImport.status === 0, `os import exited with ${osImport.status}`);
assert(osImport.output.trim() === "browser /tmp DindbOS true", `unexpected os import output: ${osImport.output}`);

const ttyRequire = node.evaluate(
  [
    "const tty = require('tty');",
    "const output = new tty.WriteStream(1);",
    "console.log(tty.isatty(1), output.isTTY, output.columns, output.hasColors());",
  ].join("\n"),
  cwd,
);
assert(ttyRequire.status === 0, `tty require exited with ${ttyRequire.status}`);
assert(ttyRequire.output.trim() === "false false 80 false", `unexpected tty require output: ${ttyRequire.output}`);

const ttyImport = await node.evaluate(
  [
    "import { ReadStream, isatty } from 'node:tty';",
    "const input = new ReadStream(0);",
    "console.log(isatty(0), input.isTTY, input.setRawMode() === input);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(ttyImport.status === 0, `tty import exited with ${ttyImport.status}`);
assert(ttyImport.output.trim() === "false false true", `unexpected tty import output: ${ttyImport.output}`);

const moduleRequire = node.evaluate(
  [
    "const moduleApi = require('module');",
    `const scopedRequire = moduleApi.createRequire('${cwd}/node_modules/left/index.js');`,
    "console.log(moduleApi.isBuiltin('node:fs'), moduleApi.builtinModules.includes('fs'), scopedRequire('shared').name, scopedRequire.resolve('shared').includes('/left/node_modules/shared/index.js'));",
  ].join("\n"),
  cwd,
);
assert(moduleRequire.status === 0, `module require exited with ${moduleRequire.status}`);
assert(moduleRequire.output.trim() === "true true nested true", `unexpected module require output: ${moduleRequire.output}`);

const moduleImport = await node.evaluate(
  [
    "import moduleApi, { builtinModules, createRequire, isBuiltin } from 'node:module';",
    `const scopedRequire = createRequire('file://${cwd}/node_modules/left/index.js');`,
    "console.log(isBuiltin('node:path'), builtinModules.includes('module'), moduleApi.builtinModules.includes('tty'), scopedRequire('shared').name);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(moduleImport.status === 0, `module import exited with ${moduleImport.status}`);
assert(moduleImport.output.trim() === "true true true nested", `unexpected module import output: ${moduleImport.output}`);

const stringDecoderRequire = node.evaluate(
  [
    "const { StringDecoder } = require('string_decoder');",
    "const decoder = new StringDecoder('utf8');",
    "console.log(decoder.write(Buffer.from('DindbOS')), decoder.end(), new StringDecoder('hex').write(Buffer.from('ok')));",
  ].join("\n"),
  cwd,
);
assert(stringDecoderRequire.status === 0, `string_decoder require exited with ${stringDecoderRequire.status}`);
assert(stringDecoderRequire.output.trim() === "DindbOS  6f6b", `unexpected string_decoder require output: ${stringDecoderRequire.output}`);

const stringDecoderImport = await node.evaluate(
  [
    "import { StringDecoder } from 'node:string_decoder';",
    "const decoder = new StringDecoder('latin1');",
    "console.log(decoder.write(new Uint8Array([65, 66, 67])), new StringDecoder('base64').write(Buffer.from('hi')));",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(stringDecoderImport.status === 0, `string_decoder import exited with ${stringDecoderImport.status}`);
assert(stringDecoderImport.output.trim() === "ABC aGk=", `unexpected string_decoder import output: ${stringDecoderImport.output}`);

const constantsRequire = node.evaluate(
  "const constants = require('constants'); console.log(constants.ENOENT, constants.EACCES, constants.O_RDONLY, constants.S_IFDIR > 0, constants.F_OK, constants.R_OK);",
  cwd,
);
assert(constantsRequire.status === 0, `constants require exited with ${constantsRequire.status}`);
assert(constantsRequire.output.trim() === "2 13 0 true 0 4", `unexpected constants require output: ${constantsRequire.output}`);

const constantsImport = await node.evaluate(
  "import constants, { SIGTERM, O_CREAT } from 'node:constants'; console.log(SIGTERM, O_CREAT, constants.EEXIST, constants.X_OK);",
  cwd,
  { inputType: "module" },
);
assert(constantsImport.status === 0, `constants import exited with ${constantsImport.status}`);
assert(constantsImport.output.trim() === "15 64 17 1", `unexpected constants import output: ${constantsImport.output}`);

const diagnosticsRequire = node.evaluate(
  [
    "const dc = require('diagnostics_channel');",
    "let seen = '';",
    "const channel = dc.channel('dindbos:test');",
    "const onMessage = (message, name) => { seen = `${name}:${message.value}`; };",
    "channel.subscribe(onMessage);",
    "channel.publish({ value: 'ok' });",
    "console.log(channel.hasSubscribers, dc.hasSubscribers('dindbos:test'), seen);",
    "channel.unsubscribe(onMessage);",
  ].join("\n"),
  cwd,
);
assert(diagnosticsRequire.status === 0, `diagnostics_channel require exited with ${diagnosticsRequire.status}`);
assert(diagnosticsRequire.output.trim() === "true true dindbos:test:ok", `unexpected diagnostics_channel require output: ${diagnosticsRequire.output}`);

const diagnosticsImport = await node.evaluate(
  [
    "import { channel, subscribe, unsubscribe, tracingChannel } from 'node:diagnostics_channel';",
    "let count = 0;",
    "const onMessage = () => { count += 1; };",
    "subscribe('dindbos:esm', onMessage);",
    "channel('dindbos:esm').publish({});",
    "unsubscribe('dindbos:esm', onMessage);",
    "channel('dindbos:esm').publish({});",
    "console.log(count, tracingChannel('trace').start.name);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(diagnosticsImport.status === 0, `diagnostics_channel import exited with ${diagnosticsImport.status}`);
assert(diagnosticsImport.output.trim() === "1 trace:start", `unexpected diagnostics_channel import output: ${diagnosticsImport.output}`);

const dnsPolicyRequire = node.evaluate(
  [
    "const dns = require('dns');",
    "console.log(Array.isArray(dns.getServers()), dns.Resolver ? 'resolver' : 'missing');",
    "try { dns.lookup('example.com'); } catch (error) { console.log(error.message); }",
  ].join("\n"),
  cwd,
);
assert(dnsPolicyRequire.status === 0, `dns policy require exited with ${dnsPolicyRequire.status}`);
assert(dnsPolicyRequire.output.includes("true resolver"), "dns policy shape missing");
assert(dnsPolicyRequire.output.includes("NodeCompat dns networking is unavailable"), "dns policy error missing");

const dnsPolicyImport = await node.evaluate(
  [
    "import dns, { promises, resolve4 } from 'node:dns';",
    "console.log(dns.NOTFOUND, typeof promises.lookup, typeof resolve4);",
    "try { resolve4('example.com'); } catch (error) { console.log(error.message); }",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(dnsPolicyImport.status === 0, `dns policy import exited with ${dnsPolicyImport.status}`);
assert(dnsPolicyImport.output.includes("ENOTFOUND function function"), "dns ESM policy shape missing");
assert(dnsPolicyImport.output.includes("NodeCompat dns networking is unavailable"), "dns ESM policy error missing");

const consoleRequire = node.evaluate(
  [
    "const { Console, log } = require('console');",
    "const writes = [];",
    "const stream = { write(line) { writes.push(line.trim()); } };",
    "const scoped = new Console(stream);",
    "scoped.log('scoped', { ok: true });",
    "log('global-console', 7);",
    "console.log(writes[0]);",
  ].join("\n"),
  cwd,
);
assert(consoleRequire.status === 0, `console require exited with ${consoleRequire.status}`);
assert(consoleRequire.output.trim() === "global-console 7\nscoped {\"ok\":true}", `unexpected console require output: ${consoleRequire.output}`);

const consoleImport = await node.evaluate(
  [
    "import consoleApi, { Console } from 'node:console';",
    "const lines = [];",
    "const c = new Console({ write(line) { lines.push(line.trim()); } });",
    "c.warn('warned');",
    "consoleApi.error('module-error');",
    "console.log(lines[0]);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(consoleImport.status === 0, `console import exited with ${consoleImport.status}`);
assert(consoleImport.output.trim() === "module-error\nwarned", `unexpected console import output: ${consoleImport.output}`);

const networkPolicyRequire = node.evaluate(
  [
    "const http = require('http');",
    "const https = require('node:https');",
    "for (const api of [http.request, https.get]) {",
    "  try { api('https://example.com'); } catch (error) { console.log(error.message); }",
    "}",
  ].join("\n"),
  cwd,
);
assert(networkPolicyRequire.status === 0, `network policy require exited with ${networkPolicyRequire.status}`);
assert(networkPolicyRequire.output.includes("NodeCompat http networking is unavailable"), "http policy error missing");
assert(networkPolicyRequire.output.includes("NodeCompat https networking is unavailable"), "https policy error missing");

const networkPolicyImport = await node.evaluate(
  [
    "import { request } from 'node:http';",
    "try { request('http://example.com'); } catch (error) { console.log(error.message); }",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(networkPolicyImport.status === 0, `network policy import exited with ${networkPolicyImport.status}`);
assert(networkPolicyImport.output.trim() === "NodeCompat http networking is unavailable; use an explicit DindbOS network capability outside NodeCompat.", `unexpected network policy import output: ${networkPolicyImport.output}`);

const runtimePolicyRequire = node.evaluate(
  [
    "const childProcess = require('child_process');",
    "const workers = require('node:worker_threads');",
    "console.log(typeof childProcess.spawn, workers.isMainThread, workers.parentPort === null, workers.threadId);",
    "try { childProcess.exec('echo nope'); } catch (error) { console.log(error.message); }",
  ].join("\n"),
  cwd,
);
assert(runtimePolicyRequire.status === 0, `runtime policy require exited with ${runtimePolicyRequire.status}`);
assert(runtimePolicyRequire.output.includes("function true true 0"), "runtime policy require shape missing");
assert(runtimePolicyRequire.output.includes("NodeCompat child_process is unavailable"), "child_process policy error missing");

const runtimePolicyImport = await node.evaluate(
  [
    "import { spawn } from 'node:child_process';",
    "import workerThreads, { Worker, isMainThread } from 'worker_threads';",
    "console.log(typeof spawn, isMainThread, workerThreads.parentPort === null);",
    "try { new Worker('./worker.js'); } catch (error) { console.log(error.message); }",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(runtimePolicyImport.status === 0, `runtime policy import exited with ${runtimePolicyImport.status}`);
assert(runtimePolicyImport.output.includes("function true true"), "runtime policy ESM shape missing");
assert(runtimePolicyImport.output.includes("NodeCompat worker_threads is unavailable"), "worker_threads policy error missing");

const compressionPolicyRequire = node.evaluate(
  [
    "const zlib = require('zlib');",
    "console.log(typeof zlib.gzipSync, zlib.constants.Z_BEST_COMPRESSION);",
    "try { zlib.gzipSync(Buffer.from('nope')); } catch (error) { console.log(error.message); }",
  ].join("\n"),
  cwd,
);
assert(compressionPolicyRequire.status === 0, `zlib policy require exited with ${compressionPolicyRequire.status}`);
assert(compressionPolicyRequire.output.includes("function 9"), "zlib policy require shape missing");
assert(compressionPolicyRequire.output.includes("NodeCompat zlib compression is unavailable"), "zlib policy require error missing");

const compressionPolicyImport = await node.evaluate(
  [
    "import zlib, { createGzip, constants } from 'node:zlib';",
    "console.log(typeof createGzip, constants.Z_DEFAULT_COMPRESSION, typeof zlib.gunzipSync);",
    "try { createGzip(); } catch (error) { console.log(error.message); }",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(compressionPolicyImport.status === 0, `zlib policy import exited with ${compressionPolicyImport.status}`);
assert(compressionPolicyImport.output.includes("function -1 function"), "zlib policy ESM shape missing");
assert(compressionPolicyImport.output.includes("NodeCompat zlib compression is unavailable"), "zlib policy ESM error missing");

const policyInstaller = new NpmInstaller(os, { registry: "https://registry.example.test" });
const policyFetch = countedFetch(fakePolicyFetch);
const policyRecords = await policyInstaller.install(["policy-pkg@1.0.0"], `${cwd}/policy`, { fetch: policyFetch, maxPackages: 2 });
assert(policyRecords.length === 1, `policy fixture record count mismatch: ${policyRecords.length}`);
assert(policyRecords[0].peerDependencies.react === "^18.0.0", "peer dependency was not recorded");
assert(policyRecords[0].optionalDependencies.fsevents === "^2.0.0", "optional dependency was not recorded");
assert(policyRecords[0].unsupportedNative.includes("script:install"), "install script native warning missing");
assert(policyRecords[0].unsupportedNative.includes("node-gyp"), "node-gyp warning missing");
assert(policyRecords[0].warnings.some((warning) => warning.includes("peerDependencies")), "peer dependency warning missing");
assert(policyRecords[0].warnings.some((warning) => warning.includes("optionalDependencies")), "optional dependency warning missing");
const policyLock = JSON.parse(os.fs.readFile(`${cwd}/policy/package-lock.json`));
const policyLockEntry = policyLock.packages["node_modules/policy-pkg"];
assert(policyLockEntry.peerDependencies.react === "^18.0.0", "lock peer dependencies missing");
assert(policyLockEntry.optionalDependencies.fsevents === "^2.0.0", "lock optional dependencies missing");
assert(policyLockEntry.dindbosWarnings.length >= 3, "lock warnings missing");
const fetchCountAfterFirstInstall = policyFetch.count;
mkdir(os, `${cwd}/policy-repeat`, os.permissions.systemPrincipal());
await policyInstaller.install(["policy-pkg@1.0.0"], `${cwd}/policy-repeat`, { fetch: policyFetch, maxPackages: 2 });
assert(policyFetch.count === fetchCountAfterFirstInstall, "npm cache did not avoid repeated metadata/tarball fetches");
const cacheStatus = os.cache.status();
assert(cacheStatus.hits >= 2, `expected npm cache hits, got ${cacheStatus.hits}`);
assert(cacheStatus.entries >= 2, `expected npm cache entries, got ${cacheStatus.entries}`);

const lifecycleInstaller = new NpmInstaller(os, { registry: "https://registry.example.test" });
mkdir(os, `${cwd}/lifecycle`, os.permissions.systemPrincipal());
const lifecycleRecords = await lifecycleInstaller.install(["lifecycle-pkg@1.0.0"], `${cwd}/lifecycle`, { fetch: fakeLifecycleFetch, maxPackages: 2 });
assert(lifecycleRecords.length === 1, `lifecycle fixture record count mismatch: ${lifecycleRecords.length}`);
const lifecycleRecord = lifecycleRecords[0];
const lifecycleScript = lifecycleRecord.lifecycleScripts.find((script) => script.name === "postinstall");
assert(lifecycleScript?.supported === true, "JS lifecycle script was not marked supported");
assert(lifecycleScript.status === "complete", `JS lifecycle script status mismatch: ${lifecycleScript?.status}`);
assert(os.fs.readFile(`${cwd}/lifecycle/node_modules/lifecycle-pkg/generated.txt`) === "generated by lifecycle", "JS lifecycle script did not write inside package root");
assert(os.fs.readFile(`${cwd}/lifecycle/node_modules/lifecycle-pkg/sandbox.txt`).includes("NodeCompat filesystem sandbox denied"), "JS lifecycle script did not observe package-root sandbox");
assert(!os.fs.exists("/home/guest/escaped-lifecycle.txt"), "JS lifecycle script escaped package-root sandbox");
const lifecycleLock = JSON.parse(os.fs.readFile(`${cwd}/lifecycle/package-lock.json`));
const lifecycleLockEntry = lifecycleLock.packages["node_modules/lifecycle-pkg"];
assert(lifecycleLockEntry.dindbosLifecycleScripts[0].status === "complete", "lock lifecycle status missing");

console.log(`npm/node smoke ok ${records[0].name}@${records[0].version}`);

function bootOs() {
  const permissions = new PermissionPolicy();
  const fs = new VirtualFileSystem(null, { home: "/home/guest", policy: permissions });
  const system = permissions.systemPrincipal();
  let storageFlushes = 0;
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
  fs.createDirectory("/tmp", "/", { owner: "root", group: "root", permissions: "drwxrwxrwx" }, system);
  fs.createDirectory("/home/guest", "/", { owner: "guest", group: "users" }, system);
  fs.createDirectory("/home/guest/Documents", "/", { owner: "guest", group: "users" }, system);
  fs.createDirectory(cwd, "/", { owner: "guest", group: "users" }, system);
  return {
    fs,
    permissions,
    session: {
      home: "/home/guest",
      user: "guest",
    },
    cache: new RuntimeCacheStore({ cacheApi: null }),
    storage: {
      status: () => ({ backend: "memory", bytes: 0 }),
      flush: async () => {
        storageFlushes += 1;
        return { flushed: true };
      },
    },
    get storageFlushes() {
      return storageFlushes;
    },
    async syscallAsync(name) {
      if (name !== "storage.sync") return { ok: false, error: { code: "ENOSYS", message: `syscall: ${name}: not implemented`, syscall: name } };
      storageFlushes += 1;
      return { ok: true, value: { synced: true, backend: "memory" } };
    },
    async flushPersistentFileSystem() {
      storageFlushes += 1;
      return { flushed: true };
    },
  };
}

function writeFixtureFiles(os) {
  const system = os.permissions.systemPrincipal();
  mkdir(os, `${cwd}/type-module`, system);
  mkdir(os, `${cwd}/reexport`, system);
  mkdir(os, `${cwd}/esm-rich`, system);
  mkdir(os, `${cwd}/node_modules/exports-pkg`, system);
  mkdir(os, `${cwd}/node_modules/shared`, system);
  mkdir(os, `${cwd}/node_modules/left`, system);
  mkdir(os, `${cwd}/node_modules/left/node_modules`, system);
  mkdir(os, `${cwd}/node_modules/left/node_modules/shared`, system);
  mkdir(os, `${cwd}/policy`, system);
  write(os, `${cwd}/direct.cjs`, "console.log('direct-cjs');\n", system);
  write(os, `${cwd}/direct.mjs`, "export const label = 'direct-mjs'; console.log(label);\n", system);
  write(os, `${cwd}/type-module/package.json`, JSON.stringify({ type: "module" }, null, 2), system);
  write(os, `${cwd}/type-module/data.json`, JSON.stringify({ name: "type-module-json" }), system);
  write(os, `${cwd}/type-module/app.js`, "import data from './data.json'; console.log(data.name);\n", system);
  write(os, `${cwd}/reexport/core.mjs`, "export const core = 'core-value'; export default 'default-value';\n", system);
  write(os, `${cwd}/reexport/barrel.mjs`, "export * from './core.mjs'; export { default, default as renamed } from './core.mjs';\n", system);
  write(os, `${cwd}/reexport/consumer.mjs`, "import value, { core, renamed } from './barrel.mjs'; console.log(core, value, renamed);\n", system);
  write(os, `${cwd}/esm-rich/source.mjs`, "const localAlpha = 'alpha-value'; const beta = 'beta-value'; export { localAlpha as alpha, beta };\n", system);
  write(os, `${cwd}/esm-rich/extra.mjs`, "export const extra = 'extra-value', ignored = 'ignored-value';\n", system);
  write(os, `${cwd}/esm-rich/barrel.mjs`, [
    "export {",
    "  alpha,",
    "  beta as renamedBeta",
    "} from './source.mjs';",
    "export * as grouped from './source.mjs';",
    "export {",
    "  extra",
    "} from './extra.mjs';",
  ].join("\n"), system);
  write(os, `${cwd}/esm-rich/consumer.mjs`, [
    "import {",
    "  alpha,",
    "  renamedBeta,",
    "  grouped,",
    "  extra",
    "} from './barrel.mjs';",
    "console.log(alpha, renamedBeta, extra, grouped.alpha, grouped.beta);",
  ].join("\n"), system);
  write(os, `${cwd}/node_modules/exports-pkg/package.json`, JSON.stringify({
    name: "exports-pkg",
    exports: {
      ".": {
        require: "./cjs.cjs",
        import: "./esm.mjs",
      },
      "./feature": {
        require: "./feature.cjs",
        import: "./feature.mjs",
      },
      "./fallback": {
        default: "./fallback.js",
      },
    },
  }, null, 2), system);
  write(os, `${cwd}/node_modules/exports-pkg/cjs.cjs`, "module.exports = { mode: 'cjs' };\n", system);
  write(os, `${cwd}/node_modules/exports-pkg/esm.mjs`, "export default { mode: 'esm' };\n", system);
  write(os, `${cwd}/node_modules/exports-pkg/feature.cjs`, "module.exports = { mode: 'feature-cjs' };\n", system);
  write(os, `${cwd}/node_modules/exports-pkg/feature.mjs`, "export default { mode: 'feature-esm' };\n", system);
  write(os, `${cwd}/node_modules/exports-pkg/fallback.js`, "module.exports = { mode: 'fallback-default' };\n", system);
  write(os, `${cwd}/node_modules/shared/package.json`, JSON.stringify({ name: "shared", main: "index.js" }), system);
  write(os, `${cwd}/node_modules/shared/index.js`, "module.exports = { name: 'root' };\n", system);
  write(os, `${cwd}/node_modules/left/package.json`, JSON.stringify({ name: "left", main: "index.js" }), system);
  write(os, `${cwd}/node_modules/left/index.js`, "module.exports = { shared: require('shared').name };\n", system);
  write(os, `${cwd}/node_modules/left/node_modules/shared/package.json`, JSON.stringify({ name: "shared", main: "index.js" }), system);
  write(os, `${cwd}/node_modules/left/node_modules/shared/index.js`, "module.exports = { name: 'nested' };\n", system);
}

async function fakePolicyFetch(url) {
  if (url === "https://registry.example.test/policy-pkg") {
    const tarball = packageTarball({
      "package/package.json": JSON.stringify({ name: "policy-pkg", version: "1.0.0", main: "index.js" }),
      "package/index.js": "module.exports = { ok: true };\n",
    });
    return response(JSON.stringify({
      name: "policy-pkg",
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          name: "policy-pkg",
          version: "1.0.0",
          dist: {
            tarball: "https://registry.example.test/policy-pkg/-/policy-pkg-1.0.0.tgz",
            integrity: "",
          },
          peerDependencies: { react: "^18.0.0" },
          optionalDependencies: { fsevents: "^2.0.0" },
          scripts: { install: "node-gyp rebuild" },
          gypfile: true,
        },
      },
      _tarballBytes: tarball.length,
    }));
  }
  if (url === "https://registry.example.test/policy-pkg/-/policy-pkg-1.0.0.tgz") {
    return responseBytes(packageTarball({
      "package/package.json": JSON.stringify({ name: "policy-pkg", version: "1.0.0", main: "index.js" }),
      "package/index.js": "module.exports = { ok: true };\n",
    }));
  }
  return { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" };
}

async function fakeLifecycleFetch(url) {
  if (url === "https://registry.example.test/lifecycle-pkg") {
    return response(JSON.stringify({
      name: "lifecycle-pkg",
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          name: "lifecycle-pkg",
          version: "1.0.0",
          dist: {
            tarball: "https://registry.example.test/lifecycle-pkg/-/lifecycle-pkg-1.0.0.tgz",
            integrity: "",
          },
          scripts: { postinstall: "node scripts/postinstall.js" },
        },
      },
    }));
  }
  if (url === "https://registry.example.test/lifecycle-pkg/-/lifecycle-pkg-1.0.0.tgz") {
    return responseBytes(packageTarball({
      "package/package.json": JSON.stringify({ name: "lifecycle-pkg", version: "1.0.0", main: "index.js" }),
      "package/index.js": "module.exports = { ok: true };\n",
      "package/scripts/postinstall.js": [
        "const fs = require('fs');",
        "fs.writeFileSync('../generated.txt', 'generated by lifecycle');",
        "try {",
        "  fs.writeFileSync('/home/guest/escaped-lifecycle.txt', 'bad');",
        "} catch (error) {",
        "  fs.writeFileSync('../sandbox.txt', error.message);",
        "}",
      ].join("\n"),
    }));
  }
  return { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" };
}

function countedFetch(fetcher) {
  const wrapped = async (...args) => {
    wrapped.count += 1;
    return fetcher(...args);
  };
  wrapped.count = 0;
  return wrapped;
}

function packageTarball(files) {
  const chunks = [];
  for (const [path, content] of Object.entries(files)) {
    chunks.push(tarHeader(path, Buffer.byteLength(content), "0"));
    chunks.push(Buffer.from(content));
    chunks.push(Buffer.alloc((512 - (Buffer.byteLength(content) % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function tarHeader(path, size, type) {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = [...header].reduce((total, byte) => total + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

function responseBytes(bytes) {
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-length", String(bytes.byteLength)]]),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function mkdir(os, path, system) {
  if (!os.fs.exists(path)) os.fs.createDirectory(path, "/", { owner: "guest", group: "users" }, system);
}

function write(os, path, content, system) {
  os.fs.writeOrCreateFile(path, `${content.replace(/\n?$/, "\n")}`, "/", { owner: "guest", group: "users" }, system);
}

function response(text) {
  const bytes = Buffer.from(text);
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-length", String(bytes.byteLength)]]),
    text: async () => text,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
