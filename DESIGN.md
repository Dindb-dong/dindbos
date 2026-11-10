# dindbOS design system

dindbOS is an embeddable desktop, inspired by the precision and interaction grammar of macOS Tahoe 26. Its default appearance is a quiet green alpine desktop with glass navigation above readable, mostly opaque app content. All appearance belongs to a desktop instance; the embedding page is never reset.

## Reference and hierarchy

- Primary reference: [Build an AppKit app with the new design, WWDC25](https://developer.apple.com/videos/play/wwdc2025/310/). Glass belongs to floating controls, navigation, sidebars and system panels. Text and document content need a stable backing.
- The menu bar is 30 px high and touches the top edge. App menus live at the left; system controls and clock live at the right.
- Window titlebars are 40 px high. Close, minimize and zoom controls are at the left, ordered red, yellow, green, with 12 px circles, 8 px gaps and a 14 px inset. Window titles are centered when space allows.
- Windows use a 14 px radius; panels 12 px; controls 6 px; Dock 22 px. Toolbar groups can use capsule shapes where they contain related actions.
- Sidebars should remain compact, typically 164–196 px. Inspectors are optional. A file list must remain usable at the default window size.

## Tokens

Use only these font, color, spacing and motion tokens for new UI. Existing aliases remain available for compatibility.

| Role | Token / value |
| --- | --- |
| UI font | `var(--font-ui)`: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif |
| Code font | `var(--mono)`: SF Mono, Menlo, Consolas, monospace |
| Body / secondary / label | 13 px / 12 px / 11 px |
| Spacing | 4, 8, 12, 16, 24, 32 px |
| Default accent | `--accent: #287a58` |
| Main text / secondary | `--text`, `--muted` |
| Document content | `--content-bg` |
| Window chrome / sidebar | `--chrome-bg`, `--sidebar-bg` |
| Lines / selection | `--line`, `--accent-soft` |
| Window / menu shadows | `--window-shadow`, `--menu-shadow` |
| Quick / normal / large motion | `--motion-fast: 130ms`, `--motion-normal: 220ms`, `--motion-slow: 380ms` |
| Motion curve | `--ease-out: cubic-bezier(.2,.8,.2,1)` |

`[data-appearance="light"]` and `[data-appearance="dark"]` on `.dindbos-host` control the palette. Resolve system preference in the runtime, rather than letting independent media queries override the user's selection. Theme values are inheritable CSS custom properties, not global `:root` declarations. An inline host token wins over defaults.

## Interaction and states

- Buttons have quiet default surfaces, an observable hover, an immediate pressed state, and a visible keyboard focus ring. Disabled controls retain their shape and reduce emphasis; do not communicate state by color alone.
- Active windows have a stronger shadow, clear title and colored traffic lights. Inactive windows have a quieter shadow and controls. A click activates a window before routing its interaction.
- Desktop icons support double click and Enter; touch uses a single tap. Labels truncate or wrap at intentional boundaries, never split an extension into a one-letter line.
- Dock icons retain their identity at all sizes. Running indicators, minimized state, tooltip and focus are distinct. Hover magnification must not change layout geometry.
- Opening, minimizing and restoring should preserve their source and destination. Interrupting an animation must cancel the old transition before starting a new one. Reduced motion removes spatial movement and long staged entrances.
- Menus, drawers and dialogs support Escape, outside dismissal where appropriate, and return focus to the invoking control. There must be no inaccessible hover-only action.
- Empty, loading, error, long-name and small-window states are part of the component. Short-lived feedback uses one accessible toast; durable errors stay beside the affected task.

## Embedding and responsive behavior

- `.dindbos-host` is the containing block and CSS size container. Consumers supply a height; the demo supplies viewport height separately. No library rule may change `html` or `body`.
- Legacy styles are under `@scope (.dindbos-host) to (.dindbos-host)`. New styles use the same scope boundary. Host tokens can inherit; selectors cannot escape to the page or a nested desktop.
- Use container widths for desktop layout. A narrow desktop uses full-width app windows and compact navigation, even when the surrounding browser is wide.
- Do not hide essential tools to make a screenshot fit. Overflow menus and horizontal scrolling are preferable to unreachable controls.
- Files uses compact icon tools, a short folder title, view/sort menus and a quiet path bar. The current folder column stays visible after resize. Drag instructions appear during dragging rather than consuming a permanent row.
- Browser gives the document priority: proportional address text, icon navigation and per-tab close controls. Connection diagnostics live behind Connection → Advanced; actionable failures remain visible. Closing a background tab preserves the active document and its input state.
- Right-click works across the desktop background, its gutters, file rows and empty folder space. Menus stay inside the host, support keyboard access and restore focus on dismissal.

## Assets and composition

The default meadow photograph is original generated artwork bundled in `src/styles/wallpapers/meadow.jpg`. The original SVG alpine illustration remains available as `--wallpaper-alpine` in `theme.css`; both work without external requests or attribution. Wallpaper, accent, density and icon artwork can be replaced by a consumer. Do not ship Apple logos, screenshots, fonts or wallpaper as library assets.

Avoid decorative dashboards, rainbow gradients, glass behind every paragraph, excessive blur, nested cards, oversized typography, repeated diagnostics at the top of apps, and layout animations on every pointer movement. Polish comes from consistent geometry, readable content and dependable state transitions.

## Verification

Inspect actual desktop and mobile rendering, a narrow embedded desktop, light and dark appearances, active and inactive windows, keyboard focus, menus, long names and app errors. Observe motion while interacting; a still image cannot establish animation quality. Check two desktop instances and the surrounding page for style and event leakage. The design is complete only after the integrated screen follows these rules.

## Consumer Dock tokens

`theme.variables` exposes `--dock-background`, `--dock-border`, `--dock-radius`, `--dock-shadow`, `--dock-gap`, `--dock-padding` and `--dock-bottom`. Omitted values preserve the existing desktop and narrow-container defaults; glass and dark appearance honor the same overrides. Reduced transparency and forced colors retain opaque readable material. This API wiring and performance maintenance do not introduce a new visual design. Wallpaper and accent use the existing appearance API; full replacement uses `ui.slots.dock`.

## Platform shells

### Visitor style controls

The system menu offers a direct switch within the current UI family: macOS/Windows or iOS/Samsung. Settings → Appearance exposes Desktop UI and Mobile UI groups, each with Automatic and its two named presets. Each group remembers its own choice under the instance storage key; Automatic restores the consumer's configured selection. The configured UI determines the family during resizing/rotation, so a manual mobile preference does not replace the landscape desktop. Changes reuse the responsive shell transition and preserve open apps and drafts. Controls use existing semantic tokens, 44px targets, wrapping rows and `aria-pressed`; keyboard focus remains reachable after a transition.

The editable source is the existing **DindbOS · iOS Apps · Reviewed** document, **Components / UI style switching** board with a reusable Desktop/Automatic group and linked instance. The same controls are composed inside each platform's existing Settings appearance panel. Local IDs and rendered comparison evidence remain in the private evaluation record.

`ui.style` defaults to `auto`. macOS visitors receive Windows on wide hosts and Samsung-inspired Android on compact hosts; Windows visitors receive macOS and iOS. Detected Android visitors receive iOS in portrait and macOS in landscape; iOS/iPadOS visitors receive Samsung-inspired Android and Windows. Unknown visitors retain macOS. Desktop selection uses the760px host breakpoint; mobile orientation uses the host width/height. `ui.autoStyles` overrides any visitor's desktop/mobile defaults, explicit named styles force a preset at all sizes, and `ui.mobileStyle` optionally overrides the compact choice. Palette, wallpaper and app state remain instance-owned.

The editable project document is **DindbOS · Platform Shells**, page **Page 1**. Its platform foundations, linked navigation components, and desktop/mobile compositions define the preset designs. Maintained source references and component-to-code decisions live in [Windows](docs/platform-windows.md), [iOS](docs/platform-ios.md), and [Android](docs/platform-android.md). Each preset's adapter is in `src/ui/platforms/` and its scoped stylesheet is `src/styles/platform-*.css`. Local canvas IDs, captures, persistence checks, and runtime comparisons are kept in the project's private evidence record.

Windows uses a bottom taskbar, Start launcher, tray and right-aligned caption controls. iOS uses a compact status/navigation area, app-focused fullscreen layout and a state-preserving Home action. Samsung-inspired Android uses a reachable home layout and Back/Home/Recents navigation. All use existing runtime application, window and panel actions. These are web adaptations of published design guidance; no vendor logos, fonts or wallpapers are bundled. Desktop app chrome and functions remain available within the mobile layout.

Compare the Windows board at desktop size and each mobile board at 390 CSS pixels. Verify 320px, 760px and 761px boundaries, narrow embedded hosts, keyboard navigation, dark mode, reduced motion, Home/restore state preservation and repeated responsive transitions. Native device behavior requires separate physical-device evidence.

### Platform app interiors

Every existing built-in app uses the selected shell's visual language: Files, Applications, Terminal, Activity Monitor, TextEdit, Browser, Viewer, Calculator, Settings, Notes, Reminders, Calendar, Clock, Photos, Music, and Portfolio. Existing app actions, storage and permissions remain shared. Platform styles live in `src/styles/platform-{windows,ios,android}-apps.css`; no platform stylesheet applies to the default macOS host.

The editable sources are separate Canvas documents **DindbOS · Windows 11 Apps**, **DindbOS · iOS Apps · Reviewed**, and **DindbOS · Samsung One UI Apps · Verified runtime**. Each includes foundations, reusable linked components, and app compositions; the corresponding platform reference document records current official sources and adaptation boundaries. Local canvas IDs, saved-state readbacks, screenshots and comparisons remain in private evaluation records.

Mobile Notes and Settings use a shared `mountMobileAppNavigation` decorator to expose list/detail navigation, including Android system Back and Notes keyboard creation. The decorator delegates to the existing app controls, preserves draft state and save-error recovery, respects trusted prompts and nested desktop ownership, and removes its buttons and pane attributes when the host switches back to a desktop style. Mobile Files uses a compressed current-path row and a host-contained Locations sheet for ancestors, Favorites and other locations, with readable dark controls and keyboard focus restoration. The editable breadcrumb/Locations main and linked instance are in the reviewed iOS document's component board. Layout changes must keep every pre-existing command reachable; no action may be hidden merely to resemble a screenshot.

The evaluation fixture in `scripts/fixtures/platform-apps.html` supplies isolated memory-backed documents, notes, reminders, events, and media. `npm run smoke:platform-apps` exercises every app in each platform at desktop/mobile widths, captures light and dark UI with the existing glass engine, verifies narrow host containment, and records actual app workflows. Browser captures supplement the Canvas review and code review; neither replaces real-device evaluation.

Original platform SVG artwork replaces the shared macOS icon silhouettes on Windows, iOS and Android. The icon renderer follows the nearest desktop host, including responsive changes, while preserving host-provided React and image icons. Desktop, Dock/taskbar, launcher, Applications and in-app registered-app icons use the same renderer. Windows keeps one taskbar material; its inner app strip is transparent even while the existing glass adapter decorates other shell surfaces.


### Reference-driven mobile home and recent apps

The **Mobile reference correction / Home and Recents** board in **DindbOS · Platform Shells**, Page 1, supersedes the earlier mobile home compositions. The shared **Mobile / Recent app card** main defines the rounded preview surface. Android uses a four-column grid (five at 440px), wallpaper-first status/navigation, a full-width search capsule, and four Dock apps. iOS retains four columns with 60px icons, a translucent Dock and an Experience folder with a 2×2 miniature app preview. No workspace heading or unrelated dashboard is added. Existing wallpapers and app artwork remain authoritative; reference photos and vendor assets are not bundled.

`desktop-view.js` composes app/folder entries, `platform-android.css` and `platform-ios.css` define home geometry, and `recent-apps.js` plus `platform-recents.css` provide horizontal card dragging, snapping, restore, and upward guarded dismissal. iOS uses its bottom Home region for short Home swipes and recent-app swipes/holds. Reduced motion, keyboard close/restore, trusted prompts, drafts, and nested host boundaries remain required. External frames receive labeled placeholders rather than fabricated previews. Local board IDs and runtime evidence are retained in the private evaluation record.
