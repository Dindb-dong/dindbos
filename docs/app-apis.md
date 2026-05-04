# DindbOS App APIs

Apps receive a sandboxed runtime object in their `render()` function or package `mount()` function. The sandbox exposes only the APIs allowed by the app manifest.

```js
export function mount({ content, os, pkg, imports, window }) {
  content.textContent = pkg.name;
}
```

## Capabilities And Filesystem Scopes

Capabilities are checked before sensitive runtime APIs run. Filesystem access is checked against manifest read/write scopes.

```json
{
  "permissions": {
    "capabilities": ["app.launch", "process.read", "package.read"],
    "fileSystem": {
      "read": ["/home/guest/Documents", "/opt/my-app"],
      "write": ["/home/guest/Documents"]
    }
  }
}
```

Denied operations throw explicit errors such as `capability denied` or `sandbox denied`.

## Filesystem

Available as `os.fs`.

- `list(path, cwd)`
- `resolve(path, cwd)`
- `readFile(path, cwd)`
- `readFileBytes(path, cwd)`
- `writeFile(path, content, cwd)`
- `writeFileBytes(path, bytes, cwd, options)`
- `appendFile(path, content, cwd)`
- `writeOrCreateFile(path, content, cwd, options)`
- `createFile(path, cwd, options)`
- `createDirectory(path, cwd, options)`
- `remove(path, cwd, options)`
- `copy(sourcePath, destinationPath, cwd, options)`
- `move(sourcePath, destinationPath, cwd)`
- `chmod(path, permissions, cwd)`
- `stat(path, cwd)`
- `lstat(path, cwd)`
- `exists(path, cwd)`
- `normalize(path, cwd)`
- `join(base, name)`
- `dirname(path)`
- `basename(path)`

Binary APIs use `Uint8Array`. Blob APIs are available for browser `Blob` inputs.

## Apps

Available as `os.apps` plus selected top-level helpers.

- `os.apps.list()`
- `os.apps.manifests()`
- `os.apps.getManifest(appId)`
- `os.launch(appId, context)` requires `app.launch`
- `os.openPath(path, context)` requires `app.launch` and file read scope
- `os.openNode(node, context)` requires `app.launch` and file read scope

HTML files should be opened through Browser.app by passing a path or URL context.

## Processes

Available as `os.processes`.

- `current()`
- `list()` requires `process.read`
- `get(pid)` requires `process.read`
- `log(pid)` requires `process.read`
- `logSelf(message, level)`
- `kill(pid)` requires `process.manage`
- `restart(pid)` requires `process.manage`
- `table()` requires `process.read`

Crash reports and process diagnostics are written under `/proc` and `/var/log/dindbos` by the runtime process manager.

Process records include browser-native activity metrics:

- `parentPid`: parent process ID, or `0` for top-level launches
- `parentAppId`: parent app ID when known
- `childPids`: running child process IDs
- `runtimeBytes`: estimated runtime state size, not memory RSS
- `activityScore`: weighted process events in the recent activity window, not CPU percent
- `activitySamples`: number of retained activity samples
- `activityLastSampleAt`: timestamp of the latest activity sample

The browser does not expose per-app CPU time, so Activity Monitor reports event-based activity instead of pretending to show native CPU usage.

## Packages

Available as `os.packages`.

- `list()` requires `package.read`
- `info(packageId)` requires `package.read`
- `dependencies(packageId)` requires `package.read`
- `registries()` requires `package.read`
- `search(query)` requires `package.read`
- `installFromManifestPath(path, cwd)` requires `package.manage` and manifest read scope
- `installFromRegistry(packageId)` requires `package.manage`
- `installFromUrl(url)` requires `package.manage`
- `update(packageId)` requires `package.manage`
- `addNpmDependency(packageId, specifier)` requires `package.manage`
- `remove(packageId)` requires `package.manage`

Remote package records include trust metadata until package signatures are implemented.

## npm And NodeCompat

Available as `os.npm` and `os.node`.

- `os.npm.install(specifiers, cwd)` requires `npm.install` and write scope
- `os.node.runFile(path, cwd, argv)` requires `node.execute` and file read scope
- `os.node.evaluate(source, cwd)` requires `node.execute` and cwd read scope

NodeCompat is a browser-safe subset. It supports CommonJS, simple ESM transforms, JSON modules, package lookup, and selected VFS-backed built-ins.

## Storage

Available as `os.storage`.

- `status()` requires `storage.read`
- `estimate()` requires `storage.read`
- `flush()` requires `storage.manage`
- `resetFileSystem()` requires `storage.manage`

Storage APIs report persistence backend state. They do not expose unrestricted browser storage primitives to apps.

## App State

Available as `os.state`.

- `get(key, fallback)` reads a JSON-serializable value from the current app namespace.
- `set(key, value)` writes a JSON-serializable value to the current app namespace.
- `remove(key)` deletes a key from the current app namespace.
- `keys()` lists saved keys for the current app namespace.
- `snapshot()` returns the current namespace values.
- `clear()` removes all keys for the current app namespace.
- `path()` returns the VFS-backed state record path for diagnostics.

App state is scoped by app id under `/var/lib/dindbos/app-state/<appId>.json`, survives close, relaunch, update, and VFS reload, and is removed during package uninstall cleanup. Apps cannot use this API to read another app's state.

## Session State

The runtime exposes browser-native login session state through `os.sessionStatus()`, `os.lockSession(reason)`, and `os.unlockSession()`. Locking a session blocks Shell command execution and app/path launches until the session is unlocked. The current status is persisted at `/var/run/dindbos/session.json`, and lock transitions emit `session:lock` / `session:unlock` events on the runtime bus.

## Disk Policy

Available on the runtime object for built-in tools and trusted diagnostics:

- `os.diskPolicyAreas()`
- `os.diskPolicyForPath(path)`

The current policy roots are `/home`, `/opt`, `/var`, `/var/cache`, `/tmp`, and `/mnt`. Each policy area reports `root`, `type`, `durability`, `policy`, `exists`, and `usedBytes`.

## Local Mounts

Available as `os.localMounts`.

- `supported()`
- `mountLocal(name, options)` requires `localMount.manage`
- `unmount(path, options)` requires `localMount.manage`
- `listMounts()` requires `localMount.read`
- `status()` requires `localMount.read`
- `restorePersistedMounts(options)` requires `localMount.manage`
- `requestAccess(path, options)` requires `localMount.manage`
- `forgetMount(path)` requires `localMount.manage`
- `operations()` requires `localMount.read`
- `isMountedPath(path, cwd)`
- `syncDirectory(path)`
- `list(path, cwd)` requires `localMount.read`
- `stat(path, cwd)` requires `localMount.read`
- `readFile(path, cwd)` requires `localMount.read`
- `readFileBytes(path, cwd)` requires `localMount.read`
- `writeFile(path, content, cwd)` requires `localMount.manage`
- `writeFileBytes(path, bytes, cwd, options)` requires `localMount.manage`
- `createDirectory(path, cwd, options)` requires `localMount.manage`
- `copy(sourcePath, destinationPath, cwd, options)` requires `localMount.manage`
- `move(sourcePath, destinationPath, cwd, options)` requires `localMount.manage`
- `remove(path, cwd, options)` requires `localMount.manage`
- `exists(path, cwd)`

Local mounts are browser permission-bound and currently a Chromium-family workflow.

## Browser Companion Boundary

Browser.app uses `browserd` through its own client. Third-party apps should open local HTML or URLs through `os.launch("browser", context)` or `os.openPath(path)` instead of talking to the companion directly.

The companion is optional. Apps must handle the browser runtime booting without `browserd`.
