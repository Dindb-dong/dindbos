# iOS-inspired mobile shell

Select `ui: { style: "ios" }` for a mobile-only shell, or keep a desktop style and supply `mobileStyle: "ios"`. Selection uses the desktop host's width, with a 760 CSS pixel breakpoint; a wide host falls back to its desktop style. This is a DindbOS browser interface, not Apple's operating system.

## Official research and implementation decisions

Sources were reviewed on November 10, 2026. Apple's public HIG describes application design; it does not prescribe a third-party Home screen clone. The app grid, horizontally scrollable Dock, and clickable Home indicator below are DindbOS design choices. They reuse the project's original icons and wallpaper, with no Apple logo, bundled font, status indicators, or system artwork.

| Official source | Guidance used | DindbOS adaptation |
| --- | --- | --- |
| [Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Preserve visual hierarchy, group related controls, adapt to available size, and protect important controls from hardware and system overlays. | Four-column Home grid, full-width foreground app, safe-area insets around top and bottom chrome, and scrolling where content exceeds the host. |
| [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) | Make actions identifiable and give them sufficient surrounding space; general guidance recommends a 44 × 44 point hit region. | Shell actions and Home use at least 44 × 44 CSS pixels, with visible keyboard focus and accessible names. CSS pixels are a web adaptation, not a physical-point equivalence guarantee. |
| [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Support adequate contrast, readable text, and reduced motion; do not rely exclusively on visual effects. | Reuse light/dark semantic surfaces, labeled native buttons, accessible search, and `prefers-reduced-motion`. No gesture is the only route to an action. |
| [Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Motion should explain state and remain optional. | Reuse existing app opening/minimizing, disable spatial shell transitions with reduced motion, and avoid an extra Home animation system. |

## Behavior and compatibility

- Home dismisses the current shell panel and minimizes every visible window, preserving the app process, component state, and unsaved drafts. Reopen an app through the grid, Dock, or Search.
- One foreground app occupies the content area. Background frames stay mounted. The bottom Home button remains reachable; the Dock and Home Search pill appear on Home.
- Search opens the existing application launcher. Control Center, calendar, system menu, and compact application menus retain their existing behavior. The titlebar close action still uses the window manager's existing close and unsaved-change handling.
- Pinned apps remain reachable through a horizontally scrollable Dock rather than being silently dropped after the fourth item. Desktop filesystem entries remain available alongside installed applications.
- Supplied desktop and menubar slot renderers are retained. The adapter adds its own Home affordance and adds the Search pill only for the default desktop.
- Resizing back to a desktop layout removes iOS controls and listeners without resetting application state. CSS is confined to the selected DindbOS host.

## Verification boundaries

`node scripts/smoke-platform-ios.js` checks Home behavior, draft preservation, repeated activation, transition cleanup, and custom desktop slot handling. Browser integration should also check 320/390 pixel hosts, app launch → Home → restore, light/dark mode, reduced motion, narrow embedded hosts, resizing, and coexistence with another desktop.

Physical iPhone Safari, VoiceOver, virtual keyboard occlusion, device cutouts, and gesture navigation require device validation. Browser chrome and OS Home gestures remain under the real operating system's control.
