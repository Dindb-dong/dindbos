# DindbOS App Manifest

Packages are installed from `dindbos.app.json`.

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

Remote installs fetch `dindbos.app.json` over `http` or `https`. A remote manifest can declare small package files with inline `content`, UTF-8 `base64`, or a relative/absolute file `url`. Relative file URLs resolve from the manifest URL.

Remote manifests are marked untrusted until package signatures are implemented. `pkg info <package>` shows `trust.source`, `trust.trusted`, and `trust.warnings` so users can see whether an app came from local VFS content or a remote registry/manifest URL.

When `app.entry` is present, DindbOS reads that file from `/opt/<package>` and imports it as an ES module. The module should export `mount()` or a default function:

```js
export async function mount({ content, os, pkg, imports }) {
  const lodash = await imports.npm("lodash-es");
  content.textContent = lodash.kebabCase(pkg.name);
}
```

Remote file entries can include `integrity` as `sha256-<base64 digest>`. npm dependencies are browser ESM module URLs, currently resolved through `https://esm.sh`, and are loaded by package apps through `imports.npm()`.

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
