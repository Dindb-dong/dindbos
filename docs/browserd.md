# DindbOS Browser Companion

`dindbos-browserd` is the local companion for `Browser.app`.

It runs on the user's machine, launches Chromium with the Chrome DevTools Protocol, and exposes a small DindbOS WebSocket protocol:

```text
Browser.app -> ws://127.0.0.1:8787/browser -> browserd -> Chromium CDP
```

Browser.app can also be pointed at a browserd-compatible provider URL with the DindbOS `browserProviderUrl` option or a Browser.app launch context `browserProviderUrl`/`companionUrl`. A `wss://...` provider is health-checked through `https://.../health`; a `ws://...` provider is health-checked through `http://.../health`.

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

The response must include `service: "dindbos-browserd"`, `protocol: "dindbos-browserd.v1"`, and required capabilities such as `browser.navigate`, `browser.input`, and `browser.frames.binary`. If another old local server is already using port `8787`, Browser.app will refuse to connect instead of rendering a broken frame.

## Trust Boundary

`browserd` is an explicit local capability bridge. It is outside the browser sandbox and should be treated differently from ordinary DindbOS app code.

Boundary rules:

- Browser.app may talk to `browserd` only after the `/health` response identifies the expected service, protocol version, and required capabilities.
- Browser.app opens the WebSocket with subprotocol `dindbos-browserd.v1`, and `browserd` refuses `/browser` upgrades that do not request that subprotocol.
- Each Browser.app WebSocket session receives its own Chromium browser context and page target. Cookies, localStorage, and other origin-scoped page state are isolated between sessions.
- Third-party apps should not connect to `browserd` directly. They should open URLs or HTML documents through Browser.app via `os.launch("browser", context)` or `os.openPath(path)`.
- `browserd` is optional. The DindbOS runtime must boot, run local apps, open local HTML files, and keep the desktop usable when the companion is absent.
- Starting `browserd` is a user/developer action from the local machine. Web pages must not attempt to install or launch it automatically.
- The companion can drive a local Chromium instance. Do not expose file helper, download, mount rename, or broader native-adjacent commands through this protocol until those commands have their own capability policy and failure UX.
- The WebSocket protocol should stay narrow: browser navigation, viewport resize, input events, screenshots/frames, and status/error reporting.
- Hosted or remote browser providers are a separate trust boundary from `127.0.0.1` `browserd`. The current Browser.app integration only accepts providers that advertise the expected service, protocol, and capabilities; deployment-level authentication, tenancy, and TLS policy still belong outside this v1 protocol.

## Companion Scope Decision

`browserd` remains a browser-only companion. Its advertised capabilities must stay under the `browser.*` namespace and must not include file helper, download-save, local mount rename, generic native command, or filesystem helper capabilities.

Native-adjacent work is split by boundary:

- Browser downloads stay denied in `browserd` until a separate save/download policy exists.
- Local mount rename belongs to a future mount/file companion with its own service identity, protocol, capabilities, prompts, and failure UX.
- File import/export helpers belong to browser-native APIs first; any native helper must use a separate companion identity instead of expanding `browserd`.
- Remote hosted browser providers are separate from local `browserd` and require their own provider identity/trust model.

Current identity checks are intentionally local and versioned: Browser.app verifies the health service name, protocol version, and required capabilities before opening a WebSocket, then requests the same protocol as a WebSocket subprotocol. This prevents accidental connection to an unrelated or incompatible local server; it is not a full authentication scheme.

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
- `resize { width, height, deviceScaleFactor, mobile }`
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
- One isolated Chromium browser context and target is created per Browser.app WebSocket session.
- The companion must be started manually. Web pages cannot install or launch local native processes automatically.
