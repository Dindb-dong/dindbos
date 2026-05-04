# DindbOS Browser Companion

`dindbos-browserd` is the local companion for `Browser.app`.

It runs on the user's machine, launches Chromium with the Chrome DevTools Protocol, and exposes a small DindbOS WebSocket protocol:

```text
Browser.app -> ws://127.0.0.1:8787/browser -> browserd -> Chromium CDP
```

Run it during development:

```text
npm run browserd
```

Options:

```text
node scripts/browserd.js --port 8787 --cdp-port 9223
node scripts/browserd.js --headful
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run browserd
```

Health check:

```text
curl http://127.0.0.1:8787/health
```

The response must include `service: "dindbos-browserd"`. If another old local server is already using port `8787`, Browser.app will refuse to connect instead of rendering a broken frame.

## Trust Boundary

`browserd` is an explicit local capability bridge. It is outside the browser sandbox and should be treated differently from ordinary DindbOS app code.

Boundary rules:

- Browser.app may talk to `browserd` only after the `/health` response identifies `service: "dindbos-browserd"`.
- Third-party apps should not connect to `browserd` directly. They should open URLs or HTML documents through Browser.app via `os.launch("browser", context)` or `os.openPath(path)`.
- `browserd` is optional. The DindbOS runtime must boot, run local apps, open local HTML files, and keep the desktop usable when the companion is absent.
- Starting `browserd` is a user/developer action from the local machine. Web pages must not attempt to install or launch it automatically.
- The companion can drive a local Chromium instance. Do not expose file helper, download, mount rename, or broader native-adjacent commands through this protocol until those commands have their own capability policy and failure UX.
- The WebSocket protocol should stay narrow: browser navigation, viewport resize, input events, screenshots/frames, and status/error reporting.
- Future hosted or remote browser providers must use a separate provider identity and trust model. Do not treat a remote provider as equivalent to `127.0.0.1` `browserd`.

Current identity checks are intentionally simple: Browser.app verifies the health service name before opening a WebSocket and refuses non-DindbOS services on the same port. This prevents accidental connection to an unrelated local server; it is not a full authentication scheme.

## Connection Policy

Browser.app uses a hybrid connection policy:

- Opening an empty Browser.app window does not auto-connect. The user can press `Connect` after starting `browserd`.
- Submitting an external URL in the address bar connects automatically, then navigates.
- Launching Browser.app with a URL context connects automatically, then navigates.
- Opening a local VFS HTML file never starts `browserd`; it renders through the internal sandboxed iframe provider.
- After an unexpected disconnect, the toolbar changes to `Reconnect` and the next connection creates a fresh WebSocket.

Smoke test:

```text
npm run smoke:browserd
npm run smoke:browserd-failures
```

The main smoke test starts `browserd` on temporary ports, verifies the health check, opens a WebSocket session, navigates Chromium to a local `data:` HTML page, and fails unless a real binary JPEG frame is received. The failure smoke test verifies missing Chrome, CDP startup failure, and WebSocket drop behavior.

Run all local syntax and browser companion checks:

```text
npm run smoke
```

Performance knobs:

```text
DINDBOS_BROWSERD_FRAME_INTERVAL_MS=100
DINDBOS_BROWSERD_JPEG_QUALITY=58
DINDBOS_BROWSERD_MAX_FRAME_WIDTH=1280
DINDBOS_BROWSERD_MAX_FRAME_HEIGHT=900
```

Protocol commands:

- `navigate { url }`
- `reload`
- `back`
- `forward`
- `resize { width, height, deviceScaleFactor }`
- `click { x, y }`
- `type { text }`
- `key { key, code, modifiers }` where modifiers follow CDP bit flags: Alt `1`, Ctrl `2`, Meta `4`, Shift `8`.
- `scroll { deltaX, deltaY, x, y }`
- `capture`

Server events:

- `status`
- `frame` as a binary WebSocket message. The first four bytes are a big-endian JSON header length, followed by a UTF-8 JSON header with `type: "frame"`, `mime`, `url`, `title`, and `transport: "binary"`, followed by the JPEG bytes.
- `error`

Current limits:

- The browser frame is a throttled Chromium screencast stream, not GPU/WebRTC video.
- Keyboard input covers printable text, common special keys, and modifier metadata, but full browser shortcut/focus policy is still limited.
- One Chromium target is created per Browser.app WebSocket session.
- The companion must be started manually. Web pages cannot install or launch local native processes automatically.
