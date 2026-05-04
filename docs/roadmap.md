# DindbOS.js Roadmap

Last updated: 2026-05-04

DindbOS.js should behave like a browser-native OS runtime, not an OS-themed portfolio page. The portfolio is the demo workload that proves the runtime.

In plain terms: this roadmap is for building a real operating environment that runs inside the browser. It is not a plan for mimicking macOS, Windows, or Linux cosmetically. DindbOS should expose durable files, installable apps, process state, shell execution, permissions, package management, browser/device bridges, and developer APIs that other apps can use as platform primitives.

This roadmap is written from the current working tree state. The immediate goal is to finish the runtime proof points that make DindbOS feel like a real browser-native desktop: real URL browsing, durable files, app/package execution, process visibility, and document workloads.

## Product Direction

The target is not "an OS-looking website." The target is a real operating environment that runs inside browser constraints.

The difference matters:

- OS imitation means windows, icons, menus, and fake panels that only look like a desktop.
- Browser-native OS means runtime services that actually work: apps launch through a registry, files persist in browser-backed storage, shell commands operate on the same VFS as GUI apps, packages install into `/opt`, processes appear in `/proc`, permissions block unauthorized access, and external capabilities are routed through explicit browser or companion boundaries.

Every roadmap item below should be judged by that standard. If a feature cannot be reused by another app, script, or package, it is still demo UI, not an OS primitive.

DindbOS should provide OS primitives that browser apps can actually depend on:

- Kernel/runtime layer: boot sequence, process table, app lifecycle, capability checks, `/proc`-style runtime introspection, and recoverable crash state.
- Filesystem layer: shared virtual filesystem, durable browser-backed disk, binary-safe file APIs, local folder mounts, path resolution, metadata, permissions, imports, exports, and cache volumes.
- Shell layer: scriptable command environment with `PATH`, environment variables, pipes, redirection, exit codes, and executable files.
- Package layer: installable apps, manifests, registry installs, dependency records, update/remove flows, trust policy, and app launchers.
- User/permission layer: session user, app sandbox, filesystem scopes, chmod-style access checks, and clear permission-denied behavior.
- Device/bridge layer: browser-native devices plus optional local companions for capabilities the browser sandbox cannot directly provide.
- Application layer: built-in apps should be real clients of the runtime APIs, not privileged one-off panels.
- Developer layer: documented APIs and examples so third-party apps can target DindbOS as a platform.

The UI should prove those primitives, not substitute for them. A feature is not considered complete because it looks like a desktop control; it is complete when another app or shell command can use the underlying runtime capability consistently.

## Non-Goals

- Do not pretend to be a Linux kernel emulator.
- Do not fake OS behavior with static portfolio sections.
- Do not build features that only work inside one hard-coded demo panel.
- Do not hide browser limitations; expose them as clear runtime constraints and companion boundaries.
- Do not give apps raw unrestricted access when a sandboxed runtime API can express the needed capability.

## Browser-Native OS Roadmap

This is the platform roadmap that separates "real browser OS" work from visual polish.

### Stage 1: Runtime Kernel

Status: Done first pass.

Goal: DindbOS has a coherent internal kernel model that every app uses.

Already present:

- Bootstrapped runtime object.
- Process manager with PID allocation, app state, window state, logs, and `/proc` files.
- App registry and manifest normalization.
- App sandbox boundary.
- Permission policy.
- Window manager integration with process state.
- Parent/child process metadata for sandbox-launched apps.
- Explicit runtime boot phases: storage load, VFS mount, package registry load, app registry load, process init, and desktop render.
- Boot diagnostics are persisted under `/var/log/dindbos/boot.json` and `/var/log/dindbos/boot.log`.
- `npm run smoke:boot` verifies boot phase order, completion diagnostics, persisted boot logs, boot phase events, `/proc` initialization, app registry load, package registry load, and storage-load failure reporting.
- App render crashes are isolated to the app process, render an explicit crash panel, mark the process as crashed, and keep the desktop session alive.
- `npm run smoke:app-registry` verifies crash panel rendering and process crash reporting for a throwing app render path.
- Explicit app lifecycle events exist for install, update, first-run, launch, ready, focus, suspend, resume, crash, close, uninstall-cleanup, and uninstall.
- `npm run smoke:packages` verifies app install/update/first-run/uninstall-cleanup/uninstall lifecycle events; `npm run smoke:processes` verifies launch, ready, focus, suspend, resume, crash, and close lifecycle events.
- Failed storage-load and VFS mount restore phases can recover and continue booting with explicit `recovered` diagnostics.
- `npm run smoke:boot` verifies recovered storage-load diagnostics, recovered boot log persistence, and strict no-recovery failure behavior.

### Stage 2: Durable Disk And Mounts

Status: In progress.

Goal: Files are real runtime state, not demo content.

Already present:

- Browser-backed VFS persistence.
- OPFS/IndexedDB-backed storage path.
- Binary-safe file node model.
- File System Access API local folder mounts under `/mnt`.
- Import/export and drag/drop file flows.
- `/home`, `/opt`, `/var`, `/tmp`, `/mnt`, and `/var/cache` are exposed as distinct disk/cache policy areas through runtime APIs and `df`.
- `npm run smoke:boot` verifies disk policy root creation and path-to-policy resolution.
- Runtime Cache API store exists with memory fallback for package and npm fetches.
- npm metadata/tarballs and remote package manifests/files use the runtime cache; `npm run smoke:npm-node` and `npm run smoke:packages` verify repeated installs avoid repeated fetches.
- Flush/recovery status is exposed through runtime persistence status, Terminal/Settings storage surfaces, and pending-write unload prompts.
- `npm run smoke:persistent-storage` verifies pending-write `beforeunload` prompting and fallback recovery paths.
- Local mount writes check the last synced external file metadata before overwriting; if the file changed on disk, DindbOS blocks the write, preserves the external bytes, and reports a `sync-conflict` operation.
- `npm run smoke:local-mounts` verifies local mount permission denial plus disk-change/write-conflict detection and reporting.
- Files.app large virtual copy/move plus archive import/export paths use cooperative operation scheduling so long traversals yield back to the browser event loop while preserving progress and cancellation.
- `npm run smoke:files` verifies scheduled copy/import traversal yields and still preserves nested file bytes.
- Viewer.app uses the runtime Cache API store for document and image preview bytes, keyed by path, MIME type, size, and modified time so changed files do not reuse stale previews.
- `npm run smoke:viewer` verifies image preview cache writes/hits and markdown document preview byte caching.

### Stage 3: Scriptable Userland

Status: In progress.

Goal: The shell and package layer can operate the system without hard-coded UI shortcuts.

Already present:

- Shell with path lookup, variables, pipes, redirection, chaining, and common file commands.
- Executable DindbOS shell scripts with shebang handling, `PATH` lookup, positional arguments, stdin pipeline support, and execute-bit enforcement.
- Package manager with manifest installs.
- Package install transactions roll back failed installs/updates and cleanly remove package files, launchers, records, and app registration.
- Package smoke coverage proves install -> launch -> run -> remove through a real AppRegistry launch path.
- Package signature design documents public key format, signed manifest payloads, verification order, trust states, and failure UX.
- Package signature verification enforces the documented trust model before remote package filesystem mutation.
- npm-compatible installer for browser-safe JavaScript packages.
- NodeCompat for early CommonJS and simple ESM execution.
- Shell status codes are documented and enforced for success, runtime failure/no-match, and usage errors; `npm run smoke:shell` verifies status-driven `&&`/`||`.

Remaining:

- Expand NodeCompat only in directions that support browser-safe packages.

### Stage 4: Real Apps On Runtime APIs

Status: Done first pass, third-party API hardening continues through package milestones.

Goal: Built-in and third-party apps behave like OS apps because they consume runtime services.

Already present:

- Files.app uses shared VFS/local mount APIs.
- Activity Monitor reads process state and `/proc`.
- Browser.app uses local HTML provider and companion bridge.
- TextEdit saves into shared VFS.
- Viewer.app opens real file bytes through object URLs.
- API Lab sample package installs from `/opt/dindbos/packages/api-lab/dindbos.app.json` and proves third-party access to sandboxed filesystem writes, package metadata reads, current-process reads, and process logging.
- App sandbox exposes per-app `os.state` JSON persistence under `/var/lib/dindbos/app-state/<appId>.json`; state survives close, relaunch, update, and VFS reload while package uninstall cleanup removes the app state record.
- `docs/app-apis.md` documents app-facing filesystem, process, storage, app state, package, npm, NodeCompat, local mount, app launch, and Browser.app handoff APIs.
- App capability and filesystem-scope failures throw explicit `capability denied` or `sandbox denied` errors; `npm run smoke:permissions` verifies these messages for process, package, local mount, and filesystem denials.
- TextEdit, Viewer.app, and Browser.app use user-document read scopes for file-open paths instead of root filesystem read scope.
- `npm run smoke:packages` launches API Lab through AppRegistry and verifies its rendered output, `/home/guest/DindbOS API Lab/report.txt` write, package metadata read, process log side effect, app state relaunch restore, app state VFS reload restore, and uninstall cleanup.
- `npm run smoke:permissions` verifies app state namespace isolation and JSON-serializable value enforcement.
- `npm run smoke:viewer` verifies TextEdit and Viewer.app reject root-owned files outside their app sandbox scopes.

### Stage 5: External Capability Bridges

Status: In progress through Browser.app companion.

Goal: Capabilities blocked by browser sandbox can be exposed through explicit, opt-in companions.

Already present:

- `browserd` local companion for real Chromium browsing through CDP.
- Health check and WebSocket protocol.
- Browser.app companion client.
- `docs/browserd.md` defines the local companion trust boundary, optional-runtime rule, direct-third-party-access restriction, and future companion/provider separation.
- Browser.app checks `browserd` health service, protocol version, required capabilities, and WebSocket subprotocol before opening the companion boundary.
- `browserd` is explicitly browser-only: future file helper, download-save, local mount rename, and native-adjacent work must use separate companion identities/protocols instead of expanding the browser companion.
- DindbOS accepts a configurable browser provider WebSocket URL so hosted deployments can point Browser.app at a browserd-compatible remote provider when a local companion is not available.
- Browser.app persists the selected provider URL in its session snapshot and maps `ws`/`wss` provider endpoints to matching `http`/`https` health checks before opening the WebSocket.

### Stage 6: Desktop UX As A Runtime Client

Status: Done first pass, polish continues in detailed app sections.

Goal: Polish the desktop after the runtime primitives are dependable.

Already present:

- Snap zones, Alt-Tab, keyboard shortcuts, mobile window policy, and persisted window placement are implemented in Window Manager and covered by `npm run smoke:window-manager`.
- Files.app keyboard navigation is implemented for selection movement, folder traversal, open, Trash, rename, and copy/paste, covered by `npm run smoke:files`.
- Viewer.app controls cover zoom, Browser.app handoff, export, copy path, PDF page navigation through the optional PDF.js adapter, and deck/large-preview behavior, covered by `npm run smoke:viewer`.

## Status Legend

- Done: usable first implementation exists.
- In progress: working path exists, but edge cases, UX, or verification are still incomplete.
- Next: should be handled before broad polish.
- Later: important, but not blocking the next proof point.

## Current Priority

Browser.app is the next proof point.

Process/activity visibility, persistent storage, local folder mounts, npm install, and early NodeCompat are already in place. The work that remains is to make Browser.app and document viewers strong enough that the portfolio demo can run real URL/document workloads inside the OS shell, not just open built-in demo panels.

The next practical sequence:

1. Stabilize the current Browser.app + `browserd` companion work.
2. Add verification coverage for Browser.app, storage persistence, npm install, and NodeCompat smoke paths.
3. Improve document viewers so PDF, image, markdown, and HTML workloads feel native.
4. Harden app packaging and runtime lifecycle once the browser/document proof point works.
5. Polish window management and UX only after the core runtime behavior is reliable.

## 0. Immediate Carry-Over Work

These are the tasks most likely to be "what we were in the middle of" right now.

### 0.1 Browser.app Companion Stabilization

Status: Done first pass, provider/native-adjacent hardening remaining.

Already present:

- Browser.app shell with address bar, back/forward/reload/go/connect controls.
- Local HTML file opening through an internal iframe document provider.
- `BrowserCompanionClient` connection to `ws://127.0.0.1:8787/browser`.
- `scripts/browserd.js` local companion that launches Chromium through CDP.
- Health check at `http://127.0.0.1:8787/health`.
- Screencast frame streaming back into Browser.app.
- Protocol commands for `navigate`, `reload`, `back`, `forward`, `resize`, `click`, `type`, `key`, `scroll`, and `capture`.
- Companion docs in `docs/browserd.md`.
- `npm run smoke:browserd` verifies companion startup, health, WebSocket, navigation, and first JPEG frame receipt.
- `npm run smoke:browser-client` verifies that a non-DindbOS service on the companion port is rejected before WebSocket use.
- `npm run smoke:browserd-failures` verifies missing Chrome, CDP startup failure, and WebSocket drop behavior.
- `npm run smoke:browser-addresses` verifies Browser.app address normalization and supported URL scheme policy.
- `npm run smoke:browserd` verifies printable text, Backspace, Enter form submission, and Ctrl-modifier key forwarding inside a real Chromium page.
- Browser.app exposes a clear reconnect path after `browserd` disconnects; `npm run smoke:browser-client` verifies reconnect status events and a second WebSocket connection after disconnect.
- Browser.app connection policy is documented: blank windows require Connect, external URL submissions/context launches auto-connect, and local VFS HTML never starts `browserd`.
- Browser.app forwards clipboard paste into remote pages and blocks companion downloads with visible status instead of silent writes.
- Browser.app address/title/status session state is snapshotted into the window state slot and survives minimize/focus/activate flows.
- Browser.app companion frames use binary WebSocket payloads with JSON headers and object URLs instead of base64 data URL transport.
- Browser.app companion identity checks verify health service, protocol version, required capabilities, and WebSocket subprotocol before accepting `browserd`.
- Browser.app keyboard policy supports Ctrl/Cmd+L address focus, Escape back to remote viewport, Tab/Shift+Tab remote focus movement, and modifier shortcuts for remote text selection/copy/cut/paste.
- Browser.app can be configured with a local or hosted browser provider WebSocket URL; session snapshots preserve that provider, and smoke coverage verifies remote `wss` provider URL persistence.
- Browser.app v1 stream policy is explicit: `browserd` health advertises CDP screencast with binary JPEG frame encoding, and Browser.app rejects providers that advertise a different stream shape. WebRTC remains deferred until the proven CDP screencast path fails measured workload latency, bandwidth, or quality targets.
- `npm run smoke:browserd` verifies `browserd` health stream metadata; `npm run smoke:browser-client` verifies incompatible WebRTC-only stream metadata is rejected.

Completion criteria:

- `npm run browserd` starts consistently on macOS with a detected Chrome or a documented `CHROME_PATH`.
- Browser.app can open `https://example.com`, click a link, type into an input, scroll, reload, go back, and go forward.
- Browser.app can open a local VFS HTML file without starting `browserd`.
- Broken companion states produce actionable in-app status text instead of a blank frame.

### 0.2 Verification Baseline

Status: Done first pass, expand only when new risky runtime paths appear.

Already present:

- `npm run check` validates syntax for the main runtime modules and `scripts/browserd.js`.
- `npm run smoke:browserd` verifies the Browser.app companion path with a real Chromium frame.
- `npm run smoke:browser-client` verifies the companion identity guard for occupied/wrong-service ports.
- `npm run smoke:browser-client` verifies the Browser.app companion reconnect contract after disconnect.
- `npm run smoke:browserd-failures` verifies missing Chrome, CDP startup failure, and WebSocket drop behavior.
- `npm run smoke:browser-addresses` verifies Browser.app address normalization and supported URL scheme policy.
- `npm run smoke:storage` verifies VFS text and binary read/write persistence through snapshot reload.
- `npm run smoke:persistent-storage` verifies localStorage-style snapshot fallback and OPFS write-failure fallback preserve binary bytes.
- `npm run smoke:files` verifies Files.app archive export/import preserves nested binary bytes.
- `npm run smoke:packages` verifies package transaction rollback for failed local install, failed update, and failed remote install.
- `npm run smoke:npm-node` verifies real npm registry install of `is-number@7.0.0` plus NodeCompat CommonJS and simple ESM execution.
- `npm run smoke:processes` verifies process logs, `/proc` updates, kill cleanup, attached window close, and Activity Monitor-style restart relaunch.
- `npm run smoke:local-mounts` verifies the local folder mount permission-denied path does not create runtime or VFS mounts.
- `npm run smoke:app-registry` verifies singleton activation and non-singleton window ID uniqueness.
- `npm run smoke:boot` verifies runtime boot phase order, completion diagnostics, persisted boot logs, and storage-load failure reporting.
- `npm run smoke:sessions` verifies generated user homes, shell ownership for created files/directories, and active-home built-in app scopes.
- `npm run smoke` runs syntax checks plus current boot, storage, persistent storage, Files.app, Settings.app, Viewer.app, Shell, session, permission, package, npm/node, process, local mount, app registry, window manager, browser address, and browser companion smoke checks as one local confidence command.

Completion criteria:

- The smoke tests avoid fake success states: they must verify real output, real file bytes, or real browser frames.

## 1. Shell

Status: Done first pass, hardening remaining.

Already present:

- `PATH` based command lookup.
- Environment variables: `HOME`, `USER`, `SHELL`, `PATH`, `PWD`.
- `export`, `env`, and variable expansion.
- Redirection: `>`, `>>`, `<`.
- Pipes: `cat file | grep text`.
- Command chaining with `&&`, `||`, and `;`.
- Parser/chaining/status regression smoke is covered by `npm run smoke:shell`.
- Executable shell scripts are resolved through direct paths or `PATH`, support `#!dindbsh`-style shebangs, receive `$0`, `$1`, `$@`, and can consume stdin in pipelines.
- `npm run smoke:shell` verifies executable scripts, `PATH` lookup, positional arguments, pipeline stdin, non-executable permission denial, and unsupported shebang failure.
- `man`, `which`, `chmod`, `df`, `mount`.
- Keyboard history with up/down.
- Filesystem commands including `pwd`, `cd`, `ls`, `tree`, `find`, `cat`, `grep`, `stat`, `readlink`, `mkdir`, `touch`, `rm`, `cp`, `mv`, and `echo`.
- Runtime commands including `open`, `apps`, `ps`, `kill`, `storage`, `resetfs`, `pkg`, `npm`, and `node`.
- Command-not-found suggestions use builtins, `PATH`, app registry metadata, and package records.
- `docs/shell.md` defines status codes, chaining semantics, and the supported DindbOS shell script dialect.
- `npm run smoke:shell` verifies `&&` and `||` depend on explicit status codes for no-match, missing executable, and usage cases, not only thrown errors.
- Parser behavior handles quoted separators, escaped quotes, empty string arguments, input redirection, output redirection, and mixed pipes/redirection.
- `npm run smoke:shell` verifies escaped quotes, empty string arguments, compact output redirection, input redirection, and redirected pipeline status.
- `npm run smoke:shell` verifies rare builtin-specific failure statuses for `kill`, `stat`, `find`, `man`, and `manifest`.
- `doctor` prints a compact troubleshooting snapshot with session, cwd, storage, local mount, package, process, docs, and follow-up command details; `npm run smoke:shell` verifies the diagnostic fields.

Completion criteria:

- Shell behavior is deterministic enough for docs and demo scripts.
- A user can write a small script under `/home/guest/bin` and run it through `PATH`.
- Failures include a useful message and a consistent exit status.

## 2. Storage And Filesystem

Status: Done first pass, durability hardening remaining.

Already present:

- IndexedDB storage backend.
- OPFS snapshot backend.
- OPFS per-file content records.
- OPFS inode metadata records.
- Dirty-file-only and dirty-inode-only writes.
- Debounced/coalesced persistence.
- VFS snapshot load before boot.
- File state survives reloads.
- `storage` status command.
- `resetfs` command.
- File System Access API local folder mount.
- `/mnt/<name>` external disk model.
- Terminal `mount-local` and `umount`.
- Files.app `Mount Local`.
- `storage persist` and quota estimate.
- Persisted directory handles in IndexedDB.
- `mount-local --list`, `mount-local --restore`, `mount-local --forget`.
- Binary-safe VFS read/write compatibility layer.
- Files.app import/export.
- Files.app drag and drop upload.
- Native `Uint8Array` file nodes with Blob/File import adapters.
- Files.app local mount permission banner with reconnect/sync/forget controls.
- Files.app copy/move/import/export progress reporting.
- Settings storage flush, quota, persistence, process/package counts, and local mount management panel reads live runtime APIs; `npm run smoke:settings` verifies the runtime snapshot and rendered status markup.
- Lifecycle flush status and write-pending status.
- Runtime disk policy areas distinguish `/home`, `/opt`, `/var`, `/tmp`, `/mnt`, and `/var/cache`; `df` prints their policy, durability, and used bytes.
- Runtime Cache API store caches npm metadata/tarballs and remote package manifests/files, with memory fallback when Cache API is unavailable.
- Pending writes trigger best-effort flushes through `beforeunload`, `pagehide`, and hidden-tab visibility changes; `beforeunload` also requests the native leave-page prompt.
- `npm run smoke:persistent-storage` verifies pending-write `beforeunload` prompting plus `pagehide` and hidden-tab flush triggers.
- `npm run smoke:storage` verifies VFS text and binary byte preservation across copy, content-record serialization, and snapshot reload.
- `npm run smoke:files` verifies Files.app import/export preserves nested binary files byte-for-byte.
- Local mount writes detect when the external file changed after the last sync and report `sync-conflict` instead of silently overwriting disk changes.
- `npm run smoke:local-mounts` verifies sync conflict detection, external byte preservation, conflict status, and operation reporting.
- Files.app copy/move/import/export traversal uses cooperative scheduling with progress/cancel checks instead of running every large tree operation as one uninterrupted main-thread block.
- `npm run smoke:files` verifies scheduled copy/import yields and nested byte preservation.
- Viewer.app document/image preview bytes use the runtime Cache API store with memory fallback.
- `npm run smoke:viewer` verifies preview cache namespace, writes, hits, and byte preservation.
- Storage Buckets are evaluated as a future physical isolation layer: `os.storageBucketPolicy()` reports support detection and records the current decision to keep OPFS/IndexedDB/Cache as the active storage stack while disk policies mark `/tmp` as session, `/var/cache` as cache, and durable areas as durable bucket intent.
- `npm run smoke:boot` verifies storage bucket policy reporting, disk-policy bucket intent for `/tmp` and `/var/cache`, and boot diagnostics persistence.
- Local mount directory copy conflicts are defined at the runtime boundary: default `error`, destructive `replace`, non-destructive `merge`, `skip`, `rename`, and caller-resolved `prompt`.
- `npm run smoke:local-mounts` verifies local directory copy policy reporting, default conflict rejection, merge preservation, replace overwrite, skip preservation, and prompt rename behavior.
- Same-folder local mount rename is routed through a separate `dindbos-file-helper-v1` `file.rename` helper when configured; without that helper, DindbOS refuses browser copy-delete rename and leaves the source entry untouched.
- `npm run smoke:local-mounts` verifies helperless local mount rename failure, helper-backed native rename, external byte preservation, and native rename operation reporting.

Completion criteria:

- Text and binary files survive reloads with no byte drift.
- Large imports do not freeze the UI without progress.
- Storage errors are visible and recoverable.
- Local mount permission states are understandable from both Terminal and Files.app.

## 3. Package System

Status: Done first pass, trust/lifecycle hardening remaining.

Already present:

- `dindbos.app.json` manifest schema.
- App entry loader.
- Permissions and filesystem scopes.
- Install/uninstall.
- Remote manifest URL install.
- Remote registry search/install.
- Package update from recorded source.
- npm dependency records through browser ESM modules.
- npm registry metadata fetch.
- npm tarball install into VFS-backed `node_modules`.
- Recursive regular dependency install.
- Package-lock writer.
- sha256 file integrity checks.
- npm peer/optional dependencies are recorded as policy metadata but are not auto-installed.
- npm native/lifecycle signals such as install scripts and `node-gyp` are reported as DindbOS warnings.
- `/usr/share/applications/*.app`.
- `/opt/<package>`.
- Package install transactions roll back failed local and remote installs, preserving previous package versions and removing partial app registration, launcher, package DB records, and install directories.
- `npm run smoke:packages` verifies local install failure cleanup, failed update rollback, valid update lifecycle metadata, remove cleanup, missing-remove stability, unsigned remote rejection, invalid signature rejection, untrusted-key rejection, remote integrity failure cleanup, trusted signed install, first-run lifecycle persistence, and install -> AppRegistry launch -> package runtime render -> remove cleanup.
- Remote package records include trust metadata with signature status, publisher id, key id, registry source, trusted flag, and warnings.
- Package/npm fetches are cached through the runtime Cache API store with memory fallback; repeated remote package and npm installs avoid repeated manifest/file/tarball fetches.
- Package signature verification enforces the `docs/package-signatures.md` model: Ed25519 public key format, canonical manifest signing, trusted publisher store, file integrity binding, trust states, and fail-closed verification before filesystem mutation.
- `pkg trust list|add|remove` manages trusted publishers in `/etc/dindbos/trusted-publishers.json`; `npm run smoke:shell` verifies the command surface.
- Package lifecycle metadata and events distinguish install, update, first-run, uninstall-cleanup, and uninstall; `docs/app-lifecycle.md` and `npm run smoke:packages` cover the contract.
- Package app state persists separately from lifecycle metadata through app-scoped `os.state`, and package uninstall cleanup removes `/var/lib/dindbos/app-state/<appId>.json`.

Completion criteria:

- A package install either completes cleanly or leaves no partial launcher/app state.
- Remote package trust boundaries are explicit.
- Installed apps can declare realistic runtime needs without receiving the raw OS object.

## 3.1 NodeCompat

Status: Done early pass, compatibility expansion remaining.

Already present:

- `npm install <package>` direct dependency install.
- npm `.tgz` download and extraction.
- npm integrity verification.
- VFS-backed `node_modules`.
- `package.json` and `package-lock.json` writes.
- Recursive regular dependency install.
- `node <file>` and `node -e <code>`.
- CommonJS `require`.
- `node --input-type=module -e <code>`.
- `.mjs` files with simple static import/export transforms.
- Package `"type": "module"` detection.
- Package `main` and explicit root/subpath `exports` resolution with common `import`, `require`, `browser`, and `default` conditions.
- JSON modules.
- Module cache.
- VFS-backed `fs`, `path`, `process`, and `Buffer` facades.
- NodeCompat `process` facade exposes browser-safe feature probe fields including `nextTick`, `hrtime`, `uptime`, `memoryUsage`, `release`, `title`, and `execPath`.
- `npm run smoke:npm-node` verifies `process` CommonJS and ESM import paths for next-tick callbacks, high-resolution time shape, memory usage shape, and runtime identity fields.
- Browser-native `Buffer` fallback supports `from`, `alloc`, `concat`, `isBuffer`, `byteLength`, and common string encodings when host `Buffer` is unavailable; `npm run smoke:npm-node` verifies the no-host-Buffer path.
- `events`/`EventEmitter` builtin facade is available through `events` and `node:events`; `npm run smoke:npm-node` verifies CommonJS and ESM import paths.
- `path/posix` resolves through CommonJS and ESM import paths to the browser-safe POSIX path facade used by package feature probes.
- `npm run smoke:npm-node` verifies `path/posix`, `node:path/posix`, and `path.posix` behavior.
- `path/win32` resolves through CommonJS and ESM import paths to a browser-safe Windows path string facade for package feature probes without exposing host filesystem access.
- `npm run smoke:npm-node` verifies `path/win32`, `node:path/win32`, and `path.win32` behavior for join, basename, dirname, extname, absolute path detection, normalize, and relative path calculations.
- `url`, `util`, and `timers` builtin facades are available through bare and `node:` import paths; `npm run smoke:npm-node` verifies CommonJS and ESM import paths.
- `util.debuglog` and `util.deprecate` support browser-safe package diagnostics and legacy API wrappers without host Node access; `npm run smoke:npm-node` verifies enabled/disabled debug channels, callback shape, one-time deprecation warnings, and CommonJS/ESM import paths.
- `util.TextEncoder`, `util.TextDecoder`, and `util.isDeepStrictEqual` support browser-safe package encoding and equality probes through CommonJS and ESM import paths.
- `npm run smoke:npm-node` verifies util text encoding/decoding and strict deep equality for nested objects, typed arrays, dates, and mismatched primitive types.
- `util/types` is available through `util.types`, `util/types`, and `node:util/types` for browser-safe package feature probes covering ArrayBuffer, typed array, boxed primitive, collection, Date, RegExp, Promise, and Error checks.
- `npm run smoke:npm-node` verifies `util/types` CommonJS and ESM import paths plus representative type probe behavior.
- `perf_hooks` builtin facade supports CommonJS and ESM import paths for browser-safe performance marks, measures, observer shape, and package runtime probes.
- `npm run smoke:npm-node` verifies `perf_hooks` and `node:perf_hooks` import paths, mark/measure entries, buffered observer behavior, clearing marks, supported entry types, and `performance.now()` shape.
- `async_hooks` builtin facade supports CommonJS and ESM import paths for synchronous `AsyncLocalStorage`, `AsyncResource`, hook shape, and runtime probes used by browser-safe packages.
- `npm run smoke:npm-node` verifies `async_hooks` and `node:async_hooks` import paths, scoped storage, resource async id/trigger id behavior, hook enable state, bound callbacks, and exit/disable behavior.
- `stream` builtin facade supports the browser-safe subset of `Readable.from`, `Writable`, `PassThrough`, `pipeline`, and `finished` through bare and `node:` import paths; `npm run smoke:npm-node` verifies CommonJS and ESM import paths.
- `crypto` builtin facade supports browser-safe `createHash("sha256")`, `randomBytes`, `randomFillSync`, `randomUUID`, `getRandomValues`, and `webcrypto` through bare and `node:` import paths; `npm run smoke:npm-node` verifies CommonJS and ESM import paths.
- `assert` and `querystring` builtin facades support CommonJS and ESM import paths for browser-safe package compatibility, covered by `npm run smoke:npm-node`.
- `punycode` builtin facade supports CommonJS and ESM import paths for legacy IDNA/domain helpers still used by browser-safe package probes.
- `npm run smoke:npm-node` verifies `punycode` and `node:punycode` import paths plus encode/decode, toASCII/toUnicode, and ucs2 helpers.
- `os` builtin facade supports CommonJS and ESM import paths for browser-safe package environment probes while returning conservative DindbOS/browser values instead of host OS details.
- `npm run smoke:npm-node` verifies `os` and `node:os` import paths, DindbOS home/tmp paths, browser platform identity, user info, CPU shape, type, and load average shape.
- `tty` builtin facade supports CommonJS and ESM import paths for browser-safe package terminal probes while reporting a non-interactive browser runtime.
- `npm run smoke:npm-node` verifies `tty` and `node:tty` import paths, `isatty`, read/write stream shape, terminal size fallback, raw-mode no-op behavior, and no-color policy.
- `module` builtin facade supports CommonJS and ESM import paths for `builtinModules`, `isBuiltin`, `createRequire`, and a minimal `Module` object.
- `npm run smoke:npm-node` verifies `module` and `node:module` import paths, builtin probes, `createRequire` scoped package lookup, file URL input, and scoped `require.resolve`.
- `string_decoder` builtin facade supports CommonJS and ESM import paths for browser-safe package decoding paths.
- `npm run smoke:npm-node` verifies `string_decoder` and `node:string_decoder` import paths plus `utf8`, `hex`, `latin1`, and `base64` decoding behavior.
- `constants` builtin facade supports CommonJS and ESM import paths for common errno, signal, open flag, and file mode constants used by browser-safe package probes.
- `npm run smoke:npm-node` verifies `constants` and `node:constants` import paths plus representative errno, signal, open flag, and file mode values.
- `diagnostics_channel` builtin facade supports CommonJS and ESM import paths for in-runtime browser-safe instrumentation publish/subscribe hooks.
- `npm run smoke:npm-node` verifies `diagnostics_channel` and `node:diagnostics_channel` import paths, named channel publish/subscribe, unsubscribe, has-subscriber reporting, and tracing channel object shape.
- `dns` policy facade supports CommonJS and ESM import paths for package DNS feature probes while failing lookup/resolve/reverse APIs with explicit DindbOS network capability guidance.
- `npm run smoke:npm-node` verifies `dns` and `node:dns` import paths, resolver/promise/constant shape, and explicit policy errors for DNS lookup/resolve paths.
- `console` builtin facade supports CommonJS and ESM import paths for `Console` plus log/warn/error helpers that write into the NodeCompat output buffer or caller-provided stream-like objects.
- `npm run smoke:npm-node` verifies `console` and `node:console` import paths, default captured output, `Console` custom stream writes, and error/warn helper behavior.
- `http` and `https` policy facades support CommonJS and ESM import paths but fail with explicit DindbOS network capability guidance when used; network APIs belong to a future explicit app sandbox/capability boundary, not NodeCompat.
- `npm run smoke:npm-node` verifies NodeCompat `http`/`https` policy errors for CommonJS and ESM import paths.
- `child_process` and `worker_threads` policy facades support CommonJS and ESM import paths for package feature probes while failing host process and Node worker APIs with explicit DindbOS capability guidance.
- `npm run smoke:npm-node` verifies NodeCompat runtime policy facade shape and policy errors for `child_process`, `node:child_process`, `worker_threads`, and `node:worker_threads`.
- `zlib` policy facade supports CommonJS and ESM import paths for package compression feature probes while failing compression APIs with explicit browser CompressionStream/DindbOS capability guidance.
- `npm run smoke:npm-node` verifies NodeCompat `zlib` and `node:zlib` facade shape, constants, and policy errors.
- ESM transform supports simple re-export barrels through `export { ... } from` and `export * from`, which covers common browser-safe package index modules without pretending to implement full Node loader semantics.
- `npm run smoke:npm-node` verifies default, named, renamed, and star re-export behavior through a VFS-backed `.mjs` fixture.
- ESM transform supports multiline static import/export lists, multiple variable declaration exports, and namespace re-export barrels through `export * as namespace from`, covering more real browser-safe package index modules without claiming full Node loader semantics.
- `npm run smoke:npm-node` verifies multiline import lists, multiline re-export lists, namespace re-exports, and multiple declaration exports through VFS-backed `.mjs` fixtures.
- `npm run smoke:npm-node` verifies package `"type": "module"`, `.cjs`, `.mjs`, JSON import, conditional root/subpath `exports`, and nested dependency conflict resolution.
- `npm run smoke:npm-node` verifies peer dependency recording, optional dependency recording, and unsupported native/lifecycle warning metadata.
- JS-only npm lifecycle scripts are supported only for `node <relative .js/.mjs/.cjs file>` commands; they run through NodeCompat with filesystem access sandboxed to the package root, while shell/native lifecycle commands remain warning-only.
- `npm run smoke:npm-node` verifies sandboxed JS-only postinstall execution, generated package-root output, package-root escape denial, lifecycle lock metadata, and continued warning-only handling for native lifecycle scripts.
- `docs/node-compat.md` documents the supported ESM subset, package resolution behavior, built-in module surface, and unsupported Node features.
- `docs/npm-compat.md` documents the JS-only lifecycle policy and unsupported shell/native lifecycle boundary.

Completion criteria:

- Common browser-safe npm packages can install and run without WebContainers.
- Unsupported Node features fail with specific messages instead of vague runtime errors.
- Compatibility scope is documented enough that users know what to expect.

## 4. Activity Monitor

Status: Done first pass.

Already present:

- Process table UI.
- PID, app, user, state, uptime, and window fields.
- Kill/restart controls.
- `/proc` viewer.
- Process logs.
- `/proc/processes`.
- `/proc/processes.json`.
- `/proc/<pid>/status`.
- `/proc/<pid>/cmdline`.
- `/proc/<pid>/log`.
- `npm run smoke:processes` verifies process log reads, `/proc` cleanup, kill window cleanup, and restart relaunch flow.
- Activity Monitor supports app/state filtering plus PID, app, state, uptime, and runtime sorting; `npm run smoke:processes` verifies the filter/sort logic.
- Process runtime byte estimates are exposed in process lists and `/proc/<pid>/status`; `npm run smoke:processes` verifies the estimate is populated.
- Process crashes write reports under `/var/log/dindbos`; `npm run smoke:processes` verifies the per-crash report and crash index.
- Process activity sampling uses a browser-native event score instead of fake CPU%; Activity Monitor, `/proc/<pid>/status`, and `/proc/processes.json` expose activity score/sample metadata, covered by `npm run smoke:processes`.
- `docs/app-lifecycle.md` defines crash recovery policy: isolate the crash, keep diagnostics, avoid automatic restart, and let Activity Monitor perform manual restart.
- `ProcessManager.restart(pid)` centralizes kill -> relaunch behavior so Activity Monitor and sandboxed process managers use the same restart path; `npm run smoke:processes` verifies restart closes the old window, removes stale `/proc`, and relaunches by app id.
- Parent/child process metadata is recorded when sandboxed apps launch or open other apps; Activity Monitor, `/proc/<pid>/status`, and `/proc/processes.json` expose parent and child PIDs, covered by `npm run smoke:processes`.

Completion criteria:

- Activity Monitor helps debug a real broken app, not just display a static process list.
- Process logs point to actionable failures.
- Restart and kill never leave orphaned windows or stale `/proc` entries.

## 5. Browser.app

Status: In progress.

Already present:

- Browser.app shell with address bar, navigation controls, viewport, and companion status.
- Local HTML file opening through internal document provider.
- Local companion bridge through `ws://127.0.0.1:8787/browser`.
- `scripts/browserd.js` launches Chromium through CDP and streams throttled screencast frames.
- Click, type, key, scroll, resize, reload, back, and forward protocol commands.
- Keyboard forwarding includes printable text, common special keys, and modifier metadata, covered by `npm run smoke:browserd`.
- Browser companion reconnect state emits actionable status and creates a fresh WebSocket after disconnect, covered by `npm run smoke:browser-client`.
- Local VFS HTML renders in an explicit sandbox allowing scripts/forms/popups while denying same-origin and top-navigation privileges.
- `npm run smoke:browser-addresses` verifies Browser.app local HTML sandbox policy and URL scheme rejection.
- Browser.app companion sets a deny-by-default download policy and surfaces attempted downloads as `download-blocked` status instead of silently writing local files.
- `npm run smoke:browserd` verifies a real Chromium download attempt is blocked with the suggested filename reported.
- Browser.app forwards Ctrl/Cmd+V clipboard text into remote companion pages through the explicit `Input.insertText` protocol path.
- `npm run smoke:browser-client` verifies paste helper behavior and the `type` protocol payload sent to the companion.
- Browser.app stores address/title/status/frame/local-document session state in the window state slot so minimize, focus, activation, and render restore paths do not reset visible browser state.
- `npm run smoke:browser-addresses` verifies Browser.app session snapshots; `npm run smoke:window-manager` verifies window state survives minimize/focus/activate.
- Browser.app keeps multiple tab records with active tab state, close/reopen support, and per-tab navigation history in the window state slot.
- `npm run smoke:browser-addresses` verifies tab restore, active tab sync, new tab, close, reopen, and per-tab history behavior.
- Binary frame transport sends Chromium JPEG screencast bytes over WebSocket binary messages and Browser.app renders them through object URLs, covered by `npm run smoke:browserd` and `npm run smoke:browser-client`.
- Browser.app keyboard policy covers address focus, viewport focus restore, remote Tab/Shift+Tab focus movement, and remote modifier shortcuts, covered by `npm run smoke:browser-addresses` and `npm run smoke:browserd`.
- Browser.app accepts configurable browser provider URLs through runtime options or launch context, preserving remote `wss` providers across window session snapshots.
- Browser.app maps provider WebSocket URLs to `/health` using `http` for `ws` and `https` for `wss`, covered by `npm run smoke:browser-client`.
- `browserd` creates an isolated Chromium browser context for each Browser.app WebSocket session so cookies and localStorage do not leak between sessions, covered by `npm run smoke:browserd`.
- Browser.app forwards mobile viewport intent to `browserd`, enabling mobile CDP metrics/touch emulation for narrow or touch-capable viewports, with toolbar/input layout polish for mobile windows.
- Browser.app v1 uses a documented CDP screencast stream policy instead of WebRTC/GPU video. `browserd` advertises `stream.transport: "cdp-screencast"` and `stream.encoding: "binary-jpeg"` in health, Browser.app rejects incompatible stream metadata, and WebRTC is deferred until measured workload targets require it.
- `docs/browserd.md`, `npm run smoke:browserd`, and `npm run smoke:browser-client` cover the stream transport decision and provider compatibility guard.
- Browser.app includes app-specific troubleshooting diagnostics for provider kind, provider health URL, connection state, stream policy, tab/session mode, and next-step advice for local HTML, remote providers, protocol mismatches, and disconnected local `browserd`.
- `npm run smoke:browser-addresses` verifies Browser.app diagnostics for remote provider health mapping, local HTML sandbox advice, connected provider state, tab counts, stream policy, and diagnostics markup.

Completion criteria:

- Browser.app supports both local document browsing and real external browsing.
- The local companion path is documented and testable.
- Browser.app has graceful unsupported-state UX for browsers that cannot run the companion path.

## 6. Document Viewers

Status: Done second pass.

Already present:

- PDF preview through browser iframe/object URL.
- Image preview through object URL.
- Markdown preview with safe escaped rendering.
- Basic text/binary preview fallback.
- HTML document association with Browser.app.
- File associations for PDF, image, markdown, HTML, plain text, and unknown binary are covered by `npm run smoke:viewer`.
- Viewer.app uses adapters for PDF, image, markdown, and fallback previews instead of splitting separate viewer apps.
- Object URLs created for PDF/image previews are revoked after media load/error or before rerender.
- Viewer toolbar includes zoom controls, disabled native page controls, Browser.app handoff for HTML documents, TextEdit handoff for editable text-like documents, export, and copy path.
- `npm run smoke:viewer` verifies Viewer toolbar markup, zoom behavior, editable MIME handoff target selection, disabled edit controls for non-editable documents, and the Viewer.app `app.launch` capability needed for app handoffs.
- Large text previews are bounded with a truncation notice and readable status; binary fallback previews include file-size status, covered by `npm run smoke:viewer`.
- `.deck.html` files use `application/x-dindbos-deck`, resolve to Viewer.app, and render in a sandboxed HTML deck frame.
- `npm run smoke:viewer` verifies deck MIME detection, deck file association, sandboxed deck markup, and bounded deck text preview behavior.
- Viewer.app document/image preview bytes use the runtime Cache API store with memory fallback and stale-key protection from path, MIME type, size, and modified time.
- `npm run smoke:viewer` verifies preview cache namespace, image cache writes/hits, markdown document cache writes, and byte preservation.
- Viewer.app includes an optional PDF.js adapter hook: when a deployment provides `globalThis.pdfjsLib`, PDFs render to a canvas with page previous/next controls; otherwise Viewer.app safely falls back to the native iframe preview.
- `npm run smoke:viewer` verifies the PDF.js canvas surface, fake PDF.js page rendering, page state, and page-control enable/disable behavior.
- PDF.js packaging policy is decided for the current static runtime: DindbOS keeps PDF.js as a deployment-provided optional adapter instead of bundling worker/assets. When `globalThis.pdfjsLib` is missing or fails, Viewer.app shows native PDF preview fallback status instead of implying a bundled renderer.
- `npm run smoke:viewer` verifies the deployment-provided PDF.js policy status for missing, available, and failed adapter paths.
- Viewer.app includes app-specific troubleshooting diagnostics for MIME type, byte size, preview cache eligibility, cache hits/writes, PDF adapter mode, truncation/binary fallback, and next-step advice.
- `npm run smoke:viewer` verifies Viewer.app diagnostics for cacheable markdown, native PDF fallback, large text truncation, and unsupported binary previews.

Completion criteria:

- A portfolio deck, PDF, image, markdown note, and HTML file all open from Files.app with the expected viewer.
- Large or unsupported files fail gracefully.
- Viewer behavior does not corrupt or mutate files.

## 7. Files.app

Status: Done third pass.

Already present:

- Local folder mount button.
- Rename.
- Duplicate.
- Copy/paste.
- Trash.
- Context menu.
- Drag and drop move.
- Permission inspector.
- Breadcrumb.
- Search.
- Import/export.
- Drag and drop upload.
- Local mount permission banner.
- Reconnect/sync/forget controls.
- Copy/move/import/export progress reporting.
- File operation history/log for recent successful and failed operations.
- Rich search filters by text, type, extension, size, modified time, and path.
- `npm run smoke:files` verifies Files.app search query parsing and type/ext/size filter behavior.
- Files.app supports folder and search result sorting by kind/name, name, modified time, and size so large folders can be scanned predictably.
- `npm run smoke:files` verifies Files.app sort ordering for folder-first, alphabetical, largest-first, and newest-first views.
- Files.app caps rendered rows per column while preserving the selected item, reports capped folders in the column/status UI, and stops search traversal after the visible result budget so large folders do not create unbounded DOM work.
- `npm run smoke:files` verifies column capping, selected-row preservation beyond the cap, uncapped folders, and bounded search result collection.
- Multi-select selection model with Ctrl/Cmd toggle and Shift range selection.
- Multi-select Trash/Delete target calculation for operating on several selected files at once.
- `npm run smoke:files` verifies Files.app multi-select helper behavior and multi-action target de-duplication.
- Keyboard navigation supports Up/Down/Home/End selection movement, Left/Right folder traversal, Enter open, Delete to Trash, F2 rename, and Ctrl/Cmd+C/V copy/paste.
- `npm run smoke:files` verifies Files.app keyboard selection movement helper behavior.
- Large tree copy/move/export operations are cancellable through the operation reporter and abort signal checks; `npm run smoke:files` verifies cancellation stops export traversal and records cancelled history.
- Copy, move, import, and export naming paths expose conflict/filename choices for replace, rename, skip, and custom export names; `npm run smoke:files` verifies the non-destructive conflict policies.
- Files.app inspector includes app-specific troubleshooting diagnostics for folder scale, selection count, local mount conflicts, recent operation state, and next-step advice; `npm run smoke:files` verifies the diagnostic summary and conflict/large-folder guidance.
- Files.app rename on same-folder local mount paths uses the runtime local mount move path, which now requires a separate file helper companion for OS-level rename instead of silently performing browser copy-delete.

Completion criteria:

- Files.app can handle realistic project folders without confusing state.
- Local mount operations are visible, cancellable, and recoverable.
- File operations preserve permissions and bytes where the model supports it.

## 8. Window Manager

Status: Done first pass, desktop polish remaining.

Already present:

- Open/focus/close/minimize/maximize windows.
- Task strip rendering.
- Draggable windows.
- Resizable windows.
- Cascading initial positions.
- Process state updates tied to window state.
- Viewport resize constraints keep windows reachable, covered by `npm run smoke:window-manager`.
- Singleton and non-singleton launch behavior is covered by `npm run smoke:app-registry`.
- Edge snap zones, Alt-Tab focus cycling, z-index focus promotion, active class toggling, and Ctrl/Meta keyboard shortcuts for minimize/close are covered by `npm run smoke:window-manager`.
- Window placements persist under `/var/lib/dindbos/window-placements.json` and are clamped into the current viewport when restored; `npm run smoke:window-manager` verifies persistence and restore behavior.
- Mobile viewport policy starts windows as a single reachable maximized panel instead of restoring cramped desktop coordinates; `npm run smoke:window-manager` verifies mobile viewport detection and placement.
- Minimize uses a stable delayed-hide animation state instead of immediately removing the window from layout; `npm run smoke:window-manager` verifies the animation state, delayed hide, and focus restore behavior.

Completion criteria:

- Window behavior feels predictable under repeated open/minimize/maximize/focus cycles.
- Keyboard users can switch and close windows without using the mouse.
- Mobile behavior is deliberate instead of an accidental cramped desktop.

## 9. Users And Permissions

Status: Early permission model present, user/session model remaining.

Already present:

- Session user concept.
- chmod-style permission checks.
- Terminal filesystem operations run with the session principal instead of implicit root/system access.
- Shell script execution enforces the script file execute bit.
- App launcher `.app` nodes enforce execute permission before `openPath` launches the app, covered by `npm run smoke:permissions`.
- Package JavaScript entry files are readable app code, not executable programs; `/usr/share/applications/*.app` launchers are the executable app boundary.
- `npm run smoke:packages` verifies package JS entries remain non-executable while AppRegistry launch still works.
- App manifests declare filesystem read/write scopes.
- App sandbox gives apps scoped runtime access instead of the raw OS object.
- Permission-denied smoke covers Terminal reads/writes, app sandbox filesystem scopes, package capability denial, and local mount capability denial.
- Denied app capability requests include actionable app id, capability, path, and `sandbox denied`/`capability denied` messages, covered by `npm run smoke:permissions`.
- `su` and `sudo` are explicit shell placeholders that fail with a browser-runtime fixed-session explanation instead of pretending to elevate privileges.
- `npm run smoke:shell` verifies `su`/`sudo` unsupported status and chaining behavior.
- Session users are normalized into browser-safe names and receive generated `/home/<user>` workspaces with Desktop, Documents, Downloads, `.Trash`, and `.profile`.
- VFS file/directory creation now defaults ownership to the caller principal so non-guest session writes are owned by the active user.
- Built-in app manifests use the active session home for document read/write scopes instead of hard-coded `/home/guest`, covered by `npm run smoke:sessions`.
- VFS path traversal enforces execute permission on parent directories before read, write, stat, copy, move, chmod, and app sandbox resolve/stat/exists access.
- `npm run smoke:permissions` verifies that a world-readable file inside non-executable `/root` is still blocked by traversal permissions.
- Login session state exists as an OS primitive: the runtime exposes `sessionStatus()`, `lockSession()`, and `unlockSession()`, persists status under `/var/run/dindbos/session.json`, emits `session:lock`/`session:unlock`, and blocks Shell plus app/path launch while locked.
- `npm run smoke:sessions` verifies session status persistence, lock/unlock events, locked shell denial, locked file-open denial, and unlocked shell recovery.
- User/group management exists as a runtime registry under `/etc/dindbos/users.json`, with `listUsers()`, `listGroups()`, `createUser()`, `createGroup()`, `addUserToGroup()`, and `removeUserFromGroup()` APIs. Creating a user sanitizes browser-safe ids, persists group membership, and creates the owned home workspace.
- `npm run smoke:sessions` verifies active-session registration, user/group creation, membership add/remove, persisted registry records, duplicate-user denial, and generated home ownership.

Completion criteria:

- Permissions are enforced consistently across Terminal, Files.app, packages, and built-in apps.
- Users can understand why an operation was blocked.
- The model remains browser-native and does not pretend to be real OS security.

## 10. Developer Experience

Status: Partial docs present, onboarding and examples remaining.

Already present:

- README project shape.
- `docs/app-apis.md`.
- `docs/app-manifest.md`.
- `docs/shell.md`.
- `docs/storage.md`.
- `docs/npm-compat.md`.
- `docs/node-compat.md`.
- `docs/browserd.md`.
- `docs/package-signatures.md`.
- `docs/app-lifecycle.md`.
- `docs/first-app.md`.
- README Browser Companion section documents local companion startup, health check, Chrome path override, focused browser smoke tests, and the `docs/browserd.md` handoff.
- README Verification section lists the broad `npm run smoke` gate and focused runtime smoke commands.
- README Troubleshooting section covers storage reset, local mount permissions, Chrome detection, and npm package limitations.
- `docs/app-manifest.md` includes manifest examples for a simple app, file viewer, package app, and app with npm dependencies.
- `docs/shell.md` documents shell status codes, chaining semantics, pipes/redirection, shebang support, script limits, and shell verification.
- `docs/support.md` documents supported browser targets, Chromium-only workflows, stability labels, manifest/registry versioning expectations, and local environment safety.
- `docs/first-app.md` walks a contributor through a package manifest, install command, launcher path, and package smoke verification.
- `docs/app-apis.md` documents sandboxed filesystem, process, storage, package, npm, NodeCompat, local mount, app launch, and Browser.app handoff APIs.
- `docs/package-signatures.md` documents the remote package trust model, publisher key format, signed manifest payload, trust states, trusted publisher commands, and verification failure UX.
- `docs/app-lifecycle.md` documents install, update, first-run, launch, ready, focus, suspend/resume limits, crash, close, uninstall cleanup, uninstall, current hooks, limits, and lifecycle verification commands.
- Sample package/app paths in the runtime, including Hello Notes for Notes, Paint Sample for a canvas tool, PDF Viewer Sample for a file-viewer manifest, and API Lab for a richer third-party API proof.
- Local sample package sources and the local registry are kept in sync for Hello Notes, API Lab, Paint Sample, and PDF Viewer Sample; `npm run smoke:boot` and `npm run smoke:packages` verify their source manifests, registry entries, install paths, associations, and launch render paths.

Completion criteria:

- A new contributor can build and install a small DindbOS app without reading source first.
- Runtime limitations are explicit and not discovered only by failure.
- Docs match actual commands and app behavior.

## 11. Release And Project Hygiene

Status: Partial release hygiene present; demo deployment alignment remaining.

Already present:

- `.github/PULL_REQUEST_TEMPLATE.md` includes verification and runtime checklists for storage, package, browser, and permission changes.
- GitHub issue templates exist for app compatibility, storage loss, and Browser.app companion failures.
- GitHub Pages demo deployment is reproducible through `.github/workflows/pages.yml`: pushes to `main` run `npm run smoke`, upload the static runtime root as the Pages artifact, and deploy through GitHub Pages.
- `docs/support.md` defines minimum browser support, Chromium-specific local mount and Browser.app companion workflows, manifest/registry versioning expectations, and credential/local environment file policy.
- `docs/changelog.md` tracks the current Unreleased runtime changes, known limits, and release checklist before version tags.
- `npm run smoke:pages-workflow` verifies the Pages workflow deploy gate, static artifact path, `.nojekyll`, and current runtime cache-buster wiring for the demo entrypoint.

Completion criteria:

- Demo deployment is reproducible.
- Project docs describe what is stable, experimental, and unsupported.
- Runtime changes have a consistent verification path before PR.

## Milestone Plan

### Milestone A: Browser Proof Point

Goal: Browser.app can reliably open local HTML and real external URLs.

Tasks:

- Continue provider/native-adjacent hardening only where smoke coverage exposes a real gap.

### Milestone B: Runtime Confidence

Goal: Storage, npm install, NodeCompat, and process visibility have enough verification to support continued work.

Tasks:

- Add focused smoke coverage when a new risky browser-runtime path is introduced.

### Milestone C: Document Workloads

Goal: Portfolio documents open naturally from the desktop.

Tasks:
- No open document workload polish task is currently identified; add new work here only when smoke coverage or real usage exposes a gap.

### Milestone D: Package And App Platform

Goal: Third-party DindbOS apps can be built, installed, updated, and debugged.

Tasks:

- Expand NodeCompat only in directions that support browser-safe packages.

### Milestone E: Desktop Polish

Goal: The OS shell feels stable under normal daily interaction.

Tasks:

- No open desktop polish task is currently identified; add new work here only when smoke coverage or real usage exposes a gap.
