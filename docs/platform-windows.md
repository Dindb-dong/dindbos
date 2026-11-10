# Windows shell

Select `ui: { style: "windows" }` to use a Windows-inspired shell. The existing runtime, filesystem, permissions, apps and window state are shared with the default macOS shell. This is a browser interface, not Windows or WinUI.

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
- Taskbar icons retain the project's original artwork. The Start symbol is original generic geometry. Wallpaper and accent remain consumer configurable.
- Light, dark, reduced-motion and forced-color styles remain scoped to this desktop instance. A narrow Windows host retains a compact taskbar unless `ui.mobileStyle` requests a mobile shell.
- Native Windows snap layouts, virtual desktops, shell extensions, jump lists and taskbar previews are outside this implementation.

## Check

With the demo server running, run `DINDBOS_QA_URL=http://127.0.0.1:5186/ node scripts/smoke-platform-windows.js`. The regression exercises Start, focus return, Ctrl+Escape, active taskbar minimize/restore without losing app state, caption order, maximized bounds, application menus and a narrow host.
