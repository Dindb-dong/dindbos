# DindbOS.js

DindbOS.js is an embeddable browser-native OS runtime for web apps.

It is not a Linux kernel emulator. It is a small OS-style runtime for the browser:

- virtual file system
- process manager
- chmod-style permission checks
- app manifests
- process-scoped app sandbox
- persistent filesystem snapshots
- local folder mounts through File System Access API
- app registry
- package manager
- window manager
- desktop shell
- built-in apps
- conformance and release evidence

## Install In A Web App

```bash
npm install dindbos
```

```js
import { createAndBootDindbOS } from "dindbos";
import "dindbos/styles.css";

await createAndBootDindbOS({
  root: "#app",
  fileSystem: {
    "/home/guest/readme.md": "# Hello from DindbOS\n",
  },
  builtins: { includePortfolio: false },
  launch: ["files", "terminal"],
});
```

Expected result: a DindbOS desktop mounts into `#app`, Files.app can open `/home/guest/readme.md`, Terminal.app can read and write the same VFS, and `/proc/conformance.json` describes the active browser constraints.

## Create A Host App

```bash
npx create-dindbos my-web-os
cd my-web-os
npm install
npm run dev
```

The generated project seeds `/home/guest/readme.md`, registers one host `Hello.app`, installs built-ins, and includes origin-isolation header notes.

## Framework Examples

- Vanilla Vite: `examples/vanilla-vite`
- React Vite: `examples/react-vite`
- Next.js client-only route: `examples/next-client`
- Astro client-only island: `examples/astro-island`

See `examples/README.md` and `docs/deployment.md`.

## Demo

- GitHub Pages: https://dindb-dong.github.io/dindbos/

## Local Dev

```bash
npm run dev
```

Then open `http://127.0.0.1:5174`.

## Troubleshooting

- Blank mount: verify the `root` selector exists before booting.
- Missing styles: import `dindbos/styles.css` from the host entrypoint.
- Storage denial: switch to memory/custom storage or clear the named IndexedDB storage key.
- Service Worker scope: keep `serviceWorker.enabled` false unless the host controls the route scope.
- Origin isolation: use `docs/deployment.md` and then run `doctor isolation`.

More cases are in `docs/troubleshooting.md`.

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
  mnt/<local-folder>/   optional user-selected local folders
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
mount-local, umount, storage persist
pkg list, pkg info, pkg install, pkg search, pkg registry, pkg update, pkg deps, pkg npm, pkg remove
npm install, npm root, node -e, node --input-type=module -e, node <file>
```

Runtime state is shared across apps. Files created from Terminal appear in Files.app, and TextEdit saves back into the same VFS.
Shell syntax supports command chaining with `&&`, `||`, and `;`, plus pipes and redirection.
See `docs/shell.md` for status codes, chaining semantics, and the supported script dialect.

## Browser Companion

Browser.app can open local HTML files directly. For real external URLs, start the local companion:

```bash
npm run browserd
```

Then open Browser.app and connect to `ws://127.0.0.1:8787/browser`. The companion launches local Chromium through CDP and streams frames back into DindbOS.

Useful companion commands:

```bash
node scripts/browserd.js --port 8787 --cdp-port 9223
node scripts/browserd.js --headful
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run browserd
curl http://127.0.0.1:8787/health
npm run smoke:browserd
npm run smoke:browserd-failures
```

Browser.app refuses to connect when port `8787` is occupied by a non-DindbOS service. More protocol details and failure modes are in `docs/browserd.md`.

## Runtime Kernel

DindbOS.js now has browser-native OS primitives:

- `ProcessManager` assigns PIDs to launched apps and exposes `ps`/`kill`.
- `Activity Monitor.app` reads the process table, process logs, `/proc/<pid>` status files, and container diagnostics, then can kill or restart apps.
- `AppRegistry` normalizes app manifests and writes them to `/usr/share/dindbos/manifests`.
- `PackageManager` installs local, remote, or registry-backed `dindbos.app.json` manifests into `/opt/<package>` and `/usr/share/applications/*.app`.
- `NpmInstaller` fetches npm registry metadata and tarballs, verifies integrity, and writes pure JavaScript packages into VFS-backed `node_modules`.
- `NodeCompat` runs CommonJS files with `require()`, package resolution, and VFS-backed `fs`, `path`, `process`, and `Buffer` facades.
- `AppSandbox` gives each app a scoped runtime instead of the raw OS object; the page entrypoint does not expose the raw runtime on `window`.
- `PermissionPolicy` enforces owner/group/other mode bits for VFS reads and writes.
- `ShellSession` handles `PATH`, environment variables, pipes, redirection, and shell builtins.
- `PersistentStorage` saves the VFS snapshot to IndexedDB with localStorage and memory fallback; `resetfs` clears it and reloads.
- `LocalFolderMountManager` mounts user-selected folders under `/mnt` with File System Access API so files can move between DindbOS and the local computer.

Local folder mounts are opt-in and transient. Use `mount-local mydisk` from Terminal or `Mount Local` in Files.app, then copy files both ways:

```text
mount-local mydisk
cp ~/Documents/todo.md /mnt/mydisk/todo.md
cp /mnt/mydisk/input.txt ~/Documents/input.txt
storage persist
```

The current model is still a browser runtime, not a Linux kernel emulator, but app execution now flows through process, manifest, sandbox, permission, and storage layers.

See `docs/app-lifecycle.md` for install, update, launch, crash, close, and uninstall behavior.

## Packages

A DindbOS package starts with a `dindbos.app.json` manifest. The package manager stores installed package records under `/var/lib/dindbos/packages`, installs app files under `/opt/<package>`, creates launchers under `/usr/share/applications`, and registers the app with the runtime.

Try the sample packages:

```text
pkg list
pkg info hello-notes
pkg deps hello-notes
open "/usr/share/applications/Hello Notes.app"
pkg install /opt/dindbos/packages/paint-sample/dindbos.app.json
pkg install /opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json
```

Remote packages install the same way when the server allows browser CORS:

```text
pkg install https://example.com/dindbos-packages/hello-notes/dindbos.app.json
```

Registry and dependency commands:

```text
pkg search notes
pkg registry add community https://example.com/dindbos-registry.json
pkg install hello-notes
pkg update hello-notes
pkg npm add hello-notes lodash-es@4.17.21
```

Package apps can execute `/opt/<package>/app.js` when the manifest sets `app.entry`. npm dependencies are installed as browser ESM dependency records and loaded at runtime through `imports.npm("package-name")`; this is not a Node.js `npm install` or native binary execution path.

Remote package trust and the planned signature model are documented in `docs/package-signatures.md`.

## npm Compatibility

DindbOS has an early npm-compatible installer:

```text
cd /home/guest/Documents
npm install is-number@7.0.0
ls node_modules/is-number
cat package-lock.json
node -e "console.log(require('is-number')(7))"
node --input-type=module -e "import isNumber from 'is-number'; console.log(isNumber(7))"
```

This fetches package metadata from the npm registry, resolves a version, downloads the `.tgz` tarball, verifies npm integrity, extracts files, updates `package.json`, and writes `package-lock.json`.
Installed CommonJS packages can be loaded by the early NodeCompat runtime.
Regular package `dependencies` are installed recursively and recorded in `package-lock.json`; compatible dependencies are hoisted, and version conflicts are nested under the dependent package.

Current limits:

- supports simple exact, `latest`, `^`, `~`, and `>=` ranges
- installs regular `dependencies`, but not `devDependencies`, `peerDependencies`, or `optionalDependencies`
- does not run lifecycle scripts
- does not execute native addons
- provides only a partial Node built-in surface
- supports only simple ESM import/export transforms

## Verification

Run the broad local confidence gate before shipping runtime changes:

```bash
npm run smoke
```

Focused gates:

```bash
npm run check
npm run smoke:boot
npm run smoke:storage
npm run smoke:persistent-storage
npm run smoke:files
npm run smoke:shell
npm run smoke:permissions
npm run smoke:packages
npm run smoke:npm-node
npm run smoke:processes
npm run smoke:local-mounts
npm run smoke:app-registry
npm run smoke:window-manager
npm run smoke:browser-addresses
npm run smoke:browser-client
npm run smoke:browserd
npm run smoke:browserd-failures
npm run qa:visual
```

The browser companion smoke starts real Chromium through CDP and fails unless it receives a real JPEG frame. The npm/node smoke fetches a real package from the npm registry and runs it through NodeCompat.
`npm run qa:visual` uses Playwright's bundled Chrome for Testing by default, launches it headless with low-background-work flags, and disables CSS motion for screenshots. Set `CHROME_PATH` only when debugging a specific installed Chrome build, or `DINDBOS_QA_DISABLE_MOTION=0` when animation fidelity is the thing being tested.

## Troubleshooting

Storage reset:

```text
storage
storage flush
resetfs
```

`resetfs` clears the persisted VFS snapshot and reloads the browser tab. Use it when old demo state is masking runtime changes.

Local folder mounts:

```text
mount-local --list
mount-local --restore
mount-local --forget /mnt/mydisk
```

The File System Access API requires a Chromium-family browser and explicit user permission. If a mount shows as denied or unavailable, reconnect it from Files.app or forget and mount it again.

Chrome detection for Browser.app:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run browserd
curl http://127.0.0.1:8787/health
```

If `browserd` cannot find Chrome automatically, set `CHROME_PATH`. If the health check does not return `service: "dindbos-browserd"`, stop the process using port `8787` or start `browserd` with `--port`.

Visual QA CPU spikes:

```bash
npm run qa:visual
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run qa:visual
DINDBOS_QA_DISABLE_MOTION=0 npm run qa:visual
```

The default visual QA path avoids the user's installed Chrome app. If CPU stays high after QA exits, check for unrelated lingering Playwright or Vite processes from other workspaces before blaming DindbOS.

npm package limits:

```text
npm install <package>
node <file>
```

Only browser-safe JavaScript packages are expected to work. Native addons, lifecycle scripts, broad Node built-ins, peer dependencies, and optional dependencies are intentionally limited until the package trust and sandbox model is hardened.

## Support Policy

Supported browser targets, stability labels, manifest/registry versioning expectations, and local environment safety rules are documented in `docs/support.md`. Runtime changes and pre-tag release notes are tracked in `docs/changelog.md`.

## App Development

Start with `docs/first-app.md` to build and install a small DindbOS package app. Manifest fields and package examples are documented in `docs/app-manifest.md`, and sandboxed app APIs are documented in `docs/app-apis.md`.

## Goal

The goal is to make DindbOS.js useful as an open-source web desktop runtime, while this repository also serves as the canonical demo.
