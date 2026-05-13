# DindbOS.js Roadmap

Last updated: 2026-05-14

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
- Low-load visual QA path using Playwright Chrome for Testing by default instead of the user's installed Chrome app.
- Repository hygiene pass kept only `main`, `codex/harden-runtime-boundaries`, and the active follow-up worktree branch `codex/runtime-boundary-next`.

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
- `npm run smoke:permissions`: capability and filesystem denials.
- `npm run smoke:browserd` / `npm run smoke:browser-client`: real browser companion boundary.
- `npm run smoke:window-manager`: compositor/window handles, shortcuts, surface capture policy.
- `npm run smoke:trusted-ui`: trusted prompt handles and decision cleanup.

## Active Queue

The next work should harden the kernel boundary before adding broad UX polish.

### 1. App Containers And Trusted UI

Goal: run less-trusted GUI apps without direct access to desktop internals.

Done:

- Same-realm hardening removed the raw runtime global.
- Package container diagnostics expose same-realm, worker, package-sandbox, and sandboxed-iframe boundaries.
- Opt-in sandboxed iframe package mode exists and uses postMessage syscalls.
- Iframe bridge syscall messages have schema validation, request size limits, rate limits, trace ids, and audit logs.
- Iframe containers report heartbeat, mount timeout, cleanup, and crash state into `/proc/<pid>/container.json`.

Next:

- Expand iframe bridge API coverage from basic async syscalls to the documented SDK surface.
- Add focused browser smoke coverage for iframe heartbeat and crash paths.
- Add Activity Monitor isolation badges and Settings security history from `/proc/<pid>/container.json`.
- Move trusted prompts into compositor-owned surfaces that ordinary apps cannot cover, embed, or spoof.
- Add capture-denial tests around trusted surfaces.

### 2. Browser API Brokers And Device Tree

Goal: make browser-native power visible, permissioned, and revocable.

Next:

- Add `/proc/browser-capabilities` and `/proc/device-tree`.
- Broker clipboard, notifications, local files, screen capture, media devices, Web Share, WebRTC, WebGPU, WebUSB, WebSerial, WebHID, and related APIs through declared grants.
- Add a privacy ledger for sensitive access by package id, process id, user, window, capability, and expiry.
- Add Settings permission panels and `doctor browser`.

### 3. Process Images, Job Control, And PTY

Goal: make Terminal a real process session endpoint.

Next:

- Define process image records for shell commands, package CLI, NodeCompat, WASM, worker jobs, services, and GUI apps.
- Add `process.spawn`, `process.exec`, `process.wait`, and `process.signal` syscall families.
- Add foreground/background process groups, `jobs`, `fg`, `bg`, `wait`, and pipeline cleanup.
- Add PTY master/slave descriptors, `/dev/pts`, terminal modes, resize, and signal delivery.

### 4. Storage Kernel And Recovery

Goal: make disk semantics durable, repairable, and explainable.

Done:

- Atomic write primitives, package staging, archive import staging, OPFS replay records, fsync-style barriers, storage status, and `fsck` first pass.

Next:

- Extend transaction groups into service lifecycle and mapped-file writes.
- Add page-cache/writeback diagnostics.
- Add salvage/repair views in Settings.
- Add stronger conflict handling for concurrent local mount writes and remote sync apply.

### 5. Virtual Networking And Service Mesh

Goal: provide a realistic networking abstraction without pretending arbitrary TCP/UDP is available to ordinary browser pages.

Next:

- Add virtual loopback services and service discovery records.
- Add fetch/WebSocket/WebRTC broker policy by package, user, host, protocol, and companion requirement.
- Expose `/proc/net`, `/proc/sockets`, and firewall diagnostics.
- Prove packages cannot bypass policy through direct browser APIs, `browserd`, service workers, or remote providers.

### 6. Secure Boot, Policy Compiler, And Package Trust

Goal: make activation decisions measurable and auditable.

Done:

- Signed remote package manifests and trusted publisher records.

Next:

- Compile package manifests into syscall/path/device/network policy bundles.
- Add boot measurements for base files, package records, app registry, and trusted publishers.
- Add `pkg audit`, `policyctl`, and `/proc/policy`.
- Add policy proofs for denied raw runtime, denied undeclared imports, denied dependency view reads, and denied device access.

### 7. Cross-Origin Isolation And Shared Memory

Goal: unlock safer app containers, SharedArrayBuffer, Atomics, and high-performance WASM patterns.

Next:

- Document COOP/COEP/CORP deployment profiles.
- Add `doctor isolation`.
- Add degraded-mode reporting when isolation headers are absent.
- Prototype worker memory-region handles after policy and container boundaries are stronger.

### 8. Service Worker Boot And Offline Recovery

Goal: support installed/offline deployments without claiming closed-page magic.

Next:

- Add Service Worker boot manifest and runtime handshake.
- Add safe boot profiles: normal, safe mode, package-disabled, service-disabled, companion-disabled, offline, and storage repair.
- Add offline command queue only for explicitly permissioned maintenance tasks.
- Add recovery shell assets and panic diagnostics.

### 9. Conformance Lab

Goal: turn "native-like" claims into tested levels.

Next:

- Define certification levels for durable disk, descriptor IO, package platform, WASM, NodeCompat, worker isolation, app containers, device brokers, virtual networking, and companion trust.
- Generate compatibility docs from conformance output.
- Add browser profile matrix for Chromium, Safari, Firefox, mobile, installed PWA, cross-origin isolated, local companion, and remote provider.

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
