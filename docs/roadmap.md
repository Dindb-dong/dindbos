# DindbOS.js Roadmap

Last updated: 2026-05-05

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

Status: Done first pass.

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

Status: Done first pass.

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

- No open scriptable userland task is currently identified; add new work here only when smoke coverage or real browser-safe package usage exposes a gap.

### Stage 4: Real Apps On Runtime APIs

Status: Done first pass, third-party API hardening continues through package milestones.

Goal: Built-in and third-party apps behave like OS apps because they consume runtime services.

Already present:

- Files.app uses shared VFS/local mount APIs.
- Activity Monitor reads process state and `/proc`.
- Browser.app uses local HTML provider and companion bridge.
- TextEdit saves into shared VFS.
- Viewer.app opens real file bytes through object URLs.
- API Lab sample package installs from `/opt/dindbos/packages/api-lab/dindbos.app.json` and proves third-party access to the syscall SDK for sandboxed filesystem writes, package metadata reads, current-process reads, and process logging.
- App sandbox exposes per-app `os.state` JSON persistence under `/var/lib/dindbos/app-state/<appId>.json`; state survives close, relaunch, update, and VFS reload while package uninstall cleanup removes the app state record.
- `docs/app-apis.md` documents app-facing filesystem, syscall SDK, process, storage, app state, package, npm, NodeCompat, local mount, app launch, and Browser.app handoff APIs.
- App capability and filesystem-scope failures throw explicit `capability denied` or `sandbox denied` errors; `npm run smoke:permissions` verifies these messages for process, package, local mount, and filesystem denials.
- TextEdit, Viewer.app, and Browser.app use user-document read scopes for file-open paths instead of root filesystem read scope.
- `npm run smoke:packages` launches API Lab through AppRegistry and verifies its rendered output, SDK-backed `/home/guest/DindbOS API Lab/report.txt` write, SDK-backed package metadata read, SDK-backed process log side effect, app state relaunch restore, app state VFS reload restore, and uninstall cleanup.
- `npm run smoke:permissions` verifies app state namespace isolation and JSON-serializable value enforcement.
- `npm run smoke:viewer` verifies TextEdit and Viewer.app reject root-owned files outside their app sandbox scopes.

### Stage 5: External Capability Bridges

Status: Done first pass; future bridge work is capability-specific and demand-driven.

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

## Native OS Convergence Roadmap

This section tracks work that is technically possible inside the browser, even when it is hard, expensive, or requires optional helper processes. These items should move DindbOS closer to a native operating system without lying about the browser sandbox.

The principle is strict: each item must create a reusable OS primitive. A terminal demo, a fake process row, or a one-off app shortcut does not count. The work counts only when apps, shell commands, packages, and tests can all use the same runtime boundary.

### Convergence 1: Browser-Native Syscall ABI

Status: In progress.

Goal: define a stable syscall-style interface between user programs and the DindbOS runtime.

Why it matters:

- Native OSes are not just UI shells; user programs call a kernel boundary.
- DindbOS already has kernel services, but apps currently use higher-level JavaScript APIs.
- A syscall ABI gives scripts, WASM programs, NodeCompat packages, and future language runtimes one common low-level contract.

Implementation tasks:

- Already present: a named first-pass syscall table covers clock, entropy, filesystem existence/stat/read/write, environment reads, app metadata, package metadata, storage diagnostics, local mount diagnostics, process list/get/log, and app launch.
- Already present: `os.syscall(name, args)` returns structured `{ ok, value }` or `{ ok: false, error: { code, message, syscall } }` results.
- Already present: Terminal exposes raw ABI calls through `syscall <name> [json]`.
- Already present: sandboxed apps receive `os.syscall()` and use the same manifest filesystem scopes and capability checks as high-level facades.
- Already present: syscall tracing writes `/var/log/dindbos/syscall.log` and `/proc/<pid>/syscalls` for process-backed calls.
- Already present: `docs/syscalls.md` documents the current ABI, errno-style failures, shell usage, tracing, and browser-native compatibility boundary.
- Route existing high-level app APIs through the syscall layer where practical, instead of letting every surface call kernel services differently.
- Expand the syscall table to terminal IO, environment mutation, package lifecycle actions, storage management actions, and local mount management actions.
- Add ABI stability/version negotiation rules once a second caller runtime, such as WASM or workers, starts targeting it.

Verification:

- Already present: `npm run smoke:shell` verifies raw shell `syscall` write/read calls and `ENOSYS` for unknown syscalls.
- Already present: `npm run smoke:packages` verifies a sandboxed package app writes/reads/logs through `os.syscall()` and emits `/proc/<pid>/syscalls` plus global syscall traces.
- Already present: `npm run smoke:shell` verifies env, app, package, storage, and local mount diagnostic syscalls.
- Already present: `npm run smoke:packages` verifies sandboxed package metadata access through syscall tracing.
- Already present: `npm run smoke:permissions` verifies invalid raw syscall arguments return `EINVAL` and shell/sandbox permission denials return `EACCES`.
- Add smoke coverage proving the same operation through NodeCompat and future WASM/worker callers once those runtimes target the ABI.
- Add focused regression tests for future syscall families when terminal IO, mutation, and management actions are implemented.

Completion criteria:

- Third-party code can target the syscall table without importing private runtime internals.
- Unsupported syscalls fail explicitly with `ENOSYS`.
- Syscall logs are useful for debugging broken apps and packages.

### Convergence 2: WASM User Processes

Status: In progress.

Goal: run WebAssembly programs as first-class DindbOS processes with VFS, stdin/stdout/stderr, arguments, environment variables, and syscall access.

Why it matters:

- WASM is the browser path closest to native binary execution.
- This is the realistic route for C, Rust, Zig, Go, and TinyGo-style programs inside DindbOS.
- It moves DindbOS from "JavaScript apps only" toward a real multi-runtime userland.

Implementation tasks:

- Already present: `WasmRunner` executes `.wasm` modules from VFS paths through browser `WebAssembly.instantiate`.
- Already present: shell integration supports executable `.wasm` files and explicit `wasm <file> [args...]` runs.
- Already present: WASM runs spawn DindbOS processes with argv, cwd, environment, exit status, stdout, stderr, and process history.
- Already present: the `dindbos` WASM import namespace exposes stdout/stderr helpers, argv/env helpers, `syscall(ptr,len)`, and `exit(code)`.
- Already present: first-pass WASM syscalls map to the DindbOS syscall ABI and are covered by global syscall tracing.
- Already present: package manifests support DindbOS ABI WASM entry points through `app.runtime: "wasm"` or `.wasm` entries, launched through AppRegistry and rendered into package windows.
- Already present: a basic `wasi_snapshot_preview1` import subset covers args/env sizing and buffers, `fd_write` for stdout/stderr, `proc_exit`, `random_get`, and `clock_time_get`.
- Expand WASI-style imports where possible, mapped to the DindbOS syscall ABI and future descriptor tables.
- Already present: a first-pass process descriptor table exists for stdin/stdout/stderr, text VFS files, and basic pseudo-devices; WASI file descriptor mapping remains future work.
- Already present: stdout/stderr-only DindbOS ABI and basic WASI modules can opt into worker execution through `ProcessExecutor` output buffers.
- Already present: direct WASM `runFile` calls can pass explicit filesystem and capability scopes beyond the executable-directory default.
- Already present: WASM trap paths flow through process crash handling and return crash report paths for `/var/log/dindbos/crash-<pid>.log` diagnostics.
- Already present: first-pass `maxMemoryPages` guards stop oversized WASM runs before `_start` in the main runner and worker output backend.
- Already present: WASM modules can opt into cooperative `checkDeadline()` timeout and abort handling in the main runner and worker output backend.
- Already present: `checkDeadline()` also rechecks `maxMemoryPages`, so modules can opt into grow-time memory enforcement after `memory.grow`.
- Already present: `docs/wasm-toolchains.md` documents C, Rust, Zig, and TinyGo examples for the supported WASM/WASI target shape.

Verification:

- Already present: `npm run smoke:wasm` verifies shell execution, argv/env stdout, syscall-backed file write, syscall tracing, nonzero exit status, and process tracking.
- Already present: `npm run smoke:wasm` verifies permission-denied syscall behavior, EACCES syscall tracing, trap crash report files, and crash index entries.
- Already present: `npm run smoke:wasm` verifies basic WASI `fd_write` stdout and `proc_exit`.
- Already present: `npm run smoke:wasm` verifies worker-backed WASM stdout, exit status, and process backend history for output-only modules.
- Already present: `npm run smoke:wasm` verifies `maxMemoryPages` crash reporting in the main runner and worker memory-limit denial.
- Already present: `npm run smoke:wasm` verifies explicit direct-run filesystem scopes can allow a WASM syscall write outside the executable directory while the default scope denies it.
- Already present: `npm run smoke:wasm` verifies cooperative `checkDeadline()` timeout and abort handling in the main runner plus worker abort denial.
- Already present: `npm run smoke:wasm` verifies cooperative grow-time memory enforcement after `memory.grow` in the main runner and worker output backend.
- Already present: WASM toolchain docs describe compatible C/Rust/Zig/TinyGo CLI examples, scoped files, package manifests, and cooperative limits.
- Already present: `npm run smoke:packages` verifies a WASM-backed package install, AppRegistry launch, stdout rendering, package-scoped syscall write, and package removal.

Completion criteria:

- A small WASI-compatible program runs from Terminal without special UI handling.
- WASM process state appears in Activity Monitor and `/proc`.
- WASM cannot escape its declared filesystem and capability scopes.

### Convergence 3: Real Process Isolation With Workers

Status: In progress.

Goal: move risky or heavy userland execution out of the main UI thread into Web Workers or dedicated worker pools.

Why it matters:

- Native OSes isolate processes so one busy program does not freeze the desktop.
- DindbOS currently has process accounting and crash isolation, but much of the runtime still shares the browser main thread.
- Worker-backed execution is the browser-native version of stronger process isolation.

Implementation tasks:

- Already present: `ProcessExecutor` provides main-thread and worker execution backends for runtime-managed CPU task processes.
- Already present: worker executor syscall tasks use a message-based bridge back to the runtime kernel instead of direct VFS access.
- Already present: worker executor syscall tasks can transfer binary `ArrayBuffer` payloads back to the runtime output buffer.
- Already present: worker-backed executor tasks support process kill termination, timeout crash propagation, and completion cleanup.
- Already present: worker executor syscall tasks return stdout, stderr, binary-byte, and syscall result buffers.
- Already present: stdout/stderr-only WASM programs can run in dedicated workers and return output/status through the worker executor output buffer.
- Move syscall-heavy WASM and NodeCompat programs behind the worker syscall bridge where the runtime ABI can preserve permission checks.
- Already present: `/proc/<pid>/status` and `/proc/processes.json` expose runtime, execution backend, executor state, executor kind, and executor detail.
- Already present: Activity Monitor distinguishes execution backend and executor state in the process table/detail view.

Verification:

- Already present: `npm run smoke:processes` verifies a CPU-heavy worker process does not block main-runtime process spawning while it is busy.
- Already present: `npm run smoke:processes` verifies worker completion cleanup, timeout crash reporting, kill termination, `/proc` backend reporting, and Activity Monitor backend filtering data.
- Already present: `npm run smoke:processes` verifies worker stdout/stderr delivery, binary transfer, syscall-backed VFS write/read, syscall tracing, and VFS scope denial.
- Already present: `npm run smoke:wasm` verifies worker-backed WASM stdout/status delivery and worker backend process history for output-only modules.
- Add tests for syscall-heavy WASM and NodeCompat VFS syscall denial once those runtimes use the worker syscall bridge directly.

Completion criteria:

- Heavy package/WASM execution can be killed from Activity Monitor.
- The desktop remains responsive while a worker process is busy.
- Worker processes use the same permission and syscall boundaries as main-thread apps.

### Convergence 4: File Descriptors, Pipes, And Device Nodes

Status: In progress.

Goal: add a descriptor table model that supports files, pipes, terminals, sockets, and pseudo-devices consistently.

Why it matters:

- Native userland depends on file descriptors, not only path-based file APIs.
- Pipes and device files are the foundation for serious shell scripting, WASM/WASI compatibility, and process IO.

Implementation tasks:

- Already present: per-process descriptor tables initialize `stdin`, `stdout`, and `stderr`, expose opened file/device handles under `/proc/<pid>/fd.json`, and clean up when the process exits or crashes.
- Already present: first-pass descriptor syscalls cover `fd.list`, `fd.open`, `fd.read`, `fd.write`, `fd.seek`, `fd.stat`, and `fd.close` for text VFS files.
- Already present: WASI `fd_write` for stdout/stderr writes through the shared descriptor table instead of a separate direct output path.
- Already present: WASI `fd_read` reads through the shared descriptor table, including stdin supplied by shell pipelines and `runFile({ stdin })`.
- Already present: WASI programs receive a preopened cwd descriptor and can use `path_open` plus `fd_read`/`fd_write`/`fd_close` for scoped VFS file read/write through opened descriptors.
- Already present: WASI `path_open` maps first-pass `rightsBase` read/write rights onto descriptor read/write checks.
- Already present: WASI `fd_readdir` can enumerate directory descriptors such as the preopened cwd.
- Already present: WASI `path_create_directory` can create directories under a scoped directory descriptor.
- Already present: WASI `path_unlink_file` and `path_remove_directory` can remove files and directories under a scoped directory descriptor.
- Already present: WASI `path_rename` can rename files and directories between scoped directory descriptors.
- Already present: WASI `path_symlink` and `path_readlink` can create and inspect scoped symlink metadata through the shared VFS.
- Already present: WASI `path_link` creates VFS hard-link-like file aliases with shared write behavior and link-count metadata.
- Already present: WASI `fd_filestat_get` and `path_filestat_get` expose first-pass type, size, link count, timestamp, and stable inode metadata from descriptors and scoped paths.
- Already present: WASI `fd_fdstat_get` exposes first-pass descriptor file type, append flag, and read/write rights for preopened directories and opened files.
- Already present: shell pipelines pass segment output through transient pipe descriptors owned by a short-lived `shell:pipeline` process while preserving existing shell pipeline output semantics.
- Already present: runtime pipe objects can be attached across process descriptor tables, allowing descriptor-backed multi-process pipe chaining.
- Already present: `fd.ioctl` exposes first-pass TTY control requests for window size and `isatty` checks, returning `ENOTTY` for non-TTY descriptors.
- Already present: `/dev/null`, `/dev/zero`, `/dev/random`, and `/dev/urandom` can be opened through descriptor syscalls.
- Already present: `/dev/tty` can be opened through descriptor syscalls and maps reads/writes to the process stdin/stdout streams.
- Already present: `/dev/clipboard` can be opened through descriptor syscalls and maps reads/writes to the DindbOS runtime clipboard service inside the browser policy boundary.
- Already present: Terminal.app creates a DindbOS pseudo-terminal session; PTY-backed processes share TTY size, input, and output through standard streams and `/dev/tty`.
- Broaden WASI descriptor coverage beyond the first scoped `path_open` rights/flags, directory read, directory mutation, rename, symlink, and hard-link subset.

Verification:

- Already present: `npm run smoke:descriptors` verifies descriptor open/read/write/seek/close, `/dev/null`, `/dev/zero`, `/proc/<pid>/fd.json`, and descriptor cleanup after process kill or crash.
- Already present: `npm run smoke:wasm` verifies WASI `fd_read` from stdin plus shell pipeline stdin delivery into executable `.wasm` files.
- Already present: `npm run smoke:wasm` verifies WASI `path_open` read/write against scoped VFS files through opened descriptors.
- Already present: `npm run smoke:descriptors` verifies `/dev/tty` output through the process stdout stream.
- Already present: `npm run smoke:descriptors` verifies `/dev/clipboard` descriptor writes update the runtime clipboard and descriptor reads return clipboard chunks.
- Already present: `npm run smoke:descriptors` verifies PTY-backed `/dev/tty` size, input reads, output writes, stdout mirroring, and descriptor cleanup.
- Already present: `npm run smoke:descriptors` verifies `fd.ioctl` TTY size get/set, stdout `isatty`, and non-TTY `ENOTTY` behavior.
- Already present: `npm run smoke:shell` verifies shell pipeline output is delivered through descriptor-backed transient pipeline processes and that descriptor/procfs cleanup runs after pipeline exit.
- Already present: `npm run smoke:descriptors` verifies `/dev/zero`, `/dev/random`, and `/dev/urandom` report the actual pseudo-device byte count from `fd.read.bytes`.
- Already present: `npm run smoke:wasm` verifies read-only WASI `rightsBase` denies descriptor writes with `EBADF`.
- Already present: `npm run smoke:wasm` verifies WASI `fd_readdir` returns directory records from the preopened cwd descriptor.
- Already present: `npm run smoke:descriptors` verifies writer, middle, and reader processes can chain bytes through attached pipe descriptors and that closed pipes are removed from the pipe registry.
- Already present: `npm run smoke:wasm` verifies WASI `path_create_directory` creates a directory under the preopened cwd descriptor.
- Already present: `npm run smoke:wasm` verifies WASI `path_unlink_file` and `path_remove_directory` remove scoped files and directories.
- Already present: `npm run smoke:wasm` verifies WASI `path_rename` renames scoped files and directories while preserving file bytes.
- Already present: `npm run smoke:wasm` verifies WASI `path_symlink` creates a link, `path_readlink` returns the link target, and VFS reads through the symlink.
- Already present: `npm run smoke:wasm` verifies WASI `path_link` creates a hard-link-like alias, preserves bytes, shares writes, survives source removal, and updates link counts.
- Already present: `npm run smoke:wasm` verifies WASI `path_filestat_get` and `fd_filestat_get` report file type and size for a scoped VFS file.
- Already present: `npm run smoke:wasm` verifies WASI `fd_fdstat_get` reports descriptor type and read rights for a preopened directory and opened file.
- Add smoke coverage for broader WASI metadata edge cases as more WASI calls are mapped.

Completion criteria:

- Shell, WASM, and NodeCompat can share the same descriptor-backed IO path.
- Process crashes do not leave open descriptors or stale pipe state.

### Convergence 5: Virtual Networking Stack

Status: In progress.

Goal: provide explicit network primitives without giving apps unrestricted browser fetch access.

Why it matters:

- A native OS has sockets, DNS policy, firewall rules, and network diagnostics.
- Browser security prevents raw sockets, but DindbOS can still expose a controlled virtual network stack over Fetch, WebSocket, WebRTC data channels, and optional companions.

Implementation tasks:

- Add a network permission model: `net.fetch`, `net.websocket`, `net.webrtc`, `net.dns`, and host allowlists.
- Implement a runtime network broker so apps request network operations through DindbOS instead of calling `fetch` directly.
- Add `/proc/net` diagnostics for active requests, WebSocket sessions, denied hosts, and bandwidth estimates.
- Add Terminal commands such as `netstat`, `curl`, `ping` policy probe, and `dig` policy probe where browser APIs allow.
- Add package manifest network scopes.
- Add traffic logging with redaction rules so debugging is possible without leaking secrets.
- Add optional companion protocol for capabilities browsers cannot expose, such as raw TCP/UDP experiments, only behind explicit trust prompts.

Verification:

- Add smoke coverage for allowed fetch, denied host, WebSocket open/close, request cancellation, and `/proc/net` reporting.
- Add tests proving apps without network permission cannot bypass the broker through runtime APIs.

Completion criteria:

- Apps can perform declared network work through a visible, auditable OS boundary.
- Network denial is deterministic and explainable.
- Browser-only and companion-enhanced network capabilities are clearly separated.

### Convergence 6: Multi-User Sessions And Access Control

Status: Later.

Goal: strengthen the current session/user model into a fuller multi-user environment.

Why it matters:

- Native OS behavior depends on users, groups, ownership, process credentials, and login/session boundaries.
- DindbOS already has session user and ownership primitives, but it needs stronger cross-user behavior to feel OS-like.

Implementation tasks:

- Add persistent user and group records under `/etc/dindbos/users.json` and `/etc/dindbos/groups.json`.
- Add login, logout, lock, unlock, password/passkey placeholder policy, and guest reset behavior.
- Track process credentials: uid, gid, supplementary groups, effective permissions, and session id.
- Expand chmod/chown/chgrp behavior across VFS and local mount metadata where possible.
- Add per-user homes, app state, cache, package preferences, shell history, and desktop layout.
- Add administrator-only operations for package trust, system settings, and companion permissions.
- Add audit logs for permission escalation, denied access, package trust changes, and companion pairing.

Verification:

- Add smoke coverage for cross-user file denial, group access, admin-only command denial, session switch, and per-user app state separation.

Completion criteria:

- Two users can share one DindbOS installation without reading each other's private home files by default.
- Runtime APIs consistently use process credentials instead of a global current user shortcut.

### Convergence 7: Stronger Storage Semantics

Status: Later.

Goal: make browser-backed storage behave more like a real disk with transactions, snapshots, quotas, repair, and optional encryption.

Why it matters:

- A native OS must survive crashes, interrupted writes, quota pressure, and partial corruption.
- DindbOS already persists files, but native-like reliability requires a clearer disk layer.

Implementation tasks:

- Add a journal or transaction log for multi-file operations.
- Add atomic rename/write semantics for package installs, editor saves, and archive imports.
- Add filesystem snapshots and rollback points for package updates and user-triggered restore.
- Add quota reservation before large writes and package installs.
- Add `fsck`-style integrity checks for inode/content mismatches, orphaned content records, broken mount metadata, and package DB drift.
- Add optional per-user encrypted volumes using WebCrypto-derived keys.
- Add storage pressure handling that can evict cache volumes without touching durable user files.

Verification:

- Add smoke coverage for simulated interrupted writes, package rollback, snapshot restore, quota denial before mutation, and repair of orphaned records.

Completion criteria:

- DindbOS can explain and recover from common storage failure states.
- Durable user files are not silently replaced by partial writes.

### Convergence 8: Scheduler, Resource Accounting, And Quotas

Status: Later.

Goal: replace coarse process bookkeeping with enforceable runtime resource policy.

Why it matters:

- A native OS schedules CPU time, memory, IO, and process limits.
- Browsers do not expose full CPU control, but DindbOS can enforce cooperative limits around worker execution, async operations, storage, network, and app launches.

Implementation tasks:

- Add process groups and job control concepts for shell-launched pipelines.
- Add per-process and per-app limits for runtime memory estimate, output buffer size, open descriptors, file writes, network requests, and child processes.
- Add cooperative yield requirements for long-running built-in operations.
- Add kill escalation: graceful cancel, forced worker termination, crash report, descriptor cleanup.
- Add Activity Monitor views for resource limits, usage, throttling, and kill reason.
- Add package manifest resource hints and maximums.

Verification:

- Add smoke coverage for output quota, descriptor quota, child process limit, long-operation cancellation, and worker forced termination.

Completion criteria:

- A misbehaving app can be throttled or killed without corrupting shared runtime state.
- Resource policy is visible to users and package authors.

### Convergence 9: Native-Adjacent Companion Framework

Status: Later.

Goal: split optional native capabilities into small, named, auditable companions instead of expanding one privileged bridge.

Why it matters:

- The browser cannot provide every native OS feature.
- DindbOS can still get closer to native behavior by using explicit helper processes with narrow protocols and clear trust boundaries.

Implementation tasks:

- Define a companion registry with identity, protocol version, capabilities, health checks, and pairing state.
- Keep `browserd` browser-only and add separate companion identities for file helper, network helper, device helper, and build/runtime helper.
- Add a user approval flow for pairing each companion and granting capabilities.
- Add signed companion manifests and protocol compatibility checks.
- Add `/etc/dindbos/companions.json` and Settings UI for revoke, inspect, and test.
- Add audit logging for every companion operation that touches host-adjacent capabilities.
- Add failure UX that keeps DindbOS usable when companions are absent.

Verification:

- Add smoke coverage for companion identity mismatch, missing capability, revoked pairing, protocol mismatch, and successful helper operation.

Completion criteria:

- Host-adjacent features are opt-in, inspectable, revocable, and separated by protocol.
- No app receives direct companion access without the DindbOS runtime broker.

### Convergence 10: Language Runtime And SDK Layer

Status: Later.

Goal: let developers build real DindbOS programs in more than one language/runtime.

Why it matters:

- Native OS ecosystems are useful because many runtimes can target the same platform.
- DindbOS should expose a stable SDK over syscalls, package manifests, permissions, VFS, processes, and UI handoff.

Implementation tasks:

- Already present: JavaScript syscall SDK wrappers are exposed to package apps as `sdk`, with typed helper groups for clock, entropy, filesystem, descriptors, environment, apps, packages, storage, local mounts, and processes.
- Already present: `src/dindbos/sdk.d.ts` declares the JavaScript SDK surface for TypeScript consumers, and `npm run smoke:sdk` checks that the declaration still covers the runtime helper groups.
- Already present: `docs/wasm-toolchains.md` gives first-pass C/Rust/Zig/TinyGo examples for toolchains that produce compatible WASI modules.
- Already present: installable GUI app, CLI app, WASM CLI, and background worker package templates are seeded under `/opt/dindbos/templates`.
- Already present: `scripts/helpers/dindbos-test-runtime.js` creates reusable test runtimes with real VFS, AppRegistry, AppSandbox, PackageManager, ProcessManager, DescriptorManager, SyscallDispatcher, WasmRunner, EventBus, and in-memory window surfaces.
- Already present: package manifests can declare exact API versions or `api.minVersion` / `api.targetVersion` / `api.maxVersion` ranges; PackageManager negotiates supported version 1 or fails before package mutation when no supported API version exists.
- Already present: `docs/developer-guide.md` documents permissions, filesystem scopes, process lifecycle, app state, package signing/trust, SDK/syscalls, compatibility/API limits, browser/companion boundaries, and package-author verification steps.

Verification:

- Add example packages that install and run through the normal package system.
- Already present: `npm run smoke:packages` installs and launches the GUI, CLI, WASM CLI, and background worker package templates through the normal package manager path.
- Already present: `npm run smoke:packages` verifies API Lab uses the package `sdk` fixture through AppRegistry launch and performs real SDK-backed VFS writes, package metadata reads, process reads/logging, syscall tracing, app state restore, and uninstall cleanup.
- Already present: `npm run smoke:packages` boots package tests through the reusable DindbOS runtime test helper instead of local fake package/process/window internals.
- Already present: `npm run smoke:packages` verifies API version range negotiation to runtime API v1 and unsupported exact future API refusal before package files, records, or app registration mutate.
- Already present: `npm run smoke:sdk` verifies the TypeScript declaration covers the SDK helper groups and core syscall names.
- Already present: `npm run smoke:docs` verifies the developer guide keeps the required package-author sections and key runtime terms.
- Add smoke coverage that builds or loads broader SDK fixtures across app, CLI, worker, and WASM-adjacent callers.

Completion criteria:

- A third-party developer can create, package, install, run, debug, and remove a DindbOS app without editing core runtime files.

### Convergence 11: Background Services And Daemons

Status: Later.

Goal: support long-lived background services with explicit lifecycle, permissions, and user visibility.

Why it matters:

- Native OSes have daemons, agents, and background jobs.
- DindbOS needs an equivalent for indexing, sync, package update checks, companion monitoring, and scheduled maintenance.

Implementation tasks:

- Already present: `ServiceManager` registers runtime-managed service manifests and starts services as `service:<id>` DindbOS processes with `/proc` visibility and crash-report integration.
- Already present: service states cover `disabled`, `stopped`, `starting`, `running`, `suspended`, `degraded`, and `crashed`, with records persisted under `/var/run/dindbos/services.json`.
- Already present: scheduled service runs are represented by `runScheduled()`, run counters, last-run timestamps, service logs under `/var/log/dindbos/services.log`, and `service:scheduled-run` / `service:degraded` events.
- Already present: Settings reads `os.services.list()` and renders service status plus restart/disable controls through the sandboxed `service.read` / `service.manage` facade.
- Already present: Activity Monitor detects selected `service:<id>` processes and renders service metadata, service logs, restart controls, and disable controls through the sandboxed `service.read` / `service.manage` facade.
- Already present: Activity Monitor service detail includes a permission review of service manifest capabilities, filesystem read/write scope, and schedule metadata.
- Already present: first-pass service `suspend(reason)` and `resume(reason)` hooks emit lifecycle events; `DindbOS.installServiceLifecycleHooks()` wires `visibilitychange`, `pagehide`, and `pageshow` so browser page lifecycle events suspend/resume service records before persistence lifecycle flushes run.
- Already present: `docs/services.md` documents service manifests, state transitions, process boundary, permission boundary, and closed-page browser lifecycle limits.

Verification:

- Already present: `npm run smoke:services` verifies service start/stop/restart, crash reporting, scheduled job execution, suspend/resume hooks, and permission denial.
- Already present: `npm run smoke:settings` verifies Settings snapshot/markup coverage for service counts, status, restart, and disable controls.
- Already present: `npm run smoke:processes` verifies Activity Monitor service detail markup for service metadata, logs, restart controls, and disable controls.
- Already present: `npm run smoke:services` verifies browser `pagehide`/`pageshow` and hidden/visible `visibilitychange` service suspend/resume wiring.
- Already present: `npm run smoke:processes` verifies Activity Monitor service permission review markup for capabilities, write scope, and schedule metadata.

Completion criteria:

- Background work is visible and controllable instead of hidden inside app render code.
- Services degrade cleanly when browser lifecycle limitations prevent native-style persistence.

### Convergence 12: Compatibility Targets And Honest Boundaries

Status: In progress.

Goal: define what "native-like" means for DindbOS in measurable compatibility tiers.

Why it matters:

- Without tiers, the project can drift into vague claims.
- Compatibility targets let the roadmap say exactly what DindbOS can run and what it refuses to fake.

Implementation tasks:

- Already present: compatibility tiers are defined in the runtime:
  - Tier A: DindbOS JavaScript GUI/CLI apps.
  - Tier B: Browser-safe npm CLI packages through NodeCompat.
  - Tier C: WASI-style WASM CLI programs.
  - Tier D: Worker-isolated long-running programs.
  - Tier E: Companion-assisted native-adjacent capabilities.
- Already present: `doctor compat` prints tier support, browser capability probes, storage backend, companion/provider state, and unsupported native boundaries.
- Already present: package manifests can declare `compatibility.tier`, `compatibility.requiredTier`, `compatibilityTier`, or `requiredCompatibilityTier`; unsupported required tiers fail before package filesystem mutation.
- Already present: `docs/app-manifest.md` documents package compatibility tier fields and install refusal behavior.
- Add a compatibility matrix for filesystem, process, network, terminal, package, browser, and device features.
- Add package fallback behavior metadata beyond current fail-closed required-tier checks.
- Expand hard no-go boundary docs from `doctor compat` and app manifest docs into a dedicated compatibility document.

Verification:

- Already present: `npm run smoke:shell` verifies `doctor compat` output.
- Already present: `npm run smoke:packages` verifies package compatibility refusal when a required tier is unavailable and verifies no package/app mutation occurs.
- Add smoke coverage for the future compatibility matrix and fallback metadata once those are implemented.

Completion criteria:

- Users and package authors can tell whether a workload is supported, degraded, companion-required, or impossible in browser-only mode.

## Hard But Feasible Native-OS Backlog

These tasks are deliberately ambitious. They are still technically possible if DindbOS keeps the browser sandbox honest, pushes browser-safe work into workers/WASM, and uses optional native-adjacent companions only for capabilities the browser cannot expose directly.

The acceptance bar is the same as the rest of this roadmap: each item must become a reusable OS primitive with shell/API/package tests. Cosmetic desktop behavior does not count.

### Native-Like 1: POSIX-Lite Compatibility Surface

Status: Later.

Goal: make common Unix-style programs easier to port by filling in the practical POSIX subset that maps cleanly to DindbOS.

Implementation tasks:

- Already present: VFS supports symlink creation, relative-target path resolution, loop detection, `readlink`, and `lstat` semantics.
- Already present: VFS supports hard-link-like alias records with shared write behavior, source-removal survival, and link-count metadata.
- Expand file metadata to include mode bits, uid/gid, timestamps, link count, inode-like stable ids, device ids, and extended attributes.
- Add POSIX-like commands and syscalls for `stat`, `lstat`, `chmod`, `chown`, `umask`, `link`, `unlink`, `rename`, `truncate`, `mkdir`, `rmdir`, `readdir`, and `realpath`.
- Map NodeCompat, WASI, shell commands, and app APIs onto the same metadata and path-resolution rules.
- Document the exact POSIX gaps that remain impossible or intentionally unsupported inside browser-only mode.

Verification:

- Add smoke coverage for symlink traversal, symlink loop failure, link count behavior, metadata preservation across copy/move, and permission-denied paths.
- Add cross-runtime tests proving shell, NodeCompat, WASI, and app APIs see the same path and metadata results.

Completion criteria:

- Small POSIX-oriented packages can run without private DindbOS shims for basic file and directory operations.
- Unsupported POSIX features fail with explicit compatibility errors instead of silent browser-shaped behavior.

### Native-Like 2: Init System And Service Supervisor

Status: Later.

Goal: replace ad hoc background behavior with a real boot-time service model.

Implementation tasks:

- Add an `init` process as PID 1 for boot orchestration, service startup, orphan reparenting, and shutdown sequencing.
- Add service units for package update checks, mount sync, search indexing, storage repair, companion monitoring, and network broker maintenance.
- Add dependency ordering, restart policy, health checks, backoff, degraded mode, and service logs.
- Add `service`, `journalctl`, and `dmesg`-style shell commands backed by runtime state.
- Add recovery boot modes: normal boot, safe mode without third-party services, storage repair mode, and companion-disabled mode.
- Persist boot/service state under `/var/run`, durable service configuration under `/etc/dindbos`, and logs under `/var/log/dindbos`.

Verification:

- Add smoke coverage for service dependency order, crash restart, disabled service skip, degraded boot, safe mode, and orphaned child reparenting.
- Add regression tests proving failed services do not block the desktop unless marked boot-critical.

Completion criteria:

- DindbOS can boot into a predictable service graph and explain which service failed, restarted, or degraded.

### Native-Like 3: Job Control, Signals, And Process Groups

Status: Later.

Goal: make Terminal and process management behave closer to a real Unix-like userland.

Implementation tasks:

- Add process groups, sessions, foreground process ownership, and controlling TTY metadata.
- Add signal-like runtime events for `SIGINT`, `SIGTERM`, `SIGHUP`, `SIGKILL`, `SIGPIPE`, and resize notifications.
- Implement shell job control primitives: foreground/background launch, `jobs`, `fg`, `bg`, `kill`, pipeline group cleanup, and exit status aggregation.
- Propagate cancellation through workers, WASM, NodeCompat, descriptor tables, pipes, and service-managed processes.
- Add signal delivery auditing under `/proc/<pid>/status` and `/var/log/dindbos/process.log`.

Verification:

- Add smoke coverage for Ctrl-C-style interruption, background jobs, foreground resume, killed pipeline cleanup, broken pipe behavior, and worker termination.

Completion criteria:

- Long-running CLI workloads can be interrupted, resumed where supported, or killed without stale descriptors or frozen shell state.

### Native-Like 4: IPC And Local Message Bus

Status: Later.

Goal: give apps and services native-like communication primitives beyond direct function calls.

Implementation tasks:

- Add a runtime IPC broker with named channels, process credentials, capability checks, backpressure, and message size limits.
- Add Unix-domain-socket-like endpoints in VFS, such as `/run/dindbos/bus` and service-owned sockets.
- Support stream IPC over descriptors and datagram-style IPC over structured messages.
- Add shared-memory-like channels using transferable `ArrayBuffer` or `SharedArrayBuffer` when cross-origin isolation allows it.
- Add request/response, publish/subscribe, and service discovery APIs for apps and packages.
- Add `busctl` or equivalent shell diagnostics for listing endpoints, owners, permissions, and live subscribers.

Verification:

- Add smoke coverage for allowed IPC, denied IPC, service discovery, descriptor-stream IPC, message backpressure, endpoint cleanup, and crashed peer behavior.

Completion criteria:

- Apps can integrate through a stable OS bus without importing each other's private modules or receiving raw runtime access.

### Native-Like 5: Device Driver Model

Status: Later.

Goal: expose browser hardware and browser-mediated capabilities as explicit DindbOS devices.

Implementation tasks:

- Define a device registry with device id, class, owner, permissions, health, capabilities, and backing provider.
- Map browser-safe devices into `/dev` and Settings: clipboard, notifications, audio input/output, camera, gamepad, serial, HID, MIDI, battery, screen, pointer lock, file picker, and storage quota.
- Require manifest capabilities and user approval for sensitive devices.
- Route device reads/writes through descriptors or explicit device APIs, not direct browser calls from apps.
- Add hotplug events, permission revocation, device busy state, and degraded fallback behavior.
- Keep companion-backed devices separate from browser-backed devices with visible trust labels.

Verification:

- Add smoke coverage for device permission denial, device open/read/write where mockable, hotplug event dispatch, revoked permission, and descriptor cleanup.

Completion criteria:

- Hardware-facing apps use DindbOS device permissions and diagnostics instead of calling browser APIs directly.

### Native-Like 6: Virtual Memory, Shared Memory, And Memory Pressure

Status: Later.

Goal: approximate native memory controls within browser limits so heavy programs can be contained and diagnosed.

Implementation tasks:

- Track per-process WASM memory pages, worker heap estimates, output buffers, open binary blobs, cache allocations, and VFS write buffers.
- Add runtime memory limits by process, app, package, service, and user.
- Add shared-memory channels when `SharedArrayBuffer` is available, with fallback transfer channels when it is not.
- Add memory-pressure events that can ask apps/services to release caches before forced termination.
- Add crash reports for out-of-memory, quota denial, runaway output, and excessive descriptor allocation.
- Add Activity Monitor memory views with best-effort browser estimates and honest unsupported markers.

Verification:

- Add smoke coverage for WASM page limit, output buffer limit, blob cleanup, memory-pressure callback, shared-memory capability probe, and kill-on-limit behavior.

Completion criteria:

- A memory-heavy workload can be limited, reported, and cleaned up without destabilizing the desktop runtime.

### Native-Like 7: Filesystem Watchers, Indexing, And Search

Status: Later.

Goal: support native-style file change observation and system search as runtime services.

Implementation tasks:

- Add VFS watcher APIs with recursive and non-recursive subscriptions, event coalescing, backpressure, and permission checks.
- Map local mount refresh events into the same watcher model where browser APIs provide enough metadata.
- Add an indexing daemon for filenames, metadata, app manifests, package docs, and selected text files.
- Add shell and app APIs for `find`, `locate`, metadata search, and recent-file queries.
- Persist index state under `/var/lib/dindbos/search` with repair and rebuild commands.
- Add privacy controls for per-user indexes and app-accessible search scopes.

Verification:

- Add smoke coverage for create/update/delete/rename watcher events, denied watch scopes, index rebuild, stale index repair, and cross-user search isolation.

Completion criteria:

- Apps can react to file changes and search runtime-owned files without polling private internals.

### Native-Like 8: Virtual Socket Layer

Status: Later.

Goal: provide socket-shaped APIs for portable programs while respecting browser networking restrictions.

Implementation tasks:

- Add descriptor-backed virtual sockets for HTTP fetch streams, WebSocket sessions, WebRTC data channels, and loopback-only DindbOS services.
- Add DNS policy objects and host allowlists shared by shell, NodeCompat, WASI, apps, and packages.
- Add loopback service binding so local DindbOS services can expose ports inside the runtime without host OS sockets.
- Add `connect`, `listen`, `accept`, `send`, `recv`, `shutdown`, and socket option compatibility where practical.
- Add companion-backed raw TCP/UDP only as an explicit Tier E capability with separate approval and audit logs.
- Make `node:http`, `node:https`, and future WASI socket calls fail closed until they are routed through this broker.

Verification:

- Add smoke coverage for loopback service connect, denied host connect, WebSocket descriptor IO, fetch stream cancellation, and companion-required raw socket refusal.

Completion criteria:

- Networked programs can target a DindbOS socket boundary without receiving unrestricted browser or host networking.

### Native-Like 9: Security Profiles And Mandatory Access Control

Status: Later.

Goal: move beyond simple manifest permissions into enforceable runtime security profiles.

Implementation tasks:

- Add per-app security profiles that constrain syscalls, filesystem roots, devices, network hosts, IPC endpoints, companion access, child process spawning, and service registration.
- Add profile inheritance for child processes and package-launched tools.
- Add deny-by-default syscall filters for WASM and worker processes.
- Add temporary grants with expiry, user prompts, audit records, and revocation.
- Add signed package trust tiers that determine which profiles can be requested.
- Add `security inspect`, `security audit`, and Settings views for active grants and denied operations.

Verification:

- Add smoke coverage for syscall filter denial, inherited profile denial, temporary grant expiry, revoked grant behavior, and signed/unsigned package profile differences.

Completion criteria:

- A compromised app has a bounded runtime profile that is visible, testable, and revocable.

### Native-Like 10: Observability, Debugging, And Diagnostics

Status: Later.

Goal: make the OS understandable when programs fail.

Implementation tasks:

- Add `strace`-style syscall tracing per process, with filters and redaction.
- Add `lsof`-style descriptor and device usage reporting.
- Add `top`/`vmstat`/`iostat`-style Activity Monitor backends using honest browser-available metrics.
- Add crash dump bundles that include process metadata, syscall tail, descriptors, package info, service state, and relevant logs.
- Add developer debugger hooks for WASM stdout/stderr, source maps where available, package install traces, and worker message logs.
- Add `doctor` subcommands for storage, permissions, packages, network, devices, companions, workers, and compatibility tiers.

Verification:

- Add smoke coverage for trace filtering, crash bundle creation, descriptor listing, package install diagnostics, and `doctor` failure classification.

Completion criteria:

- A developer can diagnose a broken package without stepping through private DindbOS internals.

### Native-Like 11: Offline-First Update And Recovery System

Status: Later.

Goal: make runtime and package updates recoverable like a small operating system distribution.

Implementation tasks:

- Add signed runtime build metadata and package repository metadata.
- Add staged update downloads into cache volumes with checksum verification before activation.
- Add A/B-style runtime data migration records where feasible for VFS schema and package DB changes.
- Add package snapshots before update, uninstall, and permission profile changes.
- Add rollback commands for failed runtime migrations and failed package upgrades.
- Add offline repository mirrors that packages can install from when network is unavailable.

Verification:

- Add smoke coverage for checksum failure, interrupted update, package rollback, offline install from cache, migration failure recovery, and trust refusal.

Completion criteria:

- Updates are transactional enough that a failed package or runtime migration does not leave the system half-mutated.

### Native-Like 12: Developer Toolchain Inside DindbOS

Status: Later.

Goal: let DindbOS build, test, and package DindbOS programs from inside the OS environment.

Implementation tasks:

- Add project workspaces under `/home/<user>/Projects` with package templates, manifests, permissions, and tests.
- Add browser-safe build tasks for TypeScript/JavaScript packages through NodeCompat or worker-backed bundlers.
- Add WASM compile workflows where supported by browser-loadable toolchains or companion build providers.
- Add `dindb build`, `dindb test`, `dindb pack`, `dindb install`, and `dindb publish` commands.
- Add SDK linting for forbidden raw browser APIs, missing permissions, unsupported compatibility tiers, and package signing gaps.
- Add AppRegistry hot-reload for development packages without bypassing install/remove lifecycle semantics.

Verification:

- Add smoke coverage that creates a sample project, builds it, installs it, launches it, runs its tests, updates it, and removes it through normal package flows.

Completion criteria:

- A developer can create and ship a small DindbOS app from inside DindbOS itself.

### Native-Like 13: Window Server, Compositor, And Input Router

Status: Later.

Goal: make windows, input, focus, accessibility, and rendering behave like OS services instead of app-local DOM conventions.

Why it matters:

- Native OSes have a window server or compositor that owns focus, input routing, surfaces, z-order, capture, and accessibility metadata.
- DindbOS already has a window manager, but apps still mostly render directly into DOM containers.
- A stronger compositor boundary lets apps be isolated, suspended, captured, resized, and inspected without relying on private app internals.

Implementation tasks:

- Define a compositor service that owns app surfaces, focus, z-order, modal state, capture state, and input routing.
- Add a surface API for DOM-backed, canvas-backed, and worker-rendered windows.
- Add optional `OffscreenCanvas` worker rendering for graphics-heavy apps where browser support allows it.
- Already present: compositor input routing records pointer, keyboard, IME composition, drag/drop, paste/copy, target window, target pid, routed/denied counts, and last route through one brokered WindowManager API.
- Already present: compositor clipboard routing connects copy/paste to the runtime clipboard service, records focused-window/text-entry policy decisions, denies missing focused-window paste, and exposes copied/pasted/denied counters in `/proc/compositor`.
- Already present: compositor pointer-lock policy allows only the focused window to acquire lock, denies missing or unfocused windows, exits pointer lock during window close, and exposes active/denied/release diagnostics in `/proc/compositor`.
- Already present: app-declared shortcut scopes route global, focused-app, and text-entry shortcuts separately so text fields do not receive focused-app shortcuts unless the app declares a text-entry scope.
- Add screenshot/capture APIs for app windows and full desktop surfaces with user-visible permission checks.
- Already present: windows can publish accessibility metadata through the window API, including role, name, value, bounds, state, actions, focus, and child controls; `/proc/compositor` exposes per-surface accessibility summaries without granting direct DOM access.
- Already present: compositor diagnostics under `/proc/compositor` expose focused pid, active window, surface geometry, paint mode, viewport, capture owner placeholder, and last input event; `doctor` also reports the focused surface summary.

Verification:

- Already present: `npm run smoke:window-manager` verifies focus transfer, shortcut precedence, shortcut scope routing, stable surface geometry, last-input recording, IME/drop routing, compositor clipboard copy/paste policy, pointer-lock policy, accessibility metadata publication, pointer capture cleanup during window close, input/shortcut/clipboard/pointer-lock router state, and `/proc/compositor`; `npm run smoke:shell` verifies `doctor` compositor diagnostics.
- Add smoke coverage for broader surface cleanup.
- Add tests proving a crashed or suspended app cannot retain global input capture.
- Add screenshot/capture tests for allowed own-window capture and denied cross-app capture.

Completion criteria:

- Apps render through a stable surface contract and receive input through the OS router.
- Focus, capture, and shortcuts remain coherent when apps crash, suspend, or move between worker and DOM rendering.

### Native-Like 14: Mountable Filesystem Drivers

Status: Later.

Goal: make the VFS support multiple filesystem backends through a mount table and driver interface.

Why it matters:

- Native OS filesystems are not one tree implementation. They mount different backends with different durability, metadata, and policy.
- DindbOS already has VFS, `/proc`, `/dev`, local mounts, cache volumes, and package directories, but the boundaries should become formal mount drivers.
- A mount driver layer makes zip files, package images, remote shares, snapshots, and generated pseudo-files behave consistently.

Implementation tasks:

- Add a mount table with mount id, root path, driver type, readonly flag, owner, durability, quota policy, and capability requirements.
- Split VFS behavior into drivers such as `memfs`, `opfsfs`, `cachefs`, `procfs`, `devfs`, `pkgfs`, `zipfs`, `localfs`, and future `netfs`.
- Add mount and unmount syscalls plus shell commands with explicit permission checks.
- Add overlay mounts for package development, safe mode, and staged updates.
- Add readonly package image mounts so installed packages can be verified and mounted before activation.
- Add driver-level metadata normalization so stat, lstat, symlink, hard-link-like aliases, timestamps, and errors are stable across drivers where possible.
- Add `/proc/mounts` and `mount`/`df` diagnostics that show driver, durability, used bytes, quota, and browser support limitations.

Verification:

- Add smoke coverage for mount/unmount, readonly denial, overlay precedence, package image mount, zip mount listing, `/proc/mounts`, and driver error normalization.
- Add cross-driver tests proving shell, app APIs, NodeCompat, and WASI see the same path behavior for mounted trees.

Completion criteria:

- New storage backends can be added as filesystem drivers instead of special cases in app code.
- Mounted filesystems are visible, permissioned, testable, and removable through OS APIs.

### Native-Like 15: Package Namespaces And Container-Like Sandboxes

Status: Later.

Goal: isolate package roots, dependencies, writable state, network grants, devices, and child processes with namespace-like runtime policy.

Why it matters:

- Native OSes and modern app platforms isolate applications with namespaces, sandboxes, containers, jails, or profiles.
- DindbOS has package permissions and filesystem scopes, but package execution should eventually have a clearer root, dependency, and resource namespace.
- This would let stronger apps run without giving them broad access to shared runtime internals.

Implementation tasks:

- Add package namespaces with package root, writable state root, cache root, temp root, process group, IPC endpoints, device grants, and network grants.
- Add namespace inheritance for child processes, WASM programs, NodeCompat commands, workers, and service units launched by a package.
- Add per-package dependency views so NodeCompat and SDK resolution cannot read undeclared dependency trees by default.
- Add namespace-aware `/proc/<pid>/root`, `/proc/<pid>/cwd`, `/proc/<pid>/mounts`, and `/proc/<pid>/limits` diagnostics.
- Add a package sandbox manifest section for root policy, state policy, cache policy, device access, network hosts, IPC endpoints, and child-process limits.
- Add namespace cleanup for package uninstall, cache eviction, app state removal, temporary files, child processes, descriptors, and IPC endpoints.
- Add developer tooling that can run a package in strict namespace mode before publishing.

Verification:

- Add smoke coverage for package root isolation, denied undeclared dependency read, child namespace inheritance, namespace cleanup on uninstall, and denied cross-package IPC.
- Add tests proving namespace restrictions apply identically to GUI apps, CLI apps, WASM entries, NodeCompat tools, and background services.

Completion criteria:

- A package can be installed, launched, updated, and removed with its runtime namespace fully inspectable and cleanly disposable.
- Package code cannot escape into another package's root, state, dependencies, IPC, devices, or network grants without explicit policy.

### Native-Like 16: Credential, Keychain, And Secret Service

Status: Later.

Goal: provide a browser-native keychain for app secrets, tokens, signing keys, passkeys, and companion pairing credentials.

Why it matters:

- Native OSes provide credential stores so apps do not keep secrets in plain files.
- DindbOS will need secrets for package signing, registry auth, companion pairing, remote sync, encrypted volumes, and developer publishing.
- Browser APIs make this possible through WebCrypto, IndexedDB/OPFS storage, WebAuthn/passkeys, and user-mediated prompts.

Implementation tasks:

- Add a keychain service with per-user vaults, app-scoped secrets, access prompts, unlock state, audit records, and revocation.
- Use WebCrypto for key wrapping, signing, verification, random generation, and optional encrypted secret blobs.
- Add passkey/WebAuthn-backed unlock or reauthentication flows where supported, with password-derived fallback clearly marked as weaker.
- Add secret references in package manifests so apps ask for named credentials instead of reading raw files.
- Add signing key management for package authors, trusted publisher records, repository credentials, and companion pairing keys.
- Add `keychain` shell commands for list, get, set, delete, lock, unlock, grant, revoke, and audit.
- Add Settings UI for active grants, denied requests, stale credentials, and export/recovery warnings.

Verification:

- Add smoke coverage for app-scoped secret denial, temporary grant expiry, vault lock/unlock, package signing key lookup, revoked access, and audit log creation.
- Add tests proving secrets are never exposed through ordinary VFS reads or package export unless explicitly exported by the keychain service.

Completion criteria:

- Apps can use credentials through a revocable OS service without persisting tokens in ordinary app files.
- Package signing, companion pairing, and encrypted storage can share one auditable secret boundary.

### Native-Like 17: Power, Lifecycle, And Page-Survival Policy

Status: Later.

Goal: model suspend, resume, shutdown, page visibility, background throttling, and recovery as OS lifecycle states.

Why it matters:

- Native OSes have power states and shutdown semantics. Browsers have page visibility, unload, storage persistence, background throttling, and service worker limits.
- DindbOS should make those constraints explicit so services and apps do not pretend they can run forever after the tab closes.
- A lifecycle policy lets work save state before suspension and recover predictably after reload.

Implementation tasks:

- Already present: first-pass OS lifecycle states include `booting`, `active`, `idle`, `suspending`, `suspended`, `resuming`, `shutting-down`, `crashed`, and `recovered`, exposed through `os.lifecycleStatus()`, `os:lifecycle`, `/var/run/dindbos/lifecycle.json`, and `/var/log/dindbos/lifecycle.log`.
- Already present: per-process lifecycle callbacks record and optionally invoke `prepare-suspend`, `suspend`, `resume`, `prepare-shutdown`, and `recovery-inspection`; results emit `process:lifecycle` and surface in `/proc/<pid>/status` plus `/proc/processes.json`.
- Already present: browser event integration covers storage persistence prompts/unload-safe flush windows plus service suspend/resume on `visibilitychange`, `pagehide`, and `pageshow`.
- Already present: browser `pagehide`, `pageshow`, hidden/visible `visibilitychange`, and `beforeunload` drive first-pass OS transitions around `suspending`, `suspended`, `resuming`, `active`, and `shutting-down`.
- Already present: dirty shutdown records are written to `/var/run/dindbos/recovery/last-shutdown.json`, and the next boot acknowledges unrecovered dirty shutdowns with `/var/run/dindbos/recovery/last-recovery.json` plus an `os:lifecycle` transition to `recovered`.
- Add broader OS lifecycle state transitions around `idle` and deeper recovered-session repair modes.
- Already present: service manifests support lifecycle policies for `foreground-only`, `visible-tab-only`, `resumable`, `scheduled-when-visible`, and `companion-required` work; pagehide/hidden-tab suspension degrades foreground/visible/companion-bound services instead of pretending they can keep running.
- Already present: recovery records under `/var/run/dindbos/recovery` capture dirty shutdown state, pending persistence status, suspended services, worker-backed processes, and running processes.
- Already present: service degradation records lifecycle policy reasons in `/var/run/dindbos/services.json`, `/var/log/dindbos/services.log`, and Activity Monitor's service permission review.
- Already present: Settings and `doctor` expose lifecycle/recovery diagnostics, last shutdown/recovery records, and closed-page unsupported boundaries across timers, workers, services, and unflushed async storage.
- Already present: `backgroundMaintenanceStatus()` and `doctor compat` expose Service Worker / Periodic Background Sync probes, report closed-page persistence as unsupported when unavailable, and keep supported browsers in an explicit `available-but-not-registered` state until a permissioned maintenance task owns registration.
- Add optional Service Worker or Periodic Background Sync task registration only for browser-supported, permissioned, limited maintenance tasks.

Verification:

- Already present: smoke coverage verifies pending-write lifecycle flushes, boot-time lifecycle diagnostics, service visibility/pagehide suspend/resume wiring, OS lifecycle transitions for pagehide/pageshow/visibility/beforeunload, dirty shutdown recovery records after reload, and service degradation after pagehide.
- Already present: `npm run smoke:processes` verifies per-process lifecycle callback invocation, `process:lifecycle` events, and `/proc` callback diagnostics.
- Already present: `npm run smoke:settings` and `npm run smoke:shell` verify lifecycle/recovery diagnostics and closed-page unsupported reporting.
- Already present: `npm run smoke:shell` verifies Service Worker / Periodic Background Sync compatibility probes and unsupported closed-page background execution reporting.
- Add smoke coverage for richer recovery diagnostics after reload.

Completion criteria:

- Apps and services can persist state, release resources, and recover from browser lifecycle interruptions through a common OS policy.
- DindbOS clearly distinguishes active-tab behavior from closed-page impossibilities.

### Native-Like 18: Multi-Tab, Multi-Device, And Remote Session Coordination

Status: Later.

Goal: make multiple browser contexts coordinate like sessions of the same OS installation.

Why it matters:

- Users may open DindbOS in multiple tabs, windows, profiles, or devices.
- Native OSes coordinate shared disks, sessions, locks, and remote access. Browser-native DindbOS can approximate this with BroadcastChannel, SharedWorker, storage locks, WebRTC, and sync backends.
- Coordination prevents two runtimes from corrupting the same VFS or presenting conflicting package/process state.

Implementation tasks:

- Already present: runtime instances have stable `instanceId` values, storage-backed session locks, primary/secondary election, readonly secondary diagnostics, and stale-lock recovery for tabs sharing one browser profile.
- Already present: BroadcastChannel-backed session messages deliver cross-tab VFS file-change events and expose channel diagnostics in session coordination status.
- Already present: same-path VFS edits from different runtime instances are recorded as pending session conflicts and exposed through `/proc/sessions` plus Settings.
- Already present: storage flush start/complete/error phases are broadcast to peer sessions and exposed through session coordination diagnostics.
- Already present: app-state set/remove/clear/uninstall changes are broadcast to peer sessions and exposed through session coordination diagnostics.
- Already present: package install/update/remove start/complete/error phases are broadcast to peer sessions and exposed through session coordination diagnostics.
- Already present: package DB install/update/remove mutations acquire a runtime operation lock so peer sessions cannot mutate package records while another package transaction owns the lock.
- Already present: reload recovery records preserve previous session coordination, pending conflict count, and operation-lock context in recovery diagnostics.
- Already present: an optional storage-backed remote sync snapshot backend creates WebCrypto-encrypted snapshots for selected runtime paths and exposes last-snapshot diagnostics.
- Already present: default remote sync snapshots cover package cache metadata under `/var/cache` and settings under `/etc/dindbos`, with cache/settings record counts exposed through snapshot status, Settings, and `doctor`.
- Already present: a BroadcastChannel-backed remote session handoff protocol lets runtimes offer, accept, cancel, and diagnose `view` or `control` handoff intents.
- Already present: active session handoffs expose a first-pass BroadcastChannel relay for frame metadata/bytes and control-mode pointer, keyboard, wheel, or text input, with `/proc/sessions`, Settings, and `doctor` diagnostics.
- Add WebRTC or companion-backed low-latency media/input transports when measured cross-device workloads outgrow the BroadcastChannel relay.
- Already present: `/proc/sessions`, Settings, and `doctor` expose the local runtime instance id, primary/secondary role, lock owner, readonly fallback, and stale-lock recovery state.
- Already present: Settings exposes session channel connection state, received message count, pending conflict count, latest peer storage flush phase, latest peer app-state change, latest peer package operation, handoff state, sync status, last successful snapshot, and package cache/settings sync coverage counts.
- Already present: offline-first merge policy and planning APIs classify user documents, app state, package metadata, search indexes, settings, and cache metadata before remote sync apply mutates runtime state.
- Already present: encrypted remote sync snapshots can be applied through the merge planner; safe files are restored, text merges are written, unsafe conflicts are preserved under `.sync-conflicts`, package metadata mutations are refused, and apply conflicts/refusals are recorded in sync status.
- Already present: conflict repair APIs and `sync` shell commands list `.sync-conflicts` entries and resolve them by applying the conflict copy, keeping local state, or deleting the conflict copy.
- Already present: interrupted remote sync apply runs are checkpointed under `/var/run/dindbos/remote-sync-apply.json` and can resume from the recorded `nextIndex`.
- Already present: Settings renders pending `.sync-conflicts` with repair actions that call the same runtime conflict resolution boundary.
- Already present: refused remote sync package metadata records are retained in last-applied status and can be retried only after JSON, package id, version, record path, install path, and package DB operation-lock validation.

Verification:

- Already present: `npm run smoke:sessions` verifies primary election, secondary readonly fallback diagnostics, stale lock recovery, and `/proc/sessions`.
- Already present: `npm run smoke:sessions` verifies cross-tab file event delivery over the session channel.
- Already present: `npm run smoke:sessions` verifies same-path session conflict detection, conflict event delivery, and `/proc/sessions` conflict diagnostics.
- Already present: `npm run smoke:sessions` verifies peer storage flush event delivery and session coordination status updates.
- Already present: `npm run smoke:sessions` verifies peer app-state event delivery and session coordination status updates.
- Already present: `npm run smoke:sessions` verifies peer package install operation delivery and session coordination status updates.
- Already present: `npm run smoke:sessions` verifies package DB operation locks deny concurrent peer package record mutation.
- Already present: `npm run smoke:sessions` verifies reload-safe session recovery diagnostics after a dirty shutdown.
- Already present: `npm run smoke:sessions` verifies encrypted remote sync snapshot creation and last-snapshot status.
- Already present: `npm run smoke:sessions`, `npm run smoke:settings`, and `npm run smoke:shell` verify package cache/settings sync coverage counts in remote snapshot status, Settings, and `doctor`.
- Already present: `npm run smoke:sessions`, `npm run smoke:settings`, and `npm run smoke:shell` verify session handoff offer/accept/cancel propagation plus `/proc/sessions`, Settings, and `doctor` diagnostics.
- Already present: `npm run smoke:sessions`, `npm run smoke:settings`, and `npm run smoke:shell` verify handoff frame relay, control input relay, `/proc/sessions`, Settings, and `doctor` diagnostics.
- Already present: `npm run smoke:sessions`, `npm run smoke:settings`, and `npm run smoke:shell` verify offline-first merge policy/planning for text documents, app-state conflicts, package metadata refusal, search index rebuild, settings last-writer-wins, Settings, and `doctor`.
- Already present: `npm run smoke:sessions`, `npm run smoke:settings`, and `npm run smoke:shell` verify encrypted remote sync apply, conflict-copy preservation, package metadata refusal, cache/settings restore, last-applied status, Settings, and `doctor`.
- Already present: `npm run smoke:sessions`, `npm run smoke:settings`, and `npm run smoke:shell` verify sync conflict listing, conflict resolution, last-repair status, Settings, and shell commands.
- Already present: `npm run smoke:sessions`, `npm run smoke:settings`, and `npm run smoke:shell` verify interrupted apply checkpoint persistence, resume from `nextIndex`, apply-run status, Settings, and shell status output.
- Already present: `npm run smoke:settings` verifies Settings sync conflict repair actions for use-conflict, keep-local, and delete-conflict.
- Already present: `npm run smoke:sessions`, `npm run smoke:settings`, and `npm run smoke:shell` verify refused package metadata retry, package DB lock denial, retry status, Settings, and shell diagnostics.

Completion criteria:

- Multiple tabs do not corrupt shared runtime state.
- Remote or synced sessions are explicit, conflict-aware, and recoverable.

### Native-Like 19: Portable System Images And Boot Profiles

Status: Later.

Goal: let users export, import, boot, repair, and clone DindbOS installations as portable system images.

Why it matters:

- Native operating systems have disk images, recovery images, user backups, and boot profiles.
- DindbOS can expose the same concept through signed or checksummed VFS snapshots, package indexes, settings, and optional encrypted user data.
- Portable images make testing, demos, recovery, and migration much more OS-like than ad hoc JSON exports.

Implementation tasks:

- Define a DindbOS image format containing VFS snapshot, package DB, mount table, users/groups, settings, service units, compatibility tier, and migration metadata.
- Add image signing/checksum verification and explicit trust state before import.
- Add boot profiles: normal, safe mode, clean guest, demo image, repair image, and developer image.
- Add image import with dry-run validation for schema version, package compatibility, quota requirements, missing companions, and incompatible browser capabilities.
- Add image export with options for full system, user home only, package cache excluded, encrypted, or public demo.
- Add rollback boot from the last known good image after failed migration or failed staged update.
- Add `image` shell commands for list, inspect, export, import, verify, boot, clone, and repair.

Verification:

- Add smoke coverage for image export/import round trip, checksum failure, safe-mode boot, repair-mode boot, quota refusal before import, and rollback after migration failure.
- Add tests proving private keychain material is excluded or encrypted according to export policy.

Completion criteria:

- A DindbOS installation can be moved, cloned, tested, or recovered as an explicit system image with verifiable integrity.

### Native-Like 20: Compatibility Virtualization And Emulation Tier

Status: Later.

Goal: support selected legacy or foreign workloads through explicit emulation or compatibility layers where browser performance allows it.

Why it matters:

- Native OSes often run older software through compatibility subsystems, emulators, or virtual machines.
- Browser-native DindbOS should not pretend to run arbitrary native binaries directly, but it can host interpreters, WASM-compiled runtimes, CPU emulators, and compatibility shims for carefully scoped workloads.
- This tier is useful for education, demos, old CLI tools, and portable userlands that accept slower execution.

Implementation tasks:

- Define a Tier F compatibility class for emulated or interpreted workloads with explicit performance and capability warnings.
- Add runtime support for emulator processes that expose virtual disks, virtual serial/TTY, virtual network adapters, and controlled file exchange.
- Explore WASM-hosted interpreters and emulators such as Lua, Python subsets, QuickJS, RISC-V user-mode experiments, or tiny teaching OS images.
- Add import/export boundaries between emulated filesystems and DindbOS VFS with permission checks.
- Add resource caps for emulator CPU time, memory, output, virtual disk size, and network access.
- Add compatibility manifests that declare architecture/runtime, expected syscalls, virtual devices, disk image requirements, and unsupported host features.
- Add developer docs that distinguish DindbOS-native packages, WASI packages, NodeCompat packages, and emulated workloads.

Verification:

- Add smoke coverage for launching a tiny interpreted or emulated CLI workload, virtual disk mount/import/export, resource-limit kill, denied host file access, and explicit unsupported feature reporting.
- Add performance budget tests so emulation failures are reported as unsupported or too slow instead of freezing the desktop.

Completion criteria:

- Emulated workloads are visibly separate from native DindbOS apps and cannot escape their virtual devices or resource caps.
- Compatibility claims are honest: supported, degraded, too slow, companion-required, or impossible.

### Native-Like 21: Kernel Event Loop, Interrupts, And Timers

Status: Later.

Goal: make runtime events, timers, cancellation, wakeups, and browser lifecycle interruptions behave like a small kernel scheduler instead of scattered callbacks.

Why it matters:

- Native OSes coordinate timer interrupts, IO readiness, signals, sleeps, process wakeups, and shutdown interrupts through central kernel machinery.
- Browsers expose timers, promises, event listeners, workers, message channels, BroadcastChannel, storage events, and page lifecycle events, but they do not behave like a unified OS interrupt model by default.
- A DindbOS event loop layer would give apps, services, shell jobs, workers, WASM programs, and companions one coherent way to sleep, wake, cancel, and react to runtime interrupts.

Implementation tasks:

- Add a kernel event queue with typed events for timer, process, descriptor, pipe, device, network, storage, lifecycle, session, companion, and user-input interrupts.
- Add monotonic timer handles, sleep syscalls, timeout syscalls, interval jobs, cancellation tokens, and ownership metadata.
- Route existing page visibility, pagehide/pageshow, beforeunload, storage flush, service lifecycle, worker completion, descriptor readiness, and session BroadcastChannel events through the queue.
- Add readiness notification for descriptors, pipes, virtual sockets, IPC endpoints, and pseudo-devices so processes do not poll private state.
- Add priority and fairness rules for user-visible work, background services, maintenance tasks, and shutdown-critical flushes.
- Add `/proc/interrupts`, `/proc/timers`, and `timerctl` or `events` shell diagnostics for active timers, pending events, dropped events, and last dispatch latency.
- Add event backpressure and event-drop policy so runaway publishers cannot freeze the desktop.
- Expose app-facing and WASM-facing sleep/wakeup primitives through the syscall ABI.

Verification:

- Add smoke coverage for sleep/wakeup, timer cancellation, descriptor readiness wakeup, service lifecycle interrupt dispatch, dropped-event accounting, and shutdown-critical event priority.
- Add tests proving a crashed process releases its timers and cannot keep receiving events.
- Add tests proving hidden-tab throttling is reported as degraded timing instead of pretending native timer precision exists.

Completion criteria:

- Long-running programs can wait on timers, IO, and lifecycle events through one OS primitive.
- Runtime diagnostics can explain why a process woke up, why a timer was delayed, or why an event was dropped.

### Native-Like 22: libc And WASI/POSIX Compatibility Shims

Status: Later.

Goal: make ordinary C/Rust/Zig/TinyGo programs easier to port by providing a documented libc-shaped compatibility layer over DindbOS syscalls.

Why it matters:

- WASM support alone is not enough; most native-style programs expect libc, errno, file descriptors, clocks, random bytes, environment, process exit, and directory APIs.
- DindbOS can provide a browser-native target profile that maps those expectations onto the DindbOS syscall ABI and descriptor model.
- This creates a practical route for real command-line tools to run without rewriting every package against custom JavaScript helpers.

Implementation tasks:

- Define a `dindbos-wasi` target profile that documents supported libc/WASI calls, errno mappings, path rules, rights flags, and unsupported features.
- Expand WASI imports for clocks, random, args/env, descriptor metadata, directory traversal, path mutation, preopens, poll-like readiness, and process exit.
- Add compatibility shims for common POSIX expectations: `isatty`, `getcwd`, `chdir`, `stat`, `lstat`, `fstat`, `openat`, `read`, `write`, `seek`, `close`, `rename`, `unlink`, `mkdir`, `rmdir`, `readdir`, and `errno`.
- Add package metadata that declares the ABI target, required WASI calls, expected preopened directories, and fallback behavior.
- Add a small DindbOS C header or generated bindings file that exposes DindbOS-specific syscalls such as app metadata, package metadata, permissions, and process logging.
- Add compatibility reports when a WASM module imports unsupported WASI functions before runtime mutation occurs.
- Document toolchain recipes for producing compatible binaries with clang, wasi-sdk, Rust, Zig, and TinyGo.

Verification:

- Add fixture programs compiled from C/Rust/Zig/TinyGo that read/write files, list directories, use stdin/stdout/stderr, inspect env, return exit codes, and hit permission denials.
- Add smoke coverage for unsupported import refusal, errno mapping, preopen scope denial, and descriptor cleanup after WASM exit or trap.
- Add docs smoke checks ensuring the toolchain examples match supported imports.

Completion criteria:

- A small portable CLI program can be compiled outside DindbOS and installed as a package without custom runtime glue.
- Unsupported native assumptions fail at install or launch with explicit ABI diagnostics.

### Native-Like 23: Full Terminal Emulator And PTY Multiplexer

Status: Later.

Goal: upgrade Terminal from command output UI into a real terminal device service with PTY sessions, ANSI control, multiplexing, and shell job state.

Why it matters:

- Native OS workflows depend on terminal behavior: PTYs, escape sequences, screen buffers, interactive input, resize events, alternate screens, and multiplexed sessions.
- DindbOS already has shell and first-pass PTY behavior, but real CLI programs need more terminal semantics to feel native.
- A PTY service also helps WASM, NodeCompat, package CLIs, service consoles, and remote session handoff share the same interactive IO model.

Implementation tasks:

- Add a terminal service that owns PTY sessions, scrollback, alternate screen buffers, cursor state, selection state, paste policy, and resize propagation.
- Implement a practical ANSI/VT subset: colors, bold/dim/underline, cursor movement, clear screen/line, alternate buffer, bracketed paste, mouse reporting where feasible, and resize notifications.
- Add PTY multiplexing so one Terminal app can attach/detach from shell sessions, service logs, package build jobs, or remote DindbOS sessions.
- Add shell job control integration for foreground process groups, Ctrl-C, Ctrl-D, Ctrl-Z-style stop where supported, and terminal ownership.
- Add `/dev/pts/<id>`, `/proc/tty`, `tty`, `stty`, and `screen`/`tmux`-like minimal attach/detach commands.
- Add accessibility-friendly terminal output mirrors and copy/export scrollback commands.
- Route Terminal, WASM, NodeCompat, and service consoles through the same descriptor-backed PTY path.

Verification:

- Add smoke coverage for ANSI rendering, alternate screen enter/exit, resize delivery, attach/detach, Ctrl-C interruption, descriptor cleanup, and scrollback export.
- Add tests proving a crashed foreground process releases the PTY and returns control to the shell.
- Add tests proving background processes cannot steal terminal input without becoming the foreground process group.

Completion criteria:

- Interactive CLI packages can run through PTY semantics rather than one-shot command output.
- Terminal sessions are inspectable, attachable, and recoverable through OS APIs.

### Native-Like 24: App Associations, Open With, And Document Services

Status: Later.

Goal: treat documents, MIME types, default apps, previews, recent files, and share/open flows as OS services.

Why it matters:

- Native OSes do not hard-code every file open path. They maintain file associations, document providers, preview services, recent documents, and app handoff rules.
- DindbOS already has Files.app, TextEdit, Viewer.app, Browser.app, object URLs, and package app launchers, but the OS should own association policy.
- This lets third-party apps become real document handlers without modifying core UI code.

Implementation tasks:

- Add a MIME/type registry under `/etc/dindbos/file-associations.json` with per-user defaults, package-provided handlers, priority, trust state, and fallback rules.
- Add `open`, `open-with`, `xdg-open`-style shell behavior that resolves a path or URL through the association service.
- Add package manifest fields for document types, URL schemes, import/export formats, preview providers, and edit/create capabilities.
- Add a document broker that grants temporary file handles or scoped paths to the selected app without broad filesystem permission escalation.
- Add recent documents, pinned documents, and privacy controls under per-user state.
- Add thumbnail/preview provider lifecycle with cache invalidation and crash isolation.
- Add share/export broker flows for browser share sheet, clipboard, download, local mount save, and companion-assisted native save where available.

Verification:

- Add smoke coverage for default app resolution, Open With override, denied handler scope, third-party handler install/remove, preview cache invalidation, and recent-file privacy isolation.
- Add tests proving a document handler receives only the selected document scope unless its manifest grants broader access.

Completion criteria:

- New package apps can register as real document handlers and receive files through a reusable OS broker.
- Opening a file from shell, Files.app, recent documents, or another app follows the same association rules.

### Native-Like 25: Graphics, Audio, And Realtime Media Subsystems

Status: Later.

Goal: expose multimedia capabilities as permissioned OS subsystems instead of app-direct browser API calls.

Why it matters:

- Native OSes provide graphics, audio, camera, microphone, screen capture, codecs, and realtime scheduling through system services and drivers.
- Browser APIs make many of these capabilities possible, but direct access from apps makes permission, diagnostics, suspension, and cleanup inconsistent.
- DindbOS can broker WebGL/WebGPU, Canvas, WebCodecs, WebAudio, MediaDevices, Screen Capture, and MediaRecorder through explicit device and compositor policies.

Implementation tasks:

- Add graphics device records for DOM surfaces, Canvas2D, WebGL, WebGPU, OffscreenCanvas, and worker-rendered surfaces.
- Add an audio service for output routing, capture routing, volume/mute state, app audio sessions, WebAudio nodes, and MediaStream cleanup.
- Add camera, microphone, and screen-capture brokers with manifest capabilities, user prompts, active indicator state, and revocation.
- Add media pipeline descriptors for codecs, stream tracks, recorder sessions, capture sessions, and output sinks.
- Add per-process multimedia diagnostics under `/proc/media`, including active devices, permission state, frame/audio drop counters, and browser support limits.
- Add suspend/resume policy for active media sessions when tabs become hidden, pages unload, or users revoke permissions.
- Add companion-backed media devices only behind separate identity, permission, and audit boundaries.

Verification:

- Add smoke coverage with mockable adapters for permission denial, stream open/close, revocation cleanup, hidden-tab degradation, and `/proc/media` reporting.
- Add browser integration tests where feasible for WebAudio output graph creation and Canvas/OffscreenCanvas worker rendering.

Completion criteria:

- Multimedia apps use DindbOS brokers for device access, diagnostics, lifecycle, and cleanup.
- Users can inspect and revoke active media capabilities from Settings or Activity Monitor.

### Native-Like 26: WebGPU Compute And Graphics Driver Boundary

Status: Later.

Goal: support GPU-backed workloads through a driver-style broker with permission, quotas, diagnostics, and graceful fallback.

Why it matters:

- Modern native OSes expose GPUs for rendering, compute, video, ML, and accelerated UI composition.
- Browser WebGPU makes a limited but real GPU boundary possible inside DindbOS.
- Without an OS broker, GPU-heavy apps can consume resources invisibly and fail with browser-specific errors that are hard to diagnose.

Implementation tasks:

- Add a GPU device broker that probes WebGPU/WebGL support, adapter limits, feature flags, power preference, and fallback paths.
- Add manifest capabilities for GPU rendering, GPU compute, high-memory buffers, persistent shader cache, and background GPU work.
- Add per-process GPU contexts with quotas for buffers, textures, command submissions, shader modules, and frame budget.
- Add shader/module cache under `/var/cache/dindbos/gpu` with invalidation by adapter, feature set, package version, and runtime version.
- Add crash/error diagnostics for device lost, validation error, out-of-memory, unsupported adapter, and hidden-tab throttling.
- Expose GPU diagnostics in Activity Monitor, Settings, `/proc/gpu`, and `doctor gpu`.
- Add fallback routing to CPU, Canvas2D, or disabled mode when WebGPU is unavailable.

Verification:

- Add smoke coverage using adapter mocks for support probe, denied permission, quota denial, shader cache hit/miss, device-lost handling, and fallback reporting.
- Add browser integration tests for a minimal WebGPU or WebGL render path where CI/browser support allows.

Completion criteria:

- GPU use is permissioned, observable, quota-limited, and recoverable.
- Apps can declare GPU needs without assuming every browser exposes WebGPU.

### Native-Like 27: Distributed Filesystem Sync And Conflict Resolution

Status: Later.

Goal: sync selected DindbOS data across devices without corrupting local-first state.

Why it matters:

- Native OSes increasingly coordinate files, settings, app state, keychain records, and package metadata across devices.
- Browser-native sync is technically possible through encrypted snapshots, remote object stores, WebRTC peer sync, or user-provided backends.
- The hard part is not transport; it is conflict policy, integrity, privacy, and offline-first recovery.

Implementation tasks:

- Define sync roots for user home, app state, package records, settings, search indexes, and selected cache metadata.
- Add encrypted object snapshots with content hashes, manifest hashes, clock/vector metadata, and schema version.
- Add per-root merge policies: last-writer-wins for safe settings, three-way merge for text files, conflict copies for binary files, package DB transaction conflict refusal, and app-provided merge hooks for structured state.
- Add sync providers for manual import/export, browser storage handoff, WebDAV-like HTTP endpoints, remote object storage, and WebRTC peer transfer where feasible.
- Add conflict queue UI, shell commands, audit logs, and recovery checkpoints.
- Add bandwidth/quota limits, resumable uploads/downloads, partial snapshot repair, and offline mode.
- Keep keychain material excluded or encrypted through the keychain service, never ordinary sync files.

Verification:

- Add smoke coverage for snapshot create/apply, conflict copy creation, text three-way merge, package DB conflict refusal, interrupted sync resume, and encrypted metadata refusal without unlock.
- Add tests proving sync cannot bypass per-user access control or package namespace boundaries.

Completion criteria:

- Two devices can exchange selected DindbOS state with explicit conflict outcomes and no silent overwrite of durable user data.
- Sync status is visible, pauseable, repairable, and scoped by user policy.

### Native-Like 28: System Policy, Profiles, And Managed Mode

Status: Later.

Goal: support administrator-defined runtime policy for schools, labs, demos, enterprises, and public kiosk deployments.

Why it matters:

- Native OSes can run under managed policy: allowed apps, blocked devices, update channels, network rules, logging, guest reset, and kiosk behavior.
- DindbOS can do the same inside browser constraints through signed policy profiles and runtime enforcement.
- Managed mode would make public demos and real deployments safer than a fully mutable playground.

Implementation tasks:

- Add signed policy profiles under `/etc/dindbos/policies`, with active profile state, issuer, signature, expiration, and allowed override scope.
- Support policy rules for app install allowlists, package repository allowlists, network host allowlists, device grants, companion grants, storage quota, guest reset, desktop layout, service units, and disabled syscalls.
- Add kiosk mode with pinned app, restricted shell, disabled external mounts, limited Browser.app navigation, and reset-on-close behavior.
- Add policy inheritance across users, groups, packages, child processes, services, and remote sessions.
- Add Settings and shell diagnostics for active policy, denied actions, and unmanaged fallback.
- Add audit logs for policy changes, denied operations, and policy signature failures.

Verification:

- Add smoke coverage for signed policy load, invalid signature refusal, app install denial, network denial, kiosk shell restriction, guest reset, and policy inheritance to child processes.
- Add tests proving user-level settings cannot override system policy unless the policy explicitly allows it.

Completion criteria:

- DindbOS can run as a controlled environment without hard-coded demo locks.
- Policy denials are deterministic, visible, and enforced through the same runtime brokers as normal permissions.

### Native-Like 29: Repository, Distribution, And Trust Infrastructure

Status: Later.

Goal: make package discovery, trust, signing, dependency resolution, and update channels behave like a small OS distribution.

Why it matters:

- Native OS value comes from a trusted software distribution path, not only local app files.
- DindbOS already has package manifests and trust checks, but a real platform needs repositories, metadata, dependency policy, signatures, rollback, and compatibility matching.
- This is technically feasible with signed JSON metadata, content-addressed package blobs, browser cache storage, and optional remote providers.

Implementation tasks:

- Define repository metadata for packages, versions, dependencies, compatibility tiers, API ranges, checksums, signatures, channels, advisories, and deprecations.
- Add content-addressed package storage and checksum verification before activation.
- Add dependency solver rules for exact versions, ranges, conflicts, optional dependencies, OS compatibility, and browser capability requirements.
- Add repository trust roots, publisher trust, key rotation, revocation lists, and transparency-log-style audit records where feasible.
- Add update channels: stable, beta, local dev, pinned version, and offline mirror.
- Add `pkg search`, `pkg info`, `pkg verify`, `pkg update`, `pkg rollback`, `repo add/remove/list`, and Settings package repository UI.
- Add security advisory handling that can warn, block, or force update based on policy.

Verification:

- Add smoke coverage for repository index fetch/cache, signature refusal, dependency conflict, compatibility mismatch, rollback, offline mirror install, and revoked key refusal.
- Add tests proving failed resolution or failed verification happens before VFS/package DB mutation.

Completion criteria:

- Users can install and update packages from trusted repositories with explicit compatibility, dependency, and rollback behavior.
- Package trust decisions are inspectable and enforceable by system policy.

### Native-Like 30: Host Integration Boundary And Progressive Native Install

Status: Later.

Goal: progressively integrate with host OS features while keeping DindbOS honest about what is browser-only, PWA-installed, or companion-assisted.

Why it matters:

- A browser-native OS can feel much more native when installed as a PWA and when it uses user-approved host integrations.
- Some features are browser-standard, some are origin-installed PWA capabilities, and some require companions. Mixing them together would create false claims.
- A host integration boundary lets DindbOS expose native-adjacent features without weakening sandbox transparency.

Implementation tasks:

- Add a host capability registry for PWA install state, launch handling, file handling, protocol handling, share target, badging, notifications, storage persistence, shortcuts, and window controls overlay where supported.
- Add install profile diagnostics: browser tab, installed PWA, browser-only unsupported, companion-assisted, and remote-provider mode.
- Add manifest integration for file handlers, URL protocol handlers, share targets, app shortcuts, icons, and display modes.
- Add user-visible prompts and Settings controls for each host integration grant.
- Add fallback behavior when the same DindbOS build runs in Safari, Firefox, Chromium, mobile browsers, or locked-down enterprise browsers.
- Add companion boundaries for host features browsers do not expose, such as deeper filesystem automation, native printing workflows, raw sockets, and build toolchains.
- Add `doctor host` to explain which features are available, unavailable, permission-denied, PWA-only, or companion-required.

Verification:

- Add smoke coverage with capability mocks for PWA install state, file handler registration, protocol handler registration, notification denial, share target unsupported, and `doctor host` classification.
- Add browser-specific manual verification scripts for installed PWA behavior where automation is limited.

Completion criteria:

- DindbOS can become progressively more native when installed or paired, while the runtime still reports browser-only limitations accurately.
- Apps request host capabilities through DindbOS brokers instead of assuming direct host OS access.

## Next Technically Feasible Native-OS Push

These items go beyond the first native-like backlog. They are not cosmetic desktop features. They are the next layer of work that is technically feasible, even if it requires deep runtime redesign, stricter browser capability probes, cross-origin isolation, advanced worker orchestration, WebCrypto/WebAuthn, Service Workers, WebRTC, or narrowly scoped companion processes.

The rule remains: no feature counts as native-like unless it becomes a reusable OS primitive with a syscall/API boundary, shell diagnostics, package manifest policy, and smoke coverage.

### Native-Like 31: Secure Boot, Measured Runtime Integrity, And Trust Chain

Status: Later.

Goal: make DindbOS boot through a verifiable trust chain instead of trusting whichever JavaScript bundle and VFS records are present.

Why it matters:

- Native OSes protect boot, kernel, drivers, system configuration, and update state with integrity checks.
- Browser-delivered code cannot be treated exactly like firmware, but DindbOS can still measure runtime assets, verify signed system images, and refuse unsafe package or companion activation.
- This is the foundation for managed mode, trusted repositories, encrypted volumes, keychain unlock, and safe remote sync.

Implementation tasks:

- Define a signed system manifest that covers runtime version, boot schema version, core module hashes, built-in app hashes, syscall ABI version, migration ids, and compatibility tier.
- Add a measured boot record under `/var/run/dindbos/boot-measurements.json` and durable audit history under `/var/log/dindbos/boot-measurements.log`.
- Verify core package records, service units, trusted publisher records, companion manifests, and policy profiles before enabling privileged runtime services.
- Add boot trust states: trusted, degraded, unsigned, mismatched, recovered, safe-mode, and refused.
- Add recovery behavior that can boot a minimal safe mode when optional services, third-party packages, or companions fail trust verification.
- Add `bootctl status`, `bootctl verify`, `bootctl safe-mode`, and `doctor boot` diagnostics.
- Use WebCrypto for signature verification, digest calculation, and trust-root pinning stored outside ordinary app-writable files.
- Integrate with portable system images so an imported image cannot silently replace trusted runtime state without verification.

Verification:

- Add smoke coverage for valid signed boot manifest, hash mismatch, unsigned companion refusal, invalid policy signature, safe-mode fallback, and boot measurement logging.
- Add tests proving a compromised package record cannot register a privileged service before trust verification completes.
- Add tests proving safe mode disables third-party services while keeping Files, Terminal, Settings, and recovery tools usable.

Completion criteria:

- DindbOS can explain whether the current boot is trusted, degraded, recovered, or refused.
- Privileged package, service, policy, and companion activation is gated by measured runtime state.

### Native-Like 32: Kernel Module And Driver ABI

Status: Later.

Goal: let core runtime capabilities evolve through signed, permissioned kernel modules or driver modules instead of hard-coding every future primitive into the main bundle.

Why it matters:

- Native OSes extend kernels through drivers, filesystems, security modules, network stacks, and device providers.
- DindbOS will need new devices, filesystem drivers, network providers, codecs, package resolvers, and companion protocols without turning the core runtime into one monolith.
- A module ABI also makes experimental native-adjacent work testable behind explicit trust gates.

Implementation tasks:

- Define module manifests with id, version, ABI range, provided capabilities, requested kernel hooks, trust state, signature, and rollback metadata.
- Add module types for filesystem drivers, device drivers, network providers, package resolvers, security policy modules, sync providers, and diagnostics providers.
- Add a kernel module loader that verifies signatures, checks ABI compatibility, registers hooks, and rolls back failed activation.
- Add a module capability boundary so modules receive only the kernel hooks they declare and are denied direct access to unrelated runtime internals.
- Add module lifecycle states: discovered, verified, loaded, active, degraded, disabled, failed, and revoked.
- Add `/proc/modules`, `modctl list|load|unload|verify|disable`, and Settings diagnostics.
- Require safe-mode boot to skip non-critical modules and report which native-like capabilities are unavailable.
- Document stable and unstable hook families so package authors know which module APIs can be targeted.

Verification:

- Add smoke coverage for signed module load, invalid signature refusal, ABI mismatch refusal, failed activation rollback, safe-mode skip, and `/proc/modules` reporting.
- Add tests proving a filesystem driver module cannot register network hooks unless its manifest declares them and policy allows them.

Completion criteria:

- New native-like subsystems can be delivered as auditable modules with explicit trust and rollback behavior.
- Failed modules cannot corrupt core boot, VFS, process, package, or security state.

### Native-Like 33: Multi-Core Worker Scheduler And Atomic Runtime Primitives

Status: Later.

Goal: use browser workers, SharedArrayBuffer where available, Atomics, and transferable memory to approximate multi-core execution for CPU-heavy programs.

Why it matters:

- Native OSes schedule work across CPU cores.
- Browser JavaScript cannot expose arbitrary kernel scheduling, but DindbOS can assign worker-backed processes to pools, enforce quotas, and use shared memory when cross-origin isolation allows it.
- This would make compute-heavy WASM, package builds, indexing, media processing, and emulator workloads more realistic.

Implementation tasks:

- Add worker pool classes for interactive, background, service, build, WASM, and emulator workloads.
- Add scheduler policy for priority, fairness, CPU time estimates, cooperative yield checks, timeout budgets, and kill escalation.
- Add SharedArrayBuffer capability probing and a fallback path using transferable ArrayBuffers when shared memory is unavailable.
- Add atomic wait/notify style primitives for worker processes where browser support allows.
- Add per-process worker affinity hints, pool limits, and package manifest resource declarations.
- Add runtime metrics for queue time, run time, yield count, cancellation latency, timeout count, and memory transfer volume.
- Expose diagnostics through Activity Monitor, `/proc/scheduler`, `/proc/<pid>/limits`, and `schedctl`.
- Ensure hidden-tab throttling is reported as degraded scheduling, not as native CPU control.

Verification:

- Add smoke coverage for worker pool assignment, priority ordering, forced termination, timeout, transferable binary output, SharedArrayBuffer unavailable fallback, and scheduler diagnostics.
- Add tests proving UI process spawning remains responsive while a background worker pool is saturated.

Completion criteria:

- CPU-heavy workloads can run concurrently without freezing the desktop runtime.
- Scheduling limits and browser throttling are visible, enforceable, and explainable.

### Native-Like 34: Origin-Isolated App Containers

Status: Later.

Goal: run untrusted GUI apps in stronger browser isolation boundaries while still giving them DindbOS syscalls, files, windows, and permissions.

Why it matters:

- Native OSes isolate apps with process boundaries, sandboxes, containers, and security profiles.
- DindbOS package apps currently run inside the browser runtime boundary; stronger isolation is possible through sandboxed iframes, credentialless frames, workers, origin partitioning, and message-based syscall bridges.
- This is necessary before running less-trusted third-party GUI apps at scale.

Implementation tasks:

- Define app container modes: same-runtime trusted, sandboxed iframe, credentialless iframe, worker-rendered surface, and companion-rendered surface.
- Move containerized app access to a postMessage syscall bridge with structured clone validation, capability filtering, rate limits, and audit logging.
- Add per-container filesystem scopes, network scopes, device scopes, IPC scopes, and child-process scopes inherited from package security profiles.
- Add a compositor surface contract so sandboxed apps do not need direct access to other app DOM nodes or desktop internals.
- Add CSP, Trusted Types, import-map, and module loading policy for package app containers.
- Add crash, hang, and heartbeat detection for isolated app containers.
- Add `/proc/<pid>/container.json`, Settings security view, and Activity Monitor isolation badges.

Verification:

- Add smoke coverage for sandboxed app launch, allowed syscall bridge call, denied raw DOM/runtime access, crash isolation, heartbeat timeout, and container cleanup.
- Add tests proving a sandboxed app cannot read another app window, keychain secret, package root, or local mount without a declared grant.

Completion criteria:

- Third-party GUI apps can run with stronger browser isolation while still behaving like DindbOS apps.
- Container failures are visible and recoverable without taking down the desktop.

### Native-Like 35: User-Mode Filesystem Servers

Status: Later.

Goal: allow apps or services to implement mountable filesystems through a FUSE-like user-mode filesystem protocol.

Why it matters:

- Native OSes can mount filesystems implemented outside the kernel.
- DindbOS can use the same idea for archive mounts, remote sync views, package images, search result folders, encrypted volumes, cloud providers, and emulator disks.
- This keeps special file trees out of app-specific code and routes everything through the same VFS, descriptor, permission, and mount APIs.

Implementation tasks:

- Define a user-mode filesystem protocol for lookup, stat, read, write, readdir, mkdir, unlink, rename, watch, flush, and unmount.
- Let services register filesystem providers with mount permissions, durability hints, quota behavior, and trust state.
- Add descriptor-backed streaming reads/writes so large remote or generated files do not require full in-memory materialization.
- Add mount leases, provider heartbeat, timeout policy, read-only fallback, and crash cleanup.
- Add provider-scoped cache under `/var/cache/dindbos/fs/<provider>` with invalidation rules.
- Add `/proc/filesystems`, `/proc/mounts`, provider logs, and `mount -t userfs` diagnostics.
- Require explicit policy for providers that bridge to remote storage, companions, encrypted volumes, or package images.

Verification:

- Add smoke coverage for mounting a userfs provider, listing generated files, reading bytes, write denial, provider crash cleanup, timeout fallback, and unmount behavior.
- Add tests proving shell, Files.app, NodeCompat, WASI, and app APIs see the same mounted userfs tree.

Completion criteria:

- New filesystem-like capabilities can be plugged into DindbOS without bypassing VFS permissions or descriptor semantics.
- A crashed filesystem provider cannot leave stale writable mounts behind.

### Native-Like 36: Print, Scan, And Document Spooler

Status: Later.

Goal: provide native-style document output and capture services through a brokered spooler.

Why it matters:

- Native OSes treat printing, scanning, PDF generation, print queues, and document capture as system services.
- Browsers expose limited print dialogs and file generation, while deeper printer/scanner access requires user action or companions.
- DindbOS can still provide an OS-level spooler that apps target consistently.

Implementation tasks:

- Add a print service with jobs, queues, status, owner credentials, document MIME type, page count, options, and output destination.
- Support browser print, PDF export, image export, local file save, and companion-assisted printer/scanner providers as separate capabilities.
- Add package manifest capabilities for print, scan, PDF generation, and companion print providers.
- Add `/var/spool/dindbos/print`, `/proc/print`, `lp`, `lpstat`, `cancel`, and Settings print queue UI.
- Add job retention, privacy policy, per-user visibility, retry behavior, and failure diagnostics.
- Add scan/import flow that writes captured documents into a selected VFS path through a brokered file grant.
- Add audit records for companion-assisted host printer or scanner access.

Verification:

- Add smoke coverage for PDF spool job creation, queue listing, cancel, denied app print permission, failed provider retry state, and per-user queue isolation.
- Add companion-mock tests for printer unavailable, scanner denied, and successful document import.

Completion criteria:

- Apps can print or scan through a reusable OS spooler instead of each app inventing export behavior.
- Host-adjacent print and scan access is permissioned, visible, and revocable.

### Native-Like 37: Accessibility Server And UI Automation Boundary

Status: Later.

Goal: expose app windows, controls, focus, labels, actions, and text surfaces through an OS-owned accessibility and automation tree.

Why it matters:

- Native OSes provide accessibility APIs and automation hooks for screen readers, testing, macros, and assistive tools.
- Browser accessibility exists, but DindbOS needs a runtime-level model that works across sandboxed apps, worker-rendered surfaces, remote sessions, and compositor-managed windows.
- This also improves testability and makes real app workflows easier to verify.

Implementation tasks:

- Add an accessibility tree per window with role, name, value, bounds, state, actions, focus state, and text selection metadata.
- Let apps publish accessibility nodes through the compositor surface API without exposing private DOM internals.
- Add action routing for click, focus, type, select, invoke, scroll, copy, paste, and custom app actions through permissioned automation.
- Add screen-reader-friendly event streams for focus changes, live regions, alerts, window creation, and app crashes.
- Add automation permissions so tests, macros, and remote control sessions cannot manipulate other apps without approval.
- Add `/proc/accessibility`, `accessctl`, and developer diagnostics for missing labels or invalid control states.
- Add fallback mapping from DOM-backed apps when explicit app accessibility metadata is not provided.

Verification:

- Add smoke coverage for accessibility tree publication, focus event delivery, denied automation across apps, allowed own-window action, crashed app tree cleanup, and missing-label diagnostics.
- Add tests proving sandboxed app DOM remains private while accessibility metadata remains inspectable through the OS boundary.

Completion criteria:

- Assistive tools and automated tests can inspect and operate apps through DindbOS APIs.
- Accessibility metadata survives compositor, container, and remote session boundaries.

### Native-Like 38: System-Wide Clipboard, Drag, And Data Exchange Broker

Status: Later.

Goal: turn clipboard, drag/drop, paste, share, and cross-app data transfer into a permissioned OS data exchange service.

Why it matters:

- Native OSes broker data exchange between apps through typed formats, ownership, privacy prompts, and pasteboard lifetimes.
- DindbOS already has clipboard and file flows in some places, but a unified broker would make document workflows and sandboxed apps much more native-like.

Implementation tasks:

- Add a data exchange broker with typed flavors such as text, HTML, Markdown, image, file reference, file bytes, URL, app-specific JSON, and stream handles.
- Add per-app read/write clipboard permissions, paste prompts for sensitive data, and automatic expiry for temporary grants.
- Route drag/drop through the compositor so source and target apps receive scoped file handles or copied bytes according to policy.
- Add share target integration for browser/PWA share APIs and companion-assisted native share targets where available.
- Add `/proc/clipboard`, `clip`, `paste`, and Settings privacy diagnostics.
- Add audit logs for cross-app paste, file drag, external share, and denied data flavor access.
- Prevent sandboxed apps from directly scraping other app DOM or clipboard state.

Verification:

- Add smoke coverage for text copy/paste, denied clipboard read, file drag scoped grant, HTML flavor sanitization, temporary grant expiry, and clipboard cleanup on app uninstall.
- Add tests proving binary file transfer preserves bytes and does not grant the target broader folder access.

Completion criteria:

- Apps exchange data through one OS broker with typed formats, explicit scope, and revocable permissions.
- Clipboard and drag behavior remains coherent across sandboxed, worker-rendered, and remote apps.

### Native-Like 39: Login Manager, Lock Screen, And Session Switching

Status: Later.

Goal: make authentication, lock state, and session switching first-class runtime states rather than simple user labels.

Why it matters:

- Native OSes distinguish boot, login, unlock, active session, fast user switching, guest sessions, and locked screens.
- DindbOS needs that boundary before multi-user homes, keychain, managed mode, remote sessions, and encrypted volumes can be credible.

Implementation tasks:

- Add a login manager service that owns user selection, guest reset, lock/unlock, idle lock policy, session timeout, and failed authentication diagnostics.
- Add per-user session records under `/var/run/dindbos/sessions` and durable account policy under `/etc/dindbos/users.json`.
- Integrate passkey/WebAuthn and password-derived fallback with the keychain unlock service.
- Suspend or hide user apps when a session locks, while keeping shutdown-critical services controlled by policy.
- Add fast user switching with separate homes, app state, desktop layout, package preferences, shell history, and keychain vault state.
- Add `loginctl`, lock-screen UI, Settings account policy, and `/proc/sessions` credential details.
- Add audit logs for login, logout, lock, unlock, failed auth, session switch, and guest reset.

Verification:

- Add smoke coverage for guest login, lock, unlock, failed unlock, fast user switch, per-user app state isolation, keychain locked denial, and guest reset cleanup.
- Add tests proving a locked session cannot leak window contents, clipboard contents, or keychain material to another user.

Completion criteria:

- DindbOS can host multiple user sessions with explicit authentication, lock state, and per-user runtime boundaries.
- Session state is visible to shell, Settings, Activity Monitor, and recovery diagnostics.

### Native-Like 40: Remote Administration And Headless Control Plane

Status: Later.

Goal: allow trusted remote administration, scripted diagnostics, and headless maintenance without exposing raw runtime internals.

Why it matters:

- Native OSes can be administered through SSH, MDM, remote desktop, remote logs, and management APIs.
- DindbOS can provide a browser-native equivalent through WebRTC, WebSocket providers, signed admin tokens, local pairing, or managed policy channels.
- This would make demos, labs, CI, and support workflows more realistic.

Implementation tasks:

- Add an admin service with signed session tokens, pairing state, role-based permissions, command audit logs, and revocation.
- Define remote control modes: observe-only, terminal-only, file-transfer, settings-management, package-management, and full desktop handoff.
- Add a headless command API that routes through shell/syscall/package/service boundaries instead of private JavaScript objects.
- Add remote log streaming, crash bundle collection, storage diagnostics, package verification, and safe-mode reboot request.
- Add WebRTC data channel and WebSocket provider transports with explicit browser-only, hosted-provider, and companion-assisted trust labels.
- Add Settings and shell controls for pairing, active admins, revoke, session recording, and policy enforcement.
- Add rate limits, command allowlists, and managed-mode restrictions.

Verification:

- Add smoke coverage for pairing, observe-only denial of mutation, terminal command execution, revoked token refusal, audit log creation, and remote crash bundle export.
- Add tests proving remote admin cannot bypass local user permissions, keychain lock state, or package trust policy.

Completion criteria:

- A trusted admin can inspect and maintain DindbOS through a documented control plane.
- Remote access is opt-in, role-scoped, auditable, and revocable.

### Native-Like 41: Runtime Database, Registry, And Configuration Store

Status: Later.

Goal: move scattered JSON files into a transactional OS configuration and registry service where appropriate.

Why it matters:

- Native OSes usually have durable registries, configuration databases, launch databases, package databases, and policy stores.
- DindbOS currently uses many files under `/etc`, `/var`, `/opt`, and app state roots. That is transparent, but complex system state needs transactions, schema versions, indexes, and repair.
- A registry service should not replace user files; it should protect system records that need consistency.

Implementation tasks:

- Define a registry service for package records, app associations, users/groups, policies, trusted publishers, companions, services, mounts, devices, repositories, and compatibility declarations.
- Add typed schemas, schema versions, migrations, integrity hashes, and repair commands.
- Add transactions for multi-record updates such as package install, service registration, policy activation, and companion pairing.
- Expose registry access through syscalls and SDK helpers with read/write permissions and audit logs.
- Add export/import and diff tools for system configuration, excluding secrets unless keychain policy allows export.
- Add `/var/lib/dindbos/registry`, `regctl`, `doctor registry`, and Settings diagnostics.
- Keep human-readable mirror files where useful, but treat the registry transaction log as the source of truth for critical state.

Verification:

- Add smoke coverage for transaction commit, rollback, migration, corrupt record repair, permission denial, export/import, and package DB drift detection.
- Add tests proving failed registry writes cannot leave app registration and package records disagreeing.

Completion criteria:

- Critical OS configuration changes are transactional, versioned, inspectable, and repairable.
- Apps and packages cannot mutate registry state without explicit runtime permissions.

### Native-Like 42: Local AI/Automation Service As An OS Facility

Status: Later.

Goal: expose automation, semantic search, document understanding, and assistant workflows as permissioned OS services instead of app-specific integrations.

Why it matters:

- Modern native OSes increasingly provide system-level automation, search, summarization, dictation, and intent routing.
- DindbOS can support this without pretending the model is local-only: it can distinguish browser-local models, remote providers, and companion-assisted providers through explicit policy.
- The OS value is the permission boundary, audit trail, file scope, and workflow integration, not a chat panel.

Implementation tasks:

- Add an automation service with provider registry, model capability probes, local/remote/companion trust labels, and per-user settings.
- Add permissioned file grants so automation can read only selected documents, directories, app state, logs, or package metadata.
- Add semantic index service for user-approved folders, package docs, help pages, and recent workflows.
- Add task execution boundaries so automation can propose shell/package/file actions, but mutation requires policy or user approval.
- Add audit logs for every file read, command proposal, command execution, network call, and provider request.
- Add `assistctl`, semantic search commands, Settings provider controls, and package APIs for app-local automation.
- Keep secrets and keychain material unavailable unless a specific secret grant exists.

Verification:

- Add smoke coverage for provider unavailable fallback, denied file scope, approved document indexing, command proposal without execution, approved command execution, and audit log creation.
- Add tests proving automation cannot bypass sandbox, keychain, network, package trust, or managed policy boundaries.

Completion criteria:

- Automation becomes a reusable OS service that respects permissions, user intent, and auditability.
- Apps can request automation through DindbOS without embedding unbounded provider access.

### Native-Like 43: Notification Center, Attention, And Alarm Broker

Status: Later.

Goal: provide system-owned notifications, alerts, alarms, badges, reminders, quiet hours, and attention policy instead of app-local toast UI.

Why it matters:

- Native OSes own user attention. Apps request notifications, but the OS decides visibility, grouping, priority, privacy, sound, badges, and quiet-hour behavior.
- Browsers expose Notifications, Badging, Service Workers, and limited background wakeups, but support varies by browser, install state, user permission, and page lifecycle.
- DindbOS needs one broker that can route foreground in-OS notifications, installed-PWA notifications, scheduled reminders, service alerts, package update warnings, companion health failures, and denied background behavior honestly.

Implementation tasks:

- Add a notification service with notification id, app id, pid, user, title, body, severity, category, timestamp, actions, privacy level, expiry, and source capability.
- Add manifest capabilities for `notify.foreground`, `notify.system`, `notify.badge`, `notify.alarm`, and `notify.background`.
- Add notification channels for package updates, storage pressure, keychain access, companion pairing, network denial, service degradation, crash reports, and app-generated notices.
- Add user policy for allow, deny, quiet hours, lock-screen visibility, sound, vibration where supported, badge count, grouping, and rate limits.
- Add a Notification Center app or Settings panel backed by the runtime service, not by app-owned DOM state.
- Route browser Notification API usage through DindbOS so app packages cannot call raw browser notification APIs directly.
- Add scheduled alarms and reminders with clear distinction between active-tab timers, installed-PWA Service Worker support, Periodic Background Sync support, and unsupported closed-page behavior.
- Add `/proc/notifications`, `/var/log/dindbos/notifications.log`, `notify`, `alarm`, and `doctor notifications` diagnostics.

Verification:

- Add smoke coverage for foreground notification creation, denied notification permission, quiet-hours suppression, badge count update, notification action routing, expired notification cleanup, and notification audit logs.
- Add capability-mock tests for browser Notification supported, permission denied, PWA-only background notification, unavailable background alarm, and companion-required wakeup.
- Add tests proving a package without notification permission cannot post system notifications or spoof another app id.

Completion criteria:

- Apps, services, package manager, Settings, and companions use one notification broker.
- DindbOS can explain whether a notification was shown in the desktop, sent to the host browser, delayed, suppressed, or impossible in the current browser mode.

### Native-Like 44: Human Input, IME, Keyboard Layout, And Gesture Service

Status: Later.

Goal: turn keyboard, pointer, touch, gamepad, IME, focus traversal, gestures, and accessibility actions into a coherent input subsystem.

Why it matters:

- Native OSes separate physical input devices, layout translation, focus routing, shortcuts, text composition, pointer capture, gestures, and accessibility actions.
- DindbOS already routes first-pass compositor input, but native-like behavior requires deeper handling of text input, layouts, pointer devices, game controllers, touch gestures, and command routing.
- This is necessary for serious editors, terminals, games, remote sessions, accessibility tools, and sandboxed app containers.

Implementation tasks:

- Add an input service that tracks device type, pointer id, keyboard layout, modifier state, IME composition state, focus owner, capture owner, gesture recognizer, and active accessibility action.
- Add keyboard layout maps, user remapping, reserved OS shortcuts, app shortcut scopes, text-entry scopes, and conflict diagnostics.
- Add IME lifecycle APIs for composition start/update/commit/cancel, candidate hints where browser APIs expose them, and fallback reporting where they do not.
- Add pointer/touch gesture recognition for tap, double-click, long-press, drag, pinch, wheel, inertial scroll, context menu, and system-reserved gestures.
- Add gamepad device routing through the device registry with per-app grants, polling policy, visibility throttling, and disconnect cleanup.
- Add high-frequency input throttling and backpressure so a malicious or broken app cannot freeze the compositor with input events.
- Add `/proc/input`, `/proc/keymap`, `inputctl`, `keymap`, and Settings controls for remapping, shortcut conflicts, and active devices.
- Integrate remote session control events and accessibility automation events through the same input routing policy.

Verification:

- Add smoke coverage for shortcut conflict detection, text-entry shortcut bypass, IME composition routing, pointer capture release, gesture routing, gamepad permission denial, and input diagnostics.
- Add tests proving crashed, suspended, background, or sandboxed apps cannot retain input capture or receive reserved OS shortcuts.
- Add browser integration tests for representative keyboard, pointer, wheel, touch, and composition events where automation is reliable.

Completion criteria:

- Input reaches apps through one OS boundary regardless of DOM-backed, worker-rendered, sandboxed iframe, remote, or accessibility-driven surfaces.
- Users can inspect and change input policy without editing app code.

### Native-Like 45: Multi-Display, Virtual Desktop, And Workspace Manager

Status: Later.

Goal: support multi-monitor-like layouts, virtual desktops, workspaces, display scaling, orientation, and window placement policy inside browser constraints.

Why it matters:

- Native OSes manage displays, spaces, workspaces, DPI, scaling, fullscreen, presentation mode, and window restoration.
- Browsers expose only limited screen and viewport data, but installed PWAs, Window Management APIs, fullscreen APIs, CSS viewport primitives, and companion/remote sessions can provide progressively richer display behavior.
- A workspace manager keeps desktop state coherent across mobile, tablet, installed PWA, browser tab, remote handoff, and companion-assisted displays.

Implementation tasks:

- Add a display service with display id, viewport bounds, scale factor, orientation, safe areas, fullscreen state, window-controls overlay state, and capability source.
- Add workspace records for virtual desktops, pinned apps, window groups, saved layouts, focus history, snap zones, and per-workspace wallpaper/theme state.
- Add APIs for move window to workspace, show all windows, restore layout, presentation mode, fullscreen app mode, and external-display intent.
- Probe Window Management API and Multi-Screen Window Placement API support where available, with fallback to single-viewport virtual displays.
- Add mobile and tablet policies for app stacking, split view, touch resizing, safe-area insets, virtual keyboard occlusion, and orientation changes.
- Add remote and companion-backed display providers as explicit Tier E capabilities with user approval and diagnostics.
- Add `/proc/displays`, `/proc/workspaces`, `displayctl`, `spacectl`, and Settings UI for display/workspace state.
- Persist per-user workspace layout under user state while keeping package windows scoped to their app lifecycle.

Verification:

- Add smoke coverage for workspace create/switch/delete, window move between workspaces, layout restore, fullscreen state, mobile split policy, and `/proc/displays` reporting.
- Add capability-mock tests for multi-screen supported, unsupported, permission denied, PWA installed, and remote display provider states.
- Add tests proving hidden workspaces do not keep receiving focused keyboard input.

Completion criteria:

- Window placement and workspace state behave as OS state, not as one desktop component's private layout memory.
- DindbOS reports which display behaviors are browser-only, PWA-enhanced, remote-provider-backed, companion-assisted, or unsupported.

### Native-Like 46: Continuous Backup, Snapshot History, And Disaster Recovery

Status: Later.

Goal: add Time-Machine-like user backup, version history, restore, and disaster recovery on top of VFS snapshots and portable images.

Why it matters:

- Native OSes let users recover from accidental deletion, bad package updates, corrupted settings, and failed migrations.
- DindbOS already plans portable images, sync, storage repair, and transactional updates, but users also need continuous backup history with clear retention and restore semantics.
- Browser storage can support this through content-addressed snapshots, OPFS/IndexedDB metadata, remote encrypted objects, and optional export/download flows.

Implementation tasks:

- Add a backup service with backup sets, protected roots, excluded roots, content hashes, retention policy, encryption policy, schedule policy, and last successful checkpoint.
- Add incremental snapshots for selected user files, app state, package records, settings, and registry state without duplicating unchanged bytes.
- Add restore modes: single file, folder, app state, package record, user profile, full system, and dry-run restore report.
- Add retention rules by count, age, storage quota, user pinning, and managed policy.
- Add backup destinations for local browser storage, exported archive file, local mount folder, remote encrypted object provider, and companion-assisted native folder.
- Add corruption and ransomware-style mass-change heuristics that warn before overwriting too much recent backup state.
- Add `/var/backups/dindbos`, `/proc/backups`, `backup`, `restore`, `snapshot`, and Settings backup history UI.
- Integrate with keychain so encrypted backups exclude raw key material unless the user explicitly exports a recovery package.

Verification:

- Add smoke coverage for incremental backup, restore single file, restore app state, quota-limited retention, corrupt backup refusal, encrypted backup locked denial, and dry-run restore report.
- Add tests proving package DB, app registry, and user files remain consistent after partial restore or failed restore.
- Add tests proving backups respect user boundaries and do not leak another user's home or keychain records.

Completion criteria:

- Users can recover previous file and system states without relying on manual JSON export.
- Backup status, failures, retention, encryption, and restore impact are visible before mutation.

### Native-Like 47: Privacy Ledger, Consent Broker, And Data Access Reports

Status: Later.

Goal: make every sensitive access request visible, revocable, auditable, and explainable to users.

Why it matters:

- Native OSes increasingly provide privacy reports for files, camera, microphone, location, contacts, clipboard, screen capture, network, automation, and background access.
- DindbOS has permission checks, but native-like trust requires a user-facing record of who accessed what, when, why, and under which grant.
- This is especially important as DindbOS adds keychain, devices, network, AI automation, remote admin, companions, and sandboxed third-party apps.

Implementation tasks:

- Add a consent broker that mediates temporary grants, persistent grants, one-shot grants, denied grants, expiry, revocation, and user prompts.
- Add a privacy ledger that records app id, pid, user, capability, target resource, decision, grant duration, source policy, timestamp, and redaction state.
- Track sensitive categories: files outside app root, local mounts, clipboard, screen/window capture, camera, microphone, notifications, network hosts, keychain, automation, remote admin, companion access, and AI provider file reads.
- Add user-facing privacy reports in Settings with filters by app, capability, time range, user, and denied operation.
- Add package manifest purpose strings so the consent prompt can explain why a capability is requested.
- Add `privacy report`, `privacy grants`, `privacy revoke`, and `/var/log/dindbos/privacy.log`.
- Add managed-policy hooks for preapproved, forbidden, prompt-required, and audit-only access.
- Add retention and export policy so audit logs are useful without becoming an unbounded sensitive-data store.

Verification:

- Add smoke coverage for temporary file grant, revoked clipboard grant, denied screen capture, persistent notification grant, audit log redaction, and Settings privacy report rendering.
- Add tests proving apps cannot forge another app's privacy records or erase denied access logs without administrative policy.
- Add tests proving keychain, AI automation, remote admin, and companion calls all emit privacy ledger records through the same broker.

Completion criteria:

- Users can answer "which app touched this sensitive thing?" without source-level debugging.
- Sensitive grants are promptable, revocable, logged, scoped, and enforced by runtime brokers.

### Native-Like 48: Time, Locale, Calendar, And Cron-Like Scheduler

Status: Later.

Goal: provide system time, time zones, locale, calendars, timers, and scheduled jobs through OS services rather than raw app calls.

Why it matters:

- Native OSes centralize clock settings, locale, time zone, date formatting, calendar alarms, scheduled tasks, and time synchronization.
- Browser apps can read time directly, but DindbOS should expose a consistent runtime clock, monotonic timers, user locale policy, and honest scheduling limits.
- This supports shell scripts, package tasks, services, reminders, backups, update checks, indexing, and tests.

Implementation tasks:

- Add a clock service with wall time, monotonic time, timezone, locale, calendar format, first day of week, hour cycle, and drift diagnostics.
- Add scheduler records for one-shot timers, interval jobs, cron-like schedules, service maintenance tasks, backup jobs, package update checks, and user reminders.
- Add browser capability policy for active-tab timers, hidden-tab throttling, Service Worker alarms where supported, Periodic Background Sync where supported, and companion-assisted wakeups.
- Add `cron.d`-style service schedules under `/etc/dindbos/schedules`, per-user schedules under user state, and runtime state under `/var/run/dindbos/schedules`.
- Add missed-run handling: skip, run-on-next-active, coalesce, catch-up once, or require user approval.
- Add locale APIs for number, date, relative time, collation, plural rules, and text direction through `Intl` with explicit unsupported markers.
- Add `date`, `timedatectl`, `locale`, `crontab`, `run-parts`, `/proc/timers`, and `/proc/schedules`.
- Add deterministic test clock injection for smoke tests and package test runtimes without affecting production wall time.

Verification:

- Add smoke coverage for timezone formatting, locale formatting, one-shot schedule, interval schedule, missed-run policy, hidden-tab degradation report, and deterministic test clock.
- Add tests proving scheduled jobs run with declared user/process credentials and cannot exceed their filesystem/network/device permissions.
- Add tests proving closed-page background claims fail honestly when the browser cannot provide wakeups.

Completion criteria:

- Time and scheduled work are consistent OS primitives visible to shell, services, Settings, packages, and tests.
- DindbOS reports timer precision, throttling, and closed-page limitations instead of pretending to own native wakeups.

### Native-Like 49: System Update Channels, Migration Lab, And Rollout Rings

Status: Later.

Goal: make runtime schema changes, package platform changes, migrations, and staged rollouts testable before they touch user data.

Why it matters:

- Native OS updates do not only replace files; they migrate databases, drivers, services, policies, and user state.
- DindbOS will have VFS schemas, registry schemas, package DB schemas, keychain vaults, sync metadata, service units, and module ABIs that can break if migrations are casual.
- A migration lab lets new runtime builds test real user snapshots in dry-run mode before activation.

Implementation tasks:

- Add runtime update channels such as stable, beta, dev, local, pinned, and managed-ring with explicit compatibility expectations.
- Add migration manifests with id, from version, to version, affected stores, dry-run support, rollback support, checksum, and required browser capabilities.
- Add dry-run migration against cloned VFS/registry/keychain metadata snapshots before mutating active state.
- Add rollout rings for local user, demo profile, managed group, beta users, and full release.
- Add migration failure bundles that include affected records, logs, schema versions, rollback status, and suggested recovery mode.
- Add `updatectl channel`, `updatectl check`, `updatectl dry-run`, `updatectl apply`, `updatectl rollback`, and `doctor migrations`.
- Add policy hooks so managed deployments can pin versions, delay updates, require signed migrations, or force safe-mode repair.
- Add compatibility gates so packages requiring a newer API cannot activate until the runtime migration succeeds.

Verification:

- Add smoke coverage for dry-run migration success, dry-run failure without mutation, apply success, apply rollback, pinned-channel refusal, signed migration check, and package API gate.
- Add tests proving failed migrations leave user files, package records, app registry, service registry, and keychain metadata internally consistent.

Completion criteria:

- Runtime evolution is safe enough to carry user data forward without treating every update as a fresh demo install.
- Users and admins can see what changed, what migrated, what failed, and how to recover.

### Native-Like 50: Compatibility Test Lab And Hardware/Browser Matrix

Status: Later.

Goal: continuously verify DindbOS behavior across browsers, install modes, storage backends, device capabilities, and companion configurations.

Why it matters:

- Native OSes maintain hardware compatibility lists, driver matrices, certification suites, and regression labs.
- Browser-native OS work depends heavily on browser APIs, origin policy, PWA install state, storage quotas, worker behavior, WebGPU, WebRTC, local mounts, notifications, and companion availability.
- A test lab prevents native-like claims from drifting beyond what specific browser environments can actually support.

Implementation tasks:

- Define a capability matrix for Chromium, Safari, Firefox, mobile browsers, installed PWA, cross-origin isolated deployment, local companion, hosted provider, and managed enterprise browsers.
- Add test profiles for browser-only, PWA-installed, OPFS-supported, IndexedDB fallback, local mount supported, notification denied, WebGPU supported, SharedArrayBuffer supported, and companion-assisted.
- Add a certification runner that executes focused smoke suites against each profile and writes machine-readable support reports.
- Add `doctor matrix` and `compat report` commands that compare current runtime capability probes against the documented support matrix.
- Add fixture apps and packages for every major subsystem: VFS, descriptors, WASM, NodeCompat, compositor, network, devices, keychain, notifications, sync, and companion bridges.
- Add failure classification: unsupported, permission denied, browser bug, degraded, flaky, companion missing, policy denied, and runtime regression.
- Add docs generation that updates the public compatibility table from verified matrix results, not from aspirational roadmap text.
- Add CI hooks for automated profiles and manual verification scripts for APIs that cannot be reliably automated.

Verification:

- Add smoke coverage for capability report generation, unsupported feature classification, matrix docs consistency, fixture package install/run, and browser profile selection.
- Add tests proving a feature cannot be marked supported unless the matching probe and verification command pass.

Completion criteria:

- DindbOS can state exactly which native-like features work in which browser/install/companion mode.
- Future roadmap claims are grounded in repeatable verification rather than memory or visual inspection.

## Status Legend

- Done: usable first implementation exists.
- In progress: working path exists, but edge cases, UX, or verification are still incomplete.
- Next: should be handled before broad polish.
- Later: important, but not blocking the next proof point.

## Current Priority

Browser.app is complete as the current proof point first pass. The next product direction is native OS convergence: keep the browser-native kernel honest, then add lower-level execution and isolation primitives that real programs can target.

Process/activity visibility, persistent storage, local folder mounts, npm install, NodeCompat, Browser.app, and document viewers are now in first-pass shape for the portfolio demo to run real URL/document workloads inside the OS shell, not just open built-in demo panels.

The next practical sequence:

1. Define the compatibility tiers and `doctor compat` output first, so every future native-like claim has a measurable support boundary.
2. Add the browser-native syscall ABI and route high-level app APIs through it where practical.
3. Add WASM user processes on top of the syscall ABI with VFS, argv/env, stdio, permissions, and `/proc` visibility.
4. Move heavy NodeCompat/WASM execution into worker-backed process executors with kill, timeout, crash, and descriptor cleanup behavior.
5. Expand descriptor-backed IO from transient shell pipe descriptors into per-command process groups, pseudo-terminals, richer device nodes, and WASI rights/flags.
6. Broaden into virtual networking, stronger multi-user access control, storage journaling/snapshots, resource quotas, background services, native-adjacent companions, and the hard native-like backlog: compositor/input server, mountable filesystem drivers, package namespaces, keychain, lifecycle policy, session coordination, portable system images, explicit emulation tiers, secure boot, kernel modules, multi-core worker scheduling, origin-isolated app containers, user-mode filesystem servers, accessibility automation, remote administration, transactional registry state, and OS-level automation services.
7. Continue Browser.app, document viewer, package, and UX work only when real workloads expose gaps in the already completed first-pass surfaces.

## 0. Immediate Carry-Over Work

These are the tasks most likely to be "what we were in the middle of" right now.

### 0.1 Browser.app Companion Stabilization

Status: Done first pass; provider/native-adjacent hardening is demand-driven by real workload gaps.

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

Status: Done first pass; shell hardening is demand-driven by real command/workflow gaps.

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

Status: Done first pass; durability hardening is demand-driven by real storage/workflow gaps.

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

Status: Done first pass; trust/lifecycle hardening is demand-driven by real package gaps.

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

Status: Done first pass; compatibility expansion is now demand-driven by real browser-safe package gaps.

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
- Callback-style `fs` helpers expose browser-safe VFS-backed read/write/append, rename, copyFile, realpath, directory listing/opendir, mkdir/mkdtemp, rm/unlink, stat/lstat, and access checks.
- `fs.constants` exposes browser-safe access modes, copy flags, and common open flags for package probes.
- `npm run smoke:npm-node` verifies callback-style `fs` read/write/readdir/stat/lstat/access/unlink behavior plus `fs.constants` access modes through CommonJS and ESM `node:fs` import paths.
- `fs.promises` exposes browser-safe Promise wrappers for VFS-backed read/write/append, rename, copyFile, realpath, directory listing/opendir, mkdir/mkdtemp, rm/unlink, stat/lstat, and access checks.
- `npm run smoke:npm-node` verifies `fs.promises` CommonJS shape plus ESM async mkdir/write/read/readdir/stat/access/rm behavior inside the DindbOS VFS.
- `fs.copyFileSync`, callback-style `fs.copyFile`, and `fs.promises.copyFile` copy VFS file bytes with `COPYFILE_EXCL` conflict handling.
- `npm run smoke:npm-node` verifies VFS byte-preserving copyFile behavior and exclusive-copy errors through CommonJS and ESM `node:fs` import paths.
- `fs.appendFileSync`, callback-style `fs.appendFile`, `fs.rename`, and `fs.promises.appendFile/rename` mutate only VFS paths.
- `npm run smoke:npm-node` verifies append and rename behavior through CommonJS and ESM `node:fs` import paths.
- `fs.realpathSync`, `fs.realpath`, `fs.realpathSync.native`, `fs.realpath.native`, and `fs.promises.realpath` resolve existing VFS paths without exposing host filesystem paths.
- `npm run smoke:npm-node` verifies realpath behavior through CommonJS and ESM `node:fs` import paths.
- `fs.mkdtempSync`, callback-style `fs.mkdtemp`, and `fs.promises.mkdtemp` create unique VFS temp directories from caller prefixes.
- `npm run smoke:npm-node` verifies mkdtemp prefix handling, uniqueness, and directory creation through CommonJS and ESM `node:fs` import paths.
- `fs.opendirSync`, callback-style `fs.opendir`, and `fs.promises.opendir` expose browser-safe directory handles over VFS `Dirent` entries.
- `npm run smoke:npm-node` verifies sync, callback, Promise, and async-iterator opendir behavior through CommonJS and ESM `node:fs` import paths.
- `fs.createReadStream` and `fs.createWriteStream` expose browser-safe stream wrappers over VFS files for package compatibility probes.
- `npm run smoke:npm-node` verifies VFS-backed fs stream read/write behavior through CommonJS and ESM `node:fs` import paths.
- NodeCompat `process` facade exposes browser-safe feature probe fields including `nextTick`, `hrtime`, `uptime`, `memoryUsage`, `release`, `title`, and `execPath`.
- `npm run smoke:npm-node` verifies `process` CommonJS and ESM import paths for next-tick callbacks, high-resolution time shape, memory usage shape, and runtime identity fields.
- Browser-native `Buffer` fallback supports `from`, `alloc`, `allocUnsafe`, `concat`, `compare`, `isBuffer`, `isEncoding`, `byteLength`, instance `equals`/`compare`, Array/ArrayBuffer slice inputs, and common string encodings when host `Buffer` is unavailable.
- `npm run smoke:npm-node` verifies the no-host-Buffer path for string, array, ArrayBuffer slice, concat, compare/equality, unsafe allocation shape, encoding probes, byte length, and common encoding conversions.
- `events`/`EventEmitter` builtin facade is available through `events` and `node:events`; `npm run smoke:npm-node` verifies CommonJS and ESM import paths.
- `path/posix` resolves through CommonJS and ESM import paths to the browser-safe POSIX path facade used by package feature probes.
- `npm run smoke:npm-node` verifies `path/posix`, `node:path/posix`, and `path.posix` behavior.
- `path/win32` resolves through CommonJS and ESM import paths to a browser-safe Windows path string facade for package feature probes without exposing host filesystem access.
- `npm run smoke:npm-node` verifies `path/win32`, `node:path/win32`, and `path.win32` behavior for join, basename, dirname, extname, absolute path detection, normalize, and relative path calculations.
- `url`, `util`, and `timers` builtin facades are available through bare and `node:` import paths; `npm run smoke:npm-node` verifies CommonJS and ESM import paths.
- `url.parse`, `url.format`, and `url.resolve` provide browser-safe legacy URL string helpers for older package probes through CommonJS and ESM import paths.
- `npm run smoke:npm-node` verifies legacy URL parse query objects, format output, and relative URL resolution.
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
- `constants` builtin facade supports CommonJS and ESM import paths for common access mode, errno, signal, open flag, and file mode constants used by browser-safe package probes.
- `npm run smoke:npm-node` verifies `constants` and `node:constants` import paths plus representative access mode, errno, signal, open flag, and file mode values.
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

Status: Done first pass; provider/native-adjacent hardening is demand-driven by real workload gaps.

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

Status: Done first pass; desktop polish is demand-driven by real interaction gaps.

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

Status: Done first pass; future user/security hardening is demand-driven by real permission gaps.

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

Status: Done first pass; future onboarding/examples work is demand-driven by contributor gaps.

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

Status: Done first pass; future release hygiene work is demand-driven by release/demo gaps.

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

- No open Browser proof point task is currently identified; add new work here only when smoke coverage or real URL workloads expose a gap.

### Milestone B: Runtime Confidence

Goal: Storage, npm install, NodeCompat, and process visibility have enough verification to support continued work.

Tasks:

- No open runtime confidence task is currently identified; add focused smoke coverage when a new risky browser-runtime path is introduced.

### Milestone C: Document Workloads

Goal: Portfolio documents open naturally from the desktop.

Tasks:
- No open document workload polish task is currently identified; add new work here only when smoke coverage or real usage exposes a gap.

### Milestone D: Package And App Platform

Goal: Third-party DindbOS apps can be built, installed, updated, and debugged.

Tasks:

- No open package/app platform task is currently identified; add new work here only when smoke coverage or real browser-safe package usage exposes a gap.

### Milestone E: Desktop Polish

Goal: The OS shell feels stable under normal daily interaction.

Tasks:

- No open desktop polish task is currently identified; add new work here only when smoke coverage or real usage exposes a gap.
