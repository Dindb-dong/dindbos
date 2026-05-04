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
- VFS-backed `fs.readFileSync`, `fs.writeFileSync`, `fs.existsSync`, `fs.statSync`, `fs.readdirSync`, `fs.mkdirSync`, and `fs.rmSync`
- `path`, `process`, `events`, and `Buffer` facades

## Supported ESM Subset

NodeCompat intentionally supports a narrow ESM transform that works for simple browser-safe packages and demo scripts.

Supported:

- static default imports: `import value from "pkg"`
- static named imports: `import { value } from "./module.mjs"`
- static namespace imports: `import * as value from "./module.mjs"`
- side-effect imports: `import "./setup.mjs"`
- default exports: `export default value`
- named declarations: `export const value = 1`, `export function run() {}`
- export lists: `export { value }`
- re-export barrels: `export { value } from "./module.mjs"` and `export * from "./module.mjs"`

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
- `process`
- `buffer` / `Buffer`
- `events` / `EventEmitter`
- `url`
- `util`
- `timers`
- `stream`
- `crypto`
- `assert`
- `querystring`
- `http` / `https` policy facades

The `fs` module is backed by the DindbOS VFS and is scoped to the runtime. It does not expose the user's real local filesystem.

The `stream` module is a browser-safe subset for package compatibility. It supports `Readable.from`, `Writable`, `PassThrough`, `pipeline`, and `finished`, but it is not a full Node stream implementation.

The `crypto` module is a browser-safe subset. It supports `createHash("sha256")`, `randomBytes`, `randomFillSync`, `randomUUID`, `getRandomValues`, and `webcrypto`; it does not expose OpenSSL, certificates, ciphers, signing, or key management APIs.

The `assert` and `querystring` modules are browser-safe compatibility facades for packages that rely on Node's assertion helpers or legacy query string parsing/stringifying. They are not complete replacements for every edge case in Node core.

The `http` and `https` modules are explicit policy facades. They can be imported by packages that probe for Node built-ins, but `request()`, `get()`, `createServer()`, and constructor paths throw `NodeCompat <protocol> networking is unavailable`. Network access belongs to a future explicit DindbOS network capability or app sandbox grant, not the NodeCompat compatibility layer.

This is not a full Node.js runtime. It does not provide POSIX syscalls, native addons, unrestricted networking, child processes, worker threads, full ESM semantics, or lifecycle script execution.

The goal is to support browser-safe JavaScript packages well enough that DindbOS apps can depend on real npm packages without WebContainers.
