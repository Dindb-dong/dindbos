# DindbOS Developer Guide

This guide is for package authors who want to target DindbOS as a browser-native operating environment. It summarizes the platform rules that matter before an app is packaged, installed, launched, updated, or removed.

## Runtime Contract

DindbOS packages run inside the browser, but they should target DindbOS runtime services instead of private browser globals or internal modules.

Stable app-facing surfaces:

- `sdk`: typed JavaScript wrapper over the syscall ABI.
- `os.syscall(name, args)`: raw structured syscall ABI.
- `os.fs`: sandboxed high-level VFS facade.
- `os.state`: per-app JSON state.
- `os.processes`: process diagnostics and current-process logging.
- `os.packages`: package metadata and package management APIs when granted.
- `imports.npm(name)`: declared browser-safe npm dependency loader.

Private runtime internals, direct companion protocols, unrestricted browser storage, and undeclared host/browser APIs are not compatibility guarantees. The raw DindbOS runtime is not exposed as `window.dindbos`; package code must use the sandbox object, SDK, or syscall ABI it receives at launch.

## Permissions

Packages declare permissions in `dindbos.app.json`.

```json
{
  "permissions": {
    "capabilities": ["package.read", "app.launch"],
    "fileSystem": {
      "read": ["/opt/my-app", "/home/guest/Documents"],
      "write": ["/home/guest/Documents"]
    }
  }
}
```

Capabilities gate sensitive runtime APIs:

- `app.launch`: launch another app or open a file through the app registry.
- `package.read`: inspect package metadata.
- `package.manage`: install, update, trust, or remove packages.
- `process.read`: inspect other processes.
- `process.manage`: kill or restart another process.
- `storage.read` / `storage.manage`: inspect or mutate persistence state.
- `localMount.read` / `localMount.manage`: inspect or mutate local folder mounts.
- `npm.install`: install npm dependencies.
- `node.execute`: run NodeCompat files or evaluation.

Permission failures should be handled as normal runtime errors. DindbOS reports explicit `capability denied`, `sandbox denied`, or syscall `EACCES` results instead of exposing raw stack traces.

## Filesystem Scopes

Filesystem scopes are path-based and deny by default.

- Read access is allowed inside any declared read or write scope.
- Write access is allowed only inside declared write scopes.
- Package code should read its immutable package files from `/opt/<package>`.
- User documents should live under user-owned paths such as `/home/guest/Documents`.
- App state should use `os.state`, not hand-written JSON files, unless the user needs to inspect or edit the file directly.

Example SDK-backed file access:

```js
export function mount({ content, sdk }) {
  sdk.fs.writeText("/home/guest/Documents/report.txt", "hello\n");
  content.textContent = sdk.fs.readText("/home/guest/Documents/report.txt");
}
```

The same permission checks apply through `sdk`, `os.syscall()`, and high-level `os.fs` methods.

## Process Lifecycle

Launching a package app creates a DindbOS process with a PID, manifest, app id, cwd, user, logs, container metadata, and `/proc` diagnostics.

Relevant lifecycle events include:

- `app:install`
- `app:update`
- `app:first-run`
- `app:launch`
- `app:ready`
- `app:focus`
- `app:suspend`
- `app:resume`
- `app:crash`
- `app:close`
- `app:uninstall-cleanup`
- `app:uninstall`

Processes can be inspected through Activity Monitor, `/proc/processes`, `/proc/processes.json`, `/proc/<pid>/status`, `/proc/<pid>/container.json`, `/proc/<pid>/fd.json`, and `/proc/<pid>/syscalls`.

App render crashes are isolated to the process. The desktop remains alive, a crash panel is rendered in the app window, and crash reports are written under `/var/log/dindbos`.

Packages can opt into the first isolated GUI container with `sandbox.containerMode: "iframe"`. That path runs the package entry inside a sandboxed iframe without `allow-same-origin`; the package talks back to DindbOS through an async postMessage syscall bridge. This mode currently expects async `os.syscall`/`sdk` style APIs rather than synchronous same-realm `os.fs.readFile()` calls.

## App State

`os.state` stores JSON-serializable values in the current app namespace:

```js
export function mount({ os, content }) {
  const launches = Number(os.state.get("launches", 0)) + 1;
  os.state.set("launches", launches);
  content.textContent = `launches=${launches}`;
}
```

State behavior:

- Stored under `/var/lib/dindbos/app-state/<appId>.json`.
- Survives close, relaunch, package update, and VFS reload.
- Removed during package uninstall cleanup.
- Isolated by app id; apps cannot read another app's state namespace.
- Rejects non-JSON-serializable values.

Use `os.state` for app preferences, small session records, last-opened state, and package-local counters. Use VFS files for user documents.

## Package Signing And Trust

Remote package installs must pass trust checks before files, launchers, records, or app registrations are written.

Remote manifest trust model:

- Unsigned remote manifests are rejected unless explicitly allowed by the installing tool.
- Invalid signatures are rejected.
- Valid signatures from unknown publishers are rejected unless explicitly allowed as untrusted.
- Trusted publishers are stored in `/etc/dindbos/trusted-publishers.json`.
- `pkg trust list|add|remove` manages trusted publisher keys.

Signed manifests use the canonical `dindbos-manifest-v1` payload and Ed25519 public keys. Package records keep trust metadata so users can inspect source, registry, signature status, publisher id, key id, and warnings.

## Compatibility And API Versions

Packages can declare a compatibility tier:

```json
{
  "compatibility": {
    "tier": "A"
  }
}
```

Current installable tiers:

- Tier A / `dindbos-js`: DindbOS JavaScript GUI/CLI apps.
- Tier B / `browser-safe-npm`: browser-safe npm programs through NodeCompat.

Unsupported required tiers fail before package filesystem mutation.

Packages can also declare DindbOS package API versions:

```json
{
  "api": {
    "minVersion": 1,
    "targetVersion": 2,
    "maxVersion": 2
  }
}
```

The current runtime supports API version `1`. Exact unsupported requirements such as `"apiVersion": 2` fail before mutation. Ranges can negotiate down to a supported version, and the result is stored as `api.negotiatedVersion` on the package record and app manifest.

## SDK And Syscalls

Use `sdk` for ordinary package code:

```js
export function mount({ content, pkg, sdk }) {
  const info = sdk.packages.info(pkg.id);
  sdk.processes.log(`loaded ${info.id}`);
  content.textContent = `${info.name} ${info.version}`;
}
```

Use `os.syscall()` when you need the raw structured ABI result:

```js
const result = os.syscall("fs.readText", { path: "/home/guest/Documents/report.txt" });
if (!result.ok) throw new Error(result.error.message);
```

`src/dindbos/sdk.d.ts` declares the JavaScript SDK surface for TypeScript consumers.

## Browser And Companion Limits

DindbOS does not pretend to provide kernel-mode execution, unrestricted host filesystem access, hardware drivers, native binary execution, or raw sockets in browser-only mode.

Browser-blocked capabilities must go through explicit runtime brokers or optional companion protocols. Third-party packages should not talk directly to `browserd` or any future helper process unless a documented DindbOS broker grants that capability.

Use `doctor compat` to inspect current compatibility tiers, browser capability probes, storage backend state, and companion/provider boundaries.

## Verification For Package Authors

Before publishing a package:

- Install through `pkg install`, not by writing directly into `/opt`.
- Launch through the app registry.
- Exercise declared filesystem read/write scopes.
- Verify capability-denied behavior for features the package should not have.
- Check `/proc/<pid>/syscalls` and `/var/log/dindbos/syscall.log` for runtime API failures.
- Remove the package and confirm app state cleanup if it owns state.

DindbOS repo smoke coverage uses `scripts/helpers/dindbos-test-runtime.js` so package fixtures run against real VFS, AppRegistry, AppSandbox, PackageManager, ProcessManager, DescriptorManager, SyscallDispatcher, and WasmRunner surfaces instead of private package mocks.
