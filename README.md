# DindbOS.js

DindbOS.js is a browser-native desktop runtime for portfolio sites, docs, demos, and web OS experiments.

It is not a Linux kernel emulator. It is a small OS-style runtime for the browser:

- virtual file system
- process manager
- chmod-style permission checks
- app manifests
- process-scoped app sandbox
- persistent filesystem snapshots
- app registry
- package manager
- window manager
- desktop shell
- built-in apps
- portfolio/demo mounting

The first demo boots a portfolio inside DindbOS instead of decorating a portfolio page to look like an OS.

## Demo

- GitHub Pages: https://dindb-dong.github.io/dindbos/

## Local Dev

```bash
npm run dev
```

Then open `http://127.0.0.1:5174`.

## Project Shape

```text
src/
  dindbos/       runtime modules
  demo/          portfolio demo mount
  styles/        default DindbOS theme
```

## Virtual File System

The demo now boots with a Linux-like tree:

```text
/
  bin/                  shell commands
  boot/                 runtime boot notes
  dev/                  browser devices
  etc/                  os-release, motd, shell config
  home/guest/Desktop/   user desktop symlinks
  lib/dindbos/          runtime docs
  mnt/portfolio/        mounted portfolio projects and decks
  proc/                 runtime status files
  usr/share/applications/
  var/lib/dindbos/      installed package records
  var/log/
```

The desktop is rendered from `/home/guest/Desktop`, not from hard-coded buttons. Apps live under `/usr/share/applications`, and portfolio content is mounted under `/mnt/portfolio`.

Terminal commands currently include read and write operations against the shared virtual filesystem:

```text
help, history, clear, pwd, cd, ls, tree, find, cat, grep, stat, readlink
mkdir, touch, rm, cp, mv, echo >, echo >>, open, apps, whoami, uname, neofetch, date
export, env, which, man, chmod, df, mount, manifest, ps, kill, storage, resetfs
pkg list, pkg info, pkg install, pkg remove
```

Runtime state is shared across apps. Files created from Terminal appear in Files.app, and TextEdit saves back into the same VFS.
Shell syntax supports command chaining with `&&`, `||`, and `;`, plus pipes and redirection.

## Runtime Kernel

DindbOS.js now has browser-native OS primitives:

- `ProcessManager` assigns PIDs to launched apps and exposes `ps`/`kill`.
- `AppRegistry` normalizes app manifests and writes them to `/usr/share/dindbos/manifests`.
- `PackageManager` installs local or remote `dindbos.app.json` manifests into `/opt/<package>` and `/usr/share/applications/*.app`.
- `AppSandbox` gives each app a scoped runtime instead of the raw OS object.
- `PermissionPolicy` enforces owner/group/other mode bits for VFS reads and writes.
- `ShellSession` handles `PATH`, environment variables, pipes, redirection, and shell builtins.
- `PersistentStorage` saves the VFS snapshot to IndexedDB with localStorage and memory fallback; `resetfs` clears it and reloads.

The current model is still a browser runtime, not a Linux kernel emulator, but app execution now flows through process, manifest, sandbox, permission, and storage layers.

## Packages

A DindbOS package starts with a `dindbos.app.json` manifest. The package manager stores installed package records under `/var/lib/dindbos/packages`, installs app files under `/opt/<package>`, creates launchers under `/usr/share/applications`, and registers the app with the runtime.

Try the sample package:

```text
pkg list
pkg info hello-notes
open "/usr/share/applications/Hello Notes.app"
```

Remote packages install the same way when the server allows browser CORS:

```text
pkg install https://example.com/dindbos-packages/hello-notes/dindbos.app.json
```

## Goal

The goal is to make DindbOS.js useful as an open-source web desktop runtime, while this repository also serves as the canonical demo.
