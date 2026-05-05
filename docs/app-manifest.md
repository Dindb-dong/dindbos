# DindbOS App Manifest

Packages are installed from `dindbos.app.json`.

For the package-author workflow and runtime rules around permissions, filesystem scopes, lifecycle, state, signing, and compatibility, see `docs/developer-guide.md`.

```json
{
  "id": "hello-notes",
  "name": "Hello Notes",
  "version": "0.1.0",
  "description": "A small packaged app.",
  "app": {
    "id": "hello-notes",
    "name": "Hello Notes",
    "title": "Hello Notes.app",
    "icon": "text",
    "width": 560,
    "height": 380,
    "entry": "app.js",
    "runtime": "javascript",
    "content": "# Hello Notes"
  },
  "dependencies": {
    "npm": {
      "lodash-es": "^4.17.21"
    },
    "packages": {}
  },
  "permissions": {
    "capabilities": [],
    "fileSystem": {
      "read": ["/opt/hello-notes"],
      "write": []
    }
  },
  "compatibility": {
    "tier": "A"
  },
  "api": {
    "minVersion": 1,
    "targetVersion": 1,
    "maxVersion": 1
  },
  "files": [
    {
      "path": "app.js",
      "mime": "text/javascript",
      "content": "export function mount({ content }) { content.textContent = 'Hello'; }"
    },
    {
      "path": "README.md",
      "mime": "text/markdown",
      "content": "# Hello Notes\n"
    }
  ]
}
```

Install a package from Terminal:

```text
pkg install /opt/dindbos/packages/hello-notes/dindbos.app.json
pkg install https://example.com/dindbos-packages/hello-notes/dindbos.app.json
pkg search hello
pkg registry add community https://example.com/dindbos-registry.json
pkg install hello-notes
pkg update hello-notes
pkg deps hello-notes
pkg npm add hello-notes lodash-es@4.17.21
pkg list
pkg info hello-notes
```

Installed package records live in `/var/lib/dindbos/packages`. Package files live in `/opt/<package>`. Launchers live in `/usr/share/applications/*.app`.

The runtime includes local sample packages:

- `/opt/dindbos/packages/hello-notes/dindbos.app.json` for a minimal Notes-style package.
- `/opt/dindbos/packages/paint-sample/dindbos.app.json` for a packaged canvas tool.
- `/opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json` for a packaged PDF file-viewer manifest.
- `/opt/dindbos/packages/api-lab/dindbos.app.json` for a third-party API proof that uses sandboxed filesystem, package, and process APIs.

The runtime also seeds installable package templates:

- `/opt/dindbos/templates/template-gui-app/dindbos.app.json` for a JavaScript GUI package.
- `/opt/dindbos/templates/template-cli-app/dindbos.app.json` for a command-oriented JavaScript package with `bin/cli.js`.
- `/opt/dindbos/templates/template-wasm-cli/dindbos.app.json` for a WASI-style WASM CLI package.
- `/opt/dindbos/templates/template-background-worker/dindbos.app.json` for a package with a worker task entry.

Remote installs fetch `dindbos.app.json` over `http` or `https`. A remote manifest can declare small package files with inline `content`, UTF-8 `base64`, or a relative/absolute file `url`. Relative file URLs resolve from the manifest URL.

Remote manifests must pass package signature verification before files, launchers, records, or app registrations are written. `pkg info <package>` shows `trust.source`, `trust.trusted`, `trust.signature`, `trust.publisher`, and `trust.warnings` so users can see whether an app came from local VFS content or a trusted remote publisher.

Packages can declare a required compatibility tier with `compatibility.tier`, `compatibility.requiredTier`, `compatibilityTier`, or `requiredCompatibilityTier`. The current installable tiers are:

- Tier A / `dindbos-js`: DindbOS JavaScript GUI/CLI apps.
- Tier B / `browser-safe-npm`: browser-safe npm programs that fit the NodeCompat surface.

Tier C WASI/WASM programs, Tier D worker-isolated long-running programs, and Tier E broader companion-assisted native-adjacent capabilities are roadmap targets. Package installs that require those unsupported tiers fail before package files, launchers, records, or app registrations are written. `doctor compat` prints the current tier support and unsupported native boundaries.

Packages can also declare the DindbOS runtime API version they target:

```json
{
  "api": {
    "minVersion": 1,
    "targetVersion": 2,
    "maxVersion": 2
  }
}
```

The current runtime supports package API version `1`. If a package declares an exact unsupported version such as `"apiVersion": 2`, install fails before package files, launchers, records, or app registrations are written. If a package declares a compatible range, DindbOS negotiates the highest supported version in that range and stores the result on the installed package record and app manifest as `api.negotiatedVersion`. This lets older packages keep running when the runtime evolves and lets newer packages declare a v1 fallback explicitly.

When `app.entry` is present, DindbOS reads that file from `/opt/<package>`. JavaScript entries are the default and can also declare `"runtime": "javascript"`. The module should export `mount()` or a default function:

```js
export async function mount({ content, os, pkg, imports }) {
  const lodash = await imports.npm("lodash-es");
  content.textContent = lodash.kebabCase(pkg.name);
}
```

Remote file entries can include `integrity` as `sha256-<base64 digest>`. npm dependencies are browser ESM module URLs, currently resolved through `https://esm.sh`, and are loaded by package apps through `imports.npm()`.

WASM package apps can declare `"runtime": "wasm"` or use a `.wasm` entry. DindbOS runs the entry through the browser-native WASM runner, renders stdout/stderr/status into the package window, and applies the package's declared filesystem and capability scopes to the child WASM process. This is the DindbOS ABI runner, not full WASI tier C compatibility yet.

## Manifest Examples

### Simple App

```json
{
  "id": "hello-card",
  "name": "Hello Card",
  "version": "0.1.0",
  "app": {
    "id": "hello-card",
    "name": "Hello Card",
    "title": "Hello Card.app",
    "icon": "app",
    "width": 420,
    "height": 260,
    "content": "Hello from a manifest-only app."
  },
  "permissions": {
    "capabilities": [],
    "fileSystem": {
      "read": ["/opt/hello-card"],
      "write": []
    }
  },
  "files": []
}
```

### File Viewer App

```json
{
  "id": "markdown-viewer",
  "name": "Markdown Viewer",
  "version": "0.1.0",
  "app": {
    "id": "markdown-viewer",
    "name": "Markdown Viewer",
    "title": "Markdown Viewer.app",
    "icon": "viewer",
    "width": 720,
    "height": 520,
    "accepts": ["text/markdown"],
    "entry": "viewer.js"
  },
  "permissions": {
    "capabilities": [],
    "fileSystem": {
      "read": ["/opt/markdown-viewer", "/home/guest"],
      "write": []
    }
  },
  "files": [
    {
      "path": "viewer.js",
      "mime": "text/javascript",
      "content": "export function mount({ content, os }) { content.textContent = 'Open markdown bytes through the app context.'; }"
    }
  ]
}
```

### Package App With Entrypoint

```json
{
  "id": "task-board",
  "name": "Task Board",
  "version": "0.1.0",
  "description": "A package app rendered from /opt/task-board/app.js.",
  "app": {
    "id": "task-board",
    "name": "Task Board",
    "title": "Task Board.app",
    "icon": "app",
    "width": 760,
    "height": 540,
    "entry": "app.js"
  },
  "permissions": {
    "capabilities": [],
    "fileSystem": {
      "read": ["/opt/task-board"],
      "write": ["/home/guest/Documents"]
    }
  },
  "files": [
    {
      "path": "app.js",
      "mime": "text/javascript",
      "content": "export function mount({ content, pkg }) { content.innerHTML = `<h1>${pkg.name}</h1>`; }"
    }
  ]
}
```

### WASM Package App

```json
{
  "id": "wasm-tool",
  "name": "WASM Tool",
  "version": "0.1.0",
  "app": {
    "id": "wasm-tool",
    "name": "WASM Tool",
    "title": "WASM Tool.app",
    "entry": "tool.wasm",
    "runtime": "wasm"
  },
  "permissions": {
    "capabilities": [],
    "fileSystem": {
      "read": ["/opt/wasm-tool"],
      "write": ["/home/guest"]
    }
  },
  "files": [
    {
      "path": "tool.wasm",
      "mime": "application/wasm",
      "base64": "AGFzbQEAAA==",
      "permissions": "-rwxr-xr-x"
    }
  ]
}
```

### App With npm Dependency

```json
{
  "id": "slug-tool",
  "name": "Slug Tool",
  "version": "0.1.0",
  "app": {
    "id": "slug-tool",
    "name": "Slug Tool",
    "title": "Slug Tool.app",
    "entry": "app.js"
  },
  "dependencies": {
    "npm": {
      "lodash-es": "^4.17.21"
    }
  },
  "permissions": {
    "capabilities": [],
    "fileSystem": {
      "read": ["/opt/slug-tool"],
      "write": []
    }
  },
  "files": [
    {
      "path": "app.js",
      "mime": "text/javascript",
      "content": "export async function mount({ content, imports }) { const lodash = await imports.npm('lodash-es'); content.textContent = lodash.kebabCase('Slug Tool'); }"
    }
  ]
}
```
