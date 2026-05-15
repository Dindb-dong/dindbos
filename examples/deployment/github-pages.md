# GitHub Pages

GitHub Pages is a degraded DindbOS deployment target because repository pages cannot attach COOP, COEP, and CORP headers to every route.

Expected runtime status:

- `crossOriginIsolated=false`
- SharedArrayBuffer-backed worker memory is unavailable
- DindbOS package profiles that require origin isolation are blocked before launch
- Files, Terminal, VFS, storage, and GUI built-ins remain usable
