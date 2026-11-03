# Built-in apps

Choose apps with `builtins: { include: ['files', 'notes', 'calendar'] }` or exclude individual IDs. Register your own replacements through the same app API. Applications in the Dock lists installed apps with search and categories. Welcome provides shortcuts. Built-ins use the desktop instance's filesystem, permissions, appearance, and lifecycle.

| ID | App | Working features |
| --- | --- | --- |
| `files` | Files | Folders, history, search, list/columns, view/sort menus, import/export, contextual actions, saved drag-and-drop Favorites |
| `applications` | Applications | Installed app grid, search, categories, keyboard launch, restore existing windows |
| `notes` | Notes | Create, edit, search, delete, automatic local saving |
| `reminders` | Reminders | Tasks, completion, due dates, filtered lists |
| `calendar` | Calendar | Month navigation, selected-day events, add/delete events |
| `clock` | Clock | World clocks, stopwatch/laps, countdown timer |
| `photos` | Photos | Import local images, thumbnail library, viewer, zoom/fit, trash |
| `music` | Music | Import local audio, library, play/pause, seek, volume, previous/next |
| `text` | TextEdit | Edit, Save As, reopen, unsaved-close Save/Discard/Cancel |
| `viewer` | Viewer | Document/image preview and edit handoff |
| `browser` | Browser | Sandboxed local HTML, tabs/history, optional external companion |
| `calculator` | Calculator | Arithmetic and keyboard input |
| `terminal` | Terminal | Runtime shell, file commands and process tools |
| `activity-monitor` | Activity Monitor | Runtime processes and operations |
| `settings` | Settings | Appearance, storage, permissions and advanced diagnostics |
| `welcome` | Welcome | App shortcuts and appearance controls; opt in with `includeWelcome: true` |
| `portfolio` | Portfolio | Host-supplied project content; disable with `includePortfolio: false` |

## Local data

Notes, reminders and calendar events are JSON files in `~/Documents/.dindbos/`. They do not connect to iCloud or a server. Photos and Music copy imported files into `~/Pictures/Photos Library/` and `~/Music/Music Library/`; removal moves the library copy into `~/.Trash`. The original file on the user's computer stays intact. Media import currently allows 32 MB per file and 128 MB / 256 library entries per app. Supported audio decoding depends on the browser.

Data persists through the configured runtime storage backend. Memory-only desktops intentionally discard it on teardown. A countdown completes while the Clock app is open; closing it stops its timers. External browsing needs the separately configured browser companion. No microphone, cloud account, notification permission or paid service is required for the new apps.

## Context menus

The desktop background offers desktop actions. Desktop files/folders offer item actions. App shortcuts offer launch/reveal/Dock actions. Dock app menus reflect open windows, minimized state and pin state, with Show, New Window where supported, Keep/Remove from Dock, and Quit while running. Quit respects each window's unsaved-close guard. Right-click or Shift+F10 opens the relevant menu; Escape dismisses it and restores focus.

## Finder sidebar

Drag a folder from the desktop or Files into the Favorites insertion area to save a shortcut. Drag favorites to reorder them; right-click provides Move Up, Move Down and Remove alternatives. Dropping files onto a sidebar folder moves them into that folder. External file drops import a copy through the usual permission checks. Favorites are saved in `~/.config/dindbos/files-favorites.json`; the active location selects only its deepest matching sidebar item.

Applications uses the installed app registry. Choose Refresh after registering or removing apps while the library is open. Custom app definitions may set `category` to `productivity`, `media`, `utilities`, `development`, `internet`, or `other`. Unrecognized categories appear under Other.
