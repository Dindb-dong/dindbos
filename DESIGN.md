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

## Mobile app navigation (2026-11-04)

- Canvas library document: DindbOS · Portfolio Mobile Navigation, Page 1 (`page-0959dd44-73da-422d-8f68-016cc5dce6a7`). Component board `5b4132bd-0793-4508-9e4b-93c26ce41b96`, main `9135cb80-f7fa-48e9-9862-dc1c1b3cfa8b`, component record `component-e63836fc-600a-4006-b4fc-d42a9b4d5e4c`; mobile screen board `bfb5aa81-4d2b-44c9-930e-d67bf4869ea1`. Reopened from the library to verify persistence.
- `.dos-mobile-tabbar` is a CSS component in `dindbos/styles.css`: a 32px frosted capsule, 6px inset, 4px gaps, 20px icons, 11px labels and 64×52px minimum buttons. The host reserves a bottom row; content never sits behind it. Many destinations scroll horizontally.
- Activate against app container width ≤760px. Preserve desktop sidebars, semantic nav/buttons, keyboard focus, disabled state and opaque accessibility modes. Use existing glass/theme tokens; portfolio supplies its existing blue accent. Canvas reviewed at 390px; implementation checks include 320/390/430px and narrowed desktop windows.

## Shared searchable selector (2026-11-04)

- `renderSearchableSelect` / `mountSearchableSelect` in `src/sdk/searchable-select.js` are public SDK exports, paired with scoped `src/styles/searchable-select.css`. No portfolio code or data is embedded in the library.
- Reuse the verified DindbOS · Portfolio Mobile Navigation canvas: Page 1, searchable board `38e37259-87b3-4278-bdaa-b42223b296fe`, main `8e89f635-69b2-48e5-85a5-0be13b87b5ac`. Updated the options with an always-available All choice. Host controls list/detail navigation and query state; pinned options are generic.
- Controls are 44px high, field radius 12px, menu radius 20px and option radius 14px. Colors inherit desktop tokens with optional `--dos-select-*` overrides. The same component supports mobile and desktop, long names, empty results, keyboard navigation, native dismissal and explicit disposal.
- The existing host rounded dropdown is reused for sorting, documented by board `c84956e2-bae4-4a83-aa34-fbf52556d233`, main `acae9829-f4aa-4e26-8c05-860ec2c3b73b`, component `component-1ec67bc4-8435-4e1d-911c-44f5dc32d959`. No native select popup styling is assumed.
