# Android mobile shell

The `android` preset is a Samsung One UI-inspired browser shell designed for compact hosts. Automatic selection defaults to it for narrow macOS hosts and portrait iOS visitors, then Windows in iOS landscape. Consumers can force a preset or change these defaults through `ui.autoStyles`; see [customization](customization.md). It preserves DindbOS apps, files, permissions and running windows. It is not Samsung software or an Android emulator.

## Official research and design decisions

Reviewed 10 November 2026. The following pages describe platform conventions; the browser adaptation below is our interpretation.

| Official reference | Verified guidance | DindbOS adaptation |
| --- | --- | --- |
| [Samsung: Basic layout](https://developer.samsung.com/one-ui/layout/basic.html) | Separate an upper viewing area from a lower interaction area; group related actions. | A quiet workspace heading, grouped app content, and reachable primary controls. App handlers and data remain the existing DindbOS implementations. |
| [Samsung: Grid system](https://developer.samsung.com/one-ui/layout/grid.html) | Use at least 24 dp side margins, account for cutouts, and adapt to different screen sizes. | 24 CSS px home margins, responsive icon columns and safe-area environment insets. CSS pixels approximate the web layout, not physical Android dp calibration. |
| [Samsung: Navigation bar](https://www.samsung.com/us/support/answer/ANS10002427/) | The classic order is Recents, Home, Back. Recents displays recently opened apps; Home returns to the home screen; Back returns to a prior screen. | Three persistent controls in that order. Recents lists real running windows. Home minimizes windows without closing them. Back dismisses shell panels, offers an app navigation event, then returns Home. |
| [Android: Accessible controls](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views) | Recommend at least 48 × 48 dp touch areas and meaningful descriptions. | At least 48 CSS px navigation targets, named controls, visible keyboard focus and a host-scoped dialog. |
| [Android: Edge-to-edge layouts](https://developer.android.com/develop/ui/views/layout/edge-to-edge) | System bars can overlap content; account for insets and visual overlap. | Reserve top and bottom space with CSS safe-area insets so app content and navigation remain separate. |

Rounded groups and a restrained palette use existing DindbOS theme tokens. The Android preset includes original colorful squircle artwork for every built-in app and common file types; custom host icons remain supported. No Samsung fonts, logos, wallpaper, battery percentage or cellular indicators are copied or simulated.

## Built-in app interiors

The target is One UI 9-era published Samsung app conventions. Samsung announced the [official One UI 9 rollout on 16 September 2026](https://news.samsung.com/global/samsung-begins-official-rollout-of-one-ui-9-bringing-the-latest-galaxy-experiences-to-more-devices). Individual support screenshots are not all version-labeled; this adaptation does not claim pixel parity with every regional app release.

| App | Adaptation and retained behavior | Official reference |
| --- | --- | --- |
| Files | My Files-style amber icons, location chips, readable file rows, wrapping actions; original tabs, upload, inspector and file actions. | [My Files](https://www.samsung.com/us/support/answer/ANS10002531/) |
| Settings | Search and grouped category rows lead to a separate detail pane with Back; original settings and permissions remain reachable. | [One UI layout](https://developer.samsung.com/one-ui/layout/basic.html) |
| Notes | Warm note cards lead to the original editor; New note, search, Back, editing and draft state remain available. | [Samsung Notes](https://www.samsung.com/us/support/answer/ANS10001384/) |
| Reminders | Four smart-list tiles, full-width tasks and a reachable date/create form; completion and filtering remain real. | [One UI app bar](https://developer.samsung.com/one-ui/comp/app-bar.html) |
| Browser | Capsule address field, 48 px navigation and exposed tabs; existing navigation policy and permissions remain in force. | [Samsung Internet controls](https://www.samsung.com/us/support/answer/ANS10001594/) |
| Calculator | Green operation keys, separate result and four-column keypad; existing history and arithmetic. | [Clock and Calculator](https://www.samsung.com/us/support/answer/ANS10002547/) |
| Calendar | Month grid above a selected-day agenda; original event creation and navigation. | [Samsung Calendar](https://www.samsung.com/au/support/mobile-devices/how-to-add-and-manage-events-using-the-calendar-app-on-your-samsung-galaxy-phone/) |
| Clock | Large stacked city times and bottom mode tabs; world map, city selection, stopwatch and timer remain available. | [Clock and Calculator](https://www.samsung.com/us/support/answer/ANS10002547/) |
| Photos | Gallery-style content grid with reachable library and image actions; original import, export, zoom and deletion. | [Gallery](https://www.samsung.com/us/support/answer/ANS10002535/) |
| Music | Searchable song list and a full-width playback card; real selection, playback, seek and volume controls. | [One UI layout](https://developer.samsung.com/one-ui/layout/basic.html) |
| Text | Readable 16 px editor and reachable save action; original document editing and persistence. | [One UI app bar](https://developer.samsung.com/one-ui/comp/app-bar.html) |
| Viewer | Wrapping document actions and readable content; original zoom, download and supported document rendering. | [One UI app bar](https://developer.samsung.com/one-ui/comp/app-bar.html) |
| Applications | Searchable three-column app drawer and original Android icon artwork; original launching/filtering. | [Samsung iconography](https://developer.samsung.com/one-ui/iconography/color.html) |
| Terminal | Dark readable terminal surface with reachable toolbar; original terminal input, history and commands. | [One UI layout](https://developer.samsung.com/one-ui/layout/basic.html) |
| Activity Monitor | Grouped filter toolbar, PID/app/state process table, and runtime statistics footer; original process inspection and actions. | [One UI layout](https://developer.samsung.com/one-ui/layout/basic.html) |
| Portfolio | Large heading and stacked cards around the host's existing content. The integration fixture displays the DindbOS runtime introduction and Runtime/Web OS card. | [One UI layout](https://developer.samsung.com/one-ui/layout/basic.html) |

Utilities without a Samsung counterpart use the same layout grammar without claiming native Samsung capabilities. Styles are limited to the active Android host, preserve nested host boundaries, and use existing light/dark appearance state. Notes and Settings share a small reversible mobile navigation adapter; no app renderer or business logic is duplicated. The existing Liquid Glass engine is unchanged.

## Interaction contract

- Home preserves process and component state by minimizing every visible window.
- Recents shows horizontally draggable, snapping cards with inert snapshots of the actual running app content. Tap a card to restore its existing window, swipe it up to close through the guarded window lifecycle, or use Close all. Keyboard arrows navigate cards; each card has an accessible close action. A nonmodal `dialog` contains keyboard Tab focus, supports Escape dismissal and returns focus to its trigger. Other embedded desktops remain usable. External embedded frames show a labeled placeholder because their content cannot be safely cloned.
- Back first closes an open shell panel. Otherwise the active app content receives a bubbling, cancelable `dindbos:back` event. Calling `preventDefault()` signals that the app handled its internal navigation. Without an app handler, Back goes Home without closing or discarding the app.
- The wallpaper home uses four icon columns (five from 440px), a search bar, four pinned Dock apps and transparent Back/Home/Recents navigation. Search and status controls reuse the existing launcher and appearance controls.
- Active app windows fill the available mobile workspace. Desktop caption controls are replaced by system navigation.

The mobile preset is selected by the host configuration; it does not detect the visitor's operating system. Native Android predictive-back animation, OS app switching, hardware keys, notification permissions, and device status are outside this browser shell's scope.

## Verification

`node scripts/smoke-platform-android.js` checks Home state preservation, shell-panel dismissal, cancelable app Back handling, and the safe fallback. Browser rendering and real-device accessibility require the integration checks recorded with the platform-shell change.

`CHROME_PATH=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome node scripts/smoke-platform-android-apps.js` uses a temporary local Vite server and the existing Playwright dependency. It captures all 16 app surfaces, checks calculator arithmetic, Notes editing/Home restoration/Back navigation, Settings navigation, browser errors, and selected 320 px dark layouts. `DINDBOS_QA_URL` can target an existing server. Real Galaxy hardware, regional Samsung app packages, TalkBack, IME and media codec coverage remain outside this local-browser check.
