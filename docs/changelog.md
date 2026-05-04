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
- Browser.app now keeps a tab session model with active tab state, close/reopen history, and per-tab navigation history in the window state slot.
- Browser.app companion frames now use binary WebSocket payloads plus object URLs instead of base64 data URL transport.
- Browser.app companion identity checks now require the expected health service, protocol version, capabilities, and WebSocket subprotocol before connecting.
- Browser.app keyboard policy now covers Ctrl/Cmd+L address focus, Escape viewport restore, remote Tab/Shift+Tab focus movement, and remote modifier shortcuts.
- `browserd` capability scope is now explicitly browser-only; native-adjacent helpers must use separate companion identities and protocols.
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
- Files.app large tree operations now expose cancellation state and abort checks for recursive copy/move/export paths.
- Files.app copy, move, import, and export naming paths now expose conflict choices for replace, rename, skip, and custom export names.
- Settings.app runtime panels now have smoke coverage proving they read live storage, local mount, process, package, app, and session state.
- Viewer.app toolbar controls, Browser.app handoff for HTML documents, bounded large text previews, and binary fallback messaging.
- Viewer.app sandboxed `.deck.html` preview support for portfolio/demo HTML decks.
- Shell script execution with shebang handling, `PATH` lookup, positional arguments, stdin pipeline support, execute-bit enforcement, escaped quote parsing, empty string arguments, input redirection, and redirected pipeline status.
- Shell `su`/`sudo` placeholders now fail explicitly with browser-runtime fixed-session status instead of implying privilege escalation.
- Package transaction rollback for failed install/update/remove paths.
- Package install smoke coverage for install -> AppRegistry launch -> runtime render -> remove.
- Package app execute boundary is now explicit: JS entry files stay non-executable while `.app` launchers carry execute permission.
- Package manager now verifies signed remote manifests with Ed25519, manages trusted publishers through `pkg trust`, and fails closed before package filesystem mutation for missing, invalid, or untrusted signatures.
- Package lifecycle events now distinguish install, update, first-run, uninstall-cleanup, and uninstall, with lifecycle metadata persisted in package records.
- API Lab sample package now ships under `/opt/dindbos/packages/api-lab` and proves third-party use of sandboxed filesystem, package metadata, current-process, and process-log APIs through package smoke coverage.
- App sandbox now exposes per-app `os.state` JSON persistence backed by `/var/lib/dindbos/app-state`, with relaunch/reload restoration and package uninstall cleanup coverage.
- TextEdit, Viewer.app, and Browser.app now use user-document read scopes instead of root filesystem read scope for file-open paths.
- Session users now get generated `/home/<user>` workspaces with Desktop/Documents/Downloads/Trash directories, matching shell ownership, and built-in app scopes based on the active home.
- VFS path traversal now enforces execute permission on parent directories for reads, writes, stat, copy, move, chmod, and app sandbox resolve/stat/exists paths.
- Local mount writes now detect disk-side changes since the last sync and report `sync-conflict` instead of silently overwriting external file changes.
- Files.app large copy, move, import, and export traversals now yield cooperatively while keeping progress, cancellation, and byte-preservation smoke coverage.
- Viewer.app document and image preview bytes now use the runtime Cache API store with stale-key protection from path, MIME type, size, and modified time.
- NodeCompat support for CommonJS, JSON modules, simple ESM transforms, simple `exports` resolution, nested dependency lookup, and `events`/`node:events`.
- NodeCompat `url`, `util`, and `timers` builtin facades for browser-safe packages.
- NodeCompat `stream` builtin facade for browser-safe `Readable`, `Writable`, `PassThrough`, and `pipeline` usage.
- NodeCompat `crypto` builtin facade for browser-safe SHA-256 hashing and random APIs.
- NodeCompat `assert` and `querystring` builtin facades for browser-safe package compatibility.
- NodeCompat package `exports` resolution now supports explicit root/subpath maps with common `import`, `require`, `browser`, and `default` conditions.
- Process manager activity sampling, crash reports, parent/child process links, and centralized restart behavior.
- AppRegistry crash isolation renders a crash panel and reports failed app render paths to the process manager.
- Explicit `app:*` lifecycle events for install, update, first-run, launch, ready, focus, suspend, resume, crash, close, uninstall-cleanup, and uninstall.
- Window minimize now uses a stable delayed-hide animation state and cancels that state cleanly on focus/restore/close.
- App-facing API docs, app lifecycle docs, Browser companion docs, first app guide, package signature docs, and support policy docs.
- GitHub issue templates and PR verification checklist.

Changed:

- `npm run smoke` is the main local confidence gate and includes boot, storage, persistent storage, Files.app, Settings.app, Viewer.app, Shell, session, permission, package, npm/node, process, local mount, app registry, window manager, browser address, Browser client, and browser companion checks.
- App launcher files now require executable permission before launch.
- Mobile window placement now starts windows maximized inside the viewport instead of restoring oversized desktop coordinates.
- Persistent storage now warns before unload when filesystem writes are pending.

Known limits:

- Package signatures require Web Crypto Ed25519 support for trusted remote installs.
- Browser.app clipboard and download routing policies are not complete.
- Files.app still needs native-helper mount rename.
- PDF viewing still relies on native iframe behavior until PDF.js is introduced.
- NodeCompat is intentionally a browser-safe subset and does not provide native Node addons, arbitrary filesystem access, or full Node runtime APIs.

Release checklist before tagging:

- Run `npm run smoke`.
- Verify Browser.app with and without the local companion.
- Review `docs/support.md` for browser target changes.
- Add migration notes for manifest, package registry, or storage schema changes.
- Confirm no credentials, `.env`, local mount paths, or machine-specific helper paths are committed.
