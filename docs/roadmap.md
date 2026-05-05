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
- Runtime Cache API keys are scoped by active session user by default so preview/package/npm cache entries do not leak across `loginctl switch`.
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

### Native-Core Implementation Queue

Status: Next.

Goal: turn the broad native-like backlog into concrete engineering cuts that can be implemented in sequence. These are all technically feasible inside a browser-native architecture, even when they require Web Workers, WASM, OPFS, WebCrypto/WebAuthn, Service Workers, cross-origin isolation, or narrow local companions.

The order matters. DindbOS gets closer to a native OS when the lower kernel boundary hardens first, then userland, storage, security, and host-adjacent capabilities build on that boundary.

#### Queue 1: Atomic Storage And Repairable Disk Semantics

Why first:

- Native OS credibility depends on not corrupting files, package records, registry records, or app state during quota failure, refresh, interrupted writes, or tab lifecycle interruption.
- Browser storage is fallible and quota-shaped, so DindbOS needs a disk layer that can explain every clean, dirty, failed, repaired, or refused state.

Implementation cuts:

- Extend the existing write journal into replayable transaction records for package installs, editor saves, archive imports, remote sync apply, registry mutations, and image import.
- Already present: VFS user-document writes support atomic write-then-rename semantics through staged sibling files, abort cleanup, metadata preservation, and AppSandbox/TextEdit access.
- Already present: package files, package DB records, AppRegistry manifest records, and ServiceManager state records use the same VFS atomic write-then-rename primitive.
- Already present: package activation groups record package-record, launcher, app-registry, and services phases as one activation boundary and roll the whole install back if a phase fails.
- Already present: package install/update writes package image files into `/tmp/dindbos/package-staging` first, then activates the staged `pkgfs` root into `/opt/<package>` during the package-root activation phase.
- Already present: VFS archive imports stage extracted entries under `/tmp/dindbos/archive-import-staging` and activate them only after the full archive plan is ready, rolling back existing files and staged entries if activation fails.
- Already present: AppSandbox app-state records use the VFS atomic write-or-create primitive for per-user app state create/update/remove/clear writes.
- Already present: AppRegistry register/unregister mutations group the in-memory app map, manifest file, and launcher file under one VFS snapshot rollback boundary.
- Already present: ServiceManager register/unregister mutations group definitions, records, logs, and persisted service state under one VFS snapshot rollback boundary.
- Extend staged activation to broader service lifecycle transaction groups.
- Already present: first-pass `storage.sync` / `fsync`-style durability barrier is exposed through async syscalls, Shell raw syscall usage, SDK `storage.sync()`, AppSandbox `os.storage.sync()`, NodeCompat async `fsync`/`fdatasync` APIs, descriptor-backed `fd.sync` for file descriptors, `os.services.sync()` / service-context `sync()` for service and package-service lifecycle writes, and WASM async syscall / WASI `fd_sync` imports so programs can wait for the runtime persistence flush path before reporting success.
- Extend durability barriers into future mapped-file writes.
- Already present: first-pass `fsck --dry-run` / `fsck --repair` checks VFS structure, duplicate child names, broken symlinks, file size drift, invalid directory children, and safe size/children metadata repairs through the shell.
- Already present: `fsck --dry-run` includes first-pass package DB drift checks for package records whose `/opt/<package>` root is missing and `pkgfs` roots with no package DB record.
- Already present: package `fsck --repair` conservatively removes orphan `pkgfs` roots that have no package DB record while leaving missing package roots as non-repairable diagnostics.
- Already present: `fsck --explain` reports why each problem is repairable or non-repairable, and every shell `fsck` run appends a summary to `/var/log/dindbos/fsck.log`.
- Extend `fsck.dindbos check|repair|dry-run|explain` to orphaned nodes, broken package mounts beyond DB/root drift, partial journals, stale local mount metadata, and conservative salvage export.
- Add storage-class quota arbitration for user data, package roots, package state, cache, temp, snapshots, logs, backups, sync staging, and recovery data.
- Add conservative repair rules: never weaken ownership, permissions, security labels, quarantine state, or encrypted-volume locks during repair.

Verification:

- Already present: `npm run smoke:storage` verifies failed VFS atomic writes preserve existing file bytes/metadata and clean staged temp files before successful atomic commit; `npm run smoke:packages` verifies a sandboxed package app can use the AppSandbox atomic VFS API.
- Already present: `npm run smoke:packages` verifies package install atomically creates package DB records and AppRegistry manifest records; `npm run smoke:services` verifies service state records are atomically created.
- Already present: `npm run smoke:packages` verifies package activation phase events for package-record, launcher, app-registry, and services, plus rollback when the app-registry phase fails.
- Already present: `npm run smoke:packages` verifies package-root activation from staging, successful staging cleanup, failed activation staging cleanup, and no staging path persisted in the package DB record.
- Already present: `npm run smoke:files` verifies VFS archive import activation rollback preserves existing files, removes staged entries, and successful activation preserves nested file bytes.
- Already present: `npm run smoke:permissions` verifies app-state record create and replace writes use VFS atomic events.
- Already present: `npm run smoke:app-registry` verifies failed app registry register/unregister mutations roll back app map, manifest, and launcher state, and successful unregister cleans up launcher files.
- Already present: `npm run smoke:services` verifies failed service register/unregister mutations roll back service records, state files, and service logs.
- Already present: `npm run smoke:packages` verifies package fsck and shell `fsck --dry-run` report missing package roots and orphan `pkgfs` roots without mutating the tree.
- Already present: `npm run smoke:packages` verifies package fsck repair removes orphan `pkgfs` roots and does not attempt unsafe repair of missing package roots.
- Already present: `npm run smoke:storage` and `npm run smoke:shell` verify fsck dry-run reports file size drift without mutation and fsck repair restores safe size metadata.
- Already present: `npm run smoke:shell` verifies `fsck --explain` prints repair policy explanations and `/var/log/dindbos/fsck.log` records dry-run and repaired runs.
- Already present: `npm run smoke:shell`, `npm run smoke:sdk`, `npm run smoke:permissions`, `npm run smoke:npm-node`, `npm run smoke:descriptors`, `npm run smoke:services`, `npm run smoke:packages`, and `npm run smoke:wasm` verify `storage.sync` succeeds through Shell, SDK async helpers, AppSandbox storage facades, NodeCompat async fsync/fdatasync paths, descriptor-backed `fd.sync`, service/package-service lifecycle sync barriers, and WASM async syscall / WASI `fd_sync` barriers, while sandboxed callers without `storage.read` are denied.
- Add smoke coverage for interrupted package activation, interrupted editor save through the app surface, quota denial before mutation, journal replay, broader repair audit records, and failed repair fallback.
- Add cross-runtime write tests proving Shell, Files.app, AppSandbox, NodeCompat, and WASM writes all use the same transaction and quota boundary.
- Add regression fixtures for package DB/app registry disagreement and VFS inode/content mismatch.

Completion criteria:

- DindbOS can recover from common storage failures without factory reset.
- A saved file, installed package, or registry mutation is either fully committed, explicitly rolled back, or visibly repairable.

#### Queue 2: Kernel Object Registry And Handle Boundary

Why next:

- Native kernels do not pass private mutable kernel objects directly to user programs.
- A common handle model is the foundation for app containers, worker syscalls, WASM compatibility, IPC, devices, sockets, and companion access.

Implementation cuts:

- Define kernel object ids for processes, descriptors, files, mounts, windows, services, devices, sockets, IPC endpoints, timers, keychain grants, package namespaces, and companion sessions.
- Add per-process handle tables with rights, owner pid, namespace, user credentials, expiry, close-on-exec behavior, duplicate/transfer policy, and revocation reason.
- Route high-value APIs through handles first: open files, descriptor IO, window capture, IPC endpoints, device opens, keychain grants, companion sessions, and network sockets.
- Add process-exit, process-crash, logout, session-lock, package-uninstall, permission-revoke, and companion-disconnect cleanup that revokes owned handles.
- Expose `/proc/<pid>/handles.json`, `/proc/objects`, `handlectl`, and Activity Monitor resource views.
- Keep a compatibility shim while migrating high-level APIs so current apps do not break during the transition.

Verification:

- Add smoke coverage for valid handle use, stale handle denial, wrong-right denial, duplicated handle cleanup, cross-process transfer, inherited stdio handles, and revoked keychain/device/companion handles.
- Add fuzz-style invalid handle tests for unknown id, wrong object type, double close, use-after-close, cross-user use, and package namespace escape.

Completion criteria:

- Userland cannot operate on sensitive kernel resources unless it owns a valid handle with matching rights.
- Runtime diagnostics can answer which process owns each resource and why access was allowed or denied.

#### Queue 3: Unified Spawn, Process Groups, Signals, And Job Control

Why next:

- A native-like shell needs more than a process table. It needs executable images, inherited handles, foreground process groups, cancellation, exit status aggregation, and predictable cleanup.
- This also gives services, package CLIs, WASM programs, NodeCompat tasks, and worker jobs one launch model.

Implementation cuts:

- Define process image records for app, package CLI, service, worker task, WASM module, NodeCompat program, emulator workload, and companion-backed command.
- Add `spawn`/`exec` syscall families with executable path, argv, env, cwd, credentials, stdio handles, namespace profile, resource limits, and lifecycle policy.
- Add process groups, sessions, foreground TTY ownership, and shell job records.
- Add signal-like runtime events for interrupt, terminate, hangup, kill, pipe close, resize, suspend, and resume.
- Implement shell `jobs`, `fg`, `bg`, `kill`, background launch, Ctrl-C interruption, pipeline group cleanup, and broken-pipe behavior.
- Propagate cancellation into workers, WASM cooperative checks, NodeCompat execution, descriptor tables, pipes, services, and package child processes.

Verification:

- Add smoke coverage for spawned process images, inherited stdin/stdout/stderr, env override, cwd scope, process group cleanup, Ctrl-C-style interruption, background job resume, and killed pipeline descriptor cleanup.
- Add tests proving unsupported native `fork()` semantics fail explicitly while supported spawn/snapshot semantics remain inspectable.

Completion criteria:

- Shell, services, packages, workers, and WASM use one process launch contract.
- Long-running command workloads can be interrupted or killed without stale descriptors, zombie process rows, or frozen shell state.

#### Queue 4: IPC, Readiness, Timers, And Kernel Event Loop

Why next:

- Native userland depends on waiting for events instead of polling private runtime state.
- IPC, timers, descriptor readiness, service events, and lifecycle events need one OS-owned queue before serious daemons or terminal programs can exist.

Implementation cuts:

- Add a kernel event queue for timer, process, descriptor, pipe, IPC, device, network, storage, lifecycle, session, companion, and input events.
- Add timer syscalls for sleep, timeout, interval, cancellation, ownership, and degraded hidden-tab timing reports.
- Add readiness syscalls such as `io.poll`, `io.wait`, descriptor readiness subscribe, and cancellation tokens.
- Add IPC broker primitives for named channels, stream IPC over descriptors, datagram-style structured messages, service discovery, backpressure, and message size limits.
- Expose `/proc/interrupts`, `/proc/timers`, `/proc/ipc`, `timerctl`, `pollctl`, and `busctl`.
- Clean up timers, event subscriptions, IPC endpoints, and readiness watchers on process exit, crash, permission revoke, package uninstall, and logout.

Verification:

- Add smoke coverage for sleep/wakeup, timer cancellation, pipe readiness, PTY input readiness, socket/message readiness, IPC denied send, service discovery, backpressure, and crashed peer cleanup.
- Add tests proving hidden-tab throttling is reported as degraded timing instead of native precision.

Completion criteria:

- Programs can wait on timers, IO, IPC, and lifecycle events through one documented OS primitive.
- Runtime diagnostics can explain why a process woke up, why a timer was delayed, or why an event was dropped.

#### Queue 5: Origin-Isolated App Containers And Trusted System UI

Why next:

- Third-party GUI apps cannot be treated as native-like until they are isolated from the desktop DOM and cannot spoof permission, keychain, package, or companion prompts.
- The browser gives usable isolation tools, but DindbOS must own the bridge and trusted surfaces.

Implementation cuts:

- Add container modes for trusted same-runtime app, sandboxed iframe, credentialless iframe, worker-rendered surface, and companion-rendered surface.
- Move containerized apps onto a postMessage syscall bridge with schema validation, capability filtering, rate limits, trace ids, and audit logs.
- Add CSP, Trusted Types, import-map, and package module loading policy for containerized apps.
- Add heartbeat, hang detection, crash isolation, and cleanup for sandboxed app containers.
- Add compositor-owned trusted surfaces for login, lock/unlock, keychain unlock, package install trust, permission grant, companion pairing, remote admin approval, destructive operations, and update activation.
- Prevent ordinary apps from covering, embedding, capturing, or forging trusted surfaces; route sensitive grant creation only through trusted UI or managed policy.
- Add `/proc/<pid>/container.json`, `/proc/trusted-ui`, Settings security history, and Activity Monitor isolation badges.

Verification:

- Add smoke coverage for sandboxed app launch, allowed syscall bridge call, denied raw runtime/DOM access, heartbeat timeout, trusted prompt grant/deny/timeout, spoofed dialog denial, and capture denial around trusted surfaces.
- Add tests proving an app cannot read another window, keychain secret, package root, local mount, or trusted prompt record without a declared grant.

Completion criteria:

- Less-trusted package apps can run as real DindbOS apps without direct desktop internals.
- Sensitive OS decisions happen through a reusable trusted UI service, not app-rendered lookalikes.

#### Queue 6: Browser API Brokers, Device Tree, And Privacy Ledger

Why next:

- A native OS owns access to devices, clipboard, media, network, notifications, storage, host integration, and user attention.
- Browser APIs are real capabilities, but if apps call them directly DindbOS cannot enforce permissions or explain access.

Implementation cuts:

- Add brokers for File System Access, Clipboard, Notifications, Badging, Web Share, Storage/OPFS, WebRTC, MediaDevices, Screen Capture, WebAudio, WebGPU, WebUSB, WebSerial, WebHID, WebMIDI, Gamepad, Battery, and browser-host integration features.
- Add a declarative device/capability tree under `/proc/device-tree` and `/proc/browser-capabilities`, with support state, permission state, limits, provider, fallback, trust label, and owner service.
- Add package manifest constraints for required device nodes, browser features, PWA-only features, cross-origin-isolation requirements, and companion-required capabilities.
- Add consent broker and privacy ledger records for files, local mounts, clipboard, capture, camera, microphone, notifications, network hosts, keychain, automation, remote admin, companions, and AI provider file reads.
- Add `doctor browser`, `doctor hardware`, `privacy report`, `privacy grants`, `privacy revoke`, and Settings permission panels.
- Add temporary grants with expiry and foreground-window ownership for sensitive APIs.

Verification:

- Add mock-adapter smoke coverage for allowed grant, denied grant, revoked grant, unsupported browser feature, expired temporary grant, device-tree package refusal, and privacy report rendering.
- Add browser integration checks where automation is stable, such as storage persistence classification, notification permission denial, clipboard write policy, and worker support probes.

Completion criteria:

- Apps consume browser-native power through DindbOS brokers, not direct untracked globals.
- Users can inspect, revoke, and audit sensitive browser capability use.

#### Queue 7: Secure Boot, Policy Compiler, And Package Trust Enforcement

Why next:

- Once packages, containers, devices, and companions become serious, trust must be measured before activation.
- Permission checks should be compiled from policy instead of scattered hand-coded branches.

Implementation cuts:

- Add signed system manifests covering runtime version, boot schema, core module hashes, built-in app hashes, syscall ABI version, migration ids, and compatibility tier.
- Add measured boot records under `/var/run/dindbos/boot-measurements.json` and durable audit history under `/var/log/dindbos/boot-measurements.log`.
- Add boot trust states: trusted, degraded, unsigned, mismatched, recovered, safe-mode, and refused.
- Add a policy language for syscalls, paths, handles, network hosts, devices, IPC endpoints, companion capabilities, services, child processes, resource quotas, and temporary grants.
- Compile policy from app manifests, package manifests, service units, users/groups, managed profiles, trust tiers, compatibility tiers, and temporary grants.
- Add `bootctl`, `policyctl compile|explain|diff|audit`, `pkg audit`, `doctor boot`, and `doctor policy`.
- Add safe-mode behavior that skips non-critical packages, services, modules, companions, and repositories when trust verification fails.

Verification:

- Add smoke coverage for valid boot manifest, hash mismatch, safe-mode fallback, policy compile success, invalid policy refusal, inherited child policy, syscall denial explanation, and package activation refusal before mutation.
- Add property-style tests for path escape, host allowlist bypass, undeclared device access, revoked grant reuse, and companion direct-access denial.

Completion criteria:

- Privileged package, service, device, policy, and companion activation is gated by measured runtime state.
- Users and developers can ask why an operation was denied and receive a deterministic policy explanation.

#### Queue 8: Cross-Origin Isolation, Shared Memory, And Multi-Core Worker Runtime

Why next:

- Real native-like compute workloads need workers, shared memory, Atomics, quotas, and observable scheduling.
- These features are browser-feasible but only under strict deployment and capability conditions.

Implementation cuts:

- Define deployment profiles for basic browser tab, installed PWA, cross-origin isolated, managed kiosk, local companion, hosted provider, and developer mode.
- Add COOP/COEP/CORP requirements, asset-loading restrictions, worker script restrictions, iframe restrictions, and third-party resource policy.
- Add capability probes for SharedArrayBuffer, Atomics wait/notify, OffscreenCanvas worker rendering, WebGPU, WebCodecs, OPFS worker access, and Service Worker support.
- Add worker pools for interactive, background, service, build, WASM, emulator, media, and indexing workloads.
- Add thread-like syscalls for spawn, join, detach, cancel, yield, sleep, futex-like wait/notify where supported, and shared-memory allocate/map/unmap.
- Add scheduler diagnostics under `/proc/scheduler`, `/proc/<pid>/threads`, `/proc/shared-memory`, `schedctl`, `threadctl`, and `doctor isolation`.

Verification:

- Add smoke coverage for isolated/non-isolated profile classification, package refusal when isolation is required, worker pool assignment, priority ordering, forced termination, shared-memory denied without capability, and SharedArrayBuffer fallback.
- Add WASM fixture tests for atomic counter behavior, worker pool limits, memory quota denial, and cleanup after process kill.

Completion criteria:

- CPU-heavy and threaded workloads can run when browser capabilities allow them and fail explicitly when they do not.
- Scheduling, shared memory, and hidden-tab throttling are visible, enforceable, and explainable.

#### Queue 9: Service Worker Boot Layer, Offline Queue, And Recovery Shell

Why next:

- Browser-only DindbOS cannot be a resident kernel after tab close, but installed/PWA mode can still support offline boot assets, update checks, background sync where available, and recovery workflows.
- The OS should be useful during network failure, update failure, storage damage, and repeated boot crash.

Implementation cuts:

- Add Service Worker boot manifest with build id, boot schema, cached core assets, package index snapshots, offline docs, migration compatibility, and update state.
- Add page-runtime to Service Worker boot handshake for cache state, offline capability, storage availability, update state, and pending command queue.
- Add offline command queue for safe deferred work: package index refresh, sync retry, backup enqueue, notification scheduling, companion health probes, and update manifest refresh.
- Add panic manager and recovery shell for boot failure, migration failure, storage invariant failure, registry corruption, trust failure, service crash loop, package activation loop, and resource exhaustion.
- Add safe boot entries for normal, safe mode, storage repair, base-system repair, companion-disabled, package-disabled, offline, and developer diagnostics.
- Add `bootctl worker`, `queuectl`, `doctor offline`, `panicctl`, emergency `fsck`, `regctl repair`, `distctl repair`, `pkg disable`, `service disable`, `rollback`, and diagnostic bundle export.

Verification:

- Add smoke coverage for offline asset cache population, offline boot diagnostics, pending queue persistence, unsupported Background Sync degradation, induced boot panic, safe mode, recovery shell command allowlist, and repeated boot crash fallback.
- Add tests proving queued commands retain declared credentials and cannot exceed package/service policy.

Completion criteria:

- DindbOS can boot into a useful offline or recovery state without pretending closed-page execution is unlimited.
- Severe runtime failures lead to inspectable recovery options, not blank-screen failure or silent reset.

#### Queue 10: Conformance Lab And Native-Like Certification Levels

Why next:

- "Native-like" must become a tested claim, not a feeling.
- Browser behavior varies by engine, PWA install state, storage support, cross-origin isolation, companion availability, and user permissions.

Implementation cuts:

- Define certification levels for kernel basics, durable disk, package platform, WASM userland, worker isolation, descriptors/PTY, network broker, keychain, storage recovery, secure boot, managed policy, companion trust, and browser API brokers.
- Add a conformance runner that boots isolated profiles, installs fixture packages, runs shell/WASM/NodeCompat/app/service workloads, checks `/proc`, and validates policy denials.
- Add capability profiles for Chromium, Safari, Firefox, mobile, installed PWA, cross-origin isolated, offline, local companion, remote provider, and managed mode.
- Add machine-readable reports under `/var/log/dindbos/conformance`, `doctor conformance`, `doctor matrix`, and CI artifacts.
- Generate compatibility docs from verified matrix results rather than aspirational roadmap text.
- Add package and companion certification metadata for ABI version, compatibility tier, required capabilities, fallback behavior, smoke commands, protocol version, and expected resource envelope.

Verification:

- Add smoke coverage for conformance report generation, failed guarantee reporting, profile classification, fixture package install/run, matrix docs consistency, package certification refusal, and companion protocol mismatch.
- Add CI/browser-profile hooks where automation is practical, and manual verification scripts for user-prompt-only APIs.

Completion criteria:

- Native-like implementation rate maps to named, tested certification levels.
- Users, package authors, and contributors can see exactly which OS guarantees are implemented, degraded, companion-required, experimental, or impossible in the current build.

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
- Already present: the `dindbos` WASM import namespace exposes stdout/stderr helpers, argv/env helpers, `syscall(ptr,len)`, `syscallAsync(ptr,len)` for async runtime barriers, and `exit(code)`.
- Already present: first-pass WASM syscalls map to the DindbOS syscall ABI and are covered by global syscall tracing.
- Already present: package manifests support DindbOS ABI WASM entry points through `app.runtime: "wasm"` or `.wasm` entries, launched through AppRegistry and rendered into package windows.
- Already present: a basic `wasi_snapshot_preview1` import subset covers args/env sizing and buffers, `fd_write` for stdout/stderr, `fd_sync` / `fd_datasync` for descriptor-backed durability barriers, `proc_exit`, `random_get`, and `clock_time_get`.
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
- Already present: `npm run smoke:wasm` verifies `dindbos.syscallAsync(ptr,len)` waits for async `storage.sync` before process completion and records syscall tracing.
- Already present: `npm run smoke:wasm` verifies permission-denied syscall behavior, EACCES syscall tracing, trap crash report files, and crash index entries.
- Already present: `npm run smoke:wasm` verifies basic WASI `fd_write` stdout and `proc_exit`.
- Already present: `npm run smoke:wasm` verifies WASI `fd_sync` waits for descriptor-backed storage flush after a file write.
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
- Already present: async descriptor syscall `fd.sync` validates file descriptors and routes descriptor-backed file writes through the DindbOS persistence flush barrier while refusing non-file descriptors.
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
- Already present: `npm run smoke:descriptors` verifies `fd.sync` reaches the runtime storage flush barrier for file descriptors and rejects device descriptors.
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

- Already present: first-pass network permission model covers `net.fetch`, `net.websocket`, `net.webrtc`, `net.dns`, and package/app host allowlists; richer firewall scopes remain future work.
- Already present: runtime network broker routes app and shell fetch requests through DindbOS policy instead of direct app runtime access.
- Already present: runtime network broker owns first-pass WebSocket sessions, close handling, session history, host policy, and `/proc/net` visibility.
- Already present: runtime network broker owns first-pass WebRTC data channel sessions, close handling, message counters, host policy, and `/proc/net` visibility; signaling remains external/future work.
- Already present: `/proc/net/status.json` and `/proc/net/requests` expose active requests, WebSocket sessions/history, WebRTC data channel sessions/history, denied hosts, request history, browser-only companion state, and bandwidth estimates.
- Already present: Terminal commands `netstat`, `curl`, `ping` policy probe, and `dig` policy probe route through the network broker.
- Already present: first-pass `net.status`, `net.policy`, and `net.dns` syscalls expose broker diagnostics and policy probes through the syscall ABI.
- Already present: package manifest `sandbox.networkHosts` scopes flow into package namespace metadata and AppSandbox network policy.
- Already present: traffic logging redacts sensitive URL query values so debugging is possible without leaking tokens or secrets.
- Already present: optional raw TCP/UDP companion boundary requires an approved `networkd` companion with protocol `dindbos-networkd-v1`, declared raw socket capabilities, app network capability, and host allowlist before brokered raw sessions can open.

Verification:

- Already present: `npm run smoke:network` verifies allowed fetch, denied host, request cancellation, WebSocket open/close, WebRTC data channel open/close, package network host allowlists, shell network commands, network syscalls, traffic-log redaction, bandwidth estimates, and `/proc/net` reporting.
- Already present: `npm run smoke:network` verifies apps without `net.fetch` cannot use the broker through AppSandbox runtime APIs.
- Already present: `npm run smoke:network` verifies apps without `net.websocket` cannot open brokered WebSocket sessions through AppSandbox runtime APIs.
- Already present: `npm run smoke:network` verifies apps without `net.webrtc` cannot open brokered WebRTC data channels through AppSandbox runtime APIs.
- Already present: `npm run smoke:network` verifies raw TCP/UDP are refused without an approved companion, allowed only through an approved `networkd` companion boundary, denied by host policy, closed through the companion adapter, and exposed in `/proc/net`.

Completion criteria:

- Apps can perform declared network work through a visible, auditable OS boundary.
- Network denial is deterministic and explainable.
- Browser-only and companion-enhanced network capabilities are clearly separated.

### Convergence 6: Multi-User Sessions And Access Control

Status: In progress.

Goal: strengthen the current session/user model into a fuller multi-user environment.

Why it matters:

- Native OS behavior depends on users, groups, ownership, process credentials, and login/session boundaries.
- DindbOS already has session user and ownership primitives, but it needs stronger cross-user behavior to feel OS-like.

Implementation tasks:

- Already present: persistent user records are normalized under `/etc/dindbos/users.json`, group records are mirrored under `/etc/dindbos/groups.json`, and both carry first-pass numeric uid/gid identity metadata.
- Already present: first-pass session switching can move the active runtime session between persisted users through `switchSessionUser()` and shell `loginctl switch`, while already-running processes keep their spawn-time credential snapshot.
- Already present: first-pass login/logout state is exposed through `loginSessionUser()`, `logoutSession()`, shell `loginctl login`, and shell `loginctl logout`.
- Already present: password/passkey login policy is explicit placeholder behavior through `authenticationPolicy()` and shell `loginctl policy`, so DindbOS does not pretend to verify credentials before a trusted login UI exists.
- Already present: guest reset behavior clears `/home/guest`, guest app state, guest shell history, guest package preferences, and guest Runtime Cache API entries, then recreates the guest home workspace.
- Already present: session lock/unlock state is exposed through `sessionStatus()`, `/var/run/dindbos/session.json`, `/proc/sessions`, shell/app launch denial, and session lock/unlock events.
- Already present: process credentials snapshot uid, gid, effective uid/gid, supplementary groups, and session id at spawn time, then expose the same credential record through `/proc/<pid>/status` and `/proc/processes.json`.
- Already present: VFS metadata supports `chmod`, administrator-only `chown`, and owner/admin `chgrp`, exposed through Shell and AppSandbox file APIs; mount roots use the same VFS metadata model where browser-backed ownership changes are possible.
- Already present: host-local mount child metadata distinguishes browser-represented file fields such as MIME, size, and modified time from DindbOS session-local ownership/mode fields, while directory child metadata explicitly reports the browser File System Access limits.
- Already present: app sandbox state is separated by user and app id under `/var/lib/dindbos/app-state/<user>/<app>.json`, and package uninstall removes per-user app state records for the removed app.
- Already present: shell command history is persisted per user under `/var/lib/dindbos/shell-history/<user>.json`, reloads into new shell sessions, and switches with `loginctl switch`.
- Already present: package preferences are persisted per user under `/var/lib/dindbos/package-preferences/<user>.json` and are exposed through shell `pkg prefs`.
- Already present: window placement layout is persisted per user under `/var/lib/dindbos/window-placements/<user>.json`, restored by Window Manager, and isolated across session users.
- Already present: runtime Cache API entries are scoped by active session user and switch with `loginctl switch`, preventing cross-user cache hits for the same logical cache key.
- Already present: package trust changes through `pkg trust add/remove` require an administrator principal.
- Already present: package trust allow/deny decisions are recorded in `/var/log/dindbos/security-audit.log`.
- Already present: system settings storage-management operations through sandboxed `storage.manage` and shell `storage flush` / `storage persist` / `resetfs` require an administrator principal.
- Already present: system settings storage-management allow/deny decisions are recorded in `/var/log/dindbos/security-audit.log`.
- Already present: companion permission grant/revoke operations through shell `companion grant` / `companion revoke` require an administrator principal and persist records under `/etc/dindbos/companions.json`.
- Already present: companion permission allow/deny decisions are recorded in `/var/log/dindbos/security-audit.log`, and raw socket companions respect revoked or capability-narrowed permission records.
- Already present: VFS permission-denied reads, writes, and traversal checks are recorded in `/var/log/dindbos/security-audit.log`, and unsupported `su`/`sudo` permission-escalation attempts are recorded as denied security events.

Verification:

- Already present: `npm run smoke:sessions` verifies normalized session users/groups, per-user home creation, persistent user/group records, numeric uid/gid assignment, shell `id` output, session switching through `loginctl`, cross-user private file denial, session lock/unlock denial, process credential `/proc` reporting, and sandbox filesystem access through process supplementary groups.
- Already present: `npm run smoke:sessions` verifies shell `loginctl logout` blocks normal shell work, `loginctl login` restores authenticated state, password/passkey placeholder methods fail explicitly, `loginctl policy` exposes the placeholder policy, and `loginctl reset-guest` clears guest files/state/cache.
- Already present: `npm run smoke:sessions` verifies owner `chgrp` to a supplementary group, denial for non-member group changes, and administrator `chown owner:group` metadata changes.
- Already present: `npm run smoke:sessions` verifies per-user shell history persistence, reload into a new shell, and no shell history leakage across `loginctl switch`.
- Already present: `npm run smoke:sessions` verifies per-user package preference persistence and no package preference leakage across `loginctl switch`.
- Already present: `npm run smoke:sessions` verifies Runtime Cache API entries do not leak across `loginctl switch` and restore with the original user.
- Already present: `npm run smoke:permissions` verifies app state does not leak across users for the same app id, and `npm run smoke:packages` verifies package uninstall cleans the app's per-user state record.
- Already present: `npm run smoke:sessions` and `npm run smoke:shell` verify non-admin package trust mutation denial, admin package trust mutation allowance, and security audit logging for both decisions.
- Already present: `npm run smoke:window-manager` verifies per-user window placement persistence and no layout leakage across session users.
- Already present: `npm run smoke:local-mounts` verifies local mount file metadata from browser file handles and explicit directory metadata limitations for unsupported host ownership, permission, size, and modified fields.
- Already present: `npm run smoke:permissions` and `npm run smoke:shell` verify non-admin system storage-management denial, admin storage-management allowance, and security audit logging for both decisions.
- Already present: `npm run smoke:sessions` verifies non-admin companion grant denial, admin companion grant/revoke allowance, persistence under `/etc/dindbos/companions.json`, and security audit logging for both decisions.
- Already present: `npm run smoke:network` verifies raw socket companions are denied after revoked or capability-narrowed companion permission records.
- Already present: `npm run smoke:permissions` verifies denied VFS traversal, read, and write audit records, and `npm run smoke:shell` verifies denied `su`/`sudo` permission-escalation audit records.

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

- Already present: persistent storage records a first-pass write journal for queued, completed, failed, and fallback browser storage writes, exposed through storage status and `PersistentStorage.journal()`.
- Already present: OPFS-backed filesystem saves are grouped with explicit storage transaction ids, transaction kind, dirty file/inode counts, and matching queued/completed journal entries.
- Already present: OPFS-backed filesystem saves write a durable active transaction marker, clear it on completion/fallback, and report an interrupted-write recovery decision on the next load when a marker remains.
- Extend storage transaction groups into full interrupted-write replay instead of only recovery decision reporting.
- Already present: VFS user-document writes and TextEdit saves use atomic write-then-rename semantics that stage bytes under a sibling temp file, clean up failed commits, and preserve existing bytes/metadata until commit.
- Already present: package files, package DB JSON records, AppRegistry manifest JSON records, and ServiceManager state JSON records use VFS atomic write-then-rename semantics.
- Already present: package install/update activation is grouped into package-record, launcher, app-registry, and services phases with phase diagnostics and rollback on phase failure.
- Already present: package install/update activates staged package image roots from `/tmp/dindbos/package-staging` into `/opt/<package>` as the package-root phase, cleaning staging paths after success or rollback.
- Extend atomic activation to archive imports and broader multi-record registry/service/app-state groups.
- Add filesystem snapshots and rollback points for package updates and user-triggered restore.
- Already present: persistent storage can reserve estimated write bytes before browser persistence mutation and deny quota-exceeding writes without touching the backing adapter.
- Already present: inline package installs reserve estimated package file, package record, and launcher bytes before filesystem/app registry mutation, then fail closed on quota denial.
- Already present: remote package installs reserve declared remote file sizes plus package record and launcher bytes before package file fetch or filesystem/app registry mutation, then fail closed on quota denial.
- Extend quota reservation to large app/import writes.
- Already present: first-pass `fsck` integrity checks detect VFS structure problems and file size drift, expose dry-run repair plans, and can repair safe size/children metadata.
- Extend `fsck`-style integrity checks to inode/content mismatches, orphaned content records, broken mount metadata, package DB drift, and salvage exports.
- Add optional per-user encrypted volumes using WebCrypto-derived keys.
- Add storage pressure handling that can evict cache volumes without touching durable user files.

Verification:

- Already present: `npm run smoke:persistent-storage` verifies storage write journal records for snapshot fallback writes, OPFS write-failure fallback, matching OPFS multi-record transaction groups, interrupted transaction recovery decisions, and quota denial before adapter mutation.
- Already present: `npm run smoke:packages` verifies inline package install quota denial happens before install directory, package record, or app registry mutation.
- Already present: `npm run smoke:packages` verifies remote package install quota denial happens before package file fetch, install directory, package record, or app registry mutation.
- Already present: `npm run smoke:storage` verifies VFS atomic write abort cleanup, existing file preservation, metadata preservation, and successful atomic commit; `npm run smoke:packages` verifies sandboxed package access to the atomic VFS API.
- Already present: `npm run smoke:packages` verifies package DB and AppRegistry manifest atomic create events during package install; `npm run smoke:services` verifies service state atomic create events.
- Already present: `npm run smoke:packages` verifies activation phase diagnostics and rollback when package activation fails at app registration.
- Already present: `npm run smoke:packages` verifies package-root staged activation, cleanup of successful/failed staging roots, and package DB exclusion of staging paths.
- Already present: `npm run smoke:storage` and `npm run smoke:shell` verify fsck dry-run and safe repair behavior for corrupt file size metadata.
- Add smoke coverage for simulated interrupted writes, package rollback, snapshot restore, large app/import quota denial before mutation, and repair of orphaned records.

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
- Already present: DOM-backed window and desktop surface capture APIs return bounded `metadata+dom-text` capture descriptors through the window API and compositor broker. Own-window capture is allowed; cross-app and full-desktop capture require explicit `compositor.captureWindow` / `compositor.captureDesktop` capabilities plus user approval, and `/proc/compositor` exposes capture allow/deny counters without claiming pixel screenshot bytes.
- Already present: windows can publish accessibility metadata through the window API, including role, name, value, bounds, state, actions, focus, and child controls; `/proc/compositor` exposes per-surface accessibility summaries without granting direct DOM access.
- Already present: compositor diagnostics under `/proc/compositor` expose focused pid, active window, surface geometry, paint mode, viewport, capture owner placeholder, and last input event; `doctor` also reports the focused surface summary.

Verification:

- Already present: `npm run smoke:window-manager` verifies focus transfer, shortcut precedence, shortcut scope routing, stable surface geometry, last-input recording, IME/drop routing, compositor clipboard copy/paste policy, pointer-lock policy, accessibility metadata publication, surface capture own-window allowance, cross-app/desktop capture denial, capability-approved desktop capture, process-suspend and window-close pointer capture cleanup, closed-surface removal from `/proc/compositor`, input/shortcut/clipboard/pointer-lock/capture/cleanup router state, and `/proc/compositor`; `npm run smoke:shell` verifies `doctor` compositor diagnostics.
- Already present: `npm run smoke:processes` verifies minimized, suspended, and crashed processes release compositor capture ownership through the process manager.

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

- Already present: DindbOS exposes a first-pass mount table with mount id, root path, driver type, readonly flag, owner, durability, quota policy, capability requirements, local mount entries, text `/proc/mounts`, JSON `/proc/mounts.json`, and shell `mount` output.
- Split VFS behavior into drivers such as `memfs`, `opfsfs`, `cachefs`, `procfs`, `devfs`, `pkgfs`, `zipfs`, `localfs`, and future `netfs`.
- Already present: `mount.list`, `mount.mount`, and `mount.unmount` syscalls expose the mount table and runtime `memfs` mount/unmount operations. Shell `mount -t memfs <path> [--readonly]` and `umount <path>` route through the syscall boundary, while sandboxed apps need `mount.read` / `mount.manage` capability checks.
- Already present: first-pass readonly `overlayfs` snapshot mounts combine lower and upper VFS trees with upper-over-lower precedence for package development, safe mode, and staged update workflows.
- Already present: installed package roots are readonly `pkgfs` image mounts under `/opt/<package-id>`, visible through package image mount records and the shared mount table before app registration.
- Already present: first-pass readonly `zipfs` mounts list and read stored-method ZIP archive entries from a VFS archive file.
- Already present: first-pass driver-level metadata normalization keeps `stat` shape and common error codes stable across `memfs`, `overlayfs`, `zipfs`, and `pkgfs` paths where those drivers expose mounted VFS nodes.
- Already present: `/proc/mounts`, JSON mount records, `mount`, and `df` diagnostics show driver, durability, used bytes, quota policy, and browser support limitations from the shared mount table.

Verification:

- Already present: `npm run smoke:boot` verifies mount table entries for browser-backed user storage, package storage, cache storage, and procfs; `npm run smoke:shell` verifies `mount` output; `npm run smoke:local-mounts` verifies local mounts refresh mount table procfs.
- Already present: `npm run smoke:shell` verifies shell `mount -t memfs`, shell `umount`, `mount.list`, `mount.mount`, and `mount.unmount`; `npm run smoke:permissions` verifies sandbox denial for mount management without capability.
- Already present: `npm run smoke:boot` verifies readonly runtime `memfs` write denial with `EACCES` and unsupported driver normalization with `ENOTSUP`.
- Already present: `npm run smoke:packages` verifies installed package roots are readonly directory-like `pkgfs` mounts and deny writes with `EACCES`; `npm run smoke:boot` verifies installed package image mounts appear in the shared mount table.
- Already present: `npm run smoke:boot` verifies `/proc/mounts` includes used-byte and support diagnostics; `npm run smoke:shell` verifies `mount` and `df` render the same diagnostic fields.
- Already present: `npm run smoke:boot` verifies `overlayfs` lower-only files, upper-only files, upper-over-lower precedence, and shared mount table overlay metadata.
- Already present: `npm run smoke:boot` verifies `zipfs` root listing, nested listing, nested file reads, and shared mount table ZIP entry counts.
- Already present: `npm run smoke:boot` verifies cross-driver `stat` shape for `memfs`, `overlayfs`, `zipfs`, and `pkgfs`, plus `zipfs` unsupported compression normalization to `ENOTSUP`.
- Already present: `npm run smoke:wasm` verifies Shell, AppSandbox filesystem APIs, NodeCompat, and WASI all read the same mounted `memfs` path.

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

- Already present: package records include first-pass namespace metadata for package root, private state root, private cache root, private temp root, process group, dependency root, device grants, network grants, IPC endpoints, and child-process limit.
- Already present: ProcessManager inherits parent namespaces for child process launches, package WASM entries pass package namespace into their child process manifest, and `/proc/<pid>/status` plus `/proc/processes.json` expose process namespace metadata.
- Already present: package CLI tools run as `nodecompat-cli` DindbOS processes with package namespace metadata, package filesystem scopes, declared dependency allowlists, process history, and shell `pkg run <package> [args...]` handoff.
- Already present: package apps can launch worker executor CPU tasks through the app sandbox; `ProcessExecutor` records parent pid and inherited package namespace metadata for worker-backed tasks.
- Already present: package manifests can declare first-pass service units; PackageManager registers them as service records, ServiceManager starts them with package namespace metadata, and uninstall unregisters the service/process.
- Already present: AppSandbox NodeCompat execution inherits package filesystem scopes and a first-pass declared npm dependency allowlist, so package code cannot `require()` undeclared package-local dependency trees through NodeCompat.
- Already present: per-package dependency views expose declared dependency roots and enforce undeclared package-local `node_modules` denial for AppSandbox filesystem APIs, package SDK dependency inspection, WASM filesystem checks, package services, and namespace-inherited child processes.
- Already present: Process procfs writes namespace-aware `/proc/<pid>/root`, `/proc/<pid>/cwd`, `/proc/<pid>/mounts`, and `/proc/<pid>/limits` diagnostics, including package root, synthetic state/cache/temp/dependency namespace mounts, and namespace limits.
- Already present: AppSandbox exposes a first-pass IPC facade backed by an in-runtime broker; package namespaces can register declared IPC endpoints, cross-package sends are denied unless the sender namespace declares the endpoint, and process exit/crash unregisters owned endpoints.
- Already present: package manifests support a normalized `sandbox` section for root policy, state policy, cache policy, temp policy, device grants, network hosts, IPC endpoints, and child-process limits; package records, app manifests, package public records, and namespace metadata expose the resolved policy.
- Already present: package uninstall kills running package namespace processes, which closes their descriptors and unregisters owned IPC endpoints, then removes package root, app state, package record, launcher, and private state/cache/temp namespace roots.
- Already present: package namespace cache eviction is explicit through `packages.evictNamespaceCache()` and shell `pkg cache clear <package>`, removing only the private package cache root contents before recreating the cache root.
- Already present: package namespace cleanup removes both process-owned IPC endpoints and non-process namespace IPC endpoints through `unregisterIpcEndpointsForNamespace()` during package uninstall.
- Already present: developer tooling can run `pkg strict <manifest-path|package>` or `packages.strictNamespaceCheckFromManifestPath()` before publishing to validate package root, private roots, dependency allowlist, read/write scopes, CLI entry, and package service ids without installing the manifest.

Verification:

- Already present: `npm run smoke:packages` verifies package namespace root metadata, state/cache/temp root creation, app manifest namespace exposure, and namespace root cleanup on uninstall.
- Already present: `npm run smoke:packages` launches package code that verifies another package root is denied through AppSandbox filesystem APIs and undeclared package-local `node_modules` reads are denied through NodeCompat dependency resolution.
- Already present: `npm run smoke:packages` verifies AppSandbox filesystem APIs, package SDK dependency views, WASM filesystem policy checks, and package service filesystem facades allow declared package dependencies while denying undeclared dependency trees.
- Already present: `npm run smoke:packages` verifies package-launched child app processes and package WASM child process history inherit package namespace metadata.
- Already present: `npm run smoke:packages` verifies namespace-aware process procfs root, cwd, mounts, and limits diagnostics for package-launched child processes.
- Already present: `npm run smoke:packages` verifies denied cross-package IPC against a real package-registered endpoint.
- Already present: `npm run smoke:packages` verifies package sandbox manifest policy normalization and exposure through package records, app manifests, and namespace metadata.
- Already present: `npm run smoke:packages` verifies package uninstall cleans running package app processes, inherited child processes, IPC endpoints, and state/cache/temp namespace roots.
- Already present: `npm run smoke:packages` verifies package CLI execution through `packages.runCli()` and shell `pkg run`, including inherited package namespace metadata, cross-package root denial, undeclared dependency denial, output/status capture, and process history.
- Already present: `npm run smoke:packages` verifies package-launched worker executor tasks inherit parent pid, package namespace metadata, and worker executor history.
- Already present: `npm run smoke:packages` verifies package-declared service units register with package id, expose namespace in service manifest, start service processes with package namespace metadata, and unregister/stop on package uninstall.
- Already present: `npm run smoke:packages` verifies strict namespace tooling succeeds for installed packages and pre-publish manifest paths, and fails broad read/write scopes with shell status 1.
- Already present: `npm run smoke:packages` verifies `pkg cache clear <package>` removes private cache contents while preserving the package root, state root, temp root, and recreated cache root.
- Already present: `npm run smoke:packages` verifies package uninstall removes non-process namespace IPC endpoints in addition to process-owned endpoints.

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

- Already present: first-pass keychain service exposes per-user vault metadata, app-scoped secrets, lock/unlock state, temporary grants, revocation, redacted metadata files, and audit records without storing raw secret values in ordinary VFS records.
- Already present: keychain records use WebCrypto-backed random secret references and package signing key public identifiers for first-pass signing-key lookup; encrypted wrapping and cryptographic assertion verification remain future hardening.
- Already present: first-pass passkey/WebAuthn enrollment, unlock, and reauthentication flows are exposed through the keychain service and shell, require WebAuthn user verification where supported, and keep password-derived fallback clearly marked as weaker.
- Already present: package manifests can declare `secrets` references with alias, keychain name, kind, required flag, and purpose; package app manifests and runtime public records expose only references, and package apps can request declared credentials through the keychain facade.
- Already present: first-pass signing key management creates auditable package-author signing key references and public key ids without exposing private key material through shell lookup.
- Already present: `keychain` shell commands cover list, status, get, set, delete, lock, unlock, grant, revoke, audit, explicit export, signing create, and signing lookup.
- Already present: Settings runtime diagnostics render keychain vault state, active grants, denied requests, stale credentials, and export/recovery warnings without exposing raw secret values.

Verification:

- Already present: `npm run smoke:keychain` verifies app-scoped secret denial, temporary grant expiry, vault lock/unlock, package signing key lookup, revoked access, and audit log creation.
- Already present: `npm run smoke:keychain` verifies package manifest secret references are exposed as metadata, granted package apps can read declared credentials through `os.keychain.getDeclared()`, undeclared package secret requests are denied, and package DB records do not contain raw secret values.
- Already present: `npm run smoke:keychain` verifies raw secret values are not exposed through ordinary keychain metadata VFS reads or keychain audit logs.
- Already present: `npm run smoke:settings` verifies Settings reads keychain diagnostics and renders active grants, denied requests, stale credentials, export warnings, and recovery warnings.
- Already present: `npm run smoke:keychain` verifies ordinary package DB, keychain metadata, and audit-log exports do not expose raw secret values, non-exportable secrets cannot be exported, and explicitly exportable secrets only expose values through the keychain service export path.
- Already present: `npm run smoke:keychain` verifies passkey enrollment, WebAuthn-backed unlock, passkey reauthentication, unavailable-WebAuthn refusal, required user verification options, status diagnostics, and audit records.

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

## Further Technically Feasible Native-OS Push

These items are beyond the current convergence backlog, but they are still technically possible. They should be treated as hard engineering tracks, not product polish. Most of them require a stricter kernel boundary, Service Workers, dedicated Workers, cross-origin isolation, WASM Component Model support, WebCrypto/WebAuthn, WebRTC, OPFS, or narrowly scoped helper companions.

The acceptance bar is unchanged: the feature only counts when it becomes a reusable DindbOS primitive with a documented syscall/API boundary, shell diagnostics, package manifest policy, and smoke coverage. If it cannot be exercised by at least two caller surfaces, such as shell plus package app or WASM plus NodeCompat, it is still experimental infrastructure.

### Native-Like 51: Service Worker Boot Kernel And Offline Command Queue

Status: Later.

Goal: move the parts of DindbOS that can survive tab refreshes into a Service Worker-backed boot and offline coordination layer.

Why it matters:

- Native OSes do not disappear just because one window closes.
- Browsers cannot provide a fully resident kernel, but Service Workers can own fetch routing, offline asset availability, background sync where supported, push wakeups where approved, and install/update lifecycle.
- This gives DindbOS a more realistic boot path for installed PWA mode while still reporting closed-page limitations honestly.

Implementation tasks:

- Add a Service Worker runtime manifest that records DindbOS build id, boot schema, cached core assets, offline shell assets, package index snapshots, and migration compatibility.
- Add a boot handshake between the page runtime and Service Worker that reports cache state, update state, offline capability, storage availability, and pending commands.
- Add an offline command queue for safe deferred work such as package index refresh, sync retry, backup enqueue, notification scheduling, and companion health probes.
- Add per-command credentials, capability requirements, retry policy, idempotency key, expiration, and audit log metadata.
- Add Service Worker-owned fetch policy for DindbOS system assets, package repository metadata, update manifests, and local documentation routes.
- Add `bootctl worker`, `queuectl list`, `queuectl retry`, `queuectl cancel`, and `doctor offline` shell diagnostics.
- Add degraded modes for browsers without Background Sync, Push, persistent storage, or installed PWA affordances.
- Ensure Service Worker tasks never receive raw VFS or keychain access; they must request privileged mutation through the page runtime broker when the page is alive.

Verification:

- Add smoke coverage for first install cache population, offline boot shell availability, pending queue persistence, retry after network restore, cancellation, unsupported browser degradation, and update conflict reporting.
- Add tests proving queued commands retain declared user/process credentials and cannot exceed package manifest capabilities.
- Add tests proving DindbOS does not claim closed-page execution on browsers that only allow Service Worker fetch handling.

Completion criteria:

- Installed DindbOS can boot into a useful offline recovery shell or degraded desktop when network is unavailable.
- Deferred work is auditable, cancellable, credentialed, and honest about browser wakeup limits.

### Native-Like 52: Kernel Worker Isolation And Object-Capability Handles

Status: Later.

Goal: move kernel-owned services behind a dedicated Worker boundary and replace broad object access with narrow, revocable handles.

Why it matters:

- Native OS kernels isolate privileged state from ordinary user programs.
- DindbOS currently has kernel-like services, but stronger isolation requires message passing, structured capabilities, and revocation rather than direct object references.
- A Worker kernel boundary makes future app containers, process cleanup, crash handling, and multi-core scheduling much more credible.

Implementation tasks:

- Define a kernel Worker protocol for filesystem, process, descriptor, mount, device, network, package, keychain, registry, and policy requests.
- Replace direct privileged object exposure with object-capability handles that carry type, owner pid, rights, expiry, revocation state, and audit metadata.
- Add handle inheritance rules for child processes, package launches, WASM modules, NodeCompat tasks, services, and IPC endpoints.
- Add handle revocation for process exit, crash, suspend, logout, permission change, package uninstall, and companion disconnect.
- Add a kernel message budget, request deadline, result size limit, and backpressure behavior so one process cannot starve the runtime.
- Add `/proc/handles`, `/proc/kernel-worker`, `handlectl`, and Activity Monitor diagnostics.
- Add a compatibility shim so high-level APIs can migrate gradually onto the handle protocol without breaking existing apps at once.
- Add structured clone and transferable buffer rules for binary IO without leaking mutable kernel state.

Verification:

- Add smoke coverage for allowed handle use, denied rights, revocation after crash, inherited stdout/stderr descriptors, filesystem handle expiry, and oversized kernel response failure.
- Add cross-runtime tests proving shell, WASM, package apps, and NodeCompat observe the same handle rights.
- Add regression tests proving a crashed app cannot keep writing through stale handles.

Completion criteria:

- Privileged runtime state is no longer passed to apps as mutable JavaScript objects.
- Process cleanup can revoke every filesystem, descriptor, device, IPC, network, and companion capability owned by a pid.

### Native-Like 53: Process Checkpointing, Fork-Like Snapshots, And Restore

Status: Later.

Goal: support controlled process snapshots for restart, suspend/resume, crash reproduction, and fork-like worker cloning where browser constraints allow it.

Why it matters:

- Native OSes can suspend processes, checkpoint state, create child processes, and preserve enough diagnostics to reproduce failures.
- Browsers cannot clone arbitrary JavaScript execution stacks, but DindbOS can snapshot declarative process state, VFS state, environment, descriptors, WASM memory where allowed, app UI state, and worker launch metadata.
- This makes long-running apps, CLI jobs, and package tests more resilient.

Implementation tasks:

- Define a process checkpoint format with pid lineage, executable identity, argv, env, cwd, uid/gid, filesystem scopes, capabilities, descriptors, mount namespace, signal state, resource limits, and package metadata.
- Add checkpoint hooks for app state, WASM memory buffers, worker task state, shell command state, NodeCompat module graph metadata, and service state.
- Add explicit snapshot modes: diagnostic-only, restartable, suspendable, fork-template, and package-test fixture.
- Add `checkpoint create`, `checkpoint list`, `checkpoint inspect`, `checkpoint restore`, and `checkpoint prune` shell commands.
- Add restore policy that refuses unsafe snapshots when runtime ABI, package version, trust state, or mount layout no longer matches.
- Add crash reproduction bundles that include checkpoint metadata, syscall trace, process log, mount table, resource limits, and browser capability report.
- Add storage quotas, retention policy, encryption hooks, and user consent for checkpoints containing sensitive files or keychain handles.
- Add fork-like cloning only for supported runtimes such as worker-backed WASM or deterministic task runners, with clear `ENOTSUP` for ordinary live JavaScript stacks.

Verification:

- Add smoke coverage for diagnostic checkpoint creation, restore refusal on ABI mismatch, WASM restartable snapshot where supported, app state restore, stale descriptor denial, retention pruning, and crash bundle contents.
- Add tests proving checkpoints do not bypass filesystem scopes, mount namespace restrictions, user credentials, or revoked capabilities.
- Add tests proving unsupported live-stack cloning fails explicitly instead of pretending to fork.

Completion criteria:

- DindbOS can suspend, restore, or reproduce supported workloads through declared checkpoint data.
- Unsupported process cloning boundaries are visible to users and package authors.

### Native-Like 54: WASM Component Model, Dynamic Linking, And Shared Runtime Libraries

Status: Later.

Goal: let compiled programs share stable DindbOS runtime interfaces and libraries instead of bundling every dependency into one opaque `.wasm` file.

Why it matters:

- Native OSes support shared libraries, ABI negotiation, dynamic loading, and language-neutral system interfaces.
- WASM Component Model and interface types are the browser-safe path toward multi-language programs that target one OS contract.
- This can make C, Rust, Zig, Go, TinyGo, and future languages feel like first-class DindbOS targets.

Implementation tasks:

- Define DindbOS component interfaces for filesystem, descriptors, process, clock, entropy, environment, package metadata, network, devices, keychain, and UI handoff.
- Add component manifest fields for required interfaces, optional interfaces, ABI version range, memory limits, filesystem scopes, and capability needs.
- Add runtime linking for shared DindbOS libraries stored under `/lib`, package-provided components under `/opt`, and trusted system components under `/system`.
- Add interface version negotiation with clear errors for missing interface, incompatible ABI, denied capability, unsupported browser feature, and unsafe shared library trust state.
- Add package install validation that checks component imports before activation.
- Add `wasmctl components`, `ldd`-style diagnostics, component cache management, and syscall trace integration.
- Add shared-library update policy so a library upgrade can be rolled back if dependent packages fail compatibility checks.
- Map WASI Preview 2 or successor interfaces onto DindbOS syscalls where practical, while documenting unsupported host assumptions.

Verification:

- Add smoke coverage for component import success, missing interface denial, ABI mismatch, shared library update rollback, package activation gate, and cross-language fixture packages.
- Add tests proving component calls flow through the same syscall tracing and permission checks as JavaScript package APIs.
- Add tests proving untrusted package libraries cannot replace trusted system components.

Completion criteria:

- Compiled DindbOS programs can target stable OS interfaces instead of private runtime imports.
- Shared runtime libraries are versioned, permissioned, diagnosable, and rollback-safe.

### Native-Like 55: Poll, Select, Epoll-Like Multiplexing, And Async IO Readiness

Status: Later.

Goal: provide a portable readiness model for descriptors, sockets, pipes, devices, timers, and IPC endpoints.

Why it matters:

- Native CLI and server programs rely on `select`, `poll`, `epoll`, `kqueue`, or equivalent readiness APIs.
- DindbOS already has descriptors and async browser operations, but portable programs need one way to wait on multiple IO sources.
- A readiness layer makes terminal programs, virtual sockets, IPC services, and WASM ports more realistic.

Implementation tasks:

- Add readiness states for readable, writable, closed, errored, hung up, priority event, timer expired, device changed, and signal pending.
- Add syscalls such as `io.poll`, `io.wait`, `timer.create`, `timer.cancel`, and descriptor readiness subscription APIs.
- Add descriptor adapters for VFS files, pipes, PTYs, `/dev` devices, virtual sockets, IPC endpoints, browser fetch streams, WebSocket streams, and worker message channels.
- Add timeout handling, cancellation tokens, fairness rules, max watched descriptors, and backpressure reporting.
- Add shell diagnostics through `pollctl`, `lsof`, and richer `/proc/<pid>/fd` readiness metadata.
- Add WASI and NodeCompat mappings so portable packages can use the readiness model without private shims.
- Add browser throttling reports so hidden-tab timer delays are surfaced as degraded readiness, not silent scheduler failure.
- Add cleanup rules that remove readiness watchers when a process exits, crashes, loses permission, or closes a descriptor.

Verification:

- Add smoke coverage for waiting on pipe output, PTY input, timer expiry, socket message, descriptor close, cancellation, timeout, hidden-tab degradation report, and process cleanup.
- Add cross-runtime tests proving shell, WASM, NodeCompat, and package apps observe the same readiness events.
- Add stress tests for many descriptors so starvation and leaked watchers are caught.

Completion criteria:

- Event-driven programs can wait on multiple DindbOS IO sources through one documented OS boundary.
- Readiness behavior is fair, cancellable, observable, and honest about browser timer limits.

### Native-Like 56: Network Namespaces, Loopback Services, And Policy Firewalls

Status: Later.

Goal: make network access feel like an OS-managed subsystem with namespaces, loopback services, routing policy, and audit logs instead of direct browser fetch calls.

Why it matters:

- Native OSes separate processes with network namespaces, firewall rules, DNS policy, socket ownership, and service binding.
- Browsers prevent raw sockets, but DindbOS can still broker Fetch, WebSocket, WebRTC data channels, loopback service endpoints, and companion-backed raw networking behind explicit policy.
- This is required before server-like packages can run credibly inside the OS.

Implementation tasks:

- Add per-process network namespaces with allowed hosts, schemes, ports, protocols, loopback bindings, DNS policy, proxy policy, and companion requirements.
- Add loopback service registry where DindbOS services can bind virtual ports, advertise health, and receive descriptor-backed stream requests.
- Add firewall profiles for deny-by-default apps, package-specific allowlists, managed mode, offline mode, metered mode, and companion-assisted raw socket mode.
- Add `net.open`, `net.listen`, `net.accept`, `net.resolve`, and `net.policy` syscalls mapped onto browser-safe transports.
- Add `netstat`, `ss`, `route`, `firewallctl`, `curl`, and DNS policy probe commands.
- Add network audit logs under `/var/log/dindbos/network.log` and `/proc/<pid>/network`.
- Add user prompts and revocation behavior for sensitive network classes such as LAN discovery, WebRTC peer connections, and companion raw socket access.
- Add failure normalization for CORS denial, browser offline, DNS failure, TLS failure, policy denial, companion missing, and protocol unsupported.

Verification:

- Add smoke coverage for allowed fetch stream, denied host, loopback service request, WebSocket policy, namespace isolation, audit log entry, revoked permission, and companion-missing raw socket refusal.
- Add tests proving packages cannot bypass the network broker through direct `fetch` when sandboxed.
- Add tests proving CORS/browser failures are reported distinctly from DindbOS policy denials.

Completion criteria:

- Networked DindbOS programs use declared OS policy and virtual sockets rather than raw browser globals.
- Users can inspect which process contacted which endpoint, through which policy, and why a request was allowed or denied.

### Native-Like 57: Real-Time Media Server And Low-Latency Device Graph

Status: Later.

Goal: provide an OS-level graph for audio, video, screen, capture, speech, and low-latency media routing.

Why it matters:

- Native OSes have media servers that route devices, streams, permissions, effects, and app isolation.
- Browsers expose powerful media APIs, but DindbOS needs a broker so apps do not call camera, microphone, screen capture, audio output, or speech APIs directly.
- A media server makes communication apps, recording tools, browser streams, accessibility tools, and creative workloads possible.

Implementation tasks:

- Add a media device registry with input/output devices, stream ids, owner process, permission state, sample/video format, latency, muted state, and browser support metadata.
- Add graph nodes for microphone, camera, screen capture, tab capture where available, audio output, analyser, mixer, recorder, encoder, decoder, speech recognition, and speech synthesis.
- Add manifest capabilities and user prompts for `media.audioInput`, `media.videoInput`, `media.screenCapture`, `media.audioOutput`, `media.record`, and `media.speech`.
- Add descriptor or stream APIs for media frames/chunks with backpressure and cleanup on process crash or permission revocation.
- Add Settings and Activity Monitor views for active media use, device access history, mute controls, and degraded browser states.
- Add `mediactl devices`, `mediactl sessions`, `mediactl revoke`, and `/proc/media` diagnostics.
- Add companion protocol only for native-only media paths that browser APIs cannot provide, such as virtual audio drivers or system-wide screen capture outside browser policy.
- Add privacy indicators and data access reports integrated with the privacy ledger.

Verification:

- Add smoke coverage with mockable media devices for permission denial, granted session, revoke cleanup, stream descriptor close, process crash cleanup, and diagnostics output.
- Add browser-profile tests for unsupported capture classes and permission-denied browser prompts.
- Add tests proving an app cannot access raw media APIs through the sandbox when it lacks manifest capabilities.

Completion criteria:

- Media-capable apps consume DindbOS media devices through a visible OS broker.
- Users can see, revoke, and audit active media access without trusting each app UI.

### Native-Like 58: Policy-Proven Package Sandboxes And Reproducible App Environments

Status: Later.

Goal: make every installed app run in a reproducible environment whose permissions, dependencies, mounts, devices, network, and secrets can be explained and replayed.

Why it matters:

- Native OS package managers and container systems give each app a predictable runtime contract.
- DindbOS already has packages and scopes, but native-like trust needs reproducible environment resolution and policy proofs before launch.
- This is the bridge between package install, compatibility tiers, security profiles, mount namespaces, keychain access, and update rollback.

Implementation tasks:

- Add environment lockfiles that pin package version, dependency graph, syscall ABI, compatibility tier, mount namespace, filesystem scopes, devices, network policy, service units, and secret references.
- Add launch-time policy proof generation that explains every granted capability and every denied request source.
- Add reproducible app profile creation for browser-only, PWA, companion-assisted, managed, offline, and test-lab modes.
- Add immutable package root mounts plus writable overlay mounts for app data, cache, temp, and user-selected document scopes.
- Add environment diffing so updates show changed permissions, changed dependencies, changed network hosts, changed device access, and changed migration requirements before activation.
- Add `appctl env`, `appctl diff`, `appctl explain`, `appctl replay`, and package test fixture export.
- Add deterministic test harness support that can replay the same app environment against local smoke tests and compatibility lab profiles.
- Add rollback behavior that restores previous package root, writable overlay metadata, service state, and registry entries when activation fails.

Verification:

- Add smoke coverage for environment lock creation, launch proof contents, denied capability explanation, update diff, rollback after failed activation, and deterministic fixture replay.
- Add tests proving app code cannot mutate its immutable package root and cannot obtain undeclared mounts, devices, network hosts, or secrets.
- Add tests proving the same package produces the same resolved environment under the same compatibility profile.

Completion criteria:

- Package launches are explainable, reproducible, testable, and rollback-safe.
- Security review can inspect one environment proof instead of reverse-engineering runtime behavior.

### Native-Like 59: Linux Syscall Compatibility Facade For WASM Userland

Status: Later.

Goal: let selected Linux-oriented WASM programs run against a DindbOS syscall translation layer without pretending DindbOS is a full Linux kernel.

Why it matters:

- A native OS becomes useful when existing command-line and library ecosystems can be ported with limited changes.
- DindbOS already has a syscall ABI and WASI direction, but many real tools expect Linux-shaped errno, fd, process, signal, time, and filesystem behavior.
- A compatibility facade would make browser-safe ports of BusyBox-like tools, SQLite shells, archive tools, language runtimes, and build utilities more realistic.

Implementation tasks:

- Define a Linux-compat syscall subset document that maps each supported syscall to native DindbOS primitives, browser constraints, or explicit `ENOSYS`/`ENOTSUP` failures.
- Add descriptor-table translation for `openat`, `close`, `read`, `write`, `pread64`, `pwrite64`, `lseek`, `fcntl`, `ioctl` probes, `statx`, `fstat`, `getdents64`, `renameat`, `unlinkat`, `mkdirat`, and `readlinkat`.
- Add process/time/sysinfo compatibility for `getpid`, `getppid`, `clock_gettime`, `nanosleep`, `uname`, `getrandom`, `brk`/memory probes, and conservative resource-limit probes.
- Map Linux-style path resolution to DindbOS mount namespaces, package roots, permissions, and current working directory.
- Add signal and process-control compatibility where DindbOS can model it, and fail unsupported fork/exec/native thread semantics with documented compatibility errors.
- Add a `linux-compat` package/runtime flag so packages can declare that they require the facade and receive compatibility diagnostics before launch.
- Add tooling that records unsupported syscall traces during test runs so package authors can see what blocks a port.

Verification:

- Add smoke fixtures compiled to WASM that exercise fd IO, directory reads, metadata, time, random bytes, and unsupported syscall failures through the Linux-compat layer.
- Add regression tests proving the same VFS permissions apply through DindbOS syscalls, WASI imports, NodeCompat, and Linux-compat syscalls.
- Add compatibility reports for at least one small real-world browser-safe C/Rust/Zig utility compiled to WASM.

Completion criteria:

- A documented subset of Linux-oriented WASM CLI tools can run as DindbOS processes with real VFS, argv/env, stdio, exit status, and `/proc` visibility.
- Unsupported Linux behavior is visible in traces and compatibility reports instead of being silently faked.

### Native-Like 60: Browser-Native Container Images, Rootfs Layers, And Chroots

Status: Later.

Goal: make packages launch inside inspectable root filesystem views built from immutable layers plus writable overlays.

Why it matters:

- Native OSes and container platforms isolate programs by controlling rootfs, mounts, dependency views, writable data, and runtime identity.
- DindbOS package roots and mount drivers are first-pass primitives; a container-like rootfs model would make app environments more reproducible.
- This is technically possible in the browser if DindbOS treats container images as VFS layers, not as host OS containers.

Implementation tasks:

- Define a DindbOS image manifest containing base layer refs, package layer refs, mount table entries, environment variables, users/groups, device grants, network policy, and startup commands.
- Add immutable layer formats backed by `pkgfs`, `zipfs`, tar-like archives, OPFS snapshots, or signed package blobs.
- Add per-process rootfs views so `/`, `/usr`, `/opt`, `/home`, `/tmp`, and `/run` can resolve differently by package namespace while sharing kernel services.
- Add readonly lower layers and writable upper overlays for app state, cache, temp, and selected user document scopes.
- Add `chroot`/`rootfs`-style runtime APIs for process launch, shell command execution, WASM execution, NodeCompat resolution, and service units.
- Add image import/export commands with signatures, manifest digests, layer digests, and compatibility-tier requirements.
- Add garbage collection for unreferenced layers, stale writable overlays, failed activation roots, and abandoned temp mounts.

Verification:

- Add smoke coverage for rootfs path isolation, readonly lower-layer denial, writable overlay persistence, package update layer diffing, and uninstall garbage collection.
- Add tests proving two apps can see different `/opt`, `/tmp`, and dependency views while sharing the same kernel process table and permission broker.
- Add recovery tests proving a failed image activation rolls back to the previous rootfs view.

Completion criteria:

- A package can launch inside a reproducible DindbOS rootfs view without app code receiving global filesystem access.
- Rootfs contents, mounts, policies, and writable overlays are inspectable through shell/API diagnostics.

### Native-Like 61: Deterministic Replay, Core Dumps, And Time-Travel Diagnostics

Status: Later.

Goal: make crashes and hard-to-reproduce package failures replayable from OS-level traces.

Why it matters:

- Native operating systems provide crash dumps, logs, traces, and debuggers because real software fails in complex states.
- Browser-native apps can still produce deterministic-enough replay when the OS records syscalls, events, random seeds, timers, storage versions, network broker decisions, and permission prompts.
- This would turn DindbOS from a demo runtime into a debuggable platform.

Implementation tasks:

- Add structured kernel event recording for process spawn, syscalls, descriptor operations, VFS reads/writes, mount changes, permission decisions, IPC messages, network broker decisions, timers, and device events.
- Add per-process core dump records containing manifest, compatibility tier, argv/env, cwd, namespace, mount table digest, open descriptors, recent logs, crash reason, and relevant stack summaries.
- Add deterministic replay mode that replays recorded syscall responses, VFS snapshots, permission outcomes, random bytes, time ticks, and network fixtures.
- Add `coredumpctl`, `tracectl`, and `replay` shell commands for listing, exporting, pruning, replaying, and comparing runs.
- Add privacy controls so traces redact secrets, keychain values, personal paths, pasted clipboard data, and app-declared sensitive payload fields.
- Add developer UI for crash timeline, last syscalls, storage mutations, denied permissions, network attempts, and replay drift.
- Add trace size quotas, sampling policy, retention policy, and compression for long-running sessions.

Verification:

- Add smoke coverage for a crashing package that emits a core dump, a replayable syscall trace, redacted sensitive fields, and deterministic replay output.
- Add tests proving replay does not mutate live user files unless launched in an explicit replay sandbox.
- Add regression tests for trace retention, quota eviction, and export/import of replay bundles.

Completion criteria:

- A developer can reproduce a package failure from a DindbOS trace bundle without manually reconstructing the runtime state.
- Crash records are useful for debugging but do not leak secrets through ordinary logs.

### Native-Like 62: Coherent File Cache, Writeback Daemon, And Offline Sync Journal

Status: Later.

Goal: make local mounts, browser-backed storage, package caches, and remote sync behave like coherent storage layers with explicit writeback and conflict policy.

Why it matters:

- Native OSes do not treat every file operation as an isolated app-level save; they coordinate caches, dirty pages, flushes, fsync, conflicts, and recovery.
- DindbOS already has durable VFS and local mount concepts, but native-like behavior needs a storage daemon that owns dirty state and sync policy.
- This remains browser-feasible by using OPFS/IndexedDB, File System Access handles, service workers where available, and explicit companion helpers only for host-only operations.

Implementation tasks:

- Add a storage daemon responsible for dirty file tracking, writeback queues, fsync-like barriers, cache eviction, local mount refresh, quota pressure, and sync conflict records.
- Add per-volume journal records for pending writes, completed flushes, failed flushes, external file changes, tombstones, and recovery checkpoints.
- Add `sync`, `fsync`, `mount --flush`, `mount --refresh`, `journalctl -u storage`, and Settings diagnostics for storage health.
- Add conflict strategies: block write, keep both versions, user-mediated merge, package-defined resolver, and readonly degraded mode.
- Add background sync hooks that flush safe browser-backed operations when page lifecycle allows, and explicit offline queue replay after restart.
- Add volume-level policies for package cache, app state, user documents, local mounts, remote volumes, and temporary files.
- Add write amplification and quota diagnostics so large workloads can explain why storage is slow or degraded.

Verification:

- Add smoke coverage for dirty write tracking, flush success, flush failure, external-change conflict, restart recovery, quota pressure, and readonly degraded volume behavior.
- Add tests proving shell, GUI apps, NodeCompat, and WASM writes all go through the same dirty-state and writeback policy.
- Add browser-profile tests for OPFS/IndexedDB availability, File System Access absence, private-mode storage failures, and quota denial.

Completion criteria:

- DindbOS can explain whether data is clean, dirty, syncing, conflicted, degraded, or lost before an app claims a save succeeded.
- File writes survive restarts or fail with explicit recoverable storage state.

### Native-Like 63: System Call Fuzzing, Kernel Invariant Tests, And Policy Verification

Status: Later.

Goal: harden DindbOS kernel primitives with automated adversarial tests rather than relying only on happy-path smoke checks.

Why it matters:

- Native OS kernels are stress-tested because bugs often appear in invalid inputs, race conditions, permission edges, and cleanup paths.
- A browser-native OS still needs kernel invariants: no cross-package escape, no descriptor leak, no permission bypass, no unbounded query, no corrupted mount table, and no broken rollback.
- This is feasible locally with deterministic test runtimes, property-based generators, and replayable fuzz seeds.

Implementation tasks:

- Add property-based generators for paths, mount tables, descriptors, package manifests, permission scopes, IPC payloads, network policies, and service lifecycle events.
- Define kernel invariants for VFS tree consistency, mount resolution, descriptor lifecycle, process cleanup, package rollback, namespace isolation, permission denial, and procfs visibility.
- Add fuzz harnesses for syscalls, shell parsing, package install/update/remove, NodeCompat module resolution, WASI path operations, mount/unmount, and IPC brokers.
- Add deterministic seed recording and minimal reproduction output for every fuzz failure.
- Add policy verification for package environments that proves requested permissions match declared scopes before launch.
- Add CI-friendly fast fuzz suites plus slower local stress suites with documented runtime budgets.
- Add `doctor invariants` and `kernel test` diagnostics that report invariant status in developer builds.

Verification:

- Add seeded regression tests for every discovered kernel invariant failure.
- Add tests proving fuzz runs cannot mutate the developer's real local files or external credentials.
- Add coverage reports that distinguish deterministic smoke tests, property tests, fuzz tests, and browser-profile tests.

Completion criteria:

- DindbOS can reject malformed runtime inputs without filesystem corruption, leaked process state, or permission bypass.
- Kernel confidence is backed by reproducible adversarial tests, not only demo workflows.

### Native-Like 64: Runtime ABI Versioning, Stable SDK Contracts, And Long-Term Compatibility

Status: Later.

Goal: make DindbOS programs keep working across runtime updates through explicit ABI and SDK compatibility rules.

Why it matters:

- Native OSes maintain ABI contracts so apps are not rewritten for every kernel or SDK change.
- DindbOS already has API negotiation, but a native-like platform needs versioned syscall contracts, SDK contracts, package metadata, migration rules, and deprecation policy.
- This is technically feasible because the browser runtime can keep compatibility shims in userland if the contracts are measured and tested.

Implementation tasks:

- Version the syscall ABI, package manifest schema, SDK modules, app sandbox APIs, NodeCompat facades, WASI imports, mount driver ABI, device ABI, and companion protocols separately.
- Add a compatibility resolver that selects shims based on package target version, runtime version, browser profile, and companion availability.
- Add deprecation metadata with replacement APIs, removal windows, runtime warnings, package audit output, and documentation links.
- Add migration adapters for package records, registry state, service units, app state, keychain references, and environment lockfiles.
- Add `abi inspect`, `abi diff`, `pkg audit`, and `doctor abi` commands for developers and users.
- Add fixtures for old packages so runtime changes must prove backward compatibility before merge.
- Add an ABI policy document that defines what counts as stable, experimental, internal, deprecated, removed, and impossible.

Verification:

- Add smoke coverage that installs and runs packages targeting older SDK/syscall/package manifest versions.
- Add tests proving incompatible packages fail before mutation and compatible packages receive the correct shim.
- Add ABI diff tests that flag breaking changes to stable contracts unless an explicit migration is present.

Completion criteria:

- A DindbOS package can declare its required runtime contracts and either run with a known shim or fail before install/launch with a clear reason.
- Stable APIs are enforced by tests rather than maintained only by convention.

### Native-Like 65: System Installer, First-Boot Setup, And Factory Reset

Status: Later.

Goal: make DindbOS install, initialize, repair, and reset itself like an operating system distribution instead of a single web app state blob.

Why it matters:

- Native OSes have installation media, first-boot setup, user creation, disk layout, recovery tools, and factory reset paths.
- Browser-native DindbOS can model this with a signed system image, storage bootstrap, user/session setup, default packages, service graph, and recovery profiles.
- This makes the project easier to treat as an actual OS environment with lifecycle boundaries.

Implementation tasks:

- Add signed system image metadata for kernel/runtime version, built-in apps, default packages, service units, storage schema, compatibility tiers, and recovery assets.
- Add first-boot setup for user creation, storage backend selection, optional encryption, local companion pairing, default package installation, and privacy settings.
- Add boot profile selection for normal boot, safe mode, offline mode, repair mode, reset mode, and developer mode.
- Add factory reset that preserves or wipes user home, keychain, package cache, companion pairing, logs, and local mount references according to explicit user choice.
- Add repair tools for missing system files, broken manifests, incompatible package records, corrupt registry state, and failed migrations.
- Add install/import/export flows for portable system images and test-lab fixtures.
- Add clear versioned boundaries between immutable system files, mutable config, user data, package state, cache, temp, and logs.

Verification:

- Add smoke coverage for first boot, second boot, safe mode, repair mode, factory reset with preserve-home, factory reset wipe-all, and failed setup rollback.
- Add tests proving reset does not leave stale package apps, broken services, leaked keychain grants, or orphaned mount entries.
- Add migration fixtures for old system images and partial setup states.

Completion criteria:

- DindbOS can be initialized, repaired, reset, and re-imported through OS-level workflows with inspectable state transitions.
- Users can distinguish system files, user data, package state, cache, logs, and recovery assets.

### Native-Like 66: Capability-Aware Local Companion Fleet

Status: Later.

Goal: extend optional native-adjacent helpers into a managed fleet of narrow companions without collapsing the browser sandbox boundary.

Why it matters:

- Some native OS capabilities remain impossible in browser-only mode: raw TCP/UDP, host filesystem rename semantics, native build tools, virtual audio devices, hardware inventory, and system-wide capture.
- DindbOS can still approach native behavior by treating helpers like separate drivers with identity, attestation, pairing, permissions, health, and audit.
- This keeps the "real OS in the browser" claim honest: browser-safe work stays in the browser, native-only work crosses explicit companion boundaries.

Implementation tasks:

- Define companion identities for browser provider, file helper, network helper, build helper, device helper, media helper, test-lab helper, and remote administration helper.
- Add pairing with signed capability manifests, protocol versions, local/remote origin policy, user approval, keychain-backed credentials, revocation, and expiry.
- Add a companion manager service that tracks health, permissions, active sessions, protocol mismatches, update requirements, logs, and degraded fallback state.
- Route all companion access through DindbOS brokers; apps must never receive raw companion URLs, tokens, sockets, or host paths.
- Add least-privilege protocols for each helper instead of one all-powerful local daemon.
- Add trust labels and audit logs in Settings, Activity Monitor, package environment proofs, and `doctor compat`.
- Add failure modes that keep browser-only DindbOS usable when companions are absent, stale, denied, or compromised.

Verification:

- Add smoke coverage for companion pairing, permission denial, protocol mismatch, revocation, expired trust, helper crash, degraded fallback, and audit log creation.
- Add tests proving app code cannot bypass brokers to use companion credentials directly.
- Add separate browser-only and companion-assisted compatibility profiles so support claims remain measurable.

Completion criteria:

- Native-only capabilities are available only through explicit, inspectable, revocable OS boundaries.
- DindbOS remains useful in browser-only mode and clearer, not less secure, when companions are present.

### Native-Like 67: Trusted System UI And Secure Attention Path

Status: Later.

Goal: make OS-owned prompts, lock screens, permission dialogs, update approvals, keychain unlocks, and destructive confirmations distinguishable from app-rendered UI.

Why it matters:

- Native OSes protect users with trusted system UI for login, elevation, keychain prompts, screen capture indicators, permission grants, and shutdown/update confirmation.
- Browser apps can draw anything that looks like a dialog, so a browser-native OS needs an explicit anti-spoofing boundary before high-value permissions become credible.
- This is technically possible by routing sensitive decisions through compositor-owned surfaces, reserved shortcuts, focus locks, process attribution, and audit logs.

Implementation tasks:

- Define trusted surface classes for login, lock/unlock, keychain unlock, permission grant, package install trust, companion pairing, remote admin approval, destructive file operations, update activation, and factory reset.
- Add a compositor-owned trusted UI layer that ordinary apps cannot cover, embed, screenshot, spoof, or capture unless an explicit capture policy grants it.
- Add a reserved secure-attention action, such as a command palette chord or trusted status strip action, that always moves focus to the OS-owned security surface.
- Add trusted prompt records with prompt id, requester app id, pid, user, requested capability, target resource, policy source, timeout, decision, and audit digest.
- Add visual and programmatic provenance: every trusted prompt should expose OS issuer, requesting process, signed package identity where available, user scope, and whether a companion or remote admin is involved.
- Add prompt throttling, coalescing, timeout, denial caching, and abuse detection so a package cannot spam security UI to trick the user.
- Add `/proc/trusted-ui`, `/var/log/dindbos/trusted-ui.log`, `security prompt list`, `security prompt inspect`, and Settings security history.
- Add rules that sensitive grants can only be created by the trusted UI service or managed policy, never by direct app state mutation.

Verification:

- Add smoke coverage for trusted prompt creation, user grant, user denial, timeout, requester attribution, prompt history, spoofed app dialog denial, and screenshot/capture policy around trusted surfaces.
- Add tests proving package apps, sandboxed iframes, NodeCompat tools, WASM programs, services, and remote admin sessions cannot forge trusted prompt records.
- Add browser interaction tests where feasible for focus trapping, reserved shortcut routing, and compositor z-order protection.

Completion criteria:

- Users can distinguish OS security decisions from ordinary app UI.
- Sensitive grants, keychain unlocks, companion pairing, and destructive system operations cannot be approved through spoofable app-rendered dialogs.

### Native-Like 68: Browser-Native Threads, Atomics, And Shared Memory Runtime

Status: Later.

Goal: support a native-like threading subset for WASM and worker-backed programs using Workers, SharedArrayBuffer where available, Atomics, structured memory ownership, and explicit fallback modes.

Why it matters:

- Many real native programs assume threads, mutexes, condition variables, atomics, shared memory, and cancellation.
- Browsers can support real shared memory only under cross-origin isolation, and Worker scheduling remains browser-controlled, so DindbOS must expose this as a capability-gated runtime primitive.
- A clear thread model makes CPU-heavy tools, compilers, databases, media pipelines, and language runtimes more realistic without pretending the browser is a native kernel.

Implementation tasks:

- Define a DindbOS thread model with process-owned thread ids, worker ids, shared memory regions, stack metadata, lifecycle state, priority hint, cancellation state, and crash propagation.
- Add manifest capabilities for `thread.spawn`, `thread.shared-memory`, `thread.atomic-wait`, `thread.high-cpu`, and `thread.background`.
- Add syscalls and SDK APIs for thread spawn, join, detach, cancel, yield, sleep, futex-like wait/notify where supported, shared memory allocate/map/unmap, and thread-local diagnostics.
- Add SharedArrayBuffer support only when cross-origin isolation is verified; provide explicit `ENOTSUP` or single-thread fallback when unavailable.
- Add memory ownership rules so shared regions are tied to pid, namespace, package, user, quota, and revocation state.
- Add thread scheduling integration with worker pool limits, process limits, package limits, service lifecycle suspend/resume, and Activity Monitor CPU/memory reporting.
- Add `/proc/<pid>/threads`, `/proc/threads`, `/proc/shared-memory`, `threadctl`, and `doctor threads` diagnostics.
- Add WASM pthread compatibility guidance and NodeCompat worker-thread facade routing for packages that can operate inside DindbOS limits.

Verification:

- Add smoke coverage for thread spawn/join, cancellation, shared memory allocation, denied shared memory without capability, cross-origin-isolation fallback, crashed worker cleanup, and `/proc` thread visibility.
- Add WASM fixture tests for atomic counter behavior, worker pool limit enforcement, shared memory quota denial, and deterministic cleanup after process kill.
- Add tests proving one package cannot map another package's shared memory region or keep shared memory after uninstall, crash, logout, or permission revocation.

Completion criteria:

- Threaded workloads can run when browser capabilities allow it and fail explicitly when they do not.
- Shared memory is permissioned, quota-limited, observable, and cleaned up through the same process lifecycle as files, descriptors, and IPC endpoints.

### Native-Like 69: Host Peripheral Bus Brokers

Status: Later.

Goal: expose WebUSB, WebBluetooth, WebSerial, WebHID, Gamepad, MIDI, and future browser hardware APIs as OS-managed bus brokers instead of direct app access.

Why it matters:

- Native OSes mediate hardware through buses, drivers, permissions, hotplug events, and per-device policy.
- Browser APIs expose some real hardware paths, but each API has different permission, browser support, and user gesture constraints.
- DindbOS can get closer to a native OS by treating each hardware path as a device bus with discovery, grants, drivers, logs, and revocation.

Implementation tasks:

- Add bus records for USB, Bluetooth, Serial, HID, Gamepad, MIDI, NFC where available, and companion-provided bus bridges where browser APIs are missing.
- Add device identity records with vendor/product ids where available, user-visible name, class, serial hash, trusted state, last seen time, driver binding, and permission scope.
- Add package manifest capabilities for bus scan, device open, device read/write, exclusive lock, background access, companion bus access, and driver registration.
- Add user-mediated pairing/open flows through the trusted UI service, including purpose strings and per-device revocation.
- Add driver binding rules so a package-provided driver can claim only declared device classes and cannot receive unrelated devices.
- Add hotplug, disconnect, permission revoke, busy-device, unsupported-browser, and companion-missing events.
- Add descriptor-backed read/write streams for serial/HID/MIDI-like devices and structured event streams for gamepad/Bluetooth-style devices.
- Add `/proc/bus`, `/proc/devices`, `lsdev`, `busctl`, `devctl pair`, `devctl revoke`, and Settings device panels.

Verification:

- Add adapter-mock smoke coverage for supported bus probe, unsupported bus report, pairing grant, pairing denial, device open, read/write, disconnect cleanup, revoked grant, busy lock, and driver binding refusal.
- Add browser-profile tests for APIs that require real browser support or user gestures, with clear manual verification scripts where automation cannot drive the permission prompt.
- Add tests proving a package cannot access a device without the matching bus capability, device grant, and driver binding.

Completion criteria:

- Hardware-capable apps use DindbOS device brokers and diagnostics rather than raw browser hardware APIs.
- Device access remains honest about browser support, user gesture requirements, companion requirements, and revocation state.

### Native-Like 70: Guest VM, Virtual Hardware, And Nested Runtime Lab

Status: Later.

Goal: run tightly scoped guest environments such as small teaching OS images, RISC-V userlands, WASM-hosted interpreters, or nested DindbOS test images with explicit virtual hardware and resource limits.

Why it matters:

- Native OSes often host virtual machines, compatibility labs, and sandboxed guests.
- Browser-native DindbOS cannot run arbitrary native VMs at native speed, but WASM CPU emulators and nested runtimes can still provide real guest execution for education, compatibility tests, and isolated experiments.
- This should be treated as guest virtualization, not as proof that DindbOS is secretly Linux or macOS.

Implementation tasks:

- Define a guest runtime manifest with architecture, emulator runtime, disk image refs, virtual devices, boot command, memory limit, CPU budget, network policy, file exchange roots, and compatibility warnings.
- Add virtual hardware devices for console TTY, block disk, framebuffer, keyboard, pointer, serial port, clock, random source, loopback network, and host-file exchange.
- Add guest disk image mount/import/export through DindbOS VFS with permission checks and readonly/snapshot modes.
- Add process integration so each guest appears as a DindbOS process tree with pid, owner, resource limits, stdout/stderr, crash reason, and `/proc/<pid>/guest.json`.
- Add resource caps for emulated CPU steps, memory, framebuffer size, disk size, network packets, output rate, and wall-clock runtime.
- Add guest-to-host bridge policy for clipboard, file copy, network loopback, and display capture, all mediated by DindbOS brokers.
- Add `vmctl create`, `vmctl boot`, `vmctl pause`, `vmctl resume`, `vmctl snapshot`, `vmctl attach`, `vmctl export`, and `doctor vm`.
- Add compatibility labels that distinguish DindbOS-native, WASI, Linux-compat WASM, interpreted, emulated, nested DindbOS, and unsupported workloads.

Verification:

- Add smoke coverage for booting a tiny fixture guest, console output, disk image mount, snapshot create/restore, resource-limit kill, denied host file exchange, and guest cleanup after crash.
- Add tests proving guest virtual devices cannot bypass DindbOS filesystem, network, keychain, clipboard, or package namespace policy.
- Add performance guard tests so too-slow or unsupported guests fail with explicit degraded status instead of freezing the desktop.

Completion criteria:

- DindbOS can host supported guest workloads as isolated, inspectable, resource-limited processes.
- Guest environments are clearly labeled and cannot be confused with native DindbOS apps or browser host capabilities.

### Native-Like 71: System Pasteboard, Drag-Drop, And Share Broker

Status: Later.

Goal: centralize clipboard, pasteboard history, drag-and-drop, file transfer, share targets, and cross-app data exchange through an OS broker.

Why it matters:

- Native OSes treat clipboard and drag-drop as system services with data types, ownership, privacy prompts, file promises, and app handoff rules.
- DindbOS already has first-pass clipboard and compositor policy, but richer document and app workflows need a full pasteboard/share boundary.
- Browser clipboard and drag-drop APIs are powerful but permissioned and inconsistent, so app-direct usage would leak policy and make auditing impossible.

Implementation tasks:

- Add a pasteboard service with item id, owner pid, user, MIME types, data refs, sensitivity label, expiry, source app, target app, and audit state.
- Support text, HTML, Markdown, image blobs, file refs, virtual file promises, URLs, app-specific custom types, and redacted preview metadata.
- Add drag sessions owned by the compositor with source surface, target surface, allowed operations, cursor state, data types, temporary grants, and cancellation cleanup.
- Add a share broker for browser share sheet, download handoff, local mount save, package-to-package send, remote session transfer, and companion-assisted host sharing.
- Add privacy prompts and Settings policy for pasteboard history, cross-app paste, sensitive data, password-like content, local mount drops, and external share.
- Add `/proc/pasteboard`, `/proc/dragdrop`, `pbcopy`, `pbpaste`, `share`, `dropctl`, and Settings pasteboard history.
- Add automatic cleanup when the source process exits, a window closes, a session locks, a user logs out, a grant expires, or a package is uninstalled.
- Route raw browser clipboard and drag/drop calls through the broker for sandboxed package apps where feasible.

Verification:

- Add smoke coverage for copy/paste text, multi-MIME paste, denied cross-app paste, drag start/drop/cancel, file promise handoff, expiry cleanup, history disabled mode, and audit log records.
- Add browser interaction tests where feasible for real clipboard permission and drag/drop event routing.
- Add tests proving sensitive pasteboard items cannot be read by packages without the matching temporary or persistent grant.

Completion criteria:

- Clipboard, drag-drop, and share flows work as reusable OS services across shell, GUI apps, package apps, and remote/companion handoff.
- Users can inspect, clear, restrict, and audit pasteboard/share activity.

### Native-Like 72: Reproducible Build Farm And Native Toolchain Bridge

Status: Later.

Goal: let DindbOS build, verify, sign, and package browser-safe programs through reproducible build recipes, local WASM toolchains, remote builders, or narrowly scoped companion builders.

Why it matters:

- Native OS platforms need a software supply chain: source, builds, artifacts, signatures, provenance, dependency locks, advisories, and rollback.
- Building real WASM, NodeCompat, and package artifacts inside only the browser can be slow or impossible for some toolchains, but DindbOS can still own the policy and provenance boundary.
- This moves DindbOS closer to an OS distribution without giving packages raw host build access.

Implementation tasks:

- Define build recipes with source refs, dependency lockfiles, toolchain id, environment image, expected outputs, permissions, cache policy, reproducibility mode, and signing requirements.
- Add build backends for browser-only JavaScript packaging, WASM toolchains where feasible, remote sandboxed builders, and companion-assisted native toolchains.
- Add a build service that creates build processes with isolated roots, readonly source inputs, writable build/temp/cache overlays, network policy, CPU/memory/time limits, and artifact output grants.
- Add provenance records containing source digest, dependency digests, toolchain digest, builder identity, runtime ABI, browser profile, companion identity where used, logs, and artifact hashes.
- Add package signing integration with the keychain, trusted publisher records, repository metadata, and rollback-safe activation.
- Add `buildctl build`, `buildctl verify`, `buildctl diff`, `buildctl sign`, `buildctl publish`, `pkg provenance`, and `doctor builds`.
- Add cache isolation and garbage collection for build layers, failed outputs, dependency downloads, and toolchain artifacts.
- Add policy that prevents build scripts from reading user home, keychain, local mounts, companion credentials, or unrelated package roots unless explicitly granted.

Verification:

- Add smoke coverage for a deterministic browser-only package build, denied undeclared source read, artifact hash record, signing flow, failed build cleanup, cache reuse, and provenance inspection.
- Add tests proving remote or companion builders cannot receive secrets, raw host paths, or package credentials beyond declared build inputs.
- Add reproducibility tests that rebuild the same fixture and compare artifact digests under the same build profile.

Completion criteria:

- DindbOS can produce and verify package artifacts through inspectable build environments.
- Build provenance is strong enough for package trust decisions, repository publication, and rollback diagnostics.

### Native-Like 73: Certificate Authority, Trust Store, And Secure Transport Policy

Status: Later.

Goal: maintain an OS-level trust store for package repositories, remote sync providers, companion pairing, WebRTC peers, admin sessions, and signed runtime metadata.

Why it matters:

- Native OSes manage trusted roots, certificates, key usage, revocation, transport policy, and secure update channels.
- Browsers already own TLS for web navigation, but DindbOS still needs its own trust decisions for package signatures, repository metadata, encrypted sync, companion protocols, remote admin, and signed system images.
- A DindbOS trust service keeps these decisions auditable instead of scattering public keys and tokens across app state.

Implementation tasks:

- Add a trust store with roots, intermediates, publisher keys, companion keys, repository keys, admin keys, sync provider keys, key usage, expiry, revocation, and trust scope.
- Add certificate/key import flows through trusted UI, managed policy, repository metadata, local file import, or companion pairing.
- Add signature verification APIs for package manifests, package artifacts, repository indexes, migration manifests, system images, companion manifests, and remote admin tokens.
- Add revocation lists, trust pinning, trust-on-first-use records for local companions where acceptable, and rotation workflows for expiring keys.
- Add transport policy records for repository URLs, sync endpoints, admin endpoints, WebRTC peer identity, companion endpoints, and remote build providers.
- Add `/etc/dindbos/trust`, `/proc/trust`, `trustctl`, `certctl`, `pkg verify`, and Settings trust panels.
- Add failure modes for expired key, revoked key, wrong key usage, unknown issuer, bad signature, stale metadata, clock uncertainty, and managed-policy denial.
- Keep browser TLS status separate from DindbOS content trust so users can see both layers.

Verification:

- Add smoke coverage for trusted package verification, unknown signer refusal, revoked signer refusal, expired key warning, key rotation, companion manifest verification, and trust diagnostics.
- Add tests proving a package cannot add itself as a trusted publisher or downgrade repository trust metadata.
- Add tests proving signed system images, migrations, package artifacts, and companion manifests use the same trust service instead of private verification paths.

Completion criteria:

- DindbOS trust decisions are centralized, inspectable, revocable, and test-covered.
- Package, companion, sync, admin, and update flows cannot silently bypass the OS trust store.

### Native-Like 74: Kernel Panic, Safe Mode, And Emergency Recovery Shell

Status: Later.

Goal: provide native-like failure states for severe runtime corruption, failed migrations, broken services, storage damage, trust failures, and repeated boot crashes.

Why it matters:

- Native OSes have panic screens, recovery modes, single-user shells, safe boot, filesystem repair, rollback, and diagnostic bundles.
- Browser-native DindbOS should not crash into a blank page or silently reset user data when kernel-level invariants fail.
- A recovery shell makes the "real OS in the browser" claim more credible because the system can explain and repair itself.

Implementation tasks:

- Define panic classes for boot failure, migration failure, storage invariant failure, registry corruption, trust verification failure, service crash loop, package activation loop, companion protocol compromise, and resource exhaustion.
- Add a panic manager that freezes risky mutation, records state, opens a trusted recovery surface, and offers safe actions.
- Add safe mode boot that disables third-party packages, non-critical services, experimental modules, companion access, remote admin, and untrusted repositories.
- Add emergency shell commands for `doctor`, `fsck`, `regctl repair`, `pkg disable`, `service disable`, `mount remount-ro`, `rollback`, `image restore`, `logs export`, and `factory-reset`.
- Add recovery profiles for browser-only, offline, no-companion, storage-readonly, no-third-party, managed-policy, and developer diagnostic modes.
- Add panic bundles containing runtime version, boot phase, browser profile, lifecycle state, recent syscalls, service graph, package activation log, mount table, registry status, and redacted errors.
- Add repeated-boot-failure detection that automatically offers safe mode after a configurable crash threshold.
- Add UX copy that is honest about what can be recovered in browser storage and what requires a backup, export, remote sync, or companion.

Verification:

- Add smoke coverage for induced boot panic, safe mode entry, third-party package skip, readonly recovery shell, repair command success, failed repair report, rollback flow, and panic bundle export.
- Add tests proving emergency mode cannot leak keychain secrets, bypass user identity, or grant package permissions while the trust store is unavailable.
- Add regression tests for repeated boot crash detection and successful return to normal boot after repair.

Completion criteria:

- Severe runtime failures lead to inspectable recovery states, not silent data loss or blank-screen failure.
- Users and developers can repair, export diagnostics, roll back, or intentionally reset through OS-owned workflows.

## Long-Horizon Technically Feasible Native-OS Work

The following tasks are intentionally difficult, but still technically possible within a browser-native OS architecture. Some require cross-origin isolation, OPFS workers, WebAssembly, Service Workers, WebRTC, WebCrypto/WebAuthn, strict package policy, or narrowly scoped companions. They should be pursued only when the lower-level primitives above are stable enough to support them.

These items exist to push DindbOS closer to a native operating system without pretending the browser sandbox disappears. Each task must land as a kernel/runtime service with diagnostics, permissions, package policy, and smoke coverage before the roadmap can count it as implemented.

### Native-Like 75: OPFS Block Device, Page Cache, And Inode Journal

Status: Later.

Goal: move the durable storage layer closer to a real disk by modeling block-like content records, cache pages, inode metadata, and write-ahead journal replay.

Why it matters:

- Native OS filesystems are built on block devices, page caches, inode metadata, dirty-page flushing, and crash recovery.
- Browser storage is not a raw disk, but OPFS and IndexedDB can still back a block-device-like abstraction.
- A formal disk layer would make package installs, snapshots, image export, fsck, sync, and recovery more reliable than ad hoc VFS persistence.

Implementation tasks:

- Define a virtual block device API over OPFS content records, with block id, generation, checksum, dirty state, owner inode, and durability class.
- Add an inode journal for create, write, rename, link, unlink, chmod, chown, xattr, mount, package install, and package remove operations.
- Add a page-cache service that tracks dirty pages, flush pressure, eviction reason, cache hit rate, writeback latency, and quota pressure.
- Add journal replay during boot before package registry, app registry, service startup, and session recovery.
- Add atomic commit groups for package installs, archive imports, editor saves, system image imports, remote sync apply, and registry migrations.
- Add `fsctl journal`, `fsctl replay`, `fsctl flush`, `fsctl cache`, and `doctor fs` diagnostics.
- Keep cache volumes evictable while preventing user-home, keychain metadata, package DB, and system registry writes from being silently dropped.

Verification:

- Add smoke coverage for interrupted multi-file writes, journal replay, checksum mismatch detection, dirty-page flush, quota refusal before mutation, and page-cache eviction.
- Add tests proving package DB and VFS content cannot diverge after a simulated crash between staged writes and final commit.
- Add regression tests proving keychain raw values are not written into ordinary block records or journal payloads.

Completion criteria:

- DindbOS can recover from interrupted storage mutations with an inspectable journal and no silent data loss.
- Files, package records, mount records, and registry state are committed through one durable disk policy instead of separate best-effort paths.

### Native-Like 76: Kernel Object Registry And Handle-Based Access

Status: Later.

Goal: represent processes, files, descriptors, devices, sockets, timers, services, windows, mounts, credentials, and IPC endpoints as kernel-owned objects accessed through scoped handles.

Why it matters:

- Native kernels do not let user programs freely hold private kernel references. Programs receive handles, descriptors, capabilities, or object ids.
- DindbOS already has many runtime services, but stronger isolation needs a common handle model for every shared resource.
- Handle-based access is required for origin-isolated app containers, worker syscalls, WASM compatibility, secure IPC, and future kernel modules.

Implementation tasks:

- Define kernel object types, ids, owners, lifetimes, refcounts, capabilities, namespace membership, and audit labels.
- Add a handle table per process that can contain file descriptors, windows, IPC channels, devices, sockets, timers, service controls, mount handles, and keychain grants.
- Route app, shell, WASM, NodeCompat, service, and worker calls through handle resolution instead of direct object references where practical.
- Add handle inheritance rules for child processes, package namespaces, service processes, pipelines, app containers, and remote admin sessions.
- Add revoke, duplicate, close-on-exec, transfer, weak reference, and stale-handle error behavior.
- Expose `/proc/<pid>/handles.json`, `/proc/objects`, `lsof`, `handlectl`, and Activity Monitor resource views.
- Add resource limits for handle count, transferred bytes, outstanding events, and cross-process references.

Verification:

- Add smoke coverage for allowed handle use, stale handle denial, cross-process handle transfer, close-on-exit cleanup, inherited package namespace handles, and revoked grant behavior.
- Add tests proving a sandboxed app cannot use an object id unless it owns a valid handle with the required capability.
- Add fuzz-style tests for invalid handle ids, wrong object types, double close, duplicate close, and crash cleanup.

Completion criteria:

- Userland code cannot reach kernel services by private JavaScript references when a handle boundary should apply.
- Runtime diagnostics can explain which process owns which kernel objects and why access was allowed or denied.

### Native-Like 77: Browser-Native Fork/Spawn Model And Process Images

Status: Later.

Goal: provide a realistic process creation model for browser-safe workloads, including executable images, inherited handles, environment snapshots, working directories, credentials, and package namespaces.

Why it matters:

- Native OSes have a clear process image model: executable, argv, env, cwd, credentials, inherited descriptors, resource limits, and exit status.
- Browser JavaScript cannot implement `fork()` exactly, but DindbOS can implement spawn, snapshot, worker clone, and WASM process image semantics.
- This makes shell pipelines, package CLIs, daemons, build jobs, and compatibility shims more predictable.

Implementation tasks:

- Define process image records for JavaScript app, package CLI, service, worker task, WASM module, NodeCompat program, emulator workload, and companion-backed command.
- Add `spawn` and `exec` syscall families that accept executable path, argv, env diff, cwd, credentials, stdio handles, namespace profile, resource limits, and lifecycle policy.
- Add fork-like snapshots only for runtimes that can safely clone state, such as WASM linear memory checkpoints or worker task snapshots.
- Add process template caching for frequently launched CLI/package tools without reusing mutable process state unsafely.
- Add explicit unsupported errors for native assumptions that cannot map to browser execution, such as arbitrary memory clone or host process replacement.
- Add `/proc/<pid>/image.json`, `spawnctl`, and shell diagnostics for image type, entrypoint, inherited handles, namespace, and compatibility tier.
- Integrate process images with package manifests, service units, repository metadata, and secure boot trust state.

Verification:

- Add smoke coverage for spawn with inherited stdin/stdout/stderr, env override, cwd scope, package namespace, denied executable, process image diagnostics, and exit status propagation.
- Add tests proving process image snapshots cannot capture keychain values, companion credentials, or cross-app DOM references.
- Add WASM fixture tests for checkpoint-compatible and checkpoint-incompatible modules.

Completion criteria:

- Shell, services, packages, workers, and WASM programs use one spawn contract instead of separate launch shortcuts.
- Unsupported fork-like behavior fails explicitly while supported process images remain inspectable and reproducible.

### Native-Like 78: Capability-Safe Browser API Brokers

Status: Later.

Goal: route powerful browser APIs through DindbOS-owned brokers with manifests, user prompts, revocation, diagnostics, and testable policy.

Why it matters:

- A real OS owns access to devices, network, clipboard, files, notifications, sensors, media, storage, and user attention.
- Browser APIs are powerful but scattered; if apps call them directly, DindbOS cannot enforce policy or explain access.
- Brokered APIs make third-party apps safer and make browser limitations explicit instead of accidental.

Implementation tasks:

- Add brokers for File System Access, Clipboard, Notifications, Badging, Web Share, Web Locks, Storage Foundation/OPFS, IndexedDB quota, WebRTC, WebUSB, WebSerial, WebHID, WebMIDI, Gamepad, Battery, Geolocation where available, Screen Capture, MediaDevices, WebAudio, WebGPU, and WebCodecs.
- Define manifest capability names, user-facing permission labels, prompt policy, remembered grant policy, revocation policy, and denied-state errors for each broker.
- Add trusted system UI for prompts so packages cannot fake OS permission dialogs.
- Add `/proc/browser-capabilities`, `/proc/permissions`, Settings permission panels, and `doctor browser`.
- Add browser support probes that classify capabilities as available, unavailable, permission-denied, insecure-context, cross-origin-isolation-required, PWA-only, or companion-required.
- Add temporary grants with expiry and foreground-window ownership for sensitive APIs such as clipboard read, screen capture, camera, microphone, HID, Serial, and USB.
- Ensure all broker decisions include process id, app id, package id, user id, window id, capability, resource, and audit reason.

Verification:

- Add smoke coverage using mock adapters for allowed grant, denied grant, revocation, unsupported capability, expired temporary grant, and prompt spoofing refusal.
- Add browser integration checks where automation can safely verify real permissions, such as notification denial, clipboard write, and storage persistence classification.
- Add tests proving package apps without broker grants cannot receive powerful browser API objects through the DindbOS SDK.

Completion criteria:

- Apps access browser-native power through DindbOS permission brokers, not direct untracked calls.
- Users can inspect, revoke, and audit every sensitive browser capability currently active in the OS session.

### Native-Like 79: System Call Policy Compiler And Verification

Status: Later.

Goal: compile package manifests, user policy, managed policy, compatibility tiers, security profiles, and runtime trust state into enforceable syscall filters.

Why it matters:

- Native OSes and sandbox platforms enforce policy at the kernel boundary, not only in app UI code.
- As DindbOS adds syscalls, devices, IPC, networking, keychain, and companions, hand-written permission checks will become hard to audit.
- A policy compiler lets the runtime explain why an operation was allowed or denied and lets tests verify invariants mechanically.

Implementation tasks:

- Define a policy language for syscall allow/deny, path scopes, handle types, network hosts, devices, IPC endpoints, companion capabilities, service registration, child processes, and resource quotas.
- Compile policies from app manifests, package manifests, service units, user/group records, managed profiles, trust tiers, compatibility tiers, and temporary grants.
- Add policy versioning, migration, static validation, conflict resolution, and deny-by-default fallback.
- Add a fast runtime evaluator used by syscalls, AppSandbox, worker bridge, WASM imports, NodeCompat, services, packages, and companions.
- Add `policyctl compile`, `policyctl explain`, `policyctl diff`, `policyctl audit`, and Settings policy inspection.
- Add proof-style invariant checks for "no keychain raw export without keychain service", "no undeclared package dependency read", "no network without broker", and "no companion direct access".
- Log policy decisions with redaction, sampling, and per-process tails under `/proc/<pid>/policy.json`.

Verification:

- Add smoke coverage for policy compile success, invalid policy refusal, inherited child policy, temporary grant expiry, syscall denial explanation, and policy diff output.
- Add property-style tests over generated policy combinations for path escape, host allowlist bypass, undeclared device access, and revoked grant reuse.
- Add regression tests for every security invariant that has previously been implemented manually.

Completion criteria:

- New kernel services can plug into one policy evaluator instead of inventing their own access checks.
- Users and developers can ask "why was this denied?" and receive a deterministic policy explanation.

### Native-Like 80: Event-Sourced Kernel State And Deterministic Replay

Status: Later.

Goal: record kernel state transitions as a replayable event log for debugging, recovery, sync, audits, and reproducible bug reports.

Why it matters:

- Native OS debugging often depends on logs, traces, crash dumps, and deterministic reproduction.
- Browser runtime bugs can be intermittent because storage, lifecycle, workers, timers, and user events interleave.
- Event sourcing gives DindbOS a practical way to reconstruct what happened without exposing private app data.

Implementation tasks:

- Define event schemas for boot, process, syscall, descriptor, VFS mutation, package transaction, service lifecycle, permission decision, keychain access, network broker action, IPC, mount, sync, and companion operation.
- Add sequence numbers, timestamps, causal links, process ids, package ids, user ids, redaction policy, and integrity hashes.
- Store hot logs under `/var/run/dindbos/events` and durable compacted histories under `/var/log/dindbos/events`.
- Add replay modes for diagnostics only, dry-run recovery validation, crash reproduction, and test fixture generation.
- Add event compaction, privacy filtering, export bundles, and managed retention policy.
- Add `eventctl tail`, `eventctl replay`, `eventctl export`, `eventctl verify`, and `doctor events`.
- Integrate deterministic replay with panic bundles, remote admin, package bug reports, and CI regression fixtures.

Verification:

- Add smoke coverage for event recording, redacted export, replay of a VFS/package sequence, integrity mismatch detection, and retention cleanup.
- Add tests proving sensitive values from keychain, clipboard, auth tokens, and private file contents are redacted unless a trusted diagnostic export explicitly includes them.
- Add replay regression tests for a known crash or denied permission scenario.

Completion criteria:

- A bug report can include enough OS-owned event history to reproduce the failure without leaking secrets by default.
- Recovery tools can validate planned repairs against the event history before mutating durable state.

### Native-Like 81: Cross-Origin Isolation Deployment Profile

Status: Later.

Goal: define a hardened deployment mode that enables SharedArrayBuffer, stronger worker coordination, high-performance WASM, isolated app containers, and stricter browser security headers.

Why it matters:

- Several native-like capabilities depend on cross-origin isolation, including SharedArrayBuffer, Atomics-based coordination, high-performance WASM patterns, and safer app container boundaries.
- Not every host or browser can support the required headers, so DindbOS needs an explicit profile instead of assuming these capabilities exist.
- A deployment profile keeps Pages/demo, local dev, PWA, managed, and companion-assisted modes honest.

Implementation tasks:

- Define deployment profiles for basic browser tab, installed PWA, cross-origin isolated, managed kiosk, local companion, hosted remote provider, and developer mode.
- Add COOP/COEP/CORP header requirements, asset loading restrictions, worker script restrictions, iframe restrictions, and third-party resource policy.
- Add capability probes for SharedArrayBuffer, Atomics wait/notify, OffscreenCanvas in worker, WebGPU, WebCodecs, OPFS worker access, and Service Worker availability.
- Add fallback behavior for non-isolated deployments, including disabling shared memory, downgrading worker scheduling, and refusing packages that require isolation.
- Add package manifest fields for `requiresCrossOriginIsolation`, shared-memory use, worker-rendered surfaces, high-resolution timers, and unsupported fallback.
- Add `doctor isolation`, Settings deployment diagnostics, and documentation for GitHub Pages, local dev server, Netlify/static hosting, and PWA deployment.

Verification:

- Add smoke coverage with capability mocks for isolated/non-isolated profiles, package refusal, fallback diagnostics, and settings rendering.
- Add deployment checks that verify required headers are present in production-like static hosting before marking the profile as isolated.
- Add tests proving packages cannot receive SharedArrayBuffer-style capabilities when the runtime is not actually isolated.

Completion criteria:

- DindbOS can tell users and packages exactly which deployment profile is active and which native-like features are enabled because of it.
- High-performance worker/WASM features are gated by real browser security conditions, not optimistic detection.

### Native-Like 82: User-Space Network Service Mesh

Status: Later.

Goal: turn loopback services, package services, WebSocket endpoints, WebRTC peers, fetch streams, and companion network helpers into a policy-controlled in-OS service mesh.

Why it matters:

- Native systems route service discovery, local ports, firewall policy, DNS, sockets, and credentials through OS-owned layers.
- Browser networking can still support a useful virtual network if service discovery, host policy, credentials, and diagnostics are centralized.
- A service mesh would let packages expose local APIs to each other without bypassing permissions or leaking browser fetch access.

Implementation tasks:

- Add service identities, loopback addresses, virtual ports, protocol labels, TLS/trust policy, DNS-like names, and package namespace ownership.
- Route package service calls through virtual sockets or HTTP/WebSocket adapters with policy checks and connection accounting.
- Add service discovery records under `/run/dindbos/services`, `/proc/net/services`, and package public metadata.
- Add per-service firewall rules for allowed callers, users, packages, compatibility tiers, methods, paths, message sizes, and rate limits.
- Add credential injection through keychain references without exposing raw tokens to network logs or package DB records.
- Add sidecar-like brokers for fetch-to-service, service-to-WebRTC, companion network helper, and remote provider forwarding.
- Add `svcctl`, `netctl`, `curl --dindbos-service`, and Settings network service diagnostics.

Verification:

- Add smoke coverage for service registration, allowed loopback call, denied caller, rate limit, service crash cleanup, credential redaction, and `/proc/net/services` reporting.
- Add tests proving a package service cannot bind someone else's service name or bypass host allowlists through loopback forwarding.
- Add WebSocket and fetch stream tests for cancellation, backpressure, and closed-service refusal.

Completion criteria:

- DindbOS packages can expose and consume local services through an auditable OS network boundary.
- Network diagnostics show who connected to what, why it was allowed, and what policy would block it.

### Native-Like 83: Native-Like UI Security Layers And Anti-Spoofing

Status: Later.

Goal: make login, permission prompts, keychain unlock, package install, companion pairing, screen capture, and dangerous system actions use trusted OS-owned surfaces that apps cannot impersonate.

Why it matters:

- Native OSes protect users with trusted paths for password prompts, biometric prompts, permission dialogs, package install confirmation, and screen-recording indicators.
- Browser apps can draw convincing fake UI unless the runtime creates clear trusted surfaces and denies app overlay during sensitive actions.
- DindbOS needs trusted UI before it can safely broker keychain, device, screen, companion, and admin capabilities.

Implementation tasks:

- Define trusted surface types for login, lock screen, keychain unlock, passkey/WebAuthn prompt handoff, package trust, companion pairing, admin elevation, permission grants, screen capture indicator, and destructive system action confirmation.
- Add compositor rules that place trusted surfaces above app windows, freeze or dim untrusted input surfaces, and expose visible origin/package identity.
- Add secure attention gestures where browser policy allows, with explicit fallback when a real secure attention path is impossible.
- Add prompt tokens bound to process id, window id, package id, capability, resource, and expiration.
- Add anti-spoofing checks that prevent apps from naming windows, icons, or buttons in ways that look like trusted OS UI during active grants.
- Add audit records for every trusted prompt, including accepted, denied, expired, revoked, and interrupted states.
- Add `/proc/trusted-ui`, Settings prompt history, and `doctor trusted-ui`.

Verification:

- Add smoke coverage for trusted prompt ordering, denied app overlay, expired prompt token, wrong-window grant refusal, trusted indicator display, and prompt audit logs.
- Add tests proving package apps cannot trigger a grant for one capability and reuse it for another capability or resource.
- Add regression tests for keychain, screen capture, device, companion, and package-install prompts once they share the trusted UI service.

Completion criteria:

- Sensitive OS decisions happen through a reusable trusted UI service, not app-rendered dialog lookalikes.
- Users can distinguish DindbOS-owned prompts from ordinary app windows.

### Native-Like 84: Runtime Conformance Suite And Native-Like Certification Levels

Status: Later.

Goal: define certification levels that prove which native-like guarantees a DindbOS build, package, browser, deployment, or companion actually satisfies.

Why it matters:

- The project needs a way to say "this is a real browser-native OS primitive" without relying on vague claims.
- Native platforms have conformance tests, certification suites, hardware matrices, driver qualification, and compatibility labels.
- DindbOS should make implementation rate meaningful by tying it to tested guarantees rather than feature names.

Implementation tasks:

- Define certification levels for kernel basics, durable disk, package platform, WASM userland, worker isolation, descriptors/PTY, network broker, keychain, storage recovery, secure boot, managed policy, and companion trust.
- Add a conformance runner that boots isolated test profiles, installs fixture packages, runs shell/WASM/NodeCompat/app/service workloads, checks `/proc` diagnostics, and validates policy denials.
- Add browser/deployment capability profiles for Chromium, Safari, Firefox, mobile, PWA, cross-origin isolated, offline, local companion, and managed mode.
- Add package certification metadata for supported ABI version, compatibility tier, required capabilities, fallback behavior, smoke commands, and expected resource envelope.
- Add companion certification metadata for protocol version, declared capabilities, trust material, audit behavior, failure handling, and downgrade refusal.
- Add machine-readable reports under `/var/log/dindbos/conformance`, `doctor conformance`, and CI artifacts.
- Add docs that explain which claims are certified, experimental, degraded, companion-required, or impossible in browser-only mode.

Verification:

- Add smoke coverage for conformance report generation, failed guarantee reporting, package certification refusal, companion protocol mismatch, and browser profile classification.
- Add CI matrix entries for the supported static runtime profile and focused browser integration tests where automation is practical.
- Add tests proving a build cannot mark a certification level complete unless all required probes and smoke checks passed.

Completion criteria:

- Native-like claims map to named, tested certification levels.
- Users, package authors, and contributors can see exactly which OS guarantees are implemented in the current build.

## Beyond-Horizon Technically Feasible Native-OS Work

The following tasks push DindbOS even closer to native operating-system behavior. They are not short-term polish. They are technically feasible only if the lower layers keep maturing: syscall policy, process images, handle tables, origin-isolated containers, trusted UI, durable storage, WebCrypto/WebAuthn, cross-origin isolation, and companion protocols.

The acceptance bar stays strict: every task must become an OS-owned primitive with runtime APIs, shell diagnostics, package policy, audit records, and focused smoke coverage. If the feature only looks native in one UI panel, it does not count.

### Native-Like 85: Directory Service, Federated Identity, And Account Recovery

Status: Later.

Goal: move from local user records toward a real identity layer with local accounts, managed accounts, passkeys, recovery flows, and optional federation.

Why it matters:

- Native OSes do not treat users as a single mutable string; they have account records, identity providers, login policies, recovery keys, directory sync, and group membership.
- DindbOS already has users, groups, sessions, and per-user state, but native-like deployments need stronger identity boundaries.
- Browser-native identity is technically possible through WebAuthn/passkeys, Credential Management, OIDC/OAuth handoff, signed policy profiles, and encrypted per-user vaults.

Implementation tasks:

- Define account authority types: local, guest, managed profile, passkey-backed, federated OIDC, recovery-only, and disabled.
- Add durable identity records under `/etc/dindbos/identity`, with uid/gid mapping, display name, authority, login policy, recovery status, group sync source, and last-auth diagnostics.
- Add `loginctl login`, `loginctl logout`, `loginctl whoami`, `loginctl recover`, `idpctl`, and Settings account diagnostics.
- Add passkey-first login and reauthentication flow that unlocks session, keychain, encrypted volumes, companion grants, and admin prompts through one trusted identity broker.
- Add optional OIDC/OAuth browser handoff for managed accounts, storing refresh credentials only through the keychain service.
- Add account recovery keys, escrow-disabled local recovery, admin reset policy, guest reset policy, and disabled-account behavior.
- Add group sync and policy inheritance from managed identity records into process credentials, package policy, keychain access, and remote session control.
- Add audit records for login, logout, failed auth, recovery, group sync, disabled-account access, and identity-provider errors.

Verification:

- Add smoke coverage for local login, passkey login, failed login, account recovery, disabled account refusal, group sync application, and per-user state isolation after identity switch.
- Add tests proving federated tokens never appear in ordinary VFS files, package DB records, sync snapshots, event logs, or crash bundles.
- Add mock identity-provider tests for expired tokens, revoked accounts, group membership changes, and offline fallback.

Completion criteria:

- Multiple account types can use one session boundary without weakening per-user filesystem, keychain, package, and process isolation.
- Identity failures are explicit, auditable, and recoverable through OS-owned flows.

### Native-Like 86: ACLs, Extended Attributes, And Capability Labels

Status: Later.

Goal: extend Unix-style owner/group/mode permissions with ACLs, xattrs, labels, and inherited capability policy.

Why it matters:

- Native OSes often need richer permissions than mode bits: ACLs, labels, quarantine flags, provenance, indexing hints, backup metadata, and security profiles.
- DindbOS already has ownership and chmod-style checks, but package sandboxes, managed policy, document brokers, sync, and malware quarantine need richer metadata.
- Browser storage can persist this metadata if it is modeled as filesystem state and enforced by VFS, descriptors, syscalls, and package policy.

Implementation tasks:

- Add metadata fields for ACL entries, inherited ACL flags, security label, quarantine label, provenance id, backup policy, sync policy, content hash, and xattr map.
- Add `getfacl`, `setfacl`, `xattr`, `labelctl`, and `security label` shell commands.
- Route ACL and label checks through VFS path traversal, descriptor opens, AppSandbox filesystem access, NodeCompat, WASI, local mounts, document broker grants, and package namespaces.
- Add package manifest rules for requested labels, writable label domains, document-handler grants, and inherited child-process labels.
- Add label transitions for downloaded files, imported archives, package installs, companion-provided files, synced files, and generated documents.
- Add Settings and Files.app inspectors for ACLs, labels, quarantine state, provenance, and effective access explanation.
- Add migration logic from current mode-only metadata to label-aware metadata without changing existing file ownership unexpectedly.

Verification:

- Add smoke coverage for ACL allow/deny, inherited ACL behavior, xattr read/write, label transition on import, quarantine denial, and effective permission explanation.
- Add cross-runtime tests proving Shell, Files.app, AppSandbox, NodeCompat, and WASI see the same ACL and label decisions.
- Add regression tests proving a package cannot remove quarantine or security labels unless policy grants that label transition.

Completion criteria:

- Access control can express real document sharing, quarantine, managed policy, and package sandboxing without broad filesystem grants.
- Users and developers can inspect why a file was allowed, denied, quarantined, or label-restricted.

### Native-Like 87: Kernel Debugger, Profiler, And Live Tracing Console

Status: Later.

Goal: provide OS-level debugging tools for kernel services, processes, syscalls, workers, WASM, packages, storage, and companions.

Why it matters:

- Native OSes have kernel debuggers, profilers, tracepoints, diagnostic consoles, panic reports, and performance counters.
- DindbOS already has logs and smoke tests, but a complex browser OS needs live introspection that does not require editing private runtime code.
- Browser APIs, worker instrumentation, event logs, performance marks, and structured tracepoints make this feasible.

Implementation tasks:

- Add kernel tracepoint registration for boot, syscall, process, descriptor, VFS, mount, network, keychain, package, service, compositor, worker, WASM, policy, and companion events.
- Add a trace session manager with start/stop, filters, sampling, redaction, ring buffers, export bundles, and per-process trace tails.
- Add `ktrace`, `kdebug`, `profile`, `perf`, `tracectl`, and Settings/Activity Monitor tracing panels.
- Add CPU-time and wall-time profiling around worker jobs, WASM runs, NodeCompat execution, package install phases, large file operations, and compositor input dispatch.
- Add source-map and package manifest correlation where available, while preserving redaction for private file contents, keychain values, and auth tokens.
- Add panic breakpoints that capture live kernel object tables, handle tables, process images, descriptor state, policy state, and last trace events.
- Add trace permission policy so ordinary apps can trace only themselves, admins can trace system services, and managed policy can disable sensitive tracing.

Verification:

- Add smoke coverage for trace start/stop, syscall filtering, redacted export, package install trace, worker profile sample, denied cross-process trace, and panic bundle inclusion.
- Add tests proving trace logs do not expose keychain raw values, clipboard contents, network token query values, or private file bytes by default.
- Add performance regression tests for tracing overhead in disabled, sampled, and full-trace modes.

Completion criteria:

- A developer can diagnose a slow or failing DindbOS workload from OS-owned diagnostics instead of private runtime references.
- Trace data is useful, permissioned, redacted, and exportable for reproducible bug reports.

### Native-Like 88: Hibernation, Session Images, And Process Restore

Status: Later.

Goal: let DindbOS suspend and restore user sessions, selected processes, windows, descriptors, and runtime state as explicit session images.

Why it matters:

- Native OSes can sleep, hibernate, restore windows, recover crashed sessions, and resume some app state after reboot.
- Browsers can unload tabs at any time, but DindbOS can snapshot enough process, package, window, service, and filesystem state to recover honestly.
- This is different from pretending background execution survives tab close; it is a controlled checkpoint and restore policy.

Implementation tasks:

- Define session image records containing user id, boot id, runtime version, open windows, process images, package namespaces, service states, descriptors that can be restored, pending operations, and recovery warnings.
- Add hibernation eligibility rules for app types: pure stateful apps, shell sessions, WASM programs with checkpoint support, worker jobs with resumable state, services with lifecycle hooks, and non-restorable companion sessions.
- Add `hibernate`, `resume`, `sessionctl image`, `sessionctl restore`, and Settings recovery controls.
- Add per-process `prepare-hibernate`, `snapshot`, `restore`, and `discard-snapshot` lifecycle hooks.
- Add window restore policy that reopens apps through AppRegistry/package manifests and reconnects only handles that are safe to restore.
- Add explicit unsupported markers for remote browser companion pages, raw sockets, device streams, live media, active keychain prompts, and non-checkpointable WASM memory.
- Store session images under `/var/lib/dindbos/session-images` with integrity hashes, user ownership, quota policy, and optional encryption.

Verification:

- Add smoke coverage for session image creation, window restore, shell history restore, service degraded restore, non-restorable companion marker, corrupt image refusal, and per-user image isolation.
- Add WASM fixture tests for checkpoint-compatible and checkpoint-incompatible modules.
- Add tests proving keychain secrets, browser credentials, and companion tokens are not serialized into ordinary session images.

Completion criteria:

- DindbOS can restore a useful user workspace after reload or shutdown without claiming impossible native persistence.
- Every restored and non-restored process has an inspectable reason.

### Native-Like 89: Virtual Private Network Interface, Packet Broker, And Firewall Lab

Status: Later.

Goal: add a virtual network interface model for loopback services, WebRTC tunnels, fetch/WebSocket adapters, packet inspection, and companion-backed raw networking.

Why it matters:

- Native OSes expose network interfaces, routing tables, firewalls, DNS, packet captures, VPNs, and per-process network policy.
- Browsers cannot create host TUN/TAP interfaces directly, but DindbOS can model virtual interfaces inside the runtime and use WebRTC, WebSocket, fetch streams, or a narrow companion for real host-adjacent transport.
- This gives networked packages a more native-shaped target without bypassing browser security.

Implementation tasks:

- Define virtual interfaces such as `lo0`, `fetch0`, `ws0`, `rtc0`, `companion0`, and package namespace interfaces.
- Add route tables, DNS policy tables, per-interface firewall rules, bandwidth counters, connection state, and packet/stream metadata.
- Add descriptor-backed packet streams for loopback services and WebRTC data channels where packet boundaries matter.
- Add `ifconfig`/`ip`, `route`, `firewall`, `tcpdump`-style redacted packet capture, and `/proc/net/interfaces`.
- Add package manifest network policy for virtual interface access, loopback binding, remote host allowlists, tunnel use, and companion-required raw socket use.
- Add VPN-like tunnel profiles that can forward DindbOS service traffic over WebRTC or a user-approved network companion, without granting arbitrary host networking.
- Add traffic redaction rules for URLs, headers, tokens, keychain-injected credentials, and private payload previews.

Verification:

- Add smoke coverage for virtual interface listing, loopback route, denied route, firewall block, WebRTC tunnel mock, packet capture redaction, and companion-required raw networking refusal.
- Add tests proving package network namespaces cannot bind another package's loopback service or bypass host allowlists through a tunnel.
- Add regression tests for cancellation, close cleanup, bandwidth accounting, and denied DNS policy.

Completion criteria:

- Networked programs can reason about interfaces, routes, firewall decisions, and tunnels through DindbOS-owned diagnostics.
- VPN-like behavior is possible only through explicit runtime policy and user-approved transport.

### Native-Like 90: Quarantine, Malware Scanning, And Runtime Reputation

Status: Later.

Goal: add OS-level quarantine and reputation checks for downloaded files, imported archives, packages, companions, system images, and executable content.

Why it matters:

- Native OSes mark untrusted downloads, scan packages, warn on unsigned executables, and quarantine suspicious content.
- DindbOS will install packages, import archives, open documents, pair companions, and sync remote files; those flows need a shared trust state.
- Browser-native scanning can combine signatures, hashes, manifest policy, static analysis, sandboxed dry runs, and optional remote reputation providers.

Implementation tasks:

- Add quarantine metadata and provenance labels for Browser.app downloads, local mount imports, archive imports, remote sync files, package installs, companion manifests, and system images.
- Add a scanning service with pluggable scanners: manifest lint, forbidden API scan, package signature check, dependency risk check, archive bomb check, suspicious path check, executable policy check, and optional reputation lookup.
- Add `quarantine list|inspect|release|delete`, `scan`, `pkg verify`, Settings security panels, and Files.app quarantine badges.
- Require trusted UI confirmation or admin policy to release executable packages, companion manifests, kernel modules, system images, and scripts from quarantine.
- Add package reputation metadata for publisher trust, signature chain, install count where available, advisory status, compatibility tier, requested capabilities, and previous scan result.
- Add offline behavior that uses local trust roots and cached reputation data while marking unresolved remote checks as degraded.
- Add audit logs for scan results, quarantine release, denied execution, policy override, and reputation-provider errors.

Verification:

- Add smoke coverage for quarantined script denial, package scan failure before install mutation, archive bomb refusal, trusted release, unsigned companion refusal, and audit log creation.
- Add tests proving quarantined content cannot be executed through Shell, AppRegistry, NodeCompat, WASM, package services, or document handlers until release policy allows it.
- Add regression tests proving scanner failures fail closed for executable content and degrade explicitly for read-only documents where policy allows.

Completion criteria:

- Untrusted content carries visible provenance and cannot silently become executable OS state.
- Package, companion, document, and image trust decisions share one quarantine/reputation boundary.

### Native-Like 91: Live Runtime Update, Hot Patch, And Rollback Controller

Status: Later.

Goal: support controlled runtime and service updates without corrupting active sessions, with restartless patches where safe and rollback where not.

Why it matters:

- Native OSes update kernels, services, drivers, and packages through staged activation, dependency checks, maintenance windows, and rollback.
- DindbOS can update modules, services, package metadata, policy, docs, and some app code inside the browser, but it needs a safe controller.
- Live updates are technically possible when boundaries are explicit: module ABI, process images, service supervisor, secure boot measurements, and session images.

Implementation tasks:

- Add update plans that classify changes as hot-patchable service update, restart-required runtime update, safe-mode-only repair, package-only update, policy update, or refused incompatible migration.
- Add dependency checks against running processes, open descriptors, service state, package namespaces, kernel modules, storage schema, and browser deployment profile.
- Add `updatectl plan|stage|apply|rollback|status`, maintenance window settings, and Activity Monitor update blockers.
- Add live patch hooks for services, modules, app containers, package repository metadata, policy profiles, and diagnostics providers.
- Add runtime bundle staging with signature/hash verification, schema migration dry-run, session image capture, and last-known-good rollback.
- Add user prompts through trusted UI for disruptive updates, admin-only updates, managed-policy forced updates, and companion protocol migrations.
- Add update audit logs and crash correlation so failed updates link to the exact plan, bundle, migration, service, or module.

Verification:

- Add smoke coverage for update plan generation, incompatible blocker, staged hash verification, hot-patch service update, restart-required marker, rollback after failed migration, and audit logging.
- Add tests proving failed update activation cannot leave package DB, service registry, boot measurements, and runtime module records half-mutated.
- Add regression tests for updating while package install, remote sync apply, or storage journal replay owns an operation lock.

Completion criteria:

- DindbOS can explain what will update, what must restart, what can hot-patch, and how rollback will happen before mutation.
- Failed updates return to a known good runtime state.

### Native-Like 92: Hardware Capability Database And Declarative Device Tree

Status: Later.

Goal: give DindbOS a declarative hardware and browser capability model similar to a small device tree.

Why it matters:

- Native OSes enumerate hardware, drivers, buses, power states, quirks, and capabilities before exposing devices to userland.
- In the browser, the "hardware" is a mix of Web APIs, permissions, deployment headers, PWA install state, browser version, OS integration, and companions.
- A device tree lets packages target capabilities without directly probing private browser APIs or guessing which browser mode is active.

Implementation tasks:

- Define device tree nodes for browser, storage, graphics, audio, input, media, network, PWA host features, permissions, deployment profile, workers, WASM, companions, and remote providers.
- Add node fields for provider, trust label, support state, permission state, quota, limits, power/lifecycle policy, quirks, fallback, and owner service.
- Add `/proc/device-tree`, `/proc/browser-capabilities`, `devtree`, `doctor hardware`, and Settings capability diagnostics.
- Add package manifest constraints for required device nodes, minimum limits, fallback modes, companion requirements, and unsupported browser behavior.
- Add runtime probes that are cached, invalidated on permission changes, and redacted where browser APIs require user prompts.
- Add policy that prevents apps from receiving direct device objects; they receive handles or broker APIs derived from declared device tree nodes.
- Add companion device nodes with explicit pairing state, protocol version, signed manifest, health, and revocation status.

Verification:

- Add smoke coverage with capability mocks for device tree generation, unsupported browser feature, permission-denied feature, companion health change, package constraint refusal, and Settings rendering.
- Add tests proving package installs fail before mutation when required device nodes are unavailable and no declared fallback exists.
- Add browser integration checks for stable, non-invasive probes such as storage persistence, worker support, WebAssembly support, and notification permission classification.

Completion criteria:

- DindbOS can describe its effective hardware/browser capability profile as OS state.
- Packages and services depend on declarative device nodes instead of private ad hoc probes.

### Native-Like 93: Remote Desktop Protocol And Low-Latency Display Server

Status: Later.

Goal: evolve session handoff into a real DindbOS remote display and control protocol with permission, policy, diagnostics, and fallback transports.

Why it matters:

- Native OSes support screen sharing, remote desktop, remote assistance, headless sessions, and controlled input forwarding.
- DindbOS already has session handoff primitives, but native-like remote work needs a protocol that can carry surfaces, input, clipboard, files, audio where allowed, and session policy.
- Browser-native transports such as WebRTC, WebSocket, BroadcastChannel, canvas capture, and companion relays make this feasible with honest limitations.

Implementation tasks:

- Define a remote display protocol for surface metadata, frame deltas, input events, clipboard grants, file transfer grants, audio-session metadata, cursor state, and resize events.
- Add transport backends for same-browser BroadcastChannel, WebRTC peer connection, WebSocket relay, and companion-assisted relay.
- Add host/viewer roles, view-only/control modes, temporary grants, admin policy, consent prompts, session recording policy, and remote disconnect behavior.
- Add compositor integration so frames are produced from OS surfaces, not direct app DOM access, and input is routed through the compositor input router.
- Add `/proc/remote-sessions`, `remotectl`, Settings sharing controls, Activity Monitor remote indicators, and trusted UI consent surfaces.
- Add clipboard/file-transfer brokers so remote sessions cannot silently read local files, keychain values, or app-private state.
- Add bandwidth, latency, dropped-frame, input-lag, transport-degraded, and unsupported-feature diagnostics.

Verification:

- Add smoke coverage for offer/accept, view-only denial of control input, control-mode routed input, clipboard grant refusal, disconnect cleanup, transport fallback, and `/proc/remote-sessions`.
- Add tests proving remote viewers cannot bypass app sandbox scopes, keychain policy, trusted UI prompts, or compositor capture policy.
- Add browser integration tests for WebRTC transport where CI supports it, with mock relay fallback for deterministic coverage.

Completion criteria:

- Remote access is an OS service with consent, audit, transport diagnostics, and compositor routing.
- DindbOS can support remote assistance or headless workflows without giving remote peers raw runtime access.

### Native-Like 94: Browser-Native TPM, Attestation, And Sealed Storage

Status: Later.

Goal: approximate TPM-like trust primitives using WebCrypto, WebAuthn/passkeys, secure boot measurements, deployment profile checks, and keychain sealed records.

Why it matters:

- Native OSes use hardware-backed or platform-backed trust to seal keys, attest boot state, protect credentials, and gate sensitive operations.
- Browsers do not expose a real TPM to JavaScript, but DindbOS can build a constrained trust service around WebAuthn credentials, WebCrypto keys, signed manifests, and measured runtime state.
- This becomes important for encrypted volumes, package signing, companion pairing, managed policy, remote admin, and sync trust.

Implementation tasks:

- Define trust anchors for runtime signing keys, package repository keys, companion keys, policy issuer keys, passkey credentials, and local recovery keys.
- Add sealed storage records that can be opened only when required conditions match: user authenticated, keychain unlocked, boot measurement trusted, policy profile valid, deployment profile acceptable, and package trust tier sufficient.
- Add attestation reports for boot measurement, package trust state, companion pairing state, deployment profile, keychain lock state, and relevant browser capability probes.
- Add `trustctl status|seal|unseal|attest|verify`, Settings trust diagnostics, and package/companion attestation APIs.
- Add remote attestation handoff for managed deployments or remote sync providers that need proof of policy, version, and trust state before accepting secrets.
- Add degraded-mode behavior when WebAuthn, secure context, cross-origin isolation, or required browser APIs are unavailable.
- Ensure raw key material never enters ordinary VFS, sync snapshots, crash bundles, trace logs, or package DB records.

Verification:

- Add smoke coverage for seal/unseal success, wrong user denial, untrusted boot denial, invalid policy denial, attestation report generation, and degraded browser capability reporting.
- Add tests proving sealed records cannot be copied to another user/session/profile and opened without the required trust conditions.
- Add regression tests proving attestation reports contain public measurements and redacted identifiers, not raw private keys or secret values.

Completion criteria:

- Sensitive DindbOS secrets can be bound to user identity and measured runtime state within browser constraints.
- Trust reports make clear what is actually verified, what is browser-limited, and what requires a companion or managed deployment.

### Native-Like 95: Real Userland Distribution, Base System, And Package Sets

Status: Later.

Goal: make DindbOS feel less like a collection of built-in demos and more like a small operating-system distribution with a base system, optional package sets, release channels, and reproducible install state.

Why it matters:

- Native OSes have a base system that boots consistently, a package manager that knows which files belong to which package, and upgrade paths between releases.
- DindbOS already installs packages, apps, services, and package images, but a native-like OS needs a clearer boundary between the immutable base runtime, mutable system configuration, user-installed packages, and developer builds.
- This is technically feasible in the browser by treating the base system as a signed package set, layering it through mount drivers, and applying updates through staged package transactions.

Implementation tasks:

- Define base system package sets such as `dindbos-kernel`, `dindbos-shell`, `dindbos-desktop`, `dindbos-sdk`, `dindbos-browser-tools`, `dindbos-viewers`, and `dindbos-compat`.
- Add package-set manifests that declare included packages, boot-critical services, required mount drivers, default system files, compatibility tier, migration scripts, and rollback metadata.
- Split built-in app/service registration so the runtime can report whether an app belongs to the base system, a user package, a developer workspace, or a temporary safe-mode overlay.
- Add `distctl status|list|install-set|remove-set|verify|repair`, package-set records under `/var/lib/dindbos/distribution`, and `/etc/dindbos/release.json`.
- Add immutable base image mounts with writable overlay configuration for `/etc`, `/var`, `/home`, package caches, and developer workspaces.
- Add release channels such as stable, beta, nightly, local-dev, and managed-policy, with signed channel metadata and downgrade/rollback rules.
- Add repair mode that can reinstall missing base files without touching user homes, keychain vaults, package data, or managed policy.

Verification:

- Add smoke coverage for base system manifest verification, missing-base-file repair, safe-mode base-only boot, package-set install/remove, release channel selection, and rollback to the previous package-set state.
- Add tests proving user-installed packages cannot overwrite base-system files unless an update transaction owns the mutation.
- Add regression tests proving failed package-set activation cannot leave `/etc`, `/var`, package records, service records, and launcher records out of sync.

Completion criteria:

- DindbOS can explain exactly what belongs to the base system, what belongs to installed packages, and what belongs to the user.
- A damaged base system can be repaired without factory-resetting the whole browser OS installation.

### Native-Like 96: Rootless System Services And Least-Privilege Service Accounts

Status: Later.

Goal: move service execution away from broad system authority by giving each daemon a dedicated service account, filesystem scope, device scope, network scope, and audit identity.

Why it matters:

- Native OSes do not run every background service as one all-powerful principal; services usually have dedicated users, groups, capabilities, and resource limits.
- DindbOS already has users, groups, package services, service lifecycle state, and package namespaces, but service authority should become more granular before sensitive daemons handle sync, package updates, indexing, keychain prompts, or remote access.
- Browser-native enforcement is possible because service entry points already run through runtime-owned process, namespace, VFS, keychain, network, and device brokers.

Implementation tasks:

- Add service account records under `/etc/dindbos/service-accounts.json`, with uid/gid, home/state roots, allowed syscalls, file labels, device grants, network grants, keychain grants, and restart policy.
- Add `service --user`, `servicectl account`, `servicectl inspect-permissions`, and Settings service permission review surfaces.
- Give core daemons separate identities such as `svc.indexer`, `svc.sync`, `svc.packages`, `svc.network`, `svc.companions`, `svc.scheduler`, and `svc.recovery`.
- Route service filesystem access through service-owned roots such as `/var/lib/dindbos/services/<id>`, `/var/cache/dindbos/services/<id>`, and `/run/dindbos/services/<id>`.
- Add service-to-service IPC policy so daemons communicate through named endpoints instead of shared private runtime objects.
- Add privilege drop semantics at service start: boot may register a daemon, but the running process receives only its declared service principal and scoped grants.
- Add audit records for service permission use, denied service access, service account migration, and managed-policy overrides.

Verification:

- Add smoke coverage for service account creation, scoped service file writes, denied cross-service state reads, denied undeclared device use, allowed service IPC, and service audit records.
- Add tests proving a compromised non-critical service cannot mutate package DB, keychain records, user homes, or another service's state without explicit policy.
- Add regression tests for service account migration across runtime updates and safe-mode service disablement.

Completion criteria:

- Background services can run continuously inside DindbOS without inheriting broad kernel authority by default.
- Service permissions are inspectable, revocable, and testable like app/package permissions.

### Native-Like 97: Encrypted Volumes, Per-User Home Protection, And Recovery Keys

Status: Later.

Goal: provide encrypted browser-native volumes for user homes, package secrets, portable images, backups, and managed profiles.

Why it matters:

- Native OSes protect user data with encrypted disks, user vaults, recovery keys, and policy-controlled unlock flows.
- DindbOS already has per-user state, keychain primitives, and storage backends, but ordinary VFS files are not yet encrypted as a coherent volume.
- Browser-native encryption is technically feasible with WebCrypto, per-user keys, passkeys, recovery keys, and careful separation between encrypted content, metadata, sync state, and audit logs.

Implementation tasks:

- Define encrypted volume records under `/var/lib/dindbos/volumes`, including owner, mount path, cipher profile, key reference, recovery policy, quota, dirty state, and last unlock diagnostics.
- Add volume types for encrypted home, encrypted package state, encrypted portable image, encrypted backup archive, and managed encrypted workspace.
- Add `volctl create|mount|unmount|lock|unlock|status|recover|rotate-key|export`, Settings storage security panels, and Files.app lock indicators.
- Store encrypted file payloads in OPFS/IndexedDB-backed blocks or encrypted VFS blobs while keeping only safe redacted metadata visible before unlock.
- Bind volume unlock to keychain, passkey/WebAuthn where available, password-derived fallback only when explicitly marked weak, and offline recovery keys.
- Add key rotation, recovery key regeneration, lost-key unrecoverable-state reporting, and managed escrow-disabled policy.
- Ensure sync snapshots and portable images preserve encrypted payloads without leaking plaintext into logs, search indexes, traces, crash bundles, or package DB records.

Verification:

- Add smoke coverage for encrypted volume create, lock, unlock, read/write after unlock, denied read while locked, wrong-user denial, recovery-key unlock, and key rotation.
- Add tests proving plaintext does not appear in ordinary VFS exports, system image manifests, sync journals, audit logs, search index records, trace bundles, or crash reports.
- Add regression tests for interrupted encrypted writes, corrupt encrypted block refusal, quota pressure during encryption, and recovery after browser reload.

Completion criteria:

- User-private data can be stored in a volume that remains unreadable until an OS-owned unlock flow succeeds.
- DindbOS can honestly report which data is encrypted, which metadata is still visible, and which browser limits remain.

### Native-Like 98: Real Filesystem Consistency Checker And Repair Tool

Status: Later.

Goal: add `fsck`-style verification and repair for VFS trees, mount driver metadata, package images, journals, caches, local mount records, and encrypted volumes.

Why it matters:

- Native OSes need filesystem repair because power loss, interrupted writes, schema migrations, quota failures, and bugs can corrupt metadata.
- DindbOS already has durable files and storage diagnostics, but native-like reliability requires a tool that can prove the filesystem is internally consistent and repair known failure modes.
- This is technically feasible because the browser runtime owns the VFS tree, mount table, package records, journals, and storage schema.

Implementation tasks:

- Define filesystem invariants for path normalization, directory children, parent links, inode-like ids, hard links, symlinks, ownership, permissions, mount records, package roots, descriptor references, and storage journal records.
- Add `fsck.dindbos check|repair|dry-run|explain`, safe-mode boot repair, Settings storage repair flow, and `/var/log/dindbos/fsck.log`.
- Add repair actions for orphaned nodes, missing parent pointers, duplicate ids, broken package mount records, stale local mount metadata, inconsistent link counts, invalid permission metadata, and incomplete journal transactions.
- Add read-only salvage mode that exports recoverable files into `/var/recovery/fsck/<timestamp>` without mutating the damaged tree.
- Add mount-driver-specific checks for `memfs`, `opfsfs`, `pkgfs`, `zipfs`, `overlayfs`, `procfs`, `devfs`, local mounts, and future encrypted volumes.
- Add policy that prevents third-party packages from running repair actions unless trusted admin policy grants it.
- Add repair reports that list every mutation, every refused repair, and every browser-limited condition.

Verification:

- Add smoke coverage with synthetic corrupt VFS fixtures for orphan repair, duplicate-id refusal, broken package mount cleanup, stale local mount record cleanup, symlink loop detection, and salvage export.
- Add tests proving dry-run repair mutates nothing and full repair emits auditable mutation records.
- Add regression tests proving repair never weakens file ownership, permission bits, ACLs, quarantine labels, or encrypted volume lock state.

Completion criteria:

- DindbOS can diagnose and repair known filesystem inconsistencies without asking the user to reset the entire OS.
- Repair results are deterministic, auditable, and conservative when data safety is uncertain.

### Native-Like 99: Bootloader, Kernel Profiles, And Safe Boot Selection

Status: Later.

Goal: add a browser-native bootloader layer that selects runtime profiles, validates boot manifests, enters safe mode, and exposes boot diagnostics before the desktop starts.

Why it matters:

- Native OSes separate boot selection, kernel command line, safe mode, recovery mode, and normal user sessions.
- DindbOS already boots directly into the runtime, but native-like recovery and managed deployments need a pre-desktop boundary that can decide how the OS starts.
- Browser-native boot selection is possible through signed boot manifests, local storage/OPFS boot records, URL boot parameters, deployment policy, and safe-mode service filtering.

Implementation tasks:

- Define boot entries for normal boot, safe mode, recovery shell, storage repair, base-system repair, companion-disabled boot, package-disabled boot, managed-policy boot, and developer profile boot.
- Add `/boot/dindbos/boot.json`, boot entry signatures, kernel profile records, boot count, last boot result, fallback entry, and failure threshold policy.
- Add `bootctl status|list|set-default|once|verify|rollback`, Settings boot diagnostics, and recovery shell boot entry selection.
- Add a restricted pre-desktop recovery shell that can run `doctor`, `fsck`, `distctl repair`, `pkg verify`, `storage status`, and `bootctl rollback` without launching ordinary apps.
- Add kernel command-line style flags for diagnostics, disabled services, disabled packages, readonly mode, trace boot, safe graphics, and companion quarantine.
- Add boot measurement records that feed secure boot, attestation, update rollback, and crash correlation.
- Add automatic fallback to last-known-good boot entry after repeated boot failure or failed update activation.

Verification:

- Add smoke coverage for normal boot entry, safe-mode service filtering, package-disabled boot, recovery shell command allowlist, boot rollback, failed-boot counter, and boot measurement records.
- Add tests proving untrusted URL parameters cannot silently enable admin, disable security policy, unlock keychain, or bypass package quarantine.
- Add regression tests proving boot profile selection is persisted only through trusted runtime APIs and signed managed-policy records.

Completion criteria:

- DindbOS can start in different audited boot modes with explicit guarantees and limits.
- A failed update or damaged package set can be bypassed through safe boot without deleting user data.

### Native-Like 100: System Installer, Partitioning Model, And Multi-Installation Manager

Status: Later.

Goal: let one browser profile host multiple DindbOS installations with explicit install, clone, repair, erase, and migration flows.

Why it matters:

- Native OSes distinguish installer media, installed systems, partitions, user volumes, recovery partitions, and cloned disks.
- DindbOS can approximate this inside browser storage by treating each installation as a named system root with its own boot records, VFS roots, package DB, users, policies, and storage quota.
- This makes experiments, demos, managed profiles, and recovery safer than mutating one global runtime forever.

Implementation tasks:

- Define installation records with id, display name, storage backend, quota, boot profile, runtime version, package set, user roots, encryption state, managed policy, and last health check.
- Add `installer create|clone|import|erase|repair|migrate|list|select`, first-boot setup, and a pre-boot installation picker.
- Add logical partitions such as system, user, package, cache, recovery, snapshots, and local-mount metadata, even when they share the same browser storage backend.
- Add clone modes for full clone, base-system clone, user-data clone, package-only clone, safe diagnostic clone, and redacted bug-report image.
- Add migration rules between storage schema versions and runtime compatibility tiers.
- Add quota planning before install/clone and cleanup plans when browser storage cannot reserve enough space.
- Add managed installation profiles that can lock package sources, boot entries, update channels, remote admin, and identity providers.

Verification:

- Add smoke coverage for new installation creation, clone, selected boot, erase refusal for active install, schema migration, quota denial, and redacted export.
- Add tests proving installations cannot read each other's encrypted homes, keychain vaults, package state, boot records, or managed policies.
- Add regression tests for interrupted clone/import/migration and rollback to the previous active installation.

Completion criteria:

- Users and developers can create isolated DindbOS installations inside one browser profile.
- Installing, cloning, repairing, and erasing a system are explicit OS operations, not ad hoc local storage mutations.

### Native-Like 101: Kernel/User Boundary Fuzzing Lab And Compatibility Corpus

Status: Later.

Goal: continuously stress syscalls, VFS paths, descriptor operations, package sandboxes, WASM imports, NodeCompat facades, network policy, and browser API brokers with reproducible fuzz tests.

Why it matters:

- Native OS kernels rely on fuzzing and compatibility suites because the hardest bugs occur at privilege boundaries and weird syscall combinations.
- DindbOS is becoming a real platform boundary; random app inputs, malicious packages, corrupt files, and browser lifecycle events must not break invariants.
- Browser-native fuzzing is possible with deterministic seeds, worker-backed fuzz runners, small WASM fixtures, synthetic package manifests, and redacted crash bundles.

Implementation tasks:

- Add a fuzz runner service with deterministic seeds, corpus storage, minimization, timeout control, crash capture, policy profile selection, and safe resource limits.
- Create corpora for path normalization, symlink/link traversal, descriptor lifecycle, pipes, PTY IO, syscall argument validation, package manifests, app sandbox scopes, network rules, and local mount metadata.
- Add WASM and NodeCompat fuzz fixtures that call the syscall ABI, VFS, descriptors, and package APIs through real runtime boundaries.
- Add `fuzzctl run|minimize|replay|corpus|report`, CI-friendly focused fuzz jobs, and nightly longer fuzz jobs.
- Add invariant checks for no leaked handles, no unauthorized file mutation, no permission widening, no unbounded queues, no unredacted secrets, and no cross-user state leak.
- Add crash-bundle redaction and reproduction scripts that can replay the exact runtime seed without exposing private user data.
- Add compatibility corpus tests for known POSIX/WASI/Node package edge cases so fixes remain stable.

Verification:

- Add smoke coverage for deterministic fuzz replay, timeout kill, minimized reproducer generation, invariant failure reporting, and crash bundle redaction.
- Add tests proving fuzz runners execute in a bounded service account and cannot mutate ordinary user data outside a disposable test installation.
- Add regression tests that replay every previously fixed kernel-boundary bug before PR merge.

Completion criteria:

- DindbOS can discover kernel-boundary bugs before real packages or users hit them.
- Every fuzz failure produces a small, replayable, redacted artifact that can become a regression test.

### Native-Like 102: Policy-As-Code For Managed Browser OS Deployments

Status: Later.

Goal: let schools, teams, labs, and managed demos deploy DindbOS with declarative policy bundles that control identity, packages, devices, networking, storage, update channels, and remote access.

Why it matters:

- Native OSes become operationally useful when admins can manage policy, not just click settings by hand.
- DindbOS already has many brokered runtime boundaries; policy-as-code would make those boundaries configurable, testable, reviewable, and signed.
- This is technically feasible with signed JSON/YAML policy bundles, runtime validation, policy compilation, and explicit managed-mode diagnostics.

Implementation tasks:

- Define policy bundle schemas for accounts, groups, package repositories, allowed packages, denied packages, device grants, network allowlists, companion trust, keychain export policy, storage quotas, update rings, and remote administration.
- Add `policyctl validate|apply|diff|rollback|status|explain`, managed-mode Settings pages, and `/etc/dindbos/policy.d`.
- Compile high-level policy into syscall filters, package profiles, service account grants, browser API broker rules, companion permissions, network firewall rules, and trusted UI requirements.
- Add signed policy issuer trust roots, expiration, emergency revoke lists, local override rules, and read-only managed sections.
- Add policy simulation mode that explains what would change before mutation and which apps/services/users would be blocked.
- Add drift detection that reports when local state no longer matches the active policy bundle.
- Add admin audit exports for policy application, denied override, expired bundle, invalid signature, and rollback.

Verification:

- Add smoke coverage for valid policy apply, invalid policy refusal, signed bundle verification, policy diff, rollback, denied unmanaged override, and drift detection.
- Add tests proving policy compilation produces identical enforcement decisions across syscalls, AppSandbox, packages, devices, network, keychain, and companions.
- Add regression tests proving malformed policy cannot disable security checks, widen package scopes, or hide audit records.

Completion criteria:

- A managed DindbOS deployment can be reproduced from a signed policy bundle.
- Runtime behavior can be explained as policy decisions rather than scattered hand-coded exceptions.

### Native-Like 103: OS-Level Automation, Scripting, And Accessibility-Safe Control

Status: Later.

Goal: expose automation as a permissioned OS service that can script apps, files, windows, packages, services, and trusted UI without granting raw runtime access.

Why it matters:

- Native OSes often provide automation through shells, task schedulers, accessibility APIs, launch services, and workflow engines.
- DindbOS has shell commands, app APIs, and accessibility metadata, but general automation needs a broker that can act across apps safely and explain every grant.
- Browser-native automation is technically possible through DindbOS-owned window surfaces, accessibility trees, filesystem APIs, package manifests, service APIs, and trusted UI prompts.

Implementation tasks:

- Add an automation broker with script identities, declared scopes, user prompts, event triggers, rate limits, dry-run mode, and audit records.
- Add `automationctl`, scheduled workflow records, app action manifests, file action manifests, and service action endpoints.
- Define an app action API for open, close, focus, command palette action, document action, accessibility action, export, import, and status.
- Add automation triggers for file changes, package events, service events, lifecycle transitions, network events, time schedules, keychain grant changes, and trusted UI approvals.
- Add accessibility-safe selectors that target OS-published accessibility nodes instead of private DOM selectors.
- Add policy that blocks automation from approving its own permission prompts, reading keychain secrets, bypassing quarantine, or impersonating trusted UI.
- Add workflow export/import with signatures, compatibility tier requirements, and redacted logs.

Verification:

- Add smoke coverage for an automation workflow that opens an app, performs an app-declared action, writes a file, waits for a service event, and records an audit log.
- Add tests proving automation cannot click through trusted prompts, read another user's files, bypass app sandbox scopes, or automate a window that did not publish safe actions.
- Add regression tests for cancelled workflows, browser reload recovery, rate limiting, and dry-run no-mutation behavior.

Completion criteria:

- Users can automate real OS workflows without giving scripts direct access to private runtime objects.
- Automation behavior is permissioned, observable, revocable, and safe around trusted UI.

### Native-Like 104: Native-Like Storage Classes, Tiering, And Quota Arbitration

Status: Later.

Goal: treat browser storage as OS-managed storage classes with priorities, quotas, eviction policy, cache tiers, and user-visible pressure handling.

Why it matters:

- Native OSes distinguish system files, user data, caches, temporary files, logs, snapshots, backups, and removable/local mounts.
- Browsers expose storage with quota and eviction behavior that varies by browser and user settings; DindbOS needs to manage those limits instead of discovering them only when writes fail.
- This is technically feasible by assigning every file and mount to a storage class, maintaining accounting metadata, and routing writes through a quota arbiter.

Implementation tasks:

- Define storage classes such as system, user-home, package-root, package-state, cache, temp, logs, snapshots, backups, sync-staging, local-mount-metadata, encrypted-volume, and recovery.
- Add quota policies per class, user, package, service, installation, and mount driver.
- Add a quota arbiter that checks planned writes, journal growth, package installs, encrypted volume expansion, snapshots, logs, and cache growth before mutation.
- Add eviction policy for cache/temp/log classes with protected data classes that require explicit user/admin action before deletion.
- Add `storagectl classes|quota|pressure|evict|reserve|explain`, Settings storage class views, and `/proc/storage/classes`.
- Add browser storage pressure detection with fallback when `navigator.storage.estimate()` is unavailable or imprecise.
- Add user-facing cleanup plans that explain exactly which caches, logs, snapshots, package artifacts, or temporary files can be removed and what will be preserved.

Verification:

- Add smoke coverage for quota reservation, protected-user-data refusal, cache eviction, temp cleanup, package install quota denial, snapshot quota accounting, and storage pressure diagnostics.
- Add tests proving eviction never deletes user homes, keychain vaults, encrypted volumes, package roots, managed policy, or active recovery images without explicit authorized action.
- Add regression tests for quota accounting after rollback, interrupted writes, package uninstall, cache eviction, and multi-installation clones.

Completion criteria:

- DindbOS can predict and manage browser storage pressure before critical writes fail.
- Users can see which data is protected, which data is disposable, and which OS component owns each byte.

## Technically Feasible Native-OS Expansion Tracks

This addendum lists hard but technically possible work that would move DindbOS closer to a native OS architecture. These are not cosmetic desktop features. Each track must become a reusable runtime primitive with shell access, app/package access, policy enforcement, diagnostics, and verification.

Feasibility labels:

- Browser-only: possible in a normal browser tab, with degraded behavior when a browser capability is missing.
- Installed PWA: possible only when Service Worker, offline cache, notification, launch-handler, or install-lifecycle behavior is available.
- Cross-origin isolated: requires COOP/COEP and browser support for SharedArrayBuffer, Atomics, or stricter worker/runtime features.
- Companion-assisted: possible only through an explicit local or remote helper with a narrow protocol and auditable trust boundary.
- Research-grade: possible, but expensive enough that it should be isolated behind labs, conformance profiles, or experimental package channels first.

### Expansion 1: Dedicated Kernel Worker And Microkernel Split

Feasibility: Browser-only first pass; cross-origin isolated for high-throughput shared-memory paths.

Goal: move authoritative kernel state out of direct desktop/app object references and into a dedicated kernel worker that receives validated messages.

Why it matters:

- Native OSes have a kernel/user boundary. DindbOS currently has kernel-like services, but a stronger split would make apps, packages, WASM, NodeCompat, services, and UI all cross the same boundary.
- A worker-hosted kernel can keep the desktop responsive while expensive syscall validation, path resolution, package activation, policy checks, and storage transactions run away from the UI thread.
- This creates a realistic path toward multi-runtime processes without pretending the browser exposes ring 0 privileges.

Implementation tasks:

- Define the kernel worker boot protocol: runtime version, storage backend, boot profile, policy bundle, service registry, package registry, device broker registry, and recovery mode.
- Move syscall dispatch, process table mutation, descriptor table mutation, VFS metadata mutation, package DB mutation, service state, policy checks, and audit logging behind a message protocol.
- Define message envelopes with call id, caller pid, user, package namespace, capability token, request type, payload schema, deadline, cancellation id, and trace id.
- Add structured clone and transferable payload rules for byte buffers, descriptor reads, WASM IO, file import/export, preview cache writes, and archive operations.
- Add kernel worker crash handling: freeze mutation, preserve last committed storage root, write crash diagnostics, show recovery shell, and allow safe-mode reboot.
- Add compatibility adapters so existing same-thread callers can use the worker-backed kernel without rewriting every built-in app at once.
- Add `/proc/kernel-worker`, `/proc/syscalls`, `/proc/kernel-queue`, `kernelctl status`, `kernelctl trace`, and Activity Monitor kernel queue views.

Verification:

- Add smoke coverage for kernel worker boot, syscall success, syscall denial, invalid message refusal, large byte transfer, cancellation, timeout, worker crash recovery, and safe-mode fallback.
- Add tests proving desktop UI cannot mutate VFS, process, package, service, or policy state without going through the worker protocol.
- Add regression tests for message replay, duplicate call id, stale capability token, wrong pid, wrong user, malformed payload, and oversized transfer.

Completion criteria:

- Kernel state has one authoritative owner.
- Apps and shells interact with kernel services through validated messages, not private object references.
- A kernel worker failure becomes an inspectable recovery state instead of silent data corruption.

### Expansion 2: Mmap-Style Shared File Regions And Zero-Copy IPC

Feasibility: Cross-origin isolated for real shared memory; browser-only fallback through copied buffers.

Goal: provide native-like shared memory and memory-mapped file semantics for WASM, media, indexing, emulator, database, and IPC workloads.

Why it matters:

- Native systems rely on `mmap`, shared memory, and zero-copy buffers for fast databases, renderers, media pipelines, language runtimes, and IPC.
- Browser APIs can approximate this with SharedArrayBuffer, Atomics, OPFS handles, worker transfer, and copy-on-write snapshots when deployed under the right headers.
- Without this layer, every heavy process must copy bytes through high-level APIs, which limits serious userland workloads.

Implementation tasks:

- Add a memory object registry for anonymous shared buffers, file-backed regions, copy-on-write snapshots, device buffers, media buffers, and IPC ring buffers.
- Add syscalls for `mem.create`, `mem.map`, `mem.unmap`, `mem.protect`, `mem.share`, `mem.stat`, `mem.sync`, and `mem.revoke`.
- Add file-backed mapping rules for read-only preview mappings, writable staged mappings, append-only log mappings, and package-root immutable mappings.
- Add dirty-page tracking for mapped file writes, explicit sync barriers, rollback on failed commit, and quota reservation before mapping expansion.
- Add futex-like wait/notify wrappers where Atomics are available, plus explicit degraded behavior where hidden-tab or non-isolated deployments cannot provide native timing.
- Add WASM import bindings and NodeCompat buffer adapters so user programs can use mapped regions without importing private runtime internals.
- Expose `/proc/shared-memory`, `/proc/<pid>/maps`, `memctl`, and `doctor isolation`.

Verification:

- Add smoke coverage for shared buffer creation, cross-process transfer, read-only denial, writable staged sync, rollback after failed sync, quota denial, revoked mapping denial, and degraded non-isolated fallback.
- Add WASM fixture tests for shared counters, mapped file reads, mapped file writes, grow denial, and kill cleanup.
- Add tests proving a process cannot map another user's file, another package's private state, keychain bytes, trusted UI surfaces, or companion sessions without policy grants.

Completion criteria:

- Heavy userland can share bytes through OS-managed mappings.
- File-backed mappings preserve the same durability, permission, quota, and rollback rules as normal file writes.

### Expansion 3: Native-Grade File Locks, Leases, And Concurrent Writer Control

Feasibility: Browser-only for intra-runtime locks; Service Worker or BroadcastChannel for multi-tab locks; companion-assisted for host filesystem coordination.

Goal: prevent concurrent writers from corrupting user files, package records, registries, databases, local mounts, and sync state.

Why it matters:

- Native OSes provide locking, leases, advisory locks, mandatory locks, and filesystem change notifications so multiple programs can coordinate.
- DindbOS already has atomic write paths, but serious apps need predictable behavior when TextEdit, Files.app, sync, package activation, and a WASM program all target related paths.
- Browser storage can be accessed from multiple tabs, workers, and Service Worker flows, so lock ownership must be explicit and recoverable.

Implementation tasks:

- Add kernel-owned lock records for file, directory, package root, registry, service state, app state, keychain vault, local mount metadata, sync workspace, and storage transaction scopes.
- Support advisory read locks, advisory write locks, mandatory system locks, leases, lock upgrade/downgrade, timeout, stale lock detection, and lock break policy.
- Add syscalls for `lock.acquire`, `lock.release`, `lock.stat`, `lock.wait`, `lock.break`, and `lock.explain`.
- Route TextEdit saves, Files.app copy/move/import/export, package activation, app registry updates, service state writes, snapshots, and sync apply through the lock manager.
- Add multi-tab coordination using BroadcastChannel, Web Locks API where available, Service Worker arbitration where installed, and clear fallback diagnostics where unsupported.
- Add `/proc/locks`, `lockctl`, Activity Monitor lock owner views, and Settings storage conflict diagnostics.
- Add companion-assisted lock mapping for local mount paths where host-side helpers can observe external file changes.

Verification:

- Add smoke coverage for shared read locks, exclusive write locks, timeout, stale lock cleanup, refused mandatory lock break, lock owner process exit cleanup, and conflict explanation.
- Add tests proving interrupted package activation releases locks only after rollback and that concurrent editor/package/sync writes cannot partially interleave.
- Add multi-context tests where practical for BroadcastChannel/Web Locks behavior, with explicit degraded-mode checks when unavailable.

Completion criteria:

- Two runtime actors cannot corrupt the same logical resource through concurrent writes.
- Users and developers can see who owns a lock, why an operation is blocked, and how recovery will proceed.

### Expansion 4: Real Terminal Stack With PTY, Shell Sessions, And Text UI Apps

Feasibility: Browser-only first pass; cross-origin isolated for high-throughput terminal workloads; companion-assisted for host command bridges only.

Goal: make Terminal a real session endpoint backed by pseudo-terminals, foreground process groups, line discipline, terminal modes, and descriptor-driven IO.

Why it matters:

- Native shells are not just command parsers. They coordinate TTY state, signals, foreground jobs, terminal resize, stdin/stdout/stderr, and interactive programs.
- WASM and NodeCompat packages need a terminal contract to run editors, REPLs, package CLIs, test runners, debuggers, and curses-like text UIs.
- A real PTY layer also gives services, remote sessions, and automation a consistent way to observe and control command execution.

Implementation tasks:

- Add PTY master/slave descriptor pairs with ownership, window size, terminal mode flags, foreground process group, input queue, output queue, and close semantics.
- Implement canonical/raw input modes, echo, erase/kill characters, Ctrl-C/Ctrl-D/Ctrl-Z events, resize notifications, and bracketed paste policy.
- Add process group integration for foreground/background jobs, stopped jobs, resumed jobs, killed jobs, and orphaned process group cleanup.
- Add shell built-ins for `stty`, `tty`, `jobs`, `fg`, `bg`, `kill`, `wait`, and `ps -j`-style diagnostics.
- Add WASI/NodeCompat bindings so interactive programs read and write the PTY through descriptor syscalls.
- Add terminal scrollback as an OS-owned buffer with export, search, privacy redaction, and per-session retention policy.
- Expose `/dev/pts/*`, `/proc/tty`, `/proc/<pid>/tty`, `ttyctl`, and Activity Monitor TTY columns.

Verification:

- Add smoke coverage for PTY open/close, stdin read, stdout write, raw/canonical mode, Ctrl-C cancellation, Ctrl-D EOF, resize event, background write policy, and killed job cleanup.
- Add WASM fixture tests for interactive stdin, terminal resize, nonblocking read fallback, and process group signal delivery.
- Add tests proving an app cannot inject into another user's PTY, steal a foreground terminal, or read scrollback without policy grants.

Completion criteria:

- Interactive command-line programs can run as first-class DindbOS processes.
- Terminal sessions are observable, revocable, restorable where possible, and consistent with descriptor/process rules.

### Expansion 5: Native-Style Daemon Model With Service Worker Participation

Feasibility: Installed PWA for offline/update participation; browser-only for page-bound daemons; companion-assisted for long-running host tasks.

Goal: split services into page-bound daemons, worker daemons, Service Worker-assisted queues, and companion-backed daemons with honest lifecycle guarantees.

Why it matters:

- Native OSes run background services independent of individual app windows.
- Browsers cannot run arbitrary code forever after every page closes, but DindbOS can still provide explicit service classes with different persistence guarantees.
- This avoids fake daemons while still enabling sync, indexing, notifications, backup, update checks, package repositories, and remote provider health checks.

Implementation tasks:

- Define service classes: interactive, page-daemon, worker-daemon, service-worker-queue, notification-wakeup, sync-wakeup, companion-daemon, and remote-provider-daemon.
- Add service unit fields for lifecycle class, restart policy, dependency graph, storage grants, network grants, device grants, wake policy, background limits, and degraded behavior.
- Add a Service Worker command queue for safe deferred tasks with credentials, policy, retry count, idempotency key, and audit log.
- Add daemon health checks, watchdog timeouts, crash loops, restart backoff, safe-mode disable, and user/admin disable controls.
- Add app/package APIs to register service units during package activation and remove them during package uninstall rollback.
- Add `/proc/services`, `/var/log/dindbos/services`, `servicectl start|stop|restart|status|logs|enable|disable`, and Settings service panels.
- Add clear labels for page-bound, PWA-assisted, companion-assisted, remote, unsupported, and degraded services.

Verification:

- Add smoke coverage for service install, dependency start order, restart backoff, disabled safe-mode boot, command queue persistence, unsupported background feature degradation, and uninstall cleanup.
- Add tests proving queued tasks cannot outlive revoked package policy, cannot run under stale user credentials, and cannot mutate protected storage after package removal.
- Add PWA/manual profile checks for Service Worker update and offline task behavior where automation cannot fully simulate user browser policies.

Completion criteria:

- Background work has explicit OS semantics instead of hidden timers.
- Users can tell whether a service is actually running, queued for later, degraded, or impossible in the current browser profile.

### Expansion 6: Hardware Driver And Host Capability Bus

Feasibility: Browser-only for Web API brokers; companion-assisted for native-only devices; research-grade for broad driver compatibility.

Goal: build a driver-style capability bus that exposes browser devices and helper-provided host devices through one permissioned DindbOS device model.

Why it matters:

- Native OSes mediate hardware through drivers and device nodes.
- Browsers expose real device APIs such as WebUSB, WebSerial, WebHID, WebMIDI, Gamepad, MediaDevices, WebGPU, WebRTC, Clipboard, and Screen Capture, but direct app access bypasses OS policy.
- A DindbOS device bus would let packages request devices declaratively and give users audit/revoke controls.

Implementation tasks:

- Define device classes for storage, clipboard, camera, microphone, display capture, GPU, audio, USB, serial, HID, MIDI, gamepad, network, printer, scanner, notification, share target, and companion bridge.
- Add provider drivers for browser APIs, mock test devices, local companion devices, remote provider devices, and virtual devices.
- Add device open/close/read/write/ioctl/event syscalls and descriptor integration where appropriate.
- Add package manifest declarations for required devices, optional devices, isolation requirements, foreground-window requirements, and companion protocol requirements.
- Add trusted pairing prompts, temporary grants, per-device policy, privacy ledger entries, revoke flow, and foreground ownership checks.
- Expose `/dev`, `/proc/device-tree`, `/proc/browser-capabilities`, `devctl`, `doctor hardware`, and Settings device history.
- Add fallback contracts so packages can detect unsupported, denied, degraded, busy, companion-missing, and policy-refused device states.

Verification:

- Add mock-driver smoke coverage for open, denied open, busy device, revoked grant, event delivery, descriptor cleanup, package manifest refusal, and privacy ledger records.
- Add browser probe tests for stable capabilities and manual verification scripts for user-prompt-heavy APIs.
- Add tests proving raw browser APIs cannot be called by sandboxed packages when a DindbOS broker exists for the same capability.

Completion criteria:

- Apps consume hardware-like capabilities through DindbOS devices and brokers.
- Device access is permissioned, inspectable, revocable, and honest about browser/companion limits.

### Expansion 7: Encrypted Multi-Volume Storage And Per-User Recovery

Feasibility: Browser-only with WebCrypto; installed PWA improves recovery/offline UX; companion-assisted only for external backup escrow.

Goal: provide native-like encrypted homes, sealed keychain records, recovery keys, backup metadata, and volume-level lock/unlock behavior.

Why it matters:

- A native OS protects user data at rest and separates system files, user homes, keychains, caches, backups, and removable volumes.
- Browser storage is origin-scoped, but DindbOS can still encrypt sensitive volumes before writing bytes into OPFS/IndexedDB.
- Encryption must integrate with users, sessions, package state, app scopes, snapshots, sync, and recovery instead of being a one-off file wrapper.

Implementation tasks:

- Define encrypted volume records for user home, keychain, package-private state, backups, sync staging, and portable system images.
- Add WebCrypto-based key derivation, random volume keys, wrapped keys, recovery keys, lock state, unlock prompts, key rotation, and emergency revoke records.
- Add sealed keychain records tied to user/session/package grants and optional WebAuthn-backed unlock where available.
- Route VFS reads/writes for encrypted volumes through transparent decrypt/encrypt adapters while preserving metadata policy and quota accounting.
- Add snapshot and backup behavior that preserves encryption boundaries and never exports plaintext without an explicit trusted prompt.
- Add `volumectl`, `keychainctl`, `recoveryctl`, `/proc/volumes`, and Settings recovery views.
- Add redacted diagnostic exports that prove volume health without exposing secrets.

Verification:

- Add smoke coverage for volume create, lock, unlock, wrong passphrase denial, recovery key unlock, key rotation, sealed key read denial, package uninstall grant cleanup, and encrypted backup export metadata.
- Add tests proving locked volume data cannot be read through shell, Files.app, package app, WASM, NodeCompat, preview cache, search index, sync, or diagnostics.
- Add regression tests for interrupted key rotation, failed snapshot, quota denial during encrypted write, and recovery without weakening permissions.

Completion criteria:

- Sensitive user data can be locked independently of the visible desktop session.
- Recovery and backup flows are explicit, auditable, and do not silently leak plaintext.

### Expansion 8: Native-Like Networking Lab With Loopback, Firewall, And Service Mesh

Feasibility: Browser-only for virtual sockets and fetch/WebSocket brokers; companion-assisted for raw sockets, DNS, packet capture, and local LAN exposure.

Goal: give DindbOS userland a network stack abstraction with virtual loopback services, policy firewall, named sockets, HTTP/WebSocket brokers, and companion-backed native escapes.

Why it matters:

- Native OSes make networking a system service with sockets, ports, DNS, firewalls, permissions, and diagnostics.
- Browsers do not expose raw TCP/UDP to ordinary pages, but DindbOS can still provide virtual sockets, service-to-service networking, fetch/WebSocket policy, WebRTC data channels, and companion-backed native protocols.
- This gives packages and WASM programs a realistic network contract without lying about browser limits.

Implementation tasks:

- Add socket object records for virtual loopback, stream IPC, datagram IPC, WebSocket broker sessions, fetch broker sessions, WebRTC data channels, and companion sockets.
- Add syscalls for `socket.open`, `socket.bind`, `socket.listen`, `socket.accept`, `socket.connect`, `socket.read`, `socket.write`, `socket.close`, and `socket.stat`.
- Add a policy firewall for host allowlists, port classes, package identity, service identity, user identity, protocol, data direction, and companion requirement.
- Add service mesh discovery for local DindbOS services, package services, browserd-compatible providers, remote providers, and mock test services.
- Add network namespace labels for user session, package sandbox, service account, test lab, and companion boundary.
- Add `netctl`, `firewallctl`, `resolvectl`, `/proc/net`, `/proc/sockets`, and Activity Monitor network columns.
- Add explicit failures for raw socket unsupported, DNS unavailable, CORS blocked, companion missing, WebRTC denied, host policy denied, and remote provider mismatch.

Verification:

- Add smoke coverage for virtual loopback server/client, denied host, allowed fetch broker, WebSocket broker, service discovery, namespace isolation, firewall audit, socket cleanup after process kill, and companion-missing diagnostics.
- Add tests proving packages cannot bypass network policy through direct `fetch`, `WebSocket`, WebRTC, browserd, or companion endpoints.
- Add regression tests for stale sockets, half-closed pipes, backpressure, oversized messages, reconnect loops, and remote provider protocol mismatch.

Completion criteria:

- Network-capable userland targets DindbOS socket/broker APIs rather than raw browser globals.
- Network permissions, failures, and companion requirements are visible and testable.

## Forward Native-OS Feasibility Register

This register turns the native-convergence backlog into work packages that are technically possible, even when they are hard. These are not promises that the browser becomes a native kernel. They are implementation paths for getting closer to native OS behavior while keeping every browser, PWA, isolation, and companion boundary explicit.

Each package must land with all of the following before it can count as implemented:

- A kernel/runtime service, not only app UI.
- A shell or diagnostic command.
- An app/package-facing API or syscall.
- Capability and policy enforcement.
- `/proc`, log, or Settings visibility.
- Smoke or conformance coverage that proves real behavior and refusal paths.

### Forward Package 1: Durable Storage Kernel, Fsync Barriers, And Page Cache

Feasibility: Browser-only first pass through OPFS/IndexedDB; installed PWA improves offline recovery; companion-assisted only for host filesystem durability guarantees.

Goal: make DindbOS storage behave less like a serialized JavaScript object and more like a small browser-native disk subsystem.

Implementation tasks:

- Add a storage transaction manager with explicit begin, stage, commit, rollback, replay, abort, and explain records.
- Already present: first-pass `storage.sync` / `fsync`-style barrier covers Shell, SDK, AppSandbox, NodeCompat async filesystem callers, and file descriptor callers through the async syscall path.
- Extend `storage.sync` / `fsync`-style barriers to WASM, package services, and future mapped-file writes.
- Add a page-cache layer that tracks clean pages, dirty pages, pinned pages, mapped pages, eviction candidates, and writeback failures.
- Add writeback policies for user documents, package roots, package DB, app registry, service state, logs, caches, temp files, snapshots, backups, and sync staging.
- Add crash-replay records for interrupted editor saves, archive imports, package activation, registry mutation, local mount sync, package update, key rotation, and snapshot creation.
- Add quota reservation before large writes, archive extraction, package install, mapped-region expansion, backup export, and encrypted-volume rotation.
- Add recovery export for damaged but readable user files before destructive repair.
- Add diagnostics under `/proc/storage`, `/proc/page-cache`, `/var/log/dindbos/storage-replay.log`, `storage journal`, `storage sync`, `cachectl`, and `fsck --replay`.

Verification:

- Already present: `npm run smoke:shell`, `npm run smoke:sdk`, `npm run smoke:permissions`, `npm run smoke:npm-node`, and `npm run smoke:descriptors` cover first-pass sync barrier success plus capability denial.
- Add smoke coverage for sync barrier failure, dirty-page flush, interrupted write replay, quota-denied preflight, failed commit rollback, stale journal explanation, and salvage export.
- Add cross-runtime tests proving Shell, Files.app, SDK apps, WASM, NodeCompat, and services all hit the same storage transaction boundary.
- Add regression tests proving repair never weakens ownership, permission, encryption, quarantine, package trust, or local mount conflict state.

### Forward Package 2: Handle-Based Kernel Boundary And User/Kernel Split

Feasibility: Browser-only for structured message handles; cross-origin isolated for high-throughput transfer; companion-assisted only for host-backed handles.

Goal: replace private object references with kernel-owned handles that can be granted, revoked, inherited, transferred, audited, and cleaned up.

Implementation tasks:

- Add kernel object handles for files, directories, descriptors, pipes, PTYs, processes, windows, app containers, services, timers, IPC channels, sockets, devices, keychain grants, storage transactions, memory regions, companion sessions, and package namespaces.
- Add per-process handle tables with object type, rights, owner pid, user, group, package namespace, close-on-exec flag, expiry, inherited-from pid, transfer policy, and revoke reason.
- Route filesystem opens, descriptor IO, app launch, IPC, device access, keychain access, network sessions, trusted prompts, and companion sessions through handle validation.
- Add syscall results that return handles instead of raw internal records for long-lived resources.
- Add cleanup on process exit, crash, kill, logout, session lock, package uninstall, permission revoke, service disable, companion disconnect, and recovery mode.
- Expose `/proc/<pid>/handles.json`, `/proc/objects`, `handlectl list|stat|close|revoke|explain`, and Activity Monitor handle views.

Verification:

- Add smoke coverage for valid handle use, wrong-right denial, stale handle denial, double close, inherited stdio, transferred IPC handle, revoked device handle, and process-exit cleanup.
- Add fuzz-style invalid handle tests for unknown id, wrong object type, cross-user use, package namespace escape, use-after-close, and replayed handle messages.

### Forward Package 3: Native-Like Spawn, Exec, Job Control, And Process Images

Feasibility: Browser-only for spawn/process image semantics; cross-origin isolated for shared-memory worker snapshots; research-grade for limited checkpoint/restore.

Goal: give apps, shell commands, WASM modules, NodeCompat programs, services, and workers one launch model.

Implementation tasks:

- Define process image records for JavaScript app, package CLI, shell script, NodeCompat file, WASM module, WASI program, worker job, service unit, emulator workload, nested DindbOS image, and companion-backed command.
- Add `process.spawn`, `process.exec`, `process.wait`, `process.signal`, `process.group`, and `process.session` syscall families.
- Add argv, env, cwd, credentials, umask, namespace profile, inherited handles, stdio descriptors, resource limits, policy bundle, lifecycle class, and restart behavior to process images.
- Add shell job control for background launch, foreground process groups, `jobs`, `fg`, `bg`, `wait`, Ctrl-C, Ctrl-D, Ctrl-Z, broken pipe, and pipeline cleanup.
- Add explicit unsupported errors for true POSIX `fork()` where browser state cannot be cloned safely.
- Add snapshot/checkpoint support only for runtimes that declare safe restore behavior, such as cooperative WASM memory checkpoints or deterministic worker jobs.
- Expose `/proc/<pid>/image.json`, `/proc/jobs`, `/proc/sessions`, `spawnctl`, `jobctl`, and richer `ps` output.

Verification:

- Add smoke coverage for app/CLI/WASM/NodeCompat/service spawn, inherited cwd/env/stdio, foreground job interruption, background resume, killed pipeline cleanup, wait status aggregation, and unsupported fork refusal.
- Add checkpoint fixtures for restorable and non-restorable WASM/worker processes.

### Forward Package 4: Descriptor-First IO, PTY, And WASI/NodeCompat Convergence

Feasibility: Browser-only first pass; cross-origin isolated for high-throughput shared buffers; companion-assisted only for host command bridges.

Goal: make file IO, pipes, terminals, sockets, devices, and runtime streams share one descriptor model.

Implementation tasks:

- Extend descriptors beyond basic VFS files into directories, pipes, PTYs, sockets, device nodes, memory objects, local mount files, archive readers, package files, and companion streams.
- Add descriptor rights, flags, append mode, nonblocking mode, readiness state, seekability, file type, owner pid, backpressure state, and cleanup lifecycle.
- Add PTY master/slave pairs with raw/canonical modes, echo, resize, foreground process group, signal delivery, bracketed paste, scrollback retention, and privacy policy.
- Route Terminal, shell pipelines, NodeCompat streams, WASI `fd_*` imports, app service logs, browser companion streams, and network sockets through descriptors.
- Add `io.poll`, `io.wait`, `fd.dup`, `fd.pipe`, `fd.pty`, `fd.dir`, `fd.event`, `stty`, `tty`, and descriptor-backed `/dev`.
- Add compatibility reports for unsupported WASI imports before a program mutates storage.

Verification:

- Add smoke coverage for descriptor dup/close, pipe backpressure, PTY input, Ctrl-C signal delivery, nonblocking read, directory descriptor reads, socket descriptor cleanup, and WASI errno mapping.
- Add tests proving a process cannot read another process PTY, steal a terminal, bypass descriptor rights, or keep descriptors alive after kill.

### Forward Package 5: Policy Compiler, Secure Boot, And Trusted System Surfaces

Feasibility: Browser-only for signed manifests and policy enforcement; WebCrypto/WebAuthn for key material; installed PWA for better offline update/recovery; companion-assisted for external attestation only.

Goal: make trust and permission decisions deterministic, inspectable, and enforced at the runtime boundary.

Implementation tasks:

- Add signed base-system manifests covering runtime version, boot schema, built-in app hashes, package ABI version, syscall ABI version, migration ids, and compatibility tier.
- Add measured boot records and trust states: trusted, unsigned, mismatched, degraded, recovered, safe-mode, developer, and refused.
- Add a policy language for syscalls, paths, handles, descriptors, devices, sockets, IPC, keychain records, package dependencies, services, child processes, storage classes, and companions.
- Compile policy from app manifests, package manifests, service units, users/groups, trusted publishers, temporary grants, managed profiles, and deployment profiles.
- Add compositor-owned trusted UI for login, unlock, permission grants, package install trust, keychain unlock, screen capture, companion pairing, update activation, destructive operations, and remote admin approval.
- Prevent sandboxed apps from covering, embedding, reading, capturing, or forging trusted surfaces.
- Expose `/proc/boot-measurements`, `/proc/policy`, `/proc/trusted-ui`, `bootctl`, `policyctl`, `pkg audit`, `doctor boot`, and `doctor policy`.

Verification:

- Add smoke coverage for valid boot manifest, hash mismatch, safe-mode fallback, policy compile refusal, syscall denial explanation, trusted prompt grant/deny, spoofed prompt denial, and package activation refusal before filesystem mutation.
- Add property-style tests for path escape, undeclared device access, revoked grant reuse, keychain prompt spoofing, and companion direct-access denial.

### Forward Package 6: Browser Device Tree, Driver Bus, And Virtual Hardware

Feasibility: Browser-only for Web API brokers; companion-assisted for host-only hardware; research-grade for broad driver compatibility.

Goal: make browser and companion capabilities look like OS-managed devices with permission, diagnostics, and fallback behavior.

Implementation tasks:

- Define a device tree for storage, local mounts, clipboard, notifications, badging, share targets, camera, microphone, screen capture, audio, GPU, USB, serial, HID, MIDI, gamepad, battery, geolocation where available, network providers, printers, scanners, companion endpoints, and remote providers.
- Add driver provider records for browser APIs, mock test drivers, virtual devices, local companions, remote providers, and disabled/unsupported devices.
- Add device open, close, read, write, ioctl, event, stat, grant, revoke, and explain syscalls.
- Add package manifest requirements for device class, feature flags, foreground ownership, cross-origin isolation, PWA install state, companion protocol, and fallback mode.
- Add privacy ledger entries for every sensitive device action, including foreground owner, process id, package id, user, grant reason, and revoke path.
- Expose `/proc/device-tree`, `/proc/browser-capabilities`, `/dev/*`, `devctl`, `privacy report`, `privacy revoke`, and Settings device history.

Verification:

- Add mock-driver smoke coverage for open, denied open, busy device, revoked grant, hotplug event, package manifest refusal, privacy ledger record, and descriptor cleanup.
- Add browser probe tests for stable capabilities and manual verification scripts for prompt-heavy APIs.
- Add tests proving sandboxed packages cannot bypass a DindbOS broker through raw browser globals when a brokered device class exists.

### Forward Package 7: Multi-Volume Encryption, Keychain, And User Recovery

Feasibility: Browser-only with WebCrypto; WebAuthn optional for stronger unlock; companion-assisted only for external escrow or backup targets.

Goal: protect user data, secrets, package state, backups, and sync payloads with OS-owned encryption and recovery flows.

Implementation tasks:

- Add volume records for system, user home, package-private state, keychain, cache, temp, backups, sync staging, portable images, and local mount mirrors.
- Add WebCrypto key derivation, random volume keys, wrapped keys, passphrase unlock, WebAuthn unlock where available, recovery keys, key rotation, lock state, and revoke records.
- Add sealed keychain records scoped by user, package, service, companion, network host, trusted prompt, and expiry.
- Route encrypted volume reads/writes through VFS adapters while preserving metadata, quota, transaction, fsck, snapshot, backup, and sync rules.
- Add trusted prompts for plaintext export, recovery key reveal, key rotation, backup restore, and destructive volume reset.
- Expose `/proc/volumes`, `/proc/keychain`, `volumectl`, `keychainctl`, `recoveryctl`, and redacted diagnostic bundle export.

Verification:

- Add smoke coverage for volume create, lock, unlock, wrong passphrase denial, recovery key unlock, key rotation, sealed secret grant, revoked secret denial, encrypted backup metadata, and package uninstall grant cleanup.
- Add tests proving locked data cannot leak through Shell, Files.app, Viewer.app cache, package app, WASM, NodeCompat, search index, sync export, diagnostics, or crash reports.

### Forward Package 8: Service Worker Boot, Recovery Shell, And Native-Like Lifecycle

Feasibility: Installed PWA for Service Worker participation; browser-only for page lifecycle diagnostics; companion-assisted for long-running host tasks.

Goal: give DindbOS explicit boot, shutdown, recovery, offline, update, and background-work semantics that match browser limits.

Implementation tasks:

- Add Service Worker boot manifests for core assets, package index snapshots, offline docs, migration compatibility, build id, update state, and recovery shell assets.
- Add a page-runtime to Service Worker handshake for cache state, storage availability, offline status, update state, background capability, and pending command queue.
- Add safe boot profiles for normal, safe mode, package-disabled, service-disabled, companion-disabled, offline, storage repair, base-system repair, and developer diagnostics.
- Add panic manager states for boot failure, migration failure, storage invariant failure, trust mismatch, package crash loop, service crash loop, quota exhaustion, and repeated UI crash.
- Add shutdown and lifecycle barriers for dirty storage, running services, pending package activation, open local mounts, sync queues, encrypted volumes, and companion sessions.
- Add `bootctl worker`, `panicctl`, `queuectl`, `shutdownctl`, `doctor offline`, emergency `fsck`, `pkg disable`, `service disable`, `rollback`, and diagnostic bundle export.

Verification:

- Add smoke coverage for offline cache population, Service Worker handshake, unsupported background sync degradation, pending queue persistence, induced boot panic, safe mode, recovery shell allowlist, dirty-shutdown warning, and rollback path.
- Add tests proving queued commands retain declared credentials, respect revoked package policy, and cannot mutate protected storage after uninstall.

### Forward Package 9: Virtual Networking, Service Mesh, And Remote Session Boundary

Feasibility: Browser-only for virtual loopback/fetch/WebSocket/WebRTC brokers; companion-assisted for raw sockets, LAN discovery, packet capture, and host network exposure.

Goal: provide a realistic OS networking abstraction without pretending ordinary browser pages can open arbitrary TCP/UDP sockets.

Implementation tasks:

- Add virtual interfaces for loopback, fetch broker, WebSocket broker, WebRTC data channel, service mesh, remote provider, companion tunnel, and disabled raw network.
- Add socket handles and descriptors for stream, datagram, request/response, event stream, data channel, service endpoint, and companion-backed sessions.
- Add firewall policy for package id, service id, user, group, host, origin, protocol, port class, data direction, foreground ownership, companion requirement, and trust tier.
- Add DNS/resolution facade that reports browser/CORS limits honestly and delegates only approved names to fetch/WebSocket/WebRTC/companion providers.
- Add remote session surfaces for screen sharing, controlled input, remote admin shell, remote logs, and diagnostic bundle transfer through trusted prompts.
- Expose `/proc/net`, `/proc/sockets`, `/proc/routes`, `netctl`, `socketctl`, `firewallctl`, `resolvectl`, `sessionctl remote`, and Activity Monitor network columns.

Verification:

- Add smoke coverage for loopback service connect, denied host, allowed fetch broker, WebSocket broker, WebRTC mock data channel, firewall audit, stale socket cleanup, companion-required refusal, and remote admin prompt denial.
- Add tests proving packages cannot bypass network policy through direct `fetch`, `WebSocket`, WebRTC, browserd, service workers, remote providers, or companions.

### Forward Package 10: Conformance, Certification, And Native-OS Implementation Rate

Feasibility: Browser-only for deterministic runtime tests; browser automation for profile tests; manual lanes for prompt-heavy APIs; companion-assisted for provider certification.

Goal: turn "native-like" from a subjective label into tested certification levels.

Implementation tasks:

- Define certification levels for kernel boundary, durable disk, descriptor IO, PTY, package platform, WASM userland, NodeCompat userland, worker isolation, policy compiler, secure boot, keychain, device brokers, virtual networking, storage recovery, app containers, Service Worker lifecycle, and companion trust.
- Add a conformance runner that boots clean profiles, installs fixture packages, runs Shell/WASM/NodeCompat/app/service workloads, checks `/proc`, validates policy denials, and records degraded browser capabilities.
- Add profile matrices for Chromium, Safari, Firefox, mobile, installed PWA, cross-origin isolated, offline, local companion, remote provider, managed mode, and developer mode.
- Generate compatibility docs from conformance output instead of manually maintained claims.
- Add package certification metadata for required ABI, compatibility tier, smoke command, fallback behavior, device/network requirements, resource envelope, and trust state.
- Add companion certification metadata for protocol version, advertised capabilities, stream policy, auth policy, trust boundary, and failure behavior.
- Expose `/var/log/dindbos/conformance`, `doctor conformance`, `doctor matrix`, `pkg certify`, and CI artifacts.

Verification:

- Add smoke coverage for conformance report generation, failed guarantee reporting, profile classification, fixture package install/run, matrix-doc consistency, package certification refusal, and companion protocol mismatch.
- Add CI/browser-profile hooks where automation is practical and explicit manual verification scripts where user prompts prevent full automation.

Completion criteria:

- DindbOS can report exactly which native-like guarantees are implemented, degraded, companion-required, experimental, or unsupported.
- Roadmap implementation rate is derived from verified capabilities, not from UI appearance or aspirational text.

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
6. Broaden into virtual networking, stronger multi-user access control, storage journaling/snapshots, resource quotas, background services, native-adjacent companions, and the hard native-like backlog: compositor/input server, mountable filesystem drivers, package namespaces, keychain, lifecycle policy, session coordination, portable system images, explicit emulation tiers, secure boot, kernel modules, multi-core worker scheduling, origin-isolated app containers, user-mode filesystem servers, accessibility automation, remote administration, transactional registry state, OS-level automation services, OPFS block-device semantics, handle-based kernel objects, process images, browser API brokers, syscall policy compilation, event-sourced replay, cross-origin isolation profiles, service mesh networking, trusted system UI, native-like conformance certification, directory/federated identity, ACL/xattr labels, kernel tracing, hibernation images, virtual VPN/firewall interfaces, quarantine scanning, live runtime update, device-tree capability modeling, remote desktop protocol, browser-native attestation, base-system distribution sets, least-privilege service accounts, encrypted volumes, `fsck` repair, bootloader profiles, multi-installation management, kernel-boundary fuzzing, policy-as-code, automation brokering, and storage-class quota arbitration.
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
- `fs.fsync`, `fs.fdatasync`, `fs.promises.fsync`, and `fs.promises.fdatasync` route NodeCompat programs to the DindbOS `storage.sync` durability barrier while sync variants fail explicitly because browser persistence cannot be blocked synchronously.
- `npm run smoke:npm-node` verifies NodeCompat async fsync/fdatasync reach the runtime storage barrier and sync variants report the browser-runtime limitation.
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
- Window placements persist under `/var/lib/dindbos/window-placements/<user>.json` and are clamped into the current viewport when restored; `npm run smoke:window-manager` verifies persistence, restore behavior, and per-user layout isolation.
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
