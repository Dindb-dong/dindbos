# Service Worker Boot And Offline Recovery

DindbOS uses a Service Worker only for browser-owned boot and recovery assets. It does not claim arbitrary closed-page OS execution.

## Boot Manifest

The runtime writes the current Service Worker boot state to:

```text
/proc/service-worker-boot
/proc/service-worker-boot.json
/var/run/dindbos/service-worker-boot.json
```

The manifest records the `dindbos-sw-boot.v1` protocol, cacheable boot assets, safe boot profiles, recovery shell path, controller state, and handshake status. The browser Service Worker file is served as `/dindbos-sw.js` and answers `dindbos:boot:hello` with `dindbos:boot:ready`.

`npm run smoke:service-worker-recovery` starts a local Vite server in Chromium, registers `/dindbos-sw.js`, verifies the `dindbos-sw-boot.v1` handshake, confirms `/index.html` is cached, switches the browser context offline, and proves navigation can recover from the cached shell. It also verifies `closedPageExecution` remains false.

## Safe Boot Profiles

Implemented profiles:

- `normal`: standard boot path.
- `safe-mode`: minimal desktop and shell, with packages, services, and companions disabled.
- `package-disabled`: skips package activation.
- `service-disabled`: skips resumable services.
- `companion-disabled`: avoids native-adjacent helpers.
- `offline`: uses locally cached boot/recovery assets and disables remote network assumptions.
- `storage-repair`: runs repair diagnostics before normal app launch.

The active profile is enforced by the runtime:

- `packages` disables package bootstrap, package install/update, package CLI runs, and package app launch.
- `services` blocks service starts before a service process is spawned.
- `companions` blocks new companion grants and masks existing companion approvals until the profile changes.
- `app-autostart` blocks launch calls marked as autostart during storage repair.

Profile decisions are recorded in the Service Worker boot status under `safeBootEnforcement`.

## Offline Maintenance Queue

Only explicitly permissioned maintenance tasks can be queued:

```text
storage.flush
sync.retry
fsck.dry-run
recovery.export
```

The queue is written to `/var/run/dindbos/offline-maintenance-queue.json`. It is intentionally narrow so the runtime never pretends to run arbitrary app work after the browser closes.

## Recovery Shell And Panic Diagnostics

Recovery assets are written under `/var/recovery/shell`, including `recovery.dindbsh`. Panic diagnostics live at `/var/run/dindbos/panic.json` and point back to the recovery shell and safe boot profiles.

Shell inspection:

```text
recovery status
recovery profiles
recovery profile [normal|safe-mode|package-disabled|service-disabled|companion-disabled|offline|storage-repair]
recovery queue
recovery panic
```
