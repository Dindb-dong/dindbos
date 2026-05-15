# SDK Deployment Recipes

DindbOS can run in any modern browser page, but advanced package and worker paths are only fully enabled when the host deployment is origin-isolated.

## Netlify Static Site

Use `examples/deployment/netlify.toml` or add equivalent headers:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
    Cross-Origin-Resource-Policy = "same-origin"
```

Expected result: `crossOriginIsolated=true` when all scripts, workers, WASM modules, fonts, and package assets are same-origin or send compatible CORS/CORP headers.

## Static Server

Use `examples/deployment/static-headers.txt` as the required response header set:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Expected result: `crossOriginIsolated=true` on HTTPS or localhost.

## GitHub Pages

GitHub Pages does not let a repository configure COOP/COEP/CORP headers for every route.

Expected result: DindbOS boots in degraded mode. Terminal, Files, VFS, storage, packages, and most GUI apps continue to work, but SharedArrayBuffer and strict origin-isolated package profiles are unavailable.

## Local Dev

Default Vite dev servers usually run without COOP/COEP/CORP headers.

Expected result: degraded mode unless the host adds a local middleware or reverse proxy that sets the origin-isolated headers.

## Verification

Inside DindbOS, run:

```text
doctor isolation
cat /proc/isolation.json
```

Release evidence also records deployment recipes in `dindbos-deployment-recipes.json` and links them from `dindbos-release-evidence-matrix.json`.
