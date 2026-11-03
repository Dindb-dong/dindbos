/** Menus are resolved against one captured window, never a global app-independent command list. */
export const APP_MENU_NAMES = ["file", "edit", "view", "help"];

export function appMenuContext(shell, task) {
  const process = task && shell.os.processes.get(task.pid);
  return process ? { os: shell.os.createSandbox(process), content: task.content, window: task.api, context: task.context || {} } : null;
}

const menuFailures = new WeakMap();
function reportMenuError(shell, app, error) {
  const message = `${app?.name || app?.id || "Application"} menu: ${error?.message || "The menu could not be loaded."}`;
  if (app && menuFailures.get(app) !== message) { menuFailures.set(app, message); shell.notify?.(message); }
}

export function customAppMenus(shell, task, app) {
  if (!app || !task) return null;
  try {
    if (!app.menus) return null;
    const context = appMenuContext(shell, task);
    if (!context) return null;
    const menus = typeof app.menus === "function" ? app.menus(context) : app.menus;
    return menus && typeof menus === "object" ? { menus, context } : null;
  } catch (error) {
    reportMenuError(shell, app, error);
    return { menus: { file: [{ label: "Application menu unavailable", enabled: false }], edit: [], view: [], help: [] }, context: null, failed: true };
  }
}

export function menuItemEnabled(shell, app, item, context) {
  try { return typeof item.enabled === "function" ? Boolean(item.enabled(context)) : item.enabled !== false; }
  catch (error) { reportMenuError(shell, app, error); return false; }
}

export function applicationMenuItems(shell, name, task, app, editable) {
  const os = shell.os;
  const custom = customAppMenus(shell, task, app);
  if (custom && Object.hasOwn(custom.menus, name)) {
    const definitions = custom.menus[name];
    if (!Array.isArray(definitions)) return [];
    const entries = definitions.slice(0, 100).map(item => {
      if (!item) return null;
      const enabled = menuItemEnabled(shell, app, item, custom.context);
      return { label: String(item.label || ""), shortcut: item.shortcut || formatAccelerator(item.accelerator), checked: Boolean(item.checked), disabled: !enabled || typeof item.run !== "function", run: () => menuItemEnabled(shell, app, item, custom.context) ? item.run(custom.context) : undefined };
    });
    if (name === "file" && custom.failed) entries.push(null, { label: "Close Window", shortcut: "⌘ W", action: "close" });
    return entries;
  }
  const frame = task?.frame;
  const node = (selector) => frame?.querySelector(selector);
  const control = (label, selector, extra = {}) => {
    const element = node(selector);
    return { label, disabled: !element || Boolean(element.disabled), run: () => element?.isConnected && !element.disabled && element.click(), ...extra };
  };
  const focus = (label, selector) => ({ label, disabled: !node(selector), run: () => { const element = node(selector); element?.focus({ preventScroll: true }); element?.select?.(); } });
  const launch = (label, id, context = {}) => ({ label, disabled: !os.apps.has(id), run: () => os.launch(id, context) });
  const close = { label: "Close Window", shortcut: "⌘ W", action: "close", disabled: !task };
  const closeTab = frame?.querySelector('[data-files-tab][aria-selected="true"]')?.closest(".files-tab-item")?.querySelector("[data-files-close-tab]");
  const nativeEdit = [
    { label: "Undo", action: "edit-undo", shortcut: "⌘ Z", disabled: !editable },
    { label: "Redo", action: "edit-redo", shortcut: "⇧ ⌘ Z", disabled: !editable }, null,
    { label: "Cut", action: "edit-cut", shortcut: "⌘ X", disabled: !editable },
    { label: "Copy", action: "edit-copy", shortcut: "⌘ C", disabled: !editable },
    { label: "Paste", action: "edit-paste", shortcut: "⌘ V", disabled: !editable || !globalThis.navigator?.clipboard?.readText },
    { label: "Select All", action: "edit-selectAll", shortcut: "⌘ A", disabled: !editable },
  ];
  const id = task?.appId;
  const hasFilesSelection = Boolean(node('.files-row[aria-selected="true"]'));
  const definitions = {
    files: {
      file: [launch("New Files Window", "files", { path: node(".files-app")?.dataset.filesPath || os.session.home }), control("New Tab", "[data-files-new-tab]", { shortcut: "⌘ T" }), control("New Folder", '[data-action="new-folder"]'), control("Import Files…", '[data-action="import"]'), null,
        ...(closeTab ? [{ label: "Close Tab", shortcut: "⌘ W", run: () => closeTab.isConnected && closeTab.click() }, { ...close, shortcut: "⇧ ⌘ W" }] : [close])],
      edit: [control("Copy Item", '[data-action="copy"]', { disabled: !hasFilesSelection || !node('[data-action="copy"]') }), control("Paste Item", '[data-action="paste"]'), null, control("Rename…", '[data-action="rename"]', { disabled: !hasFilesSelection || !node('[data-action="rename"]') }), control("Move to Trash…", '[data-action="trash"]', { disabled: !hasFilesSelection || !node('[data-action="trash"]') })],
      view: [["icons", "as Icons"], ["list", "as List"], ["columns", "as Columns"]].map(([value, label]) => control(label, `[data-files-view="${value}"]`, { checked: node(".files-app")?.dataset.filesView === value })).concat([null, control("Get Info", '[data-action="info"]')]),
    },
    text: { file: [launch("New Text Document", "text"), control("Save…", "[data-document-save]", { shortcut: "⌘ S" }), null, close], edit: nativeEdit },
    browser: {
      file: [launch("New Browser Window", "browser"), control("New Tab", '[data-browser-tab-action="new"]', { shortcut: "⌘ T" }), control("Reopen Closed Tab", '[data-browser-tab-action="reopen"]', { shortcut: "⇧ ⌘ T" }), null, close],
      view: [control("Back", '[data-browser-action="back"]'), control("Forward", '[data-browser-action="forward"]'), control("Reload Page", '[data-browser-action="reload"]'), null, focus("Enter Address…", '[name="address"]')],
    },
    notes: { file: [control("New Note", "[data-note-new]"), control("Delete Note…", "[data-note-delete]"), null, close], edit: nativeEdit, view: [focus("Search Notes…", '[aria-label="Search notes"]')] },
    reminders: { file: [control("New Reminder", "[data-reminder-focus]"), null, close], view: ["today", "scheduled", "all", "completed"].map(value => control(({ today: "Today", scheduled: "Scheduled", all: "All", completed: "Completed" })[value], `[data-reminder-filter="${value}"]`, { checked: node(`[data-reminder-filter="${value}"]`)?.getAttribute("aria-pressed") === "true" })) },
    calendar: { file: [control("New Event…", "[data-calendar-add]"), null, close], view: [control("Go to Today", "[data-calendar-today]"), control("Previous Month", '[data-month="-1"]'), control("Next Month", '[data-month="1"]')] },
    calculator: { file: [close], edit: [control("Clear", '[data-key="clear"]'), control("Delete Digit", '[data-key="backspace"]')], view: [control("Show History", "[data-calculator-history]", { checked: node("[data-calculator-history]")?.getAttribute("aria-expanded") === "true" })] },
    clock: { file: [control("Add City or Alarm…", "[data-clock-add]"), null, close], view: ["world", "alarm", "stopwatch", "timer"].map(value => control(({ world: "World Clock", alarm: "Alarm", stopwatch: "Stopwatch", timer: "Timer" })[value], `[data-clock-mode="${value}"]`, { checked: node(`[data-clock-mode="${value}"]`)?.getAttribute("aria-selected") === "true" })) },
    photos: { file: [control("Import Photos…", '[data-media-action="import"]'), null, close], view: [control("Show Library", '[data-media-action="library"]'), control("Zoom In", '[data-media-action="zoom-in"]'), control("Zoom Out", '[data-media-action="zoom-out"]'), control("Fit to Window", '[data-media-action="fit"]')] },
    music: { file: [control("Import Audio…", '[data-media-action="import"]'), null, close], view: [control("Play / Pause", '[data-media-action="play"]'), control("Previous Song", '[data-media-action="previous"]'), control("Next Song", '[data-media-action="next"]'), null, focus("Search Songs…", '[aria-label="Search songs"]')] },
    viewer: { file: [control("Export…", '[data-viewer-action="export"]'), control("Open in TextEdit", '[data-viewer-action="open-editor"]'), null, close], view: [control("Zoom In", '[data-viewer-action="zoom-in"]'), control("Zoom Out", '[data-viewer-action="zoom-out"]'), control("Actual Size", '[data-viewer-action="zoom-reset"]'), control("Previous Page", '[data-viewer-action="page-prev"]'), control("Next Page", '[data-viewer-action="page-next"]')] },
    applications: { file: [close], view: [control("Refresh Applications", ".applications-refresh"), focus("Search Applications…", '[aria-label="Search applications"]')] },
    settings: { file: [close], view: ["appearance", "wallpaper", "desktop"].map(value => control(({ appearance: "Appearance", wallpaper: "Wallpaper", desktop: "Desktop & Dock" })[value], `[data-settings-section-button="${value}"]`)) },
    terminal: { file: [launch("New Terminal Window", "terminal"), null, close], view: [focus("Focus Prompt", '.terminal-app input')] },
    "activity-monitor": { file: [close], view: [control("Activity", '[data-activity-metric="activity"]'), control("Memory", '[data-activity-metric="runtime"]'), focus("Filter Processes…", '[data-activity-filter]')] },
  };
  if (definitions[id]?.[name]) return definitions[id][name];
  if (name === "file") return [close];
  if (name === "edit") return frame?.querySelector("textarea, [contenteditable='true'], input:not([type]), input:is([type='text'], [type='search'], [type='url'], [type='email'], [type='password'], [type='tel'])") ? nativeEdit : [];
  if (name === "help") return [{ label: `About ${app?.name || "Desktop"}`, action: "about" }];
  return [];
}

export function matchesAccelerator(event, accelerator) {
  if (typeof accelerator !== "string") return false;
  const parts = accelerator.toLowerCase().split("+").map(part => part.trim());
  const key = parts.pop();
  if (!parts.some(part => ["mod", "meta", "ctrl", "control", "alt"].includes(part))) return false;
  const mod = parts.includes("mod");
  return String(event.key).toLowerCase() === key
    && (mod ? Boolean(event.metaKey || event.ctrlKey) : Boolean(event.metaKey) === parts.includes("meta") && Boolean(event.ctrlKey) === (parts.includes("ctrl") || parts.includes("control")))
    && Boolean(event.altKey) === parts.includes("alt") && Boolean(event.shiftKey) === parts.includes("shift");
}

function formatAccelerator(accelerator) {
  return typeof accelerator === "string" ? accelerator.split("+").map(part => ({ mod: "⌘", meta: "⌘", ctrl: "Ctrl", control: "Ctrl", alt: "⌥", shift: "⇧" })[part.toLowerCase()] || part.toUpperCase()).join(" ") : "";
}
