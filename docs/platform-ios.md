# iOS-inspired mobile shell

Select `ui: { style: "ios" }` to force an iOS-inspired shell, or combine a desktop style with `mobileStyle: "ios"`. Automatic selection defaults to iOS for narrow Windows hosts and portrait Android visitors, then macOS in Android landscape. Consumers can change these rules through `ui.autoStyles`; see [customization](customization.md). This is a DindbOS browser interface, not Apple's operating system.

## Official research and implementation decisions

Sources were reviewed on November 10, 2026. Apple's public HIG describes application design; it does not prescribe a third-party Home screen clone. The app grid, horizontally scrollable Dock, and clickable Home indicator below are DindbOS design choices. They use original iOS-style SVG app artwork and the project wallpaper, with no Apple logo, bundled font, status indicators, or system artwork.

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


## Built-in application interiors

Apple lists iOS **27.2.1** as the latest stable release on the [official security releases page](https://support.apple.com/en-us/100100), checked November 10, 2026. This implementation follows current iOS design grammar while retaining DindbOS functionality; it does not reproduce native Apple app source or vendor assets. The existing Liquid Glass SVG/refraction engine remains unchanged.

The interior design uses 34px large titles, 17px readable content, grouped semantic surfaces, circular utility controls, and 44 CSS pixel minimum action targets. These are web adaptations, not physical-point equivalence guarantees. [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), [toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [materials](https://developer.apple.com/design/human-interface-guidelines/materials), and [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) informed the implementation. Translucency distinguishes chrome from content; documents retain stable readable surfaces.

| App | iOS-inspired interior and preserved actions |
| --- | --- |
| Portfolio | Large typography and grouped runtime cards; host content remains authoritative. |
| Files | Browse locations, touch command overflow, icon/list views, paths, tabs and inspector. |
| Applications | Category pills and three-column app grid; existing app operations remain available. |
| Terminal | Dark monospaced utility; command input and output wrap within the host. No native iOS Terminal counterpart is claimed. |
| Activity Monitor | Stacked process list, filter controls, inspector and runtime summary. No native iOS counterpart is claimed. |
| TextEdit | Readable full-width document editor and existing Save/unsaved-close behavior. |
| Browser | Document viewport above bottom address/navigation controls; real tabs and connection settings. |
| Viewer | Readable document surface, touch zoom and command overflow. |
| Calculator | Black display, circular numeric keys, orange operators; history and modes remain available. |
| Settings | Grouped searchable category list and detail navigation with Back and focus restoration. |
| Notes | Warm accent, searchable full-width note list, real editor and Back; creation, deletion and persistence retained. |
| Reminders | Two-column smart-list cards, readable tasks, date input and completion/delete controls. |
| Calendar | Month above local-calendar toggle and agenda; all weeks and event actions remain reachable by scrolling. |
| Clock | Dark world clock, analog faces/map and bottom mode controls; alarms, stopwatch and timer retained. |
| Photos | Compact library/import controls, three-column thumbnails, viewer, export and delete. |
| Music | Searchable song list, import/export controls and expanded playback/seeking/volume controls. |

`mobile-app-navigation.js` decorates the existing Notes and Settings DOM for both mobile styles. It delegates real actions, coalesces mutation work, restores focus to the selected row, removes injected controls on desktop transitions, and restores the original Notes search element. It does not create a second persistence or app-state implementation.

`ios-icons.js` contains original React SVG artwork for every built-in app and filesystem fallbacks. Custom host icons retain the shared renderer's existing handling. The artwork uses filled rounded tiles and original glyphs, including a blue folder for Files and a multicolor rosette for Photos.

`node scripts/smoke-platform-ios-apps.js` exercises Notes search and draft preservation, Back focus, Home/reopen, external Settings navigation, 320px controls, desktop cleanup, mobile remount and destroy. Native browser captures of every built-in app were reviewed at a 390px host. The shared all-app fixture supplies local documents/media and the parent integration suite evaluates broader app actions. Physical-device, VoiceOver and software-keyboard occlusion remain unverified.


Astra review follow-up: Files folder tabs now use a 56px strip, 48px inset tab rail and 44px tab/close/new-tab controls. The existing 28/26px desktop strip previously clipped the larger mobile targets. Native browser review checked 390px light, 320px light/dark and two open folder tabs; measured tab and new-tab targets remain 44px tall. Canvas Files reflects the real commandbar and tab composition; Clock uses the bundled geographic silhouettes. Notes and Settings boards show the list state; their corresponding detail states use the existing mobile Back navigation.
