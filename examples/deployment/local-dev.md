# Local Dev

Default Vite dev servers usually run DindbOS in degraded mode because they do not set COOP, COEP, and CORP headers.

Use `doctor isolation` and `cat /proc/isolation.json` to confirm the active profile.

Expected default status:

- `crossOriginIsolated=false`
- SharedArrayBuffer-backed worker memory is unavailable
- Copy-transfer worker fallback is used

To test origin isolation locally, add a dev middleware or reverse proxy that sends the headers in `static-headers.txt`.
