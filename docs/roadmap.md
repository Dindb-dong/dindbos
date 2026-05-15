# DindbOS.js Roadmap

Last updated: 2026-05-15

DindbOS.js is a browser-native OS runtime, not an OS-themed website. The UI exists to prove reusable runtime primitives: files, processes, packages, permissions, shell execution, browser/device brokers, app containers, and diagnostics that other apps can depend on.

## Product Direction

The target is a real operating environment inside browser constraints.

- Apps launch through a registry and run with a manifest, PID, permissions, and `/proc` diagnostics.
- Files live in one shared VFS with browser-backed persistence, binary-safe nodes, local mounts, imports, exports, and repair diagnostics.
- Terminal commands and GUI apps operate on the same runtime state.
- Packages install into `/opt`, publish launchers, declare capabilities, and run through AppRegistry.
- Browser-blocked capabilities go through explicit brokers or companions instead of hidden host access.
- Browser limitations must be reported honestly as degraded, unsupported, or companion-required.

## Non-Goals

- Do not pretend to be a Linux kernel or a native host OS.
- Do not ship fake panels that only look like OS features.
- Do not give apps raw unrestricted runtime access when a scoped API or syscall can express the capability.
- Do not hide browser constraints behind misleading UI.

## Current Platform State

Status: strong first pass.

Already present:

- Boot phases, lifecycle state, recovery records, and boot logs.
- AppRegistry, app manifests, AppSandbox, process manager, process lifecycle events, crash isolation, and `/proc`.
- Shared VFS with permissions, binary-safe files, persistence, local folder mounts, archive import/export, and `fsck`.
- Shell with file commands, pipes, redirection, chaining, status codes, scripts, `PATH`, npm, NodeCompat, WASM, and raw syscall access.
- Package manager with transactions, rollback, registry/local installs, signed manifest trust, namespace roots, dependency views, package services, and package fsck.
- Browser.app with local HTML sandbox and optional `browserd` companion for real external browsing through Chromium CDP.
- TextEdit, Files.app, Viewer.app, Activity Monitor, Settings, Browser.app, and package samples acting as runtime clients.
- Kernel object registry and handles for processes, descriptors, files, devices, windows, services, IPC, sockets, keychain grants, timers, mounts, package namespaces, trusted prompts, companions, and storage transactions.
- Worker-backed process executor for CPU/syscall/WASM tasks with kill, timeout, crash, and cleanup behavior.
- Trusted UI first pass for prompt records and decisions.
- Runtime boundary hardening: no `window.dindbos`, no implicit root filesystem read for minimal manifests, and declared-only package `imports.url()`.
- Process container diagnostics in `/proc/<pid>/container.json`, `/proc/<pid>/status`, `/proc/processes.json`, and process object metadata.
- Opt-in `sandbox.containerMode: "iframe"` package apps mounted in `sandbox="allow-scripts"` iframes without `allow-same-origin`, using a postMessage syscall bridge for async runtime calls.
- Iframe package bridge messages are schema-validated, size/rate-limited, traceable, audited under `/var/log/dindbos/package-container.log`, and connected to process container health.
- `npm run smoke:iframe-containers` verifies iframe heartbeat, crash, procfs health, audit traces, and sandbox policy in a real headless browser runtime.
- Low-load visual QA path using Playwright Chrome for Testing by default instead of the user's installed Chrome app.
- Repository hygiene pass merged the completed runtime-boundary PRs and returned local/remote branches to `main` before opening the next worktree.

## Verification Baseline

Use this before trusting broad runtime changes:

```bash
npm run check
npm run smoke
npm run build
npm run qa:visual
```

Focused checks:

- `npm run smoke:runtime-boundary`: raw runtime global, default manifest scopes, declared package imports.
- `npm run smoke:processes`: process lifecycle, `/proc`, worker container diagnostics.
- `npm run smoke:packages`: install/update/remove rollback, package namespaces, package app runtime, iframe container diagnostics.
- `npm run smoke:iframe-containers`: real browser iframe heartbeat, crash, audit, and sandbox policy.
- `npm run smoke:permissions`: capability and filesystem denials.
- `npm run smoke:browserd` / `npm run smoke:browser-client`: real browser companion boundary.
- `npm run smoke:window-manager`: compositor/window handles, shortcuts, surface capture policy.
- `npm run smoke:trusted-ui`: trusted prompt handles and decision cleanup.
- `npm run smoke:release-conformance`: release conformance artifacts, secure boot JSON, manifest records, and SHA-256 lines.

## Active Queue

The runtime completion baseline is closed. The next product step is packaging DindbOS as an embeddable npm SDK so other web projects can install and boot the OS runtime with `npm install dindbos`. See `docs/sdk-packaging.md`.

## SDK Packaging Status

Current cycle: PR 10, User Docs And Launch Polish.

Done in this cycle:

- Reworked README around `npm install dindbos`, `npx create-dindbos`, framework examples, expected runtime result, and first-line troubleshooting.
- Added SDK troubleshooting coverage for blank mount, missing CSS, storage denial, Service Worker scope, origin isolation, and npm tarball install issues.
- Updated first-app and conformance docs so host app onboarding and release evidence references match the SDK packaging surface.

Next cycle:

- SDK packaging plan complete; next work should be driven by public beta feedback and package-size/runtime hardening.

## 100% Completion Plan

100% means DindbOS can make every OS-like claim through a real runtime primitive, a permission boundary, a diagnostic surface, and a regression test. Browser limitations stay explicit as degraded, unsupported, or companion-required instead of being hidden behind UI.

### Completion Axes

1. App Containers And Trusted UI: less-trusted GUI apps run behind container boundaries, and privileged prompts are compositor-owned surfaces that normal apps cannot spoof, cover, or capture.
2. Browser API Brokers And Device Tree: browser-native power is visible in `/proc`, mapped to `/dev/browser/*`, permissioned through declared grants, revocable, and privacy-ledgered.
3. Process Images, Job Control, And PTY: Terminal is a real process session endpoint with process images, wait/signal, process groups, jobs, foreground/background control, and PTY devices.
4. Storage Kernel And Recovery: disk semantics are durable, repairable, explainable, and safe across service lifecycle, mapped-file writes, local mounts, and remote sync conflicts.
5. Virtual Networking And Service Mesh: network power is policy-routed through virtual services, fetch/WebSocket/WebRTC brokers, companion boundaries, `/proc/net`, sockets, and firewall diagnostics.
6. Secure Boot, Policy Compiler, And Package Trust: package manifests compile into auditable syscall/path/device/network policy bundles, with boot measurements and policy proof commands.
7. Cross-Origin Isolation And Shared Memory: deployment profiles honestly report COOP/COEP/CORP, SharedArrayBuffer, Atomics, WASM memory handles, and degraded runtime modes.
8. Service Worker Boot And Offline Recovery: installed/offline deployments boot through safe profiles, recovery shell assets, offline maintenance queues, and panic diagnostics.
9. Conformance Lab: compatibility claims are generated from certification output across browsers, PWA modes, isolation modes, companions, and runtime subsystems.

### Implementation Cycles

Each implementation cycle uses a fresh `codex/*` worktree and branch, may contain multiple commits, and ends only after focused tests, `npm run check`, `npm run build`, PR creation, squash merge, main fast-forward, remote/local branch cleanup, and worktree removal.

1. Cycle 1: Browser API Brokers And Device Tree
   Finish notification, local file, screen capture, media, Web Share, WebRTC, WebGPU, WebUSB, WebSerial, and WebHID broker records; extend privacy ledger; add Settings permission views and `doctor browser`.
2. Cycle 2: Process Images, Job Control, And PTY
   Add process image records, spawn/exec/wait/signal syscalls, job control, process groups, `/dev/pts`, and PTY signal/resize semantics.
3. Cycle 3: Storage Kernel And Recovery
   Done: transaction groups cover writeback/service lifecycle/mapped writes; page-cache/writeback diagnostics and Storage Recovery controls are exposed. Remaining conflict work continues in the storage backlog.
4. Cycle 4: Virtual Networking And Service Mesh
   Done: loopback services, service discovery, firewall events, `net.services`, `net.firewall`, `/proc/net/services.json`, `/proc/net/firewall.json`, and `/proc/sockets` are implemented on top of the brokered fetch/WebSocket/WebRTC/raw companion boundary.
5. Cycle 5: Secure Boot, Policy Compiler, And Package Trust
   In progress: package manifests now compile into auditable path/device/network/dependency policy bundles exposed through `/proc/policy`, app manifests, `pkg audit`, and `policyctl`. Boot measurements remain in this cycle backlog.
6. Cycle 6: Cross-Origin Isolation And Shared Memory
   In progress: deployment profiles, `doctor isolation`, `/proc/isolation`, degraded-mode reporting, and worker memory-region handle prototypes are implemented. Remaining work is deeper package/container enforcement on isolated deployments.
7. Cycle 7: Service Worker Boot And Offline Recovery
   Done: Service Worker boot manifest/handshake, safe boot profiles, explicit offline maintenance queue, recovery shell assets, panic diagnostics, and package/service/companion profile enforcement are implemented.
8. Cycle 8: Conformance Lab
   Done: certification levels, browser profile matrix, generated compatibility docs, `/proc/conformance`, shell conformance commands, release artifact generation, and smoke output cover implemented guarantees.

### 1. App Containers And Trusted UI

Goal: run less-trusted GUI apps without direct access to desktop internals.

Done:

- Same-realm hardening removed the raw runtime global.
- Package container diagnostics expose same-realm, worker, package-sandbox, and sandboxed-iframe boundaries.
- Opt-in sandboxed iframe package mode exists and uses postMessage syscalls.
- Iframe bridge syscall messages have schema validation, request size limits, rate limits, trace ids, and audit logs.
- Iframe containers report heartbeat, mount timeout, cleanup, and crash state into `/proc/<pid>/container.json`.
- Focused real-browser smoke coverage locks iframe heartbeat and crash paths.
- Activity Monitor shows container isolation badges and per-process container health.
- Settings surfaces package-container security history from `/var/log/dindbos/package-container.log`.
- Iframe package SDK covers clock, entropy, fs, fd, env, apps, packages, storage, mounts, net, timers, trusted prompts, and processes through the postMessage syscall bridge.
- Trusted prompts now render as compositor-owned, capture-protected surfaces that ordinary app windows cannot cover, embed, or capture.
- Surface capture policy denies desktop and cross-window captures while trusted UI is visible.

Next:

- Add visible trusted prompt controls to the permission-specific brokers as those brokers land.

### 2. Browser API Brokers And Device Tree

Goal: make browser-native power visible, permissioned, and revocable.

Done:

- `/proc/browser-capabilities` and `/proc/device-tree` expose browser API probes, broker ownership, and `/dev/browser/*` device mappings.
- Clipboard read/write now routes through declared `clipboard.read`/`clipboard.write` grants and records privacy ledger entries in `/proc/privacy-ledger.json`.
- Browser broker status, request, and revocation paths cover notifications, local files, screen capture, media devices, Web Share, WebRTC, WebGPU, WebUSB, WebSerial, and WebHID capability records through `/proc/browser-brokers.json`.
- Gesture-gated broker requests record explicit user activation and invoke available browser APIs only when a trusted gesture is present.
- Gesture-gated broker requests can now raise compositor-owned trusted prompts, record prompt ids in the privacy ledger, and use granted prompt handles as the audited activation source for the final browser API invocation.
- Settings surfaces browser permission diagnostics and recent privacy ledger entries.
- `doctor browser` reports broker availability, access counts, and revoked grants.

Next:

- Connect each broker to its browser user-gesture implementation or companion fallback as product surfaces need it.

### 3. Process Images, Job Control, And PTY

Goal: make Terminal a real process session endpoint.

Done:

- Process records expose image metadata, job ids, process groups, foreground/background state, and `/proc/jobs`.
- `process.spawn`, `process.exec`, `process.wait`, `process.signal`, and `process.jobs` syscalls provide first-pass process session control.
- Shell `jobs`, `fg`, `bg`, `wait`, and signal-aware `kill` route through ProcessManager.
- `/dev/pts/<session>` PTY descriptors can bind directly to runtime PTY sessions.
- `/dev/pts/<session>` now enforces PTY owner or foreground process-group access, and PTY descriptors expose owner uid/gid, device mode, and terminal mode metadata.
- Signal delivery records executor, NodeCompat, WASM, job, and PTY targets; `/proc/<pid>/signals.json` and `/proc/<pid>/pty.json` expose delivery, terminal resize, and terminal mode events.

Next:

- Broaden PTY line-discipline behavior as interactive shells need canonical editing and signal characters.

### 4. Storage Kernel And Recovery

Goal: make disk semantics durable, repairable, and explainable.

Done:

- Atomic write primitives, package staging, archive import staging, OPFS replay records, fsync-style barriers, storage status, and `fsck` first pass.
- Cycle 3: storage transaction groups now cover writeback flushes, service lifecycle suspend/resume, and descriptor mapped-file writes; `/proc/storage-kernel.json`, `/proc/writeback`, `storage.kernel`, `storage fsck`, and Settings Storage Recovery expose page-cache/writeback/repair diagnostics.
- Local mount writes now detect external changes before overwriting, keep pending write content with the conflict record, expose resolution operations, and can resolve by accepting external state or overwriting the external file through an explicit arbitration call.
- Remote sync apply checkpoints now retain current file path/action plus processed and remaining counts, so interrupted apply/resume status is operator-readable under `/var/run/dindbos/remote-sync-apply.json`.

Next:

- Broaden storage conflict repair into app-specific merge hooks for richer document formats.

### 5. Virtual Networking And Service Mesh

Goal: provide a realistic networking abstraction without pretending arbitrary TCP/UDP is available to ordinary browser pages.

Done:

- Cycle 4: virtual loopback services route through the network broker and declared host policy; service discovery and firewall diagnostics are exposed through syscalls, app/package facades, `netstat`, `/proc/net`, and `/proc/sockets`.
- Package entrypoints now shadow direct browser globals and reject undeclared direct imports, while `policyctl prove` covers direct browser APIs, `browserd`, Service Worker registration, and remote provider import bypass attempts.

Next:

- Add per-provider companion identities when non-browser host capabilities are introduced.

### 6. Secure Boot, Policy Compiler, And Package Trust

Goal: make activation decisions measurable and auditable.

Done:

- Signed remote package manifests and trusted publisher records.
- Package manifests compile into auditable policy bundles covering filesystem scopes, dependency views, network hosts, device grants, IPC endpoints, process groups, services, trust state, and denial proofs.
- `/proc/policy`, app manifest policy exposure, `pkg audit`, and `policyctl` expose the compiled policy state.
- Secure boot measurements cover base files, package records, app registry manifests, trusted publishers, and executable policy proof reports through `/proc/secure-boot`, `/proc/secure-boot.json`, and `bootctl`.
- `policyctl prove` turns package policy proof descriptors into executable negative tests for raw runtime globals, undeclared dependency paths, undeclared device grants, direct browser APIs, `browserd`, Service Worker registration, and remote provider imports.
- Release conformance artifacts now boot a real headless runtime and emit conformance JSON, conformance evidence JSON, secure boot JSON, release browser/origin-isolation evidence matrix JSON, a source-digested release manifest, an Ed25519 detached manifest signature, a verification evidence JSON, and `SHA256SUMS`.

Next:

- Publish release-channel key rotation policy and hosted signature verification instructions.

### 7. Cross-Origin Isolation And Shared Memory

Goal: unlock safer app containers, SharedArrayBuffer, Atomics, and high-performance WASM patterns.

Done:

- COOP/COEP/CORP deployment profiles are documented in `docs/isolation.md`.
- `doctor isolation` and `/proc/isolation` expose current cross-origin isolation, SharedArrayBuffer/Atomics availability, degraded reasons, and worker memory-region status.
- Worker memory-region handles are kernel-tracked and fall back to ArrayBuffer copy transfer when cross-origin isolation is absent.
- Package container launches now record deployment isolation, honor origin-isolated SharedArrayBuffer requirements, and block required entries with `EISOLATION` instead of silently degrading.
- Release conformance now records origin-isolated QA evidence and preserves required headers, SharedArrayBuffer/Atomics state, worker transfer mode, and degraded modes in `dindbos-release-evidence-matrix.json`.

Next:

- Add hosted-browser QA coverage for an actually origin-isolated served build.

### 8. Service Worker Boot And Offline Recovery

Goal: support installed/offline deployments without claiming closed-page magic.

Done:

- `/dindbos-sw.js` provides a browser Service Worker boot/cache/handshake script for boot and recovery assets.
- `/proc/service-worker-boot`, `/proc/service-worker-boot.json`, and `/var/run/dindbos/service-worker-boot.json` expose the boot manifest, controller state, handshake state, and closed-page execution boundary.
- Safe boot profiles cover normal, safe-mode, package-disabled, service-disabled, companion-disabled, offline, and storage-repair modes.
- Active safe boot profiles enforce package bootstrap/install/CLI/app launch, service starts, companion grants/approval masking, and app autostart restrictions.
- The offline maintenance queue only accepts explicitly permissioned maintenance tasks.
- `/var/recovery/shell` and `/var/run/dindbos/panic.json` provide recovery shell assets and panic diagnostics.
- `npm run smoke:service-worker-recovery` verifies browser registration, boot handshake, cached `/index.html`, offline navigation fallback, and the closed-page execution boundary.

Next:

- Add hosted release evidence retention for Service Worker and browser-provider artifacts.

### 9. Conformance Lab

Goal: turn "native-like" claims into tested levels.

Done:

- Runtime conformance reports classify durable disk, descriptors, packages, WASM, NodeCompat, worker isolation, app containers, device brokers, networking, companions, service worker recovery, cross-origin isolation, and package policy trust.
- `/proc/conformance`, `/proc/conformance.json`, `conformance`, `conformance matrix`, `conformance json`, and `doctor conformance` expose the certification output.
- Real QA evidence records feed browser matrix rows and are mirrored through `/proc/conformance-evidence`, `/proc/conformance-evidence.json`, and `conformance evidence`.
- `docs/conformance.md` documents levels, areas, browser matrix profiles, and smoke verification.
- `npm run smoke:conformance` verifies report generation and shell output.
- `npm run release:conformance` writes release JSON snapshots, a release browser/origin-isolation evidence matrix, a source-digested release manifest, a detached Ed25519 manifest signature, verification evidence, and SHA-256 sums.
- `npm run smoke:release-conformance` verifies the generated release evidence matrix, origin-isolated QA row, signature, tamper rejection, and digest lines.

Next:

- Add release-channel key rotation policy and browser-profile artifact retention.

## Work Selection Rules

- Prefer primitives over demos.
- Add tests when adding guarantees.
- If a browser limitation cannot be bypassed safely, expose it as degraded or companion-required.
- Keep third-party package capability explicit and narrow.
- Do not broaden `browserd`; add separate companion identities for non-browser host capabilities.
- Keep roadmap claims tied to commands, `/proc` evidence, or runtime APIs.

## Milestones

### Milestone A: Runtime Boundary

Complete when raw runtime access is gone, packages use declared scopes, app containers have audited bridges, and trusted UI cannot be spoofed by normal apps.

### Milestone B: Userland Confidence

Complete when shell jobs, PTYs, descriptors, process images, NodeCompat, and WASM can share the same process/permission model.

### Milestone C: Durable Workspace

Complete when storage transactions, fsync barriers, local mounts, sync conflicts, package records, and repair tools are dependable for real documents.

### Milestone D: Browser-Native Capability OS

Complete when browser/device APIs are brokered, logged, revocable, and visible through Settings and `/proc`.

### Milestone E: Conformance

Complete when DindbOS can report which guarantees are implemented, degraded, companion-required, experimental, or unsupported.
