# __PROJECT_NAME__

A web desktop built with [dindbOS](https://github.com/Dindb-dong/dindbos).

```sh
npm install
npm run dev
npm run build
```

Edit `dindbos.config.js` for appearance, initial files, builtins, and storage. Give each embedded desktop its own storage name unless sharing is intentional.

Apps live in `src/apps/` and are registered in `src/apps/index.js`.

```sh
npm exec --package=dindbos -- create-dindbos add app notes --yes --json
npm exec --package=dindbos -- create-dindbos doctor --json
```

The CLI does not install dependencies or overwrite existing files by default. For a project owned by you, install the generated dependencies and run its build before shipping. See `AGENTS.md` for agent instructions.

The starter uses browser storage and does not register a Service Worker automatically. Some optional browser APIs require HTTPS, user permission, or host-provided isolation headers.
