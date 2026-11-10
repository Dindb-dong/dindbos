# Windows shell

Select `ui: { style: "windows" }` to force a Windows-inspired shell. Automatic selection uses it by default for macOS visitors on wide hosts and iOS visitors in landscape. Consumers can override these rules through `ui.autoStyles`; see [customization](customization.md). The runtime, filesystem, permissions, apps and window state are shared across presets. This is a browser interface, not Windows or WinUI.

## Official references and decisions

Reviewed on November 10, 2026:

| Official guidance | Shell decision |
| --- | --- |
| [Microsoft Support: Customize the taskbar](https://support.microsoft.com/en-us/windows/experience/personalization/customize-the-taskbar-in-windows) describes centered taskbar alignment and pinned apps. | A full-width bottom taskbar groups Start and pinned/running applications near the center, with clock and controls at the right. Clicking the active app minimizes it; clicking it again restores its existing window. |
| [Microsoft Learn: Title bar design](https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design) places caption controls on the right, protects them from title overflow, and supports dragging and double-click maximize. | Titles align left; minimize, maximize and close appear at the right. The existing window manager owns drag, resize, maximize, minimize and close confirmation. A 40px title bar accommodates browser controls; the documented native standard is 32px. |
| [Microsoft Learn: Geometry](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry) specifies 8px top-level rounding, 4px controls and square maximized windows. | Windows and flyouts use 8px corners, taskbar controls 4px, and maximized windows square corners. |
| [Microsoft Learn: Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica) describes an opaque backdrop for persistent windows. [Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic) is appropriate for transient flyouts and cautions against stacked translucent surfaces. | Window title bars use stable, theme-aware surfaces. Start, controls and calendar use a translucent browser approximation. Native Mica wallpaper sampling is not emulated. |
| [Microsoft Learn: Typography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography) recommends Segoe UI Variable, sentence case and legible hierarchy. | Use installed Segoe UI Variable/Segoe UI with a system fallback; no Microsoft fonts or assets are redistributed. |
| [Microsoft Learn: Keyboard interactions](https://learn.microsoft.com/en-us/windows/apps/develop/input/keyboard-interactions) emphasizes predictable tab order, arrow navigation, visible focus and accelerators. | Start reuses the accessible application search, including arrows, Enter, Escape and focus restoration. Ctrl+Escape opens Start within the focused desktop. The host operating system keeps its own Windows key. |

## Behavior and limits

- Start searches and launches registered DindbOS apps. It does not advertise recent host files, device status or unimplemented native services.
- App menus remain available through the taskbar's **App menus** disclosure. Their commands retain their existing context and shortcuts. Escape dismisses an open menu and restores focus; another Escape closes the disclosure.
- Standard, integrated and document app windows all receive a separate title bar, preserving content below caption controls.
- Built-in and generic file/app icons use original Windows-inspired SVG artwork, including yellow folders and distinct browser, utility and media silhouettes. Custom images and React icons retain their consumer-defined appearance. No Microsoft artwork is redistributed.
- Light, dark, reduced-motion and forced-color styles remain scoped to this desktop instance. A narrow Windows host retains a compact taskbar unless `ui.mobileStyle` requests a mobile shell.
- Native Windows snap layouts, virtual desktops, shell extensions, jump lists and taskbar previews are outside this implementation.

## Check

With the demo server running, run `DINDBOS_QA_URL=http://127.0.0.1:5186/ node scripts/smoke-platform-windows.js`. The regression exercises Start, focus return, Ctrl+Escape, active taskbar minimize/restore without losing app state, caption order, maximized bounds, application menus and a narrow host.

## App interiors

The [official Windows release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information), reviewed November 10, 2026, lists Windows 11 26H2 as generally available (build 26300; latest listed revision October 28). Store applications update independently; this implementation follows current published Windows design guidance and does not claim a particular Store package version or native application parity.

The interiors apply [Windows navigation guidance](https://learn.microsoft.com/en-us/windows/apps/design/basics/navigation-basics), the typography and geometry references above, [Microsoft's Calculator design direction](https://github.com/microsoft/calculator/blob/main/docs/Roadmap.md), and [media playback control guidance](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/media-playback). Existing app DOM, commands, keyboard handlers and state remain the implementation. No OS application engines or dependencies are added.

| Built-in | Windows treatment | Existing capabilities retained |
| --- | --- | --- |
| Portfolio | Left-aligned heading and restrained project cards | Host-supplied content and project actions |
| Files | Yellow folder artwork, neutral navigation rail, rectangular tabs and command controls | Navigation, views, search, tabs, selection, inspector, context actions, import/export |
| Applications | Compact searchable app catalog with original platform icons | Categories, search and launching registered apps |
| Terminal | Dark terminal surface and Consolas fallback | Existing command execution and input |
| Activity Monitor | Dense diagnostic table and quiet summary/details surfaces | Activity/memory views, state filtering, sorting and process diagnostics |
| TextEdit | Plain Notepad-like document pane and protected Save placement | Editing, saving and unsaved-change handling |
| Browser | Visible top tab strip and left-aligned rectangular address field | Tabs, navigation, local documents, drafts and connection controls |
| Viewer | Document page, subdued toolbar and rectangular controls | Supported previews, zoom and file actions |
| Calculator | Rectangular keypad, emphasized equals and readable history | Existing arithmetic, modes, history and keyboard input |
| Settings | Persistent categories, selected navigation rail and grouped preference cards | All existing settings sections and controls |
| Notes | Notebook/page columns, purple selection rail and paper editor | Note creation, search, edits, selection and deletion |
| Reminders | To Do-like vertical navigation and individual task rows | Lists, date input, completion, filters and deletion |
| Calendar | Compact command row, month grid and agenda sidebar | Month navigation, event creation/editing and deletion |
| Clock | Flat utility tabs and theme-aware clock cards | Existing world map, analog clocks, alarms, stopwatch and timers |
| Photos | Library navigation and compact gallery commands | Import, viewing, selection, export and deletion |
| Music | Local track table with a full-width bottom transport | Import, selection, playback, seek, volume and deletion |

Light/dark surfaces, keyboard focus, reduced motion, forced colors and narrow host layouts remain scoped to the selected Windows desktop. The taskbar has one translucent surface; the reused Dock contributes icons and state without another glass background. The Liquid Glass engine remains unchanged.

The editable design document includes foundations, linked command components and states, original icon artwork, sixteen individual app boards and light/dark taskbar comparisons. Private document IDs, captures and readback evidence are kept outside the published documentation.

With Chrome available, run `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/smoke-platform-windows-apps.js` for all sixteen app captures, calculator/history, note state, reminders, settings navigation, dark and compact layouts. `node scripts/smoke-platform-icons.js` checks icon coverage, platform separation and custom-icon handling. The shared `node scripts/smoke-platform-apps-browser.js` verifies all built-in functional flows across the three new styles. Physical Windows hardware, Narrator, Edge and non-Chromium browsers were not tested by this lane.

The Windows app regression also checks light/dark calculator toolbar foreground and background colors, full-width title bars and in-bounds caption controls at 320/390px, visible Notes list headings, note editing, and Files navigation at those widths. These checks cover inherited macOS compact-title-bar rules as well as the Windows overrides.
