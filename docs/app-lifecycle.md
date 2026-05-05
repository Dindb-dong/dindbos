# DindbOS App Lifecycle

DindbOS apps are browser-native runtime clients. They are not iframes with unrestricted access to the page, and they are not native OS processes. The lifecycle below describes the current runtime contract that built-in apps and packaged apps should assume.

## Runtime Boot

DindbOS exposes explicit boot phase diagnostics through `os.bootStatus()` and emits `boot:phase` events when a phase starts or completes.

Current boot phases:

- `storage-load`: load persisted filesystem state or keep the initial filesystem
- `vfs-mount`: restore persisted local folder mount metadata
- `package-registry-load`: bootstrap package roots, sample package source, records, and installed package apps
- `app-registry-load`: register built-in apps
- `process-init`: sync the process table and `/proc`
- `desktop-render`: mount the desktop shell, dock, and window layer

Each phase records `status`, `detail`, `startedAt`, `finishedAt`, `durationMs`, and `error`. Recoverable storage-load and VFS mount restore failures are marked `recovered` and continue booting. Strict callers can pass `{ recover: false }` to `loadPersistentFileSystem()` when they need startup to stop on the first storage error.

After desktop render, DindbOS writes selected boot diagnostics to `/var/log/dindbos/boot.json` and `/var/log/dindbos/boot.log`. It also transitions the OS lifecycle state to `active` and writes `/var/run/dindbos/lifecycle.json` plus `/var/log/dindbos/lifecycle.log`. These files are part of the VFS, so Terminal, Files.app, and packaged diagnostic tools can inspect the same runtime evidence.

## Lifecycle States

The OS-level lifecycle is exposed through `os.lifecycleStatus()` and `os:lifecycle` events. The first-pass state set is `booting`, `active`, `idle`, `suspending`, `suspended`, `resuming`, `shutting-down`, `crashed`, and `recovered`.

Browser `pagehide` and hidden-tab `visibilitychange` events transition the OS through `suspending` to `suspended` while service records are suspended. `pageshow` and visible-tab `visibilitychange` transition through `resuming` back to `active`. `beforeunload` records `shutting-down` before the persistence lifecycle hook performs its best-effort flush.

Page lifecycle exits write `/var/run/dindbos/recovery/last-shutdown.json` with pending persistence status, suspended services, worker-backed processes, and running processes. When the next boot sees an unrecovered dirty shutdown record, it writes `/var/run/dindbos/recovery/last-recovery.json`, acknowledges the prior shutdown record, and emits an `os:lifecycle` transition to `recovered` before normal boot continues.

Process lifecycle callbacks are recorded per process. `suspending` runs `prepare-suspend`, `suspended` runs `suspend`, `resuming` runs `resume`, `shutting-down` runs `prepare-shutdown`, and `recovered` runs `recovery-inspection`. Callback results are emitted as `process:lifecycle` events and surfaced in `/proc/<pid>/status` plus `/proc/processes.json`.

Settings and `doctor` expose lifecycle/recovery diagnostics, including the last shutdown/recovery record and a closed-page boundary list. DindbOS reports closed-page persistence as unsupported unless a future browser-supported background API explicitly owns that work.

`doctor compat` also reports Service Worker and Periodic Background Sync probes. DindbOS does not auto-register closed-page maintenance; it reports `unsupported-in-this-runtime` or `available-but-not-registered` until an explicit, permissioned maintenance service owns a limited task.

Each runtime has an `instanceId` and participates in a storage-backed session lock. The first active instance becomes `primary`; later instances report `secondary` with readonly fallback diagnostics. Expired locks can be recovered by a new primary, and `/proc/sessions`, Settings, and `doctor` show the current lock owner and role.

When BroadcastChannel is available, DindbOS publishes VFS file-change messages to peer runtimes and emits them as `session:file-change` events. Same-path edits from different runtime instances are recorded as pending session conflicts and surfaced through `/proc/sessions` plus Settings. Storage flush start/complete/error phases are broadcast as `session:storage-flush` diagnostics so peer runtimes can see active persistence work. App-state set/remove/clear/uninstall changes are broadcast as `session:app-state` diagnostics. Package install coordination and package DB conflict policy still need explicit handling.

Lifecycle events are emitted on the runtime event bus with explicit app-level names:

- `app:install`: package app installed
- `app:update`: package app replaced from the recorded source or a newly installed manifest with the same package id
- `app:first-run`: package app entry mounted for the first time after install
- `app:launch`: process spawned for an app
- `app:ready`: window render completed and the process was marked ready
- `app:focus`: window focused
- `app:suspend`: window minimized
- `app:resume`: window restored or maximized after suspension
- `app:crash`: app process crashed
- `app:close`: app process exited or was killed
- `app:uninstall-cleanup`: package install path, launcher, and record cleanup completed
- `app:uninstall`: package app removed

Lower-level `process:*` and `package:*` events remain available for process-table and package-manager tools, but app clients should prefer the explicit `app:*` lifecycle stream when they only need app lifecycle state.

### Install

Package installs start from a `dindbos.app.json` manifest.

The package manager:

- normalizes the manifest
- creates `/opt/<package>`
- writes package files
- writes `/var/lib/dindbos/packages/<package>.json`
- creates `/usr/share/applications/*.app`
- registers the app with `AppRegistry`
- records lifecycle metadata in the package record

Install transactions are atomic from the runtime perspective. A failed local or remote install rolls back package files, launcher files, package records, and app registration.

### Update

Updates reinstall from the recorded source path or URL.

If an update fails, the previous package files, package record, launcher, and app registration remain in place. Apps should treat update as a full package replacement, not as an in-place patch hook.

Successful replacement emits `app:update` and `package:update` instead of a second install event. The package record keeps `lifecycle.installedAt`, sets `lifecycle.updatedAt`, and increments `lifecycle.updateCount`.

### Launch

Apps launch through `AppRegistry.launch(appId, context)`.

The registry:

- resolves the app manifest
- reuses an existing singleton window when applicable
- spawns a process
- creates an app sandbox for that process
- attaches the process to a window
- calls the app render function with `{ os, content, window, context }`

Package apps with `app.entry` load `/opt/<package>/<entry>` as an ES module and call `mount()` or the default export with `{ content, os, pkg, package, imports, window }`.

The first successful package entry launch records `lifecycle.firstRunAt` and emits `app:first-run`/`package:first-run` once. Later launches do not repeat the first-run event.

### Ready

The runtime emits `app:ready` when the window manager marks the process ready. An app is considered ready when its render or mount function has produced usable DOM.

Apps that perform async work should render an explicit loading state, then replace it when ready. Package runtime errors are shown in the app content area.

Sandboxed apps can persist small JSON state through `os.state`. State is stored per app id under `/var/lib/dindbos/app-state`, survives close, relaunch, update, and VFS reload, and is removed during package uninstall cleanup.

### Focus

Focus is currently owned by the window manager. The runtime emits `app:focus` when a window is focused, but apps do not receive a dedicated in-process focus callback yet.

State that must survive focus changes should be stored in the DOM, app state object, or VFS-backed storage, not in transient event assumptions.

### Suspend And Resume

The runtime emits `app:suspend` when a window is minimized and `app:resume` when it is restored or maximized. OS-level page lifecycle transitions also invoke process lifecycle callbacks for prepare-suspend, suspend, resume, prepare-shutdown, and recovery inspection when an app or process provides `lifecycleCallbacks`.

Apps should remain robust when the browser tab is backgrounded, throttled, restored, or reloaded. Durable state must be flushed through VFS/storage APIs rather than relying on timers continuing to run.

### Crash

Synchronous app render failures are isolated to the app process.

The process manager records the crash, writes process diagnostics under `/proc`, and writes crash reports under `/var/log/dindbos`. The window shows a crash panel instead of corrupting the desktop session.

Package entry failures render a package runtime error inside the package app window.

Crash recovery policy:

- Keep the desktop session alive.
- Mark the process as `crashed`.
- Preserve the crashed window with an explicit crash panel when the failure happens during built-in app render.
- Write `/var/log/dindbos/crash-<pid>.log` and append `/var/log/dindbos/crashes.log`.
- Keep `/proc/<pid>` diagnostics available for crashed processes until the process is killed or restarted.
- Do not automatically restart crashed apps yet. Activity Monitor exposes manual restart so the user can inspect logs first.
- A restart creates a new process. It does not reuse the crashed PID.

### Close

Closing a window kills the attached process with an exited state. Process entries and `/proc/<pid>` files are cleaned up by the process manager.

Apps should write important data before close. There is no app-specific close confirmation hook yet.

### Uninstall

Package removal deletes:

- `/opt/<package>`
- `/var/lib/dindbos/packages/<package>.json`
- `/usr/share/applications/*.app`
- the app registry entry

Removal emits `app:uninstall-cleanup`/`package:uninstall-cleanup` with the cleaned install path, launcher path, and package record path before the final uninstall event. Packages should keep durable user data outside `/opt/<package>` if it should survive removal.

## Current Hooks

Built-in app:

```js
registerApp({
  id: "notes",
  render({ os, content, window, context }) {
    content.textContent = os.fs.readFile(context.path);
  }
});
```

Package app:

```js
export function mount({ content, os, pkg, imports, window }) {
  content.textContent = `${pkg.name} ${pkg.version}`;
}
```

## Current Limits

- No install, update, first-run, or uninstall script execution hook.
- No suspend/resume hook.
- No close confirmation hook.
- No long-running background service model yet.
- No automatic crash restart policy yet.

These limits are intentional until the sandbox and lifecycle policy are stricter. Apps should use the documented runtime APIs instead of depending on raw page globals or hidden OS internals.

## Verification

Lifecycle-sensitive changes should run:

```bash
npm run smoke:app-registry
npm run smoke:packages
npm run smoke:processes
npm run smoke
```

`npm run smoke:app-registry` verifies singleton launch behavior, non-singleton window IDs, and crash isolation when an app render function throws.

`npm run smoke:packages` verifies install rollback, update rollback, remove cleanup, app install/update/first-run/uninstall-cleanup/uninstall lifecycle events, and install -> AppRegistry launch -> package runtime render -> remove cleanup.

`npm run smoke:processes` verifies launch, ready, focus, suspend, resume, crash, and close lifecycle events.
