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

When `app.entry` is present, DindbOS reads that file from `/opt/<package>` and imports it as an ES module. The module should export `mount()` or a default function:

```js
export async function mount({ content, os, pkg, imports }) {
  const lodash = await imports.npm("lodash-es");
  content.textContent = lodash.kebabCase(pkg.name);
}
```

Remote file entries can include `integrity` as `sha256-<base64 digest>`. npm dependencies are browser ESM module URLs, currently resolved through `https://esm.sh`, and are loaded by package apps through `imports.npm()`.
