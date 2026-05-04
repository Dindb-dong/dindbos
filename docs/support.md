# DindbOS Support Policy

## Browser Support

DindbOS is a browser-native runtime. It does not emulate a Linux kernel and it does not bypass browser sandbox rules.

Minimum supported browser target:

- Current Chromium-family browsers are the primary supported target.
- Chrome, Chromium, Edge, and Brave are expected to run the full local development workflow.
- Safari and Firefox may run the static desktop/VFS portions, but are not the full support target until their storage, local folder, and companion behavior is verified separately.

Feature expectations:

- Core desktop, VFS, shell, package records, process table, Viewer.app, and TextEdit should work in modern browsers with IndexedDB and Blob URL support.
- Local folder mounts require the File System Access API, which is currently a Chromium-family workflow.
- Browser.app external browsing requires the optional local `browserd` companion and a local Chromium/Chrome-compatible binary.
- `browserd` is opt-in. The browser runtime must boot and local HTML browsing must still work without it.

## Stability Labels

- Stable: VFS read/write basics, process records, built-in app launch, terminal file commands, package record install/remove, and smoke-tested storage paths.
- Experimental: npm compatibility, NodeCompat, local folder mounts, Browser.app companion browsing, package app entrypoints, and viewer adapters.
- Unsupported: native Node addons, unrestricted host filesystem access, automatic native helper installation, Linux kernel compatibility, and production-grade browser isolation guarantees.

## Versioning Expectations

DindbOS has three versioned surfaces:

- Runtime version: the repository/package version.
- Manifest schema: `dindbos.app.json` fields and app permission declarations.
- Registry format: package index shape and `manifestUrl` entries.

Before a tagged release:

- Breaking manifest changes require a documented migration note in release notes.
- Registry format changes require a version note and backward-compatibility statement.
- Smoke commands in README must match the release.
- Browser support changes must update this document.

Current policy:

- Additive manifest fields are allowed in minor releases.
- Removing or renaming manifest fields is a breaking change.
- Registry entries should keep `id`, `name`, `version`, and `manifestUrl` stable.
- Package trust/signature fields are not stable yet and should be treated as experimental until the trust model lands.

## Local Environment Safety

Do not commit credentials or local environment files.

The repository ignores `.env`, `.env.*`, `node_modules/`, `dist/`, and `.DS_Store`. Commit an `.env.example` only when it contains placeholders and no secrets.
