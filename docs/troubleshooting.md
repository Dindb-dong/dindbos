# SDK Troubleshooting

## Blank Mount

Cause: the `root` selector does not match an element when `createAndBootDindbOS` or `mountDindbOSDesktop` runs.

Fix:

```js
await createAndBootDindbOS({ root: "#app" });
```

Make sure the host HTML contains `<div id="app"></div>` before the module runs.

## Missing CSS

Cause: the host app imported JavaScript but not the default CSS.

Fix:

```js
import "dindbos/styles.css";
```

## Storage Denied Or Stale

Cause: the browser denied persistent storage, the user cleared site data, or an old named storage key still contains incompatible data.

Fix:

```js
await createAndBootDindbOS({
  root: "#app",
  storage: { backend: "indexeddb", name: "my-web-os" },
});
```

Use a new `storage.name` during development or run `resetfs` inside Terminal.app.

## Service Worker Scope

Cause: the host enabled Service Worker boot without owning the route scope.

Fix:

```js
await createAndBootDindbOS({
  root: "#app",
  serviceWorker: false,
});
```

Enable Service Worker registration only after the host can serve `dindbos-sw.js` from the intended scope.

## Origin Isolation

Cause: COOP, COEP, and CORP headers are missing or a third-party asset does not allow embedding under COEP.

Fix: start with `examples/deployment/netlify.toml` or `examples/deployment/static-headers.txt`, then run:

```text
doctor isolation
cat /proc/isolation.json
```

GitHub Pages and default local dev servers are expected to run in degraded mode.

## npm Tarball Install

Cause: the package was packed before `npm run build:sdk`, or app-build output replaced SDK `dist` files.

Fix:

```bash
npm run build:sdk
npm run smoke:sdk-pack
```

Do not run `npm run build` and SDK pack checks against the same worktree at the same time.
