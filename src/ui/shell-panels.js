import React from "react";
import { createRoot } from "react-dom/client";
import { AppIcon } from "./app-icon.js";

const ACCENTS = [
  ["Green", "#287a58"], ["Blue", "#2775d6"], ["Purple", "#8854c7"],
  ["Rose", "#c94f78"], ["Orange", "#c97926"], ["Graphite", "#64717e"],
];
const WALLPAPERS = [["meadow", "Meadow"], ["coast", "Coast"], ["dusk", "Dusk"]];

export class ShellPanels {
  constructor(shell) {
    this.shell = shell;
    this.os = shell.os;
    this.calendarDate = new Date();
  }

  open(name, trigger) {
    if (name === "calendar") this.renderCalendar();
    else if (name === "controls") this.renderControls();
    else if (name === "launcher") this.renderLauncher();
    else this.renderMenu(name, trigger);
  }

  panel(markup, className, label) {
    this.disposePanel();
    const overlay = this.shell.refs.overlays;
    overlay.innerHTML = `<section class="dos-shell-panel ${className}" role="dialog" aria-label="${escapeHtml(label)}">${markup}</section>`;
    return overlay.firstElementChild;
  }

  renderMenu(name, trigger) {
    const task = this.shell.activeTask();
    const app = this.os.apps.list().find((entry) => entry.id === task?.appId);
    const available = (id) => this.os.apps.has(id);
    const editable = this.shell.editTarget?.isConnected && this.shell.root.contains?.(this.shell.editTarget);
    const items = {
      desktop: [
        ...(this.shell.contextNode ? [
          { label: "Open", action: "desktop-open" },
          { label: "Show in Files", action: "desktop-reveal", disabled: !available("files") },
          null,
        ] : [{ label: "Open Files", action: "launch", app: "files", disabled: !available("files") }, null]),
        { label: "Refresh Desktop", action: "refresh" },
        { label: "Change Wallpaper…", action: "controls" },
        null,
        { label: "System Settings…", action: "launch", app: "settings", disabled: !available("settings") },
      ],
      system: [
        { label: `About ${this.os.session.product || "DindbOS"}`, action: "about" },
        null,
        { label: "System Settings…", action: "launch", app: "settings", disabled: !available("settings") },
        { label: "Applications…", action: "launcher", shortcut: "⌘ K" },
        null,
        { label: "Show Desktop", action: "show-desktop", disabled: !this.os.windows.windows.size },
      ],
      app: [
        { label: `About ${app?.name || "Desktop"}`, action: "about" },
        null,
        { label: `Close ${app?.name || "Window"}`, action: "close", shortcut: "⌘ W", disabled: !task },
        ...["File", "Edit", "View", "Window", "Help"].map((label) => ({ label: `${label}…`, action: "open-menu", menu: label.toLowerCase(), compact: true })),
      ],
      file: [
        { label: "New Files Window", action: "launch-new", app: "files", disabled: !available("files") },
        { label: "New Text Document", action: "launch-new", app: "text", disabled: !available("text") },
        null,
        { label: "Close Window", action: "close", shortcut: "⌘ W", disabled: !task },
      ],
      edit: [
        { label: "Undo", action: "edit-undo", shortcut: "⌘ Z", disabled: !editable },
        { label: "Redo", action: "edit-redo", shortcut: "⇧ ⌘ Z", disabled: !editable },
        null,
        { label: "Cut", action: "edit-cut", shortcut: "⌘ X", disabled: !editable },
        { label: "Copy", action: "edit-copy", shortcut: "⌘ C", disabled: !editable },
        { label: "Paste", action: "edit-paste", shortcut: "⌘ V", disabled: !editable || !globalThis.navigator?.clipboard?.readText },
        { label: "Select All", action: "edit-selectAll", shortcut: "⌘ A", disabled: !editable },
      ],
      view: [
        { label: "Appearance…", action: "controls" },
        { label: "Show Desktop", action: "show-desktop", disabled: !this.os.windows.windows.size },
        { label: "Refresh Desktop", action: "refresh" },
      ],
      window: [
        { label: "Minimize", action: "minimize", shortcut: "⌘ M", disabled: !task },
        { label: task?.maximized ? "Restore Size" : "Zoom", action: "maximize", disabled: !task },
        null,
        ...[...this.os.windows.windows.values()].map((entry) => ({ label: entry.title || entry.appId, action: "focus-window", window: entry.id, checked: entry.id === task?.id })),
      ],
      help: [
        { label: "Explore Applications…", action: "launcher" },
        { label: "Getting Started", action: "launch", app: "welcome", disabled: !available("welcome") },
        { label: "About DindbOS", action: "about" },
      ],
    }[name] || [];
    this.disposePanel();
    this.shell.refs.overlays.innerHTML = `<div class="dos-shell-menu" role="menu" aria-label="${escapeHtml(name)} menu">${items.map((item) => item ? `<button type="button" role="menuitem" ${item.compact ? 'class="dos-compact-menu-item"' : ""} data-shell-action="${item.action}" ${item.menu ? `data-menu="${item.menu}"` : ""} ${item.app ? `data-app="${escapeHtml(item.app)}"` : ""} ${item.window ? `data-window="${escapeHtml(item.window)}"` : ""} ${item.disabled ? "disabled" : ""}><span class="dos-menu-check" aria-hidden="true">${item.checked ? "✓" : ""}</span><span>${escapeHtml(item.label)}</span><kbd>${item.shortcut || ""}</kbd></button>` : `<div class="dos-menu-divider" role="separator"></div>`).join("")}</div>`;
    const menu = this.shell.refs.overlays.firstElementChild;
    const rootRect = this.shell.refs.shell.getBoundingClientRect?.();
    const triggerRect = trigger?.getBoundingClientRect?.();
    if (rootRect && triggerRect) menu.style.left = `${Math.max(6, Math.min(triggerRect.left - rootRect.left, rootRect.width - 248))}px`;
    menu.querySelector?.("button:not(:disabled)")?.focus();
  }

  renderLauncher() {
    const panel = this.panel(`
      <div class="dos-launcher-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search applications" aria-label="Search applications" data-shell-search autocomplete="off"><kbd>esc</kbd></div>
      <div class="dos-launcher-results" aria-label="Applications"></div>
      <footer class="dos-launcher-footer"><span>Applications</span><span>↑ ↓ to navigate <span aria-hidden="true">·</span> ↵ to open</span></footer>`, "dos-launcher", "Search applications");
    this.renderLauncherResults("");
    panel.querySelector("input")?.focus();
  }

  renderLauncherResults(query) {
    const apps = filterApplications(this.os.apps.list(), query);
    const results = this.shell.refs.overlays.querySelector(".dos-launcher-results");
    if (!results) return;
    this.launcherRoot ||= createRoot(results);
    this.launcherRoot.render(apps.length
      ? apps.map((app) => React.createElement("button", {
          key: app.id, type: "button", "data-launch-result": "", "data-shell-action": "launch", "data-app": app.id,
        },
        React.createElement("span", { className: "dos-launcher-symbol", "aria-hidden": true }, React.createElement(AppIcon, { icon: app.icon || "app" })),
        React.createElement("span", null, React.createElement("strong", null, app.name || app.id), React.createElement("small", null, "Application")),
        React.createElement("span", { className: "dos-launcher-open", "aria-hidden": true }, "↵")))
      : React.createElement("p", { className: "dos-shell-empty" }, `No applications match “${query}”.`));
  }

  renderControls() {
    const appearance = this.os.appearance || {};
    const panel = this.panel(`
      <header><h2>Control Center</h2><button type="button" data-shell-action="dismiss" class="dos-panel-close" aria-label="Close Control Center">×</button></header>
      <section class="dos-control-section"><h3>Appearance</h3><div class="dos-appearance-options">${[["light", "Light"], ["dark", "Dark"], ["system", "Auto"]].map(([value, label]) => `<button type="button" data-shell-action="mode" data-value="${value}" aria-pressed="${(appearance.mode || "system") === value}"><span class="dos-mode-preview dos-mode-${value}" aria-hidden="true"></span>${label}</button>`).join("")}</div></section>
      <section class="dos-control-section"><h3>Accent color</h3><div class="dos-accent-options">${ACCENTS.map(([label, value]) => `<button type="button" data-shell-action="accent" data-value="${value}" aria-label="${label} accent" aria-pressed="${(appearance.accent || "#287a58") === value}" style="--swatch:${value}"></button>`).join("")}</div></section>
      <section class="dos-control-section"><h3>Wallpaper</h3><div class="dos-wallpaper-options">${WALLPAPERS.map(([value, label]) => `<button type="button" data-shell-action="wallpaper" data-value="${value}" aria-pressed="${(appearance.wallpaper || "meadow") === value}"><span class="dos-wallpaper-preview dos-wallpaper-${value}" aria-hidden="true"></span>${label}</button>`).join("")}</div></section>
      <section class="dos-control-section dos-dock-control"><label for="${this.os.instanceId}-dock-size">Dock size</label><input type="range" id="${this.os.instanceId}-dock-size" min="36" max="72" value="${Number(appearance.dockSize || 52)}" data-shell-dock-size><span aria-hidden="true">Small</span><span aria-hidden="true">Large</span></section>
      <button type="button" class="dos-panel-link" data-shell-action="launch" data-app="settings" ${this.os.apps.has("settings") ? "" : "disabled"}>Open System Settings <span aria-hidden="true">↗</span></button>`, "dos-control-center", "Control Center");
    if (this.shell.activePanel !== "controls") return;
    panel.querySelector("button")?.focus();
  }

  updateControls() {
    const appearance = this.os.appearance || {};
    const overlay = this.shell.refs.overlays;
    overlay.querySelectorAll("[data-shell-action='mode'], [data-shell-action='accent'], [data-shell-action='wallpaper']").forEach((button) => {
      const key = button.dataset.shellAction;
      const fallback = { mode: "system", accent: "#287a58", wallpaper: "meadow" };
      button.setAttribute("aria-pressed", String(button.dataset.value === (appearance[key] || fallback[key])));
    });
    const size = overlay.querySelector("[data-shell-dock-size]");
    if (size && size !== this.shell.root.ownerDocument?.activeElement) size.value = appearance.dockSize || 52;
  }

  renderCalendar() {
    const now = new Date();
    const date = this.calendarDate;
    const panel = this.panel(`
      <header><div><p class="dos-calendar-today">${escapeHtml(now.toLocaleDateString(undefined, { weekday: "long" }))}</p><h2>${escapeHtml(now.toLocaleDateString(undefined, { month: "long", day: "numeric" }))}</h2></div><button type="button" data-shell-action="calendar-today" class="dos-calendar-today-action">Today</button></header>
      <div class="dos-calendar-month"><strong>${escapeHtml(date.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</strong><div><button type="button" data-shell-action="calendar-prev" aria-label="Previous month">‹</button><button type="button" data-shell-action="calendar-next" aria-label="Next month">›</button></div></div>
      <div class="dos-calendar-week" aria-hidden="true">${["M", "T", "W", "T", "F", "S", "S"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="dos-calendar-grid" role="list" aria-label="Days in ${escapeHtml(date.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}">${calendarCells(date).map((day) => day ? `<span role="listitem" ${sameDate(day, now) ? 'class="is-today" aria-current="date"' : ""}>${day.getDate()}</span>` : `<span aria-hidden="true"></span>`).join("")}</div>`, "dos-calendar", "Calendar");
    panel.querySelector("button")?.focus();
  }

  renderAbout() {
    this.shell.activePanel = "about";
    const app = this.os.apps.list().find((entry) => entry.id === this.shell.activeTask()?.appId);
    const name = app?.name || this.os.session.product || "DindbOS";
    const panel = this.panel(`<button type="button" class="dos-panel-close" data-shell-action="dismiss" aria-label="Close About">×</button><div class="dos-about-mark" aria-hidden="true">D</div><h2>${escapeHtml(name)}</h2><p>A desktop for the web.</p><p class="dos-about-detail">${app ? "Running in DindbOS" : "Built with DindbOS"}</p><button type="button" class="dos-panel-link" data-shell-action="launcher">Explore applications</button>`, "dos-about", `About ${name}`);
    panel.querySelector("button")?.focus();
  }

  disposePanel() {
    this.launcherRoot?.unmount();
    this.launcherRoot = null;
  }

  handleInput(event) {
    if (event.target.matches?.("[data-shell-search]")) this.renderLauncherResults(event.target.value);
    if (event.target.matches?.("[data-shell-dock-size]")) this.os.setAppearance?.({ dockSize: Number(event.target.value) });
  }

  handleChange(event) {
    if (event.target.matches?.("[data-shell-dock-size]")) this.os.setAppearance?.({ dockSize: Number(event.target.value) });
  }

  runAction(action, data = {}) {
    const task = this.shell.activeTask();
    if (action === "dismiss") { this.shell.closePanel(); return; }
    if (action === "open-menu") {
      const trigger = this.shell.refs.menubar.querySelector(".dos-active-app");
      this.shell.openPanel(data.menu, trigger);
      return;
    }
    if (["mode", "accent", "wallpaper"].includes(action)) {
      this.os.setAppearance?.({ [action]: data.value });
      this.updateControls();
      return;
    }
    if (action.startsWith("calendar-")) {
      if (action === "calendar-today") this.calendarDate = new Date();
      else this.calendarDate = new Date(this.calendarDate.getFullYear(), this.calendarDate.getMonth() + (action === "calendar-next" ? 1 : -1), 1);
      this.renderCalendar();
      return;
    }
    if (["about", "launcher", "controls"].includes(action)) {
      const trigger = this.shell.returnFocus;
      this.shell.closePanel(false);
      this.shell.returnFocus = trigger;
      this.shell.activePanel = action;
      if (action === "about") this.renderAbout();
      else this.open(action);
      return;
    }
    const editor = this.shell.editTarget;
    const contextNode = this.shell.contextNode;
    this.shell.closePanel(false);
    if (action === "desktop-open" && contextNode) this.os.openNode(contextNode);
    else if (action === "desktop-reveal" && contextNode) this.shell.launchApp("files", { path: this.os.fs.dirname(contextNode.path) });
    else if (action === "launch") this.shell.launchApp(data.app);
    else if (action === "launch-new") this.shell.launchApp(data.app, {});
    else if (action === "close" && task) this.os.windows.close(task.id);
    else if (action === "minimize" && task) this.os.windows.minimize(task.id);
    else if (action === "maximize" && task) this.os.windows.maximize(task.id);
    else if (action === "focus-window") this.os.windows.activate(data.window);
    else if (action === "show-desktop") [...this.os.windows.windows.values()].filter((window) => !window.minimized).forEach((window) => this.os.windows.minimize(window.id));
    else if (action === "refresh") this.shell.renderDesktop();
    else if (action.startsWith("edit-") && editor?.isConnected) {
      editor.focus();
      const command = action.slice(5);
      if (command === "selectAll" && typeof editor.select === "function") editor.select();
      else if (command === "paste") this.pasteInto(editor);
      else this.shell.root.ownerDocument?.execCommand?.(command);
    }
  }

  async pasteInto(editor) {
    try {
      const text = await globalThis.navigator?.clipboard?.readText?.();
      if (text === undefined || !editor.isConnected || !this.shell.root.contains(editor)) return;
      editor.focus();
      if (typeof editor.setRangeText === "function") {
        editor.setRangeText(text, editor.selectionStart || 0, editor.selectionEnd || 0, "end");
        const EventType = this.shell.root.ownerDocument.defaultView.Event;
        editor.dispatchEvent(new EventType("input", { bubbles: true }));
      } else this.shell.root.ownerDocument.execCommand?.("insertText", false, text);
    } catch {
      this.shell.notify("Clipboard access is unavailable. Use the keyboard paste shortcut in the editor.");
    }
  }
}

export function filterApplications(apps, query = "") {
  const needle = String(query).trim().toLocaleLowerCase();
  return apps.filter((app) => `${app.name || ""} ${app.id}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

export function calendarCells(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const count = Math.ceil((offset + days) / 7) * 7;
  return Array.from({ length: count }, (_, index) => index >= offset && index < offset + days ? new Date(year, month, index - offset + 1) : null);
}

function sameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
