# Build with an agent

Use a precise target: the existing project, route/container, package version or source tarball, and app you want to expose. Existing authenticated access is not needed for ordinary local SDK installation.

## Installation prompt

> Install dindbOS from SOURCE in this project. Read INSTALL.md, docs/react-apps.md, and docs/customization.md. Preserve the current routes and unrelated files. Mount one desktop in CONTAINER with an explicit height and unique storage name. Add APP through DindbOSApp or defineApp. Use public theme and UI-slot APIs. Build the host, verify real launch and cleanup, and report the source/version and checks run. Do not publish, deploy, or push.

Replace SOURCE, CONTAINER, and APP. When SOURCE is an unpublished checkout, build and install its tarball; do not assume npm has the same API.

## Generated project workflow

```sh
npm exec --package=dindbos -- create-dindbos my-desktop --template react --yes --json
npm exec --package=dindbos -- create-dindbos add app notes --root my-desktop --json
npm exec --package=dindbos -- create-dindbos doctor my-desktop --json
```

The commands return JSON on stdout with `--json`; command errors include `ok: false`, an error, and a nonzero exit. Doctor returns `ok: false` with the failed checks when the project is incomplete. `--dry-run` previews create/add without writing. The CLI never installs dependencies automatically. Preserve `src/apps/index.js` registry markers so app addition stays automatic.

## Working rules

- Inspect the host before changing it. Use existing routing and build patterns.
- Keep runtime code in the dependency. Put content, configuration, and styling in the host.
- Avoid global CSS resets and browser-wide keyboard handlers for a single app.
- Give independent desktops separate storage names. Do not wipe persisted files without explicit authorization.
- Request only the permissions an app uses. Trusted host components do not turn installed packages into trusted code.
- Return cleanup from imperative app renderers and UI slots. Use React effects for React-owned resources.
- Use `useDindbOSApp` for app operations; use host `useDindbOS` only when host integration needs it.

## Completion evidence

Check source/version, exported imports, host build, initial app registration, keyboard launch, close/reopen, minimize/restore state, route unmount, and appearance changes. For storage changes, also save a file and reopen it. For layout changes, inspect desktop and a narrow container. State which browsers and flows you actually checked; a passing build does not verify interaction or animation.
