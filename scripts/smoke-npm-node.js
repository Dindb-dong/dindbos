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
  "const { URL, pathToFileURL, fileURLToPath } = require('url'); const util = require('node:util'); const timers = require('timers'); const u = new URL('/docs?q=1', 'https://dindbos.local'); console.log(u.pathname, u.searchParams.get('q'), fileURLToPath(pathToFileURL('/home/guest/a b.txt')), util.format('%s:%d', 'v', 7), typeof timers.setTimeout);",
  cwd,
);
assert(browserSafeBuiltins.status === 0, `browser-safe builtins exited with ${browserSafeBuiltins.status}`);
assert(browserSafeBuiltins.output.trim() === "/docs 1 /home/guest/a b.txt v:7 function", `unexpected browser-safe builtins output: ${browserSafeBuiltins.output}`);

const builtinImport = await node.evaluate(
  [
    "import { URL } from 'node:url';",
    "import { format } from 'util';",
    "import { setTimeout } from 'timers';",
    "console.log(new URL('https://dindbos.local/runtime').hostname, format('%s-%d', 'ok', 2), typeof setTimeout);",
  ].join("\n"),
  cwd,
  { inputType: "module" },
);
assert(builtinImport.status === 0, `builtin import exited with ${builtinImport.status}`);
assert(builtinImport.output.trim() === "dindbos.local ok-2 function", `unexpected builtin import output: ${builtinImport.output}`);

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
  fs.createDirectory("/home", "/", { owner: "root", group: "root" }, system);
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
