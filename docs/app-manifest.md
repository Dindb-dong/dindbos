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
    "content": "# Hello Notes"
  },
  "permissions": {
    "capabilities": [],
    "fileSystem": {
      "read": ["/opt/hello-notes"],
      "write": []
    }
  }
}
```

Install a package from Terminal:

```text
pkg install /opt/dindbos/packages/hello-notes/dindbos.app.json
pkg list
pkg info hello-notes
```

Installed package records live in `/var/lib/dindbos/packages`. Package files live in `/opt/<package>`. Launchers live in `/usr/share/applications/*.app`.
