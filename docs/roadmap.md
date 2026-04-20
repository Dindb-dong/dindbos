# DindbOS.js Roadmap

DindbOS.js should behave like a browser-native OS runtime, not an OS-themed portfolio page. The portfolio is the demo workload that proves the runtime.

## 1. Shell

- `PATH` based command lookup
- environment variables: `HOME`, `USER`, `SHELL`, `PATH`, `PWD`
- `export`, `env`, variable expansion
- redirection: `>`, `>>`, `<`
- pipes: `cat file | grep text`
- `man`, `which`, `chmod`, `df`, `mount`
- keyboard history with up/down

## 2. IndexedDB Filesystem

- IndexedDB storage backend
- VFS snapshot load before boot
- file state survives reloads
- storage status command
- reset command
- future: per-file records, directory index, import/export, drag and drop uploads

## 3. Package System

- `dindbos.app.json` manifest schema
- app entry loader
- permissions and filesystem scopes
- install/uninstall
- `/usr/share/applications/*.app`
- `/opt/<package>`
- future: `pkg install ./some-app`

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
