# DindbOS NodeCompat

NodeCompat is the first JavaScript runtime layer above the DindbOS virtual filesystem.

```text
cd /home/guest/Documents
npm install is-number@7.0.0
node -e "console.log(require('is-number')(7))"
node --input-type=module -e "import isNumber from 'is-number'; console.log(isNumber(7))"
```

Smoke test:

```text
npm run smoke:npm-node
```

The smoke test installs `is-number@7.0.0` from the real npm registry, then verifies both `require("is-number")` and `import isNumber from "is-number"` through NodeCompat.

It currently supports:

- `node <file>`
- `node -e <code>`
- `node --input-type=module -e <code>`
- CommonJS `require`
- `.mjs` files with simple static `import`/`export`
- `.js` files inside a `package.json` with `"type": "module"`
- relative, absolute, and package module resolution
- package `main` and simple `exports` resolution
- JSON modules
- module cache
- VFS-backed `fs` sync/callback/promise helpers for common package file probes
- `path`, `path/posix`, `process`, `events`, and `Buffer` facades

## Supported ESM Subset

NodeCompat intentionally supports a narrow ESM transform that works for simple browser-safe packages and demo scripts.

Supported:

- static default imports: `import value from "pkg"`
- static named imports: `import { value } from "./module.mjs"`
- static namespace imports: `import * as value from "./module.mjs"`
- multiline static import lists
- side-effect imports: `import "./setup.mjs"`
- default exports: `export default value`
- named declarations: `export const value = 1`, `export function run() {}`
- export lists, including multiline lists and multiple variable declarations
- re-export barrels: `export { value } from "./module.mjs"`, `export * from "./module.mjs"`, and `export * as namespace from "./module.mjs"`

Unsupported:

- top-level `await`
- dynamic `import()`
- import assertions beyond JSON handling
- live binding behavior that depends on full ESM evaluation order
- Node loader hooks

Unsupported syntax should fail with a specific NodeCompat error instead of pretending to run as full Node.js.

## Package Resolution

Supported package lookup:

- current package `package.json`
- package `"type": "module"`
- package `"main"`
- package `"exports"` root and explicit subpath maps
- conditional exports for the common `import`, `require`, `default`, `browser`, and `node` branches
- nested `node_modules` when dependency versions conflict

Unsupported package lookup:

- arbitrary custom export conditions
- package self-references beyond simple package name lookup
- native `node:` built-ins not listed below
- binary entrypoints

## Built-In Surface

Current built-ins:

- `fs`
- `path`
- `path/posix`
- `path/win32`
- `process`
- `buffer` / `Buffer`
- `events` / `EventEmitter`
- `url`
- `util`
- `util/types`
- `timers`
- `perf_hooks`
- `async_hooks`
- `stream`
- `crypto`
- `assert`
- `querystring`
- `punycode`
- `os`
- `tty`
- `module`
- `string_decoder`
- `constants`
- `diagnostics_channel`
- `dns` policy facade
- `console`
- `http` / `https` policy facades
- `child_process` / `worker_threads` policy facades
- `zlib` policy facade

The `fs` module is backed by the DindbOS VFS and is scoped to the runtime. It does not expose the user's real local filesystem. Callback-style `fs` helpers and the `fs.promises` facade wrap the same VFS operations for async package paths, including read/write/append, rename, copyFile, realpath, directory listing, mkdir/mkdtemp, rm/unlink, stat/lstat, and access checks. `fs.constants` exposes browser-safe access modes, copy flags, and common open flags for package probes. `fs.createReadStream` and `fs.createWriteStream` expose browser-safe stream wrappers over VFS files for package compatibility probes.

The `path` module exposes POSIX helpers used by the DindbOS VFS plus `path/posix` and `path/win32` subpath facades for package string probes. `path/win32` only performs browser-safe path string manipulation; it does not imply Windows host filesystem access.

The `process` module reports a browser/DindbOS runtime identity and common package probe fields including `nextTick`, `hrtime`, `uptime`, `memoryUsage`, `release`, `title`, and `execPath`. These values are conservative compatibility data, not host operating system telemetry.

The `buffer` module uses the host `Buffer` when available and falls back to a browser-native `Uint8Array` facade with `from`, `alloc`, `allocUnsafe`, `concat`, `compare`, `isBuffer`, `isEncoding`, `byteLength`, instance equality/compare helpers, Array/ArrayBuffer slice inputs, and common `utf8`, `hex`, `base64`, `base64url`, and `latin1` conversions.

The `url` module exposes WHATWG `URL`/`URLSearchParams`, file URL helpers, domain helpers, and browser-safe legacy `parse`, `format`, and `resolve` string helpers for older package probes.

The `stream` module is a browser-safe subset for package compatibility. It supports `Readable.from`, `Writable`, `PassThrough`, `pipeline`, and `finished`, but it is not a full Node stream implementation.

The `crypto` module is a browser-safe subset. It supports `createHash("sha256")`, `randomBytes`, `randomFillSync`, `randomUUID`, `getRandomValues`, and `webcrypto`; it does not expose OpenSSL, certificates, ciphers, signing, or key management APIs.

The `assert` and `querystring` modules are browser-safe compatibility facades for packages that rely on Node's assertion helpers or legacy query string parsing/stringifying. They are not complete replacements for every edge case in Node core.

The `util/types` module is available through `util.types`, `util/types`, and `node:util/types` for browser-safe package feature probes. It covers common ArrayBuffer, typed array, boxed primitive, collection, Date, RegExp, Promise, and Error checks.

The `util` module includes browser-native `TextEncoder` and `TextDecoder` plus a conservative `isDeepStrictEqual` helper for common package equality probes. These are compatibility helpers, not a full clone of every Node.js `util` inspection edge case.

The `punycode` module supports `encode`, `decode`, `toASCII`, `toUnicode`, and `ucs2` helpers for browser-safe packages that still probe or import Node's legacy IDNA utility surface.

The `perf_hooks` module exposes a browser-safe `performance` timeline for marks/measures plus a minimal `PerformanceObserver` shape. Event-loop delay monitoring is not available in the browser runtime.

The `async_hooks` module exposes a browser-safe subset of `AsyncLocalStorage`, `AsyncResource`, and hook creation for packages that use scoped context or runtime feature probes. It preserves synchronous callback scope; it is not a full Node async lifecycle tracker.

The `os` module is a browser-safe environment facade. It reports DindbOS paths and browser runtime identity for package feature detection; CPU, memory, network interface, load average, and priority APIs return conservative non-host values.

The `tty` module is a non-interactive browser-safe facade. It supports packages that probe `isatty`, `ReadStream`, `WriteStream`, terminal size, or color support, while reporting no host TTY and no terminal colors.

The `module` module supports `builtinModules`, `isBuiltin`, `createRequire`, and a minimal `Module` object so browser-safe packages can probe built-ins or bridge from ESM-style code back to CommonJS resolution without Node loader hooks.

The `string_decoder` module supports the `StringDecoder` class for common browser-safe package decoding paths, including `utf8`, `utf16le`, `latin1`/`binary`/`ascii`, `hex`, and `base64`.

The `constants` module exposes a browser-safe subset of common access mode, errno, signal, open flag, and file mode constants used by packages for feature detection and VFS-facing fallback logic.

The `diagnostics_channel` module supports in-runtime publish/subscribe channels and tracing channel objects for browser-safe instrumentation hooks. It does not forward diagnostics outside the DindbOS runtime.

The `dns` module is an explicit policy facade. Packages can import `dns`, inspect constants, construct `Resolver`, and inspect `promises`, but lookup/resolve/reverse APIs throw `NodeCompat dns networking is unavailable`. DNS/network access belongs to a future explicit DindbOS capability, not NodeCompat.

The `console` module exposes `Console` plus the standard log/warn/error helpers. By default output is captured into the NodeCompat result buffer; custom stream-like objects with `write()` are supported for package-local formatting probes.

The `http` and `https` modules are explicit policy facades. They can be imported by packages that probe for Node built-ins, but `request()`, `get()`, `createServer()`, and constructor paths throw `NodeCompat <protocol> networking is unavailable`. Network access belongs to a future explicit DindbOS network capability or app sandbox grant, not the NodeCompat compatibility layer.

The `child_process` and `worker_threads` modules are explicit policy facades. Packages can import them and inspect basic shape, but host process spawning and Node worker threads throw specific DindbOS capability errors instead of escaping the browser runtime.

The `zlib` module is an explicit policy facade. Packages can import `zlib`, inspect common compression constants, and probe API shape, but compression/decompression functions throw `NodeCompat zlib compression is unavailable`. Browser-native compression should use `CompressionStream` or a future explicit DindbOS compression capability, not a fake Node host binding.

This is not a full Node.js runtime. It does not provide POSIX syscalls, native addons, unrestricted networking, child processes, worker threads, full ESM semantics, or lifecycle script execution.

The goal is to support browser-safe JavaScript packages well enough that DindbOS apps can depend on real npm packages without WebContainers.
