import React from "react";
import { createRoot } from "react-dom/client";
import { AppIcon } from "./app-icon.js";
import { APP_MENU_NAMES, applicationMenuItems } from "./app-menus.js";

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
    const contextApp = this.shell.contextApp;
    const appWindows = contextApp ? [...this.os.windows.windows.values()].filter((entry) => entry.appId === contextApp.id) : [];
    const pinItem = contextApp && { label: contextApp.pinned ? "Remove from Dock" : "Keep in Dock", action: "context-pin", checked: Boolean(contextApp.pinned) };
    const editable = this.shell.editTarget?.isConnected && this.shell.root.contains?.(this.shell.editTarget) && this.shell.editTarget.closest?.(".dos-window")?.classList.contains("is-active");
    const defaults = {
      desktop: [
        { label: "New Folder", action: "desktop-new-folder" },
        { label: "Open Files", action: "launch", app: "files", disabled: !available("files") },
        null,
        { label: "Refresh Desktop", action: "refresh" },
        { label: "Change Wallpaper…", action: "settings", section: "wallpaper", disabled: !available("settings") },
        null,
        { label: "System Settings…", icon: "settings", action: "settings", disabled: !available("settings") },
      ],
      "desktop-item": [
        { label: "Open", action: "desktop-open" },
        { label: "Show in Files", action: "desktop-reveal", disabled: !available("files") },
        null,
        { label: "Copy Path", action: "context-copy-path", disabled: !globalThis.navigator?.clipboard?.writeText },
      ],
      "desktop-app": [
        { label: "Open", action: "context-open-app" },
        { label: "Show in Files", action: "context-reveal-app", disabled: !available("files") },
        null,
        pinItem,
      ],
      dock: [
        ...appWindows.map((entry) => ({ label: `${entry.title || contextApp.name}${entry.minimized ? " — Minimized" : ""}`, action: "context-focus-window", window: entry.id, checked: entry.id === this.os.windows.activeWindowId })),
        ...(appWindows.length ? [null] : []),
        { label: appWindows.length ? "Show" : "Open", action: "context-open-app" },
        ...(contextApp && !contextApp.singleton ? [{ label: "New Window", action: "context-new-window" }] : []),
        null,
        pinItem,
        { label: "Show in Files", action: "context-reveal-app", disabled: !available("files") },
        ...(appWindows.length ? [null, { label: "Quit", action: "context-quit" }] : []),
      ],
      system: [
        { label: `About ${this.os.session.product || "DindbOS"}`, icon: "desktop", action: "about-system" },
        null,
        { label: "System Settings…", icon: "settings", action: "settings", disabled: !available("settings") },
        { label: "Applications…", icon: "apps", action: "launch", app: "applications", disabled: !available("applications") },
        null,
        { label: "Show Desktop", action: "show-desktop", disabled: !this.os.windows.windows.size },
      ],
      app: [
        { label: `About ${app?.name || "Desktop"}`, action: "about" },
        null,
        { label: `Close ${app?.name || "Window"}`, action: "close", shortcut: "⌘ W", disabled: !task },
        ...["File", "Edit", "View", "Window", "Help"].filter(label => !APP_MENU_NAMES.includes(label.toLowerCase()) || applicationMenuItems(this.shell, label.toLowerCase(), task, app, editable).length).map((label) => ({ label: `${label}…`, action: "open-menu", menu: label.toLowerCase(), compact: true })),
      ],
      window: [
        { label: "Minimize", action: "minimize", shortcut: "⌘ M", disabled: !task },
        { label: task?.maximized ? "Restore Size" : "Zoom", action: "maximize", disabled: !task },
        null,
        ...[...this.os.windows.windows.values()].map((entry) => ({ label: entry.title || entry.appId, action: "focus-window", window: entry.id, checked: entry.id === task?.id })),
      ],
    }[name] || [];
    const items = APP_MENU_NAMES.includes(name) ? applicationMenuItems(this.shell, name, task, app, editable) : defaults;
    this.disposePanel();
    this.menuTask = task;
    this.menuEditor = editable ? this.shell.editTarget : null;
    this.menuActions = new Map();
    items.forEach((item, index) => {
      if (typeof item?.run !== "function") return;
      const callback = item.run;
      this.menuActions.set(String(index), () => {
        if (task && this.os.windows.windows.get(task.id) !== task) return;
        return callback();
      });
      item.action = "application-command";
      item.command = String(index);
    });
    this.shell.refs.overlays.innerHTML = `<div class="dos-shell-menu" role="menu" aria-label="${escapeHtml(name)} menu">${items.map((item) => item ? `<button type="button" role="menuitem" ${item.compact ? 'class="dos-compact-menu-item"' : ""} data-shell-action="${item.action}" ${item.command !== undefined ? `data-command="${item.command}"` : ""} ${item.section ? `data-section="${item.section}"` : ""} ${item.menu ? `data-menu="${item.menu}"` : ""} ${item.app ? `data-app="${escapeHtml(item.app)}"` : ""} ${item.window ? `data-window="${escapeHtml(item.window)}"` : ""} ${item.disabled ? "disabled" : ""}><span class="dos-menu-check" aria-hidden="true">${item.icon ? controlIcon(item.icon) : item.checked ? "✓" : ""}</span><span>${escapeHtml(item.label)}</span><kbd>${escapeHtml(item.shortcut || "")}</kbd></button>` : `<div class="dos-menu-divider" role="separator"></div>`).join("")}</div>`;
    const menu = this.shell.refs.overlays.firstElementChild;
    const rootRect = this.shell.refs.shell.getBoundingClientRect?.();
    const triggerRect = trigger?.getBoundingClientRect?.();
    if (rootRect && triggerRect) menu.style.left = `${Math.max(6, Math.min(triggerRect.left - rootRect.left, rootRect.width - 248))}px`;
    menu.tabIndex = -1;
    (menu.querySelector?.("button:not(:disabled)") || menu).focus({ preventScroll: true });
  }

  renderLauncher() {
    const panel = this.panel(`
      <div class="dos-launcher-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" placeholder="Search applications" aria-label="Search applications" data-shell-search autocomplete="off"><kbd>esc</kbd></div>
      <div class="dos-launcher-results" aria-label="Applications"></div>
      <footer class="dos-launcher-footer"><span>Applications</span><span>↑ ↓ to navigate <span aria-hidden="true">·</span> ↵ to open</span></footer>`, "dos-launcher", "Search applications");
    this.renderLauncherResults("");
    panel.querySelector("input")?.focus({ preventScroll: true });
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
    const fullscreen = Boolean(this.shell.root.requestFullscreen && this.shell.root.ownerDocument?.fullscreenEnabled);
    const panel = this.panel(`
      <header class="cc-heading"><h2>Control Center</h2><button type="button" data-shell-action="dismiss" class="dos-panel-close" aria-label="Close Control Center">×</button></header>
      <div class="cc-grid">
        <section class="cc-tile cc-appearance" data-glass-surface="control-tile" aria-label="Appearance">
          <div class="cc-tile-heading"><span class="cc-symbol" aria-hidden="true">${controlIcon("appearance")}</span><div><h3>Appearance</h3><span data-control-mode>Auto</span></div></div>
          <div class="cc-mode-options" role="group" aria-label="Appearance mode">${[["light", "Light", "sun"], ["dark", "Dark", "moon"], ["system", "Auto", "appearance"]].map(([value, label, glyph]) => `<button type="button" data-shell-action="mode" data-value="${value}" aria-label="${label}" title="${label}" aria-pressed="false">${controlIcon(glyph)}</button>`).join("")}</div>
        </section>
        <section class="cc-tile cc-media" data-glass-surface="control-tile" aria-label="Now Playing">
          <button type="button" class="cc-artwork" data-shell-action="control-media-open" aria-label="Open Music">${controlIcon("music")}</button>
          <button type="button" class="cc-track" data-shell-action="control-media-open" aria-label="Open Music"><strong data-control-track>Not Playing</strong><span data-control-playback>Music</span></button>
          <div class="cc-transport"><button type="button" data-shell-action="control-media-previous" aria-label="Previous song" disabled>${controlIcon("previous")}</button><button type="button" data-shell-action="control-media-play" aria-label="Play" disabled>${controlIcon("play")}</button><button type="button" data-shell-action="control-media-next" aria-label="Next song" disabled>${controlIcon("next")}</button></div>
        </section>
        <button type="button" class="cc-tile cc-action cc-desktop" data-glass-surface="control-tile" data-shell-action="show-desktop"><span class="cc-symbol" aria-hidden="true">${controlIcon("desktop")}</span><span><strong>Show Desktop</strong><small>Minimize windows</small></span></button>
        <button type="button" class="cc-tile cc-action cc-applications" data-glass-surface="control-tile" data-shell-action="launch" data-app="applications" ${this.os.apps.has("applications") ? "" : "disabled"}><span class="cc-symbol" aria-hidden="true">${controlIcon("apps")}</span><span><strong>Applications</strong><small>All your apps</small></span></button>
        ${fullscreen ? `<button type="button" class="cc-tile cc-action cc-fullscreen" data-glass-surface="control-tile" data-shell-action="control-fullscreen" aria-pressed="false"><span class="cc-symbol" aria-hidden="true">${controlIcon("fullscreen")}</span><span><strong>Full Screen</strong><small data-control-fullscreen>Desktop</small></span></button>` : `<button type="button" class="cc-tile cc-action cc-settings" data-glass-surface="control-tile" data-shell-action="settings" ${this.os.apps.has("settings") ? "" : "disabled"}><span class="cc-symbol" aria-hidden="true">${controlIcon("settings")}</span><span><strong>Settings</strong><small>Personalize</small></span></button>`}
        <section class="cc-tile cc-sound" data-glass-surface="control-tile" aria-label="Sound"><div class="cc-sound-heading"><h3>Sound</h3><span data-control-sound-status>Music volume</span></div><label class="cc-volume"><span aria-hidden="true">${controlIcon("volume-low")}</span><input type="range" min="0" max="1" step=".05" value=".7" data-control-volume aria-label="Music volume" disabled><span aria-hidden="true">${controlIcon("volume-high")}</span></label></section>
      </div>
      <button type="button" class="cc-settings-link" data-shell-action="settings" ${this.os.apps.has("settings") ? "" : "disabled"}>System Settings…</button>`, "dos-control-center", "Control Center");
    const update = () => this.updateControls();
    for (const event of ["play", "pause", "ended", "loadedmetadata", "emptied", "volumechange"]) this.shell.root.addEventListener(event, update, true);
    const document = this.shell.root.ownerDocument;
    document.addEventListener("fullscreenchange", update);
    const windowLayer = this.shell.refs.windowLayer;
    const Observer = document.defaultView?.MutationObserver;
    const observer = Observer && windowLayer ? new Observer(update) : null;
    observer?.observe(windowLayer, { childList: true, subtree: true });
    this.controlsCleanup = () => {
      for (const event of ["play", "pause", "ended", "loadedmetadata", "emptied", "volumechange"]) this.shell.root.removeEventListener(event, update, true);
      document.removeEventListener("fullscreenchange", update);
      observer?.disconnect();
    };
    this.updateControls();
    if (this.shell.activePanel === "controls") panel.querySelector("button")?.focus({ preventScroll: true });
  }

  controlAudio() {
    const sources = [...this.shell.root.querySelectorAll(".music-app audio")].filter(audio => audio.closest(".dindbos-host") === this.shell.root);
    return sources.find(audio => !audio.paused && audio.getAttribute("src")) || sources.find(audio => audio.getAttribute("src")) || sources[0] || null;
  }

  updateControls() {
    const overlay = this.shell.refs.overlays;
    const panel = overlay.querySelector(".dos-control-center");
    if (!panel) return;
    const mode = this.os.appearance?.mode || "system";
    panel.querySelectorAll("[data-shell-action='mode']").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.value === mode)));
    const modeLabel = panel.querySelector("[data-control-mode]");
    if (modeLabel) modeLabel.textContent = { light: "Light", dark: "Dark", system: "Auto" }[mode] || "Auto";
    const audio = this.controlAudio();
    const app = audio?.closest(".music-app");
    const hasTrack = Boolean(audio?.getAttribute("src"));
    const title = app?.querySelector("[data-music-title]")?.textContent;
    const track = panel.querySelector("[data-control-track]");
    if (track) track.textContent = hasTrack ? title || "Music" : "Not Playing";
    const playback = panel.querySelector("[data-control-playback]");
    if (playback) playback.textContent = hasTrack ? audio.paused ? "Paused" : "Playing" : "Music";
    for (const action of ["previous", "next", "play"]) {
      const button = panel.querySelector(`[data-shell-action="control-media-${action}"]`);
      if (!button) continue;
      button.disabled = action === "play" ? !hasTrack : !hasTrack || Boolean(app.querySelector(`[data-media-action="${action}"]`)?.disabled);
      if (action === "play") {
        button.setAttribute("aria-label", hasTrack && !audio.paused ? "Pause" : "Play");
        button.innerHTML = controlIcon(hasTrack && !audio.paused ? "pause" : "play");
      }
    }
    const volume = panel.querySelector("[data-control-volume]");
    if (volume) { volume.disabled = !audio; if (volume !== this.shell.root.ownerDocument.activeElement) volume.value = String(audio?.volume ?? .7); }
    const soundStatus = panel.querySelector("[data-control-sound-status]");
    if (soundStatus) soundStatus.textContent = audio ? "Music volume" : "Open Music to adjust";
    panel.querySelectorAll('[data-shell-action="control-media-open"]').forEach(button => button.disabled = !this.os.apps.has("music"));
    const fullscreen = panel.querySelector('[data-shell-action="control-fullscreen"]');
    if (fullscreen) {
      const active = this.shell.root.ownerDocument.fullscreenElement === this.shell.root;
      fullscreen.setAttribute("aria-pressed", String(active));
      const status = panel.querySelector("[data-control-fullscreen]");
      if (status) status.textContent = active ? "On" : "Desktop";
    }
  }

  renderCalendar() {
    const now = new Date();
    const date = this.calendarDate;
    const panel = this.panel(`
      <header><div><p class="dos-calendar-today">${escapeHtml(now.toLocaleDateString(undefined, { weekday: "long" }))}</p><h2>${escapeHtml(now.toLocaleDateString(undefined, { month: "long", day: "numeric" }))}</h2></div><button type="button" data-shell-action="calendar-today" class="dos-calendar-today-action">Today</button></header>
      <div class="dos-calendar-month"><strong>${escapeHtml(date.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</strong><div><button type="button" data-shell-action="calendar-prev" aria-label="Previous month">‹</button><button type="button" data-shell-action="calendar-next" aria-label="Next month">›</button></div></div>
      <div class="dos-calendar-week" aria-hidden="true">${["M", "T", "W", "T", "F", "S", "S"].map((day) => `<span>${day}</span>`).join("")}</div>
      <div class="dos-calendar-grid" role="list" aria-label="Days in ${escapeHtml(date.toLocaleDateString(undefined, { month: "long", year: "numeric" }))}">${calendarCells(date).map((day) => day ? `<span role="listitem" ${sameDate(day, now) ? 'class="is-today" aria-current="date"' : ""}>${day.getDate()}</span>` : `<span aria-hidden="true"></span>`).join("")}</div>`, "dos-calendar", "Calendar");
    panel.querySelector("button")?.focus({ preventScroll: true });
  }

  renderAbout(task = this.shell.activeTask(), system = false) {
    this.shell.activePanel = "about";
    const app = this.os.apps.list().find((entry) => entry.id === task?.appId);
    const name = (!system && app?.name) || this.os.session.product || "DindbOS";
    const panel = this.panel(`<button type="button" class="dos-panel-close" data-shell-action="dismiss" aria-label="Close About">×</button><div class="dos-about-mark" aria-hidden="true">D</div><h2>${escapeHtml(name)}</h2><p>A desktop for the web.</p><p class="dos-about-detail">${!system && app ? "Running in DindbOS" : "Built with DindbOS"}</p><button type="button" class="dos-panel-link" data-shell-action="launcher">Explore applications</button>`, "dos-about", `About ${name}`);
    panel.querySelector("button")?.focus({ preventScroll: true });
  }

  disposePanel() {
    this.menuTask = null;
    this.menuEditor = null;
    this.menuActions?.clear();
    this.controlsCleanup?.();
    this.controlsCleanup = null;
    this.launcherRoot?.unmount();
    this.launcherRoot = null;
  }

  handleInput(event) {
    if (event.target.matches?.("[data-control-volume]")) {
      const audio = this.controlAudio();
      if (audio) {
        audio.volume = Math.max(0, Math.min(1, Number(event.target.value)));
        const slider = audio.closest(".music-app")?.querySelector('[aria-label="Volume"]');
        if (slider) slider.value = String(audio.volume);
      }
    }
    if (event.target.matches?.("[data-shell-search]")) this.renderLauncherResults(event.target.value);
    if (event.target.matches?.("[data-shell-dock-size]")) this.os.setAppearance?.({ dockSize: Number(event.target.value) });
  }

  handleChange(event) {
    if (event.target.matches?.("[data-shell-dock-size]")) this.os.setAppearance?.({ dockSize: Number(event.target.value) });
  }

  runAction(action, data = {}) {
    const capturedTask = this.menuTask;
    const task = capturedTask ? this.os.windows.windows.get(capturedTask.id) === capturedTask ? capturedTask : null : this.shell.activeTask();
    if (action === "application-command") {
      const callback = this.menuActions?.get(data.command);
      this.shell.closePanel(false);
      return callback?.();
    }
    if (action.startsWith("control-media-")) {
      if (action === "control-media-open") { this.shell.closePanel(false); this.shell.launchApp("music"); return; }
      const name = action.slice("control-media-".length);
      const audio = this.controlAudio();
      const button = audio?.closest(".music-app")?.querySelector(`[data-media-action="${name}"]`);
      if (button && !button.disabled) button.click();
      this.updateControls();
      return;
    }
    if (action === "control-fullscreen") {
      const document = this.shell.root.ownerDocument;
      const operation = document.fullscreenElement === this.shell.root ? document.exitFullscreen?.() : !document.fullscreenElement ? this.shell.root.requestFullscreen?.() : null;
      operation?.catch?.(() => this.shell.notify("Full screen is unavailable in this browser."));
      return;
    }
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
    if (["about", "about-system", "launcher", "controls"].includes(action)) {
      const trigger = this.shell.returnFocus;
      this.shell.closePanel(false);
      this.shell.returnFocus = trigger;
      this.shell.activePanel = action;
      if (action === "about" || action === "about-system") this.renderAbout(task, action === "about-system");
      else this.open(action);
      return;
    }
    const editor = capturedTask ? this.menuEditor : this.shell.editTarget;
    const contextNode = this.shell.contextNode;
    const contextApp = this.shell.contextApp;
    this.shell.closePanel(false);
    if (action === "desktop-open" && contextNode) this.os.openNode(contextNode);
    else if (action === "context-open-app" && contextApp) this.shell.launchApp(contextApp.id);
    else if (action === "context-new-window" && contextApp) this.shell.launchApp(contextApp.id, {});
    else if (action === "context-focus-window") this.os.windows.restore(data.window);
    else if (action === "context-reveal-app" && contextApp) this.shell.launchApp("files", { path: "/usr/share/applications" });
    else if (action === "context-pin" && contextApp) this.os.registerApp({ ...contextApp, pinned: !contextApp.pinned });
    else if (action === "context-quit" && contextApp) return this.quitApp(contextApp.id);
    else if (action === "context-copy-path" && contextNode) return globalThis.navigator.clipboard.writeText(contextNode.path);
    else if (action === "desktop-new-folder") {
      const desktopPath = this.os.session.desktopPath || this.os.fs.join(this.os.session.home, "Desktop");
      let name = "Untitled Folder";
      let suffix = 2;
      while (this.os.fs.exists(this.os.fs.join(desktopPath, name))) name = `Untitled Folder ${suffix++}`;
      this.os.fs.createDirectory(this.os.fs.join(desktopPath, name), "/", { owner: this.os.session.user, group: this.os.session.groups?.[0] || "users" });
      this.shell.renderDesktop();
      return this.os.flushPersistentFileSystem?.();
    }
    else if (action === "desktop-reveal" && contextNode) this.shell.launchApp("files", { path: this.os.fs.dirname(contextNode.path) });
    else if (action === "settings") this.shell.openSettings(data.section);
    else if (action === "launch") this.shell.launchApp(data.app);
    else if (action === "launch-new") this.shell.launchApp(data.app, {});
    else if (action === "close" && task) this.os.windows.close(task.id);
    else if (action === "minimize" && task) this.os.windows.minimize(task.id);
    else if (action === "maximize" && task) this.os.windows.maximize(task.id);
    else if (action === "focus-window") this.os.windows.activate(data.window);
    else if (action === "show-desktop") [...this.os.windows.windows.values()].filter((window) => !window.minimized).forEach((window) => this.os.windows.minimize(window.id));
    else if (action === "refresh") this.shell.renderDesktop();
    else if (action.startsWith("edit-") && editor?.isConnected && (!capturedTask || task)) {
      if (task) this.os.windows.focus(task.id);
      editor.focus({ preventScroll: true });
      const command = action.slice(5);
      if (command === "selectAll" && typeof editor.select === "function") editor.select();
      else if (command === "paste") this.pasteInto(editor);
      else this.shell.root.ownerDocument?.execCommand?.(command);
    }
  }

  async quitApp(appId) {
    const windows = [...this.os.windows.windows.values()].filter((entry) => entry.appId === appId).reverse();
    for (const entry of windows) {
      if (await this.os.windows.close(entry.id) === false) return false;
    }
    return true;
  }

  async pasteInto(editor) {
    try {
      const text = await globalThis.navigator?.clipboard?.readText?.();
      if (text === undefined || !editor.isConnected || !this.shell.root.contains(editor)) return;
      editor.focus({ preventScroll: true });
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

const CONTROL_GLYPHS = {
  appearance: '<path d="M12 3a9 9 0 1 0 0 18V3Z"/><circle cx="12" cy="12" r="9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z"/>',
  desktop: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  fullscreen: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  settings: '<circle cx="12" cy="12" r="4"/><path d="m10 3-1 3-3 1-3-1v4l3 2-1 3-2 2 3 3 3-1 3 2 2-3 3-1 3 1v-4l-3-2 1-3 2-2-3-3-3 1-3-2Z"/>',
  music: '<path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="17" rx="3" ry="2"/><ellipse cx="17" cy="15" rx="3" ry="2"/>',
  previous: '<path d="M5 5v14m14-14L8 12l11 7Z"/>', next: '<path d="M19 5v14M5 5l11 7-11 7Z"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>', pause: '<path d="M8 4v16M16 4v16"/>',
  'volume-low': '<path d="m11 5-5 4H3v6h3l5 4Z"/>',
  'volume-high': '<path d="m11 5-5 4H3v6h3l5 4Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
};
function controlIcon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CONTROL_GLYPHS[name] || ""}</svg>`; }
