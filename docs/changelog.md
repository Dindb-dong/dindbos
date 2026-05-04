# DindbOS Changelog

This changelog tracks user-visible runtime changes before tagged releases.

## Unreleased

Date: 2026-05-04

Release posture:

- DindbOS is a browser-native OS runtime, not a cosmetic desktop mockup.
- The supported proof points are durable files, app launch, shell execution, package installs, process visibility, permission checks, and Browser.app companion handoff.
- Browser.app external browsing depends on the optional local `browserd` companion. Without it, Browser.app still handles local HTML documents through the in-browser viewer path.

Added:

- Browser.app companion client and `scripts/browserd.js` for real Chromium-backed page navigation through an explicit local boundary.
- Browser.app connection health, reconnect, and failure handling smoke coverage.
- Browser.app local VFS HTML sandbox policy that allows document scripts/forms/popups while denying same-origin and top-navigation privileges.
- Browser.app companion download policy blocks Chromium downloads and reports the suggested filename as an in-app status.
- Browser.app clipboard paste forwarding from Ctrl/Cmd+V into remote companion pages through the explicit text insertion protocol.
- Browser.app now snapshots address/title/status/frame/local-document state into the window state slot so minimize/focus/activate restore paths keep visible browser state.
- Browser.app companion frames now use binary WebSocket payloads plus object URLs instead of base64 data URL transport.
- Explicit runtime boot phase diagnostics for storage load, VFS mount, package registry load, app registry load, process init, and desktop render, persisted under `/var/log/dindbos`.
- Recoverable storage-load and VFS mount restore failures now continue booting with `recovered` boot phase diagnostics.
- Disk policy areas for `/home`, `/opt`, `/var`, `/var/cache`, `/tmp`, and `/mnt`, exposed through runtime APIs and `df`.
- Persistence lifecycle flush coverage for `beforeunload`, `pagehide`, and hidden-tab visibility changes.
- Runtime Cache API store with memory fallback for npm metadata/tarballs and remote package manifests/files.
- Files.app import/export archive support with nested binary byte preservation.
- Files.app local mount banners, reconnect/sync/forget controls, operation progress, and recent operation history.
- Files.app rich search filters for text, type, extension, size, modified time, and path.
- Files.app multi-select with Ctrl/Cmd toggle, Shift range selection, and multi-item Trash/Delete targeting.
- Files.app keyboard navigation for row movement, folder traversal, open, Trash, rename, and copy/paste shortcuts.
- Viewer.app toolbar controls, Browser.app handoff for HTML documents, bounded large text previews, and binary fallback messaging.
- Viewer.app sandboxed `.deck.html` preview support for portfolio/demo HTML decks.
- Shell script execution with shebang handling, `PATH` lookup, positional arguments, stdin pipeline support, execute-bit enforcement, escaped quote parsing, empty string arguments, input redirection, and redirected pipeline status.
- Shell `su`/`sudo` placeholders now fail explicitly with browser-runtime fixed-session status instead of implying privilege escalation.
- Package transaction rollback for failed install/update/remove paths.
- Package install smoke coverage for install -> AppRegistry launch -> runtime render -> remove.
- Package app execute boundary is now explicit: JS entry files stay non-executable while `.app` launchers carry execute permission.
- NodeCompat support for CommonJS, JSON modules, simple ESM transforms, simple `exports` resolution, nested dependency lookup, and `events`/`node:events`.
- NodeCompat `url`, `util`, and `timers` builtin facades for browser-safe packages.
- NodeCompat `stream` builtin facade for browser-safe `Readable`, `Writable`, `PassThrough`, and `pipeline` usage.
- NodeCompat `crypto` builtin facade for browser-safe SHA-256 hashing and random APIs.
- NodeCompat package `exports` resolution now supports explicit root/subpath maps with common `import`, `require`, `browser`, and `default` conditions.
- Process manager activity sampling, crash reports, parent/child process links, and centralized restart behavior.
- AppRegistry crash isolation renders a crash panel and reports failed app render paths to the process manager.
- Explicit `app:*` lifecycle events for install, launch, ready, focus, suspend, resume, crash, close, and uninstall.
- Window minimize now uses a stable delayed-hide animation state and cancels that state cleanly on focus/restore/close.
- App-facing API docs, app lifecycle docs, Browser companion docs, first app guide, package signature plan, and support policy docs.
- GitHub issue templates and PR verification checklist.

Changed:

- `npm run smoke` is the main local confidence gate and includes boot, storage, persistent storage, Files.app, Viewer.app, Shell, permission, package, npm/node, process, local mount, app registry, window manager, browser address, Browser client, and browser companion checks.
- App launcher files now require executable permission before launch.
- Mobile window placement now starts windows maximized inside the viewport instead of restoring oversized desktop coordinates.
- Persistent storage now warns before unload when filesystem writes are pending.

Known limits:

- Package signatures are documented but not yet enforced.
- Cache API-backed package/npm caching exists; document and image preview caching is not implemented.
- Browser.app clipboard and download routing policies are not complete.
- Files.app still needs conflict dialogs, large tree cancellation, and native-helper mount rename.
- PDF viewing still relies on native iframe behavior until PDF.js is introduced.
- NodeCompat is intentionally a browser-safe subset and does not provide native Node addons, arbitrary filesystem access, or full Node runtime APIs.

Release checklist before tagging:

- Run `npm run smoke`.
- Verify Browser.app with and without the local companion.
- Review `docs/support.md` for browser target changes.
- Add migration notes for manifest, package registry, or storage schema changes.
- Confirm no credentials, `.env`, local mount paths, or machine-specific helper paths are committed.
