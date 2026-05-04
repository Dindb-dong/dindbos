# Build Your First DindbOS App

This guide builds a small package app that installs from `dindbos.app.json`, creates a launcher, and runs through the DindbOS package/runtime path.

## 1. Create The Package Directory

In Terminal.app:

```text
mkdir -p /home/guest/Documents/hello-app
cd /home/guest/Documents/hello-app
```

## 2. Write `dindbos.app.json`

Create this file with TextEdit.app or by importing it through Files.app:

```json
{
  "id": "hello-app",
  "name": "Hello App",
  "version": "0.1.0",
  "description": "A first DindbOS package app.",
  "app": {
    "id": "hello-app",
    "name": "Hello App",
    "title": "Hello App.app",
    "icon": "app",
    "width": 520,
    "height": 320,
    "entry": "app.js"
  },
  "permissions": {
    "capabilities": [],
    "fileSystem": {
      "read": ["/opt/hello-app"],
      "write": []
    }
  },
  "files": [
    {
      "path": "app.js",
      "mime": "text/javascript",
      "content": "export function mount({ content, pkg }) { content.innerHTML = `<section class=\"package-app\"><p class=\"dos-kicker\">Package ${pkg.version}</p><h2>${pkg.name}</h2><p>Hello from a DindbOS package app.</p></section>`; }"
    }
  ]
}
```

The package manager writes the inline `files[0].content` value to `/opt/hello-app/app.js` during install.

## 3. Install And Launch

```text
pkg install /home/guest/Documents/hello-app/dindbos.app.json
pkg info hello-app
open "/usr/share/applications/Hello App.app"
```

Installed package files are copied under `/opt/hello-app`, the package record is written under `/var/lib/dindbos/packages`, and the launcher appears under `/usr/share/applications`.

## 4. Verify

From the repo root outside DindbOS:

```bash
npm run smoke:packages
npm run smoke
```

`npm run smoke:packages` verifies package install rollback and remove cleanup. `npm run smoke` runs the broad runtime confidence gate.

## Next Steps

- Add `accepts` to make a file viewer app.
- Add `dependencies.npm` and use `imports.npm("package-name")` in `mount()`.
- Add scoped file permissions instead of broad filesystem access.
- Inspect `/opt/dindbos/packages/paint-sample/dindbos.app.json` for a packaged canvas tool.
- Inspect `/opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json` for a packaged file viewer that declares `application/pdf`.
- Inspect `/opt/dindbos/packages/api-lab/dindbos.app.json` for a fuller sample that writes a report, reads package metadata, reads its current process, and records a process log through sandboxed runtime APIs.
