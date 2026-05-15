# Cross-Origin Isolation

DindbOS reports browser isolation as a runtime capability, not as a promise. SharedArrayBuffer, Atomics-backed shared memory, and high-throughput worker/WASM patterns require an origin-isolated deployment.

## Deployment Profiles

For copyable host deployment recipes, see [SDK Deployment Recipes](deployment.md).

Default local or embedded profile:

```text
Cross-Origin-Opener-Policy: unsafe-none
Cross-Origin-Embedder-Policy: unsafe-none
Cross-Origin-Resource-Policy: not-enforced
```

This profile runs the desktop and package model, but shared memory is degraded to ArrayBuffer copy transfer.

Origin-isolated profile:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Use `Cross-Origin-Embedder-Policy: credentialless` only when the deployment has compatible third-party assets. Cross-origin scripts, fonts, workers, WASM modules, images, and package assets must either send compatible CORP/CORS headers or be served from the same origin.

## Runtime Diagnostics

Use:

```text
doctor isolation
cat /proc/isolation
cat /proc/isolation.json
```

The JSON report includes the active profile, missing isolation conditions, required headers, SharedArrayBuffer/Atomics availability, worker-memory transfer mode, and active memory-region handles.

## Worker Memory Regions

`createWorkerMemoryRegion({ size })` creates a kernel-tracked memory-region handle. When `crossOriginIsolated` and SharedArrayBuffer are available, the region uses shared memory. Otherwise it returns an ArrayBuffer copy-fallback and marks the region degraded in `/proc/isolation.json`.

This keeps high-performance paths explicit: packages can detect the degraded mode and avoid pretending that browser tabs without COOP/COEP have native shared memory.

## Package Launch Decisions

Package apps inherit the current isolation report at launch. Their `/proc/<pid>/container.json` record includes `deploymentIsolation`, `isolationRequirement`, `launchDecision`, and `launchBlocked`.

Packages that require origin isolation can declare:

```json
{
  "sandbox": {
    "containerMode": "iframe",
    "isolation": {
      "profile": "origin-isolated",
      "sharedMemory": true,
      "allowDegraded": false
    }
  }
}
```

When the current browser profile cannot provide cross-origin isolation and SharedArrayBuffer, DindbOS blocks the package entrypoint before it runs, renders a package-container blocked state, and records `EISOLATION` in the process container diagnostics.
