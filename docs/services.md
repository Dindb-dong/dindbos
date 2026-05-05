# DindbOS Services

DindbOS services are runtime-managed background processes for work that should be visible, restartable, and auditable instead of hidden inside app render code.

The first-pass service manager lives at `os.services`.

## Service Manifest

Runtime code can register a service manifest:

```js
os.services.register({
  id: "search-indexer",
  name: "Search Indexer",
  enabled: true,
  schedule: { everyMs: 60000 },
  fileSystem: {
    read: ["/home/guest"],
    write: ["/var/lib/dindbos/search"]
  },
  start: ({ log }) => log("indexer boot"),
  run: async ({ os, log }) => {
    log("scheduled index pass");
  }
});
```

Each service record is persisted to `/var/run/dindbos/services.json`. Service logs append to `/var/log/dindbos/services.log`.

## States

Current service states:

- `disabled`
- `stopped`
- `starting`
- `running`
- `suspended`
- `degraded`
- `crashed`

`start()`, `stop()`, `restart()`, `disable()`, `runScheduled()`, `suspend()`, `resume()`, and `crash()` update service state and emit `service:*` events on the runtime bus.

Settings.app reads `os.services.list()` and renders service state, run count, restart controls, and disable controls through the sandboxed `service.read` / `service.manage` facade.

Activity Monitor shows service-managed processes as `service:<id>` rows. Selecting one renders service metadata, service logs, restart controls, and disable controls next to the normal process detail.

## Process Boundary

Starting a service creates a DindbOS process with runtime `service`, a `service:<id>` app id, `/proc` visibility, descriptor cleanup, and crash report integration. Service crashes write through `ProcessManager.crash()` so diagnostics appear under `/var/log/dindbos/crash-<pid>.log`.

## Permission Boundary

Service management is privileged. Calls that mutate service state require a root/system principal. Unprivileged callers fail with `service: manage denied`.

## Browser Lifecycle Limits

DindbOS wires browser `visibilitychange`, `pagehide`, and `pageshow` events into service `suspend(reason)` and `resume(reason)` transitions. Hidden tabs and pagehide move running services into `suspended`; visible tabs and pageshow restore suspended services to their previous running state.

This still does not claim closed-page persistence. Service worker and periodic background sync integration remain future work and must report unsupported behavior honestly when the browser cannot keep work alive.
