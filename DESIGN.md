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
