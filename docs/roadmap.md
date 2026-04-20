# DindbOS.js Roadmap

DindbOS.js should behave like a browser-native OS runtime, not an OS-themed portfolio page. The portfolio is the demo workload that proves the runtime.

## 1. Shell

- 1차 구현 완료
- `PATH` based command lookup
- environment variables: `HOME`, `USER`, `SHELL`, `PATH`, `PWD`
- `export`, `env`, variable expansion
- redirection: `>`, `>>`, `<`
- pipes: `cat file | grep text`
- `man`, `which`, `chmod`, `df`, `mount`
- keyboard history with up/down
- remaining: advanced shell edge cases, script execution, precise exit code semantics

## 2. Storage And Filesystem

- 1차 구현 완료
- IndexedDB storage backend
- VFS snapshot load before boot
- file state survives reloads
- storage status command
- reset command
- File System Access API local folder mount
- `/mnt/<name>` external disk model
- Terminal `mount-local` and `umount`
- Files.app `Mount Local`
- `storage persist` and quota estimate
- remaining: OPFS file content backend, move from snapshot storage to per-file inode records, persisted directory handles in IndexedDB, import/export, drag and drop upload, binary-safe file reads/writes

## 3. Package System

- 1차 구현 완료
- `dindbos.app.json` manifest schema
- app entry loader
- permissions and filesystem scopes
- install/uninstall
- remote manifest URL install
- remote registry search/install
- package update from recorded source
- npm dependency records through browser ESM modules
- npm registry metadata fetch
- npm tarball install into VFS-backed `node_modules`
- recursive regular dependency install
- package-lock writer
- sha256 file integrity checks
- `/usr/share/applications/*.app`
- `/opt/<package>`
- remaining: peer/optional dependency policy, public-key package signatures, richer app lifecycle hooks, npm bundle caching

## 3.1 NodeCompat

- 1차 구현 완료
- `npm install <package>` direct dependency install
- npm `.tgz` download and extraction
- npm integrity verification
- VFS-backed `node_modules`
- package.json and package-lock.json writes
- recursive regular dependency install
- `node <file>` and `node -e <code>`
- CommonJS `require`
- `node --input-type=module -e <code>`
- `.mjs` files with simple static import/export transforms
- package `"type": "module"` detection
- package `main` and simple `exports` resolution
- VFS-backed `fs`, `path`, `process`, and `Buffer` facades
- remaining: richer ESM semantics, richer package `exports` conditions, optional dependency handling, JS-only lifecycle scripts, broader Node built-in compatibility

## 4. Activity Monitor

- process table UI
- PID, app, user, state, uptime, window
- kill/restart controls
- `/proc` viewer
- process logs

## 5. Browser.app

- remote browser backend bridge
- WebSocket status
- address bar and navigation history
- cold start/wakeup state
- local HTML file opening
- fallback states for unsupported targets

## 6. Document Viewers

- PDF.js based PDF Viewer
- HTML deck viewer
- markdown preview
- image viewer
- stable file associations

## 7. Files.app

- local folder mount button
- rename
- duplicate
- copy/paste
- trash
- context menu
- drag and drop move
- permission inspector
- breadcrumb
- search

## 8. Window Manager

- snap zones
- alt-tab
- keyboard shortcuts
- restore window positions
- stable minimize animation
- mobile-specific window policy

## 9. Users And Permissions

- login session
- `su` and `sudo` mock
- user/group management
- home directory generation
- stricter read/write/execute checks

## 10. Developer Experience

- "Build your first DindbOS app"
- manifest examples
- app lifecycle docs
- filesystem API docs
- sample apps: Notes, Paint, Activity Monitor, Browser, PDF Viewer

## Current Priority

Start with Shell and IndexedDB filesystem. They make DindbOS feel like a stateful runtime: commands mutate real files, and those files survive reloads.
