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
- OPFS snapshot backend
- OPFS per-file content records
- OPFS inode metadata records
- dirty-file-only and dirty-inode-only writes
- debounce/coalesce persistence
- VFS snapshot load before boot
- file state survives reloads
- storage status command
- reset command
- File System Access API local folder mount
- `/mnt/<name>` external disk model
- Terminal `mount-local` and `umount`
- Files.app `Mount Local`
- `storage persist` and quota estimate
- persisted directory handles in IndexedDB
- `mount-local --list`, `mount-local --restore`, `mount-local --forget`
- binary-safe VFS read/write compatibility layer
- Files.app import/export
- Files.app drag and drop upload
- native Uint8Array file nodes with Blob/File import adapters
- Files.app local mount permission banner with reconnect/sync/forget controls
- Files.app copy/move/import/export progress reporting
- Settings storage flush, quota, persistence, and local mount management panel
- lifecycle flush status and write-pending status
- remaining: stronger browser shutdown guarantees, Cache API package/document cache, Storage Buckets where available

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

- 2차 구현 완료
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
- future: OS-level local mount rename through a native companion/helper instead of browser copy-delete

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

Storage and local mount UX are now usable enough for daily testing. The next proof point is process/activity visibility and app lifecycle polish so DindbOS feels like a runtime, not only a filesystem demo.
