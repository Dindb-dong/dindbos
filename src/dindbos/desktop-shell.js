import { mountMobileAppNavigation } from "../ui/platforms/mobile-app-navigation.js";
import { normalizeUIStyleOptions, resolveUIStyle } from "./ui-style.js";
import { mountWindowsShell } from "../ui/platforms/windows.js";
import { mountIOSShell } from "../ui/platforms/ios.js";
import { mountAndroidShell } from "../ui/platforms/android.js";
import { createDesktopRenderer } from "../ui/desktop-view.js";
import { ShellPanels } from "../ui/shell-panels.js";
import { attachLiquidGlass } from "../ui/liquid-glass.js";
import { APP_MENU_NAMES, applicationMenuItems, customAppMenus, menuItemEnabled, matchesAccelerator } from "../ui/app-menus.js";

export class DesktopShell {
  constructor(os) {
    this.os = os;
    this.refs = {};
    this.renderer = null;
    this.cleanups = [];
    this.slotCleanups = new Map();
    this.activePanel = "";
    this.returnFocus = null;
  }

  mount(root) {
    this.destroy();
    this.root = root;
    this.styleOptions = normalizeUIStyleOptions(this.os.uiOptions || {});
    root.innerHTML = `
      <main class="dos-shell">
        <header class="dos-menubar"></header>
        <nav class="dos-taskstrip" aria-label="Open windows" hidden></nav>
        <section class="dos-desktop" aria-label="Desktop"></section>
        <aside class="dos-dock" aria-label="Pinned apps"></aside>
        <section class="dos-window-layer" aria-label="Application windows"></section>
        <div class="dos-shell-overlays"></div>
      </main>`;
    for (const [key, selector] of Object.entries({ shell: ".dos-shell", menubar: ".dos-menubar", desktop: ".dos-desktop", dock: ".dos-dock", windowLayer: ".dos-window-layer", taskStrip: ".dos-taskstrip", overlays: ".dos-shell-overlays" })) {
      this.refs[key] = root.querySelector(selector);
    }
    this.panels = new ShellPanels(this);
    this.renderer = createDesktopRenderer({
      desktopElement: this.refs.desktop,
      dockElement: this.refs.dock,
      overlayElement: this.refs.overlays,
      getStyle: () => this.currentStyle,
      hasTrustedSurface: () => this.os.windows.hasVisibleTrustedSurface?.(),
      isMobile: () => ["ios", "android"].includes(this.currentStyle) || (this.root.clientWidth || 1024) <= 760,
      onOpenNode: (node) => this.os.openNode(node),
      onLaunchApp: (id) => this.launchApp(id),
    });
    this.renderSlot("menubar", this.menuState(), () => this.renderMenubar());
    const owns = (event) => !event.target?.closest || event.target.closest(".dindbos-host") === root;
    this.listen(root, "focusin", (event) => {
      if (!owns(event)) return;
      if (isEditable(event.target)) this.editTarget = event.target;
      else if (event.target.closest?.(".dos-window")) this.editTarget = null;
    });
    this.listen(root, "click", (event) => { if (owns(event)) this.handleClick(event); });
    this.listen(root, "keydown", (event) => { if (owns(event)) this.handleKeyDown(event); });
    this.listen(root, "contextmenu", (event) => {
      if (!owns(event)) return;
      this.openDesktopContext(event);
    });
    this.listen(root, "input", (event) => { if (owns(event)) this.panels.handleInput(event); });
    this.listen(root, "change", (event) => { if (owns(event)) this.panels.handleChange(event); });
    this.listen(root.ownerDocument || globalThis.document, "pointerdown", (event) => {
      if (!this.activePanel) return;
      const trigger = event.target.closest?.("[data-shell-panel]");
      if (!this.refs.overlays.contains?.(event.target) && !(trigger && this.root.contains?.(trigger))) this.closePanel(false);
    });
    const unsubscribe = this.os.bus?.on?.("appearance:change", () => {
      if (this.activePanel === "controls") this.panels.updateControls();
    });
    if (typeof unsubscribe === "function") this.cleanups.push(unsubscribe);
    const unsubscribeUI = this.os.bus?.on?.("ui:preference-change", () => this.updateStyle());
    if (typeof unsubscribeUI === "function") this.cleanups.push(unsubscribeUI);
    this.clockTimer = globalThis.setInterval(() => this.tickClock(), 1000);
    this.clockTimer.unref?.();
    this.tickClock();
    this.updateStyle();
    const ResizeObserverType = root.ownerDocument?.defaultView?.ResizeObserver || globalThis.ResizeObserver;
    if (ResizeObserverType) {
      const observer = new ResizeObserverType(() => this.updateStyle());
      observer.observe(root);
      this.cleanups.push(() => observer.disconnect());
    } else this.listen(globalThis.window, "resize", () => this.updateStyle());
    if (this.os.uiOptions?.liquidGlass !== false) this.cleanups.push(attachLiquidGlass(root, this.os.uiOptions?.liquidGlass === true ? {} : this.os.uiOptions?.liquidGlass || {}));
  }

  updateStyle() {
    const configured = resolveUIStyle(this.styleOptions, this.root.clientWidth || 1024, this.root.clientHeight || 768, this.root.ownerDocument?.defaultView?.navigator);
    const mode = ["ios", "android"].includes(configured) ? "mobile" : "desktop";
    const style = this.os.getUIStylePreference?.()[mode] || configured;
    if (this.currentStyle === style) return;
    const mobilePanes = ["ios", "android"].includes(this.currentStyle) && ["ios", "android"].includes(style)
      ? [...this.root.querySelectorAll(".dos-window[data-mobile-pane]")].filter(frame => frame.closest(".dindbos-host") === this.root).map(frame => [frame, frame.dataset.mobilePane]) : [];
    this.closePanel(false);
    this.styleCleanup?.();
    for (const [frame, pane] of mobilePanes) frame.dataset.mobilePane = pane;
    this.styleCleanup = null;
    const initial = !this.currentStyle;
    this.currentStyle = style;
    this.root.dataset.uiStyle = style;
    if (!initial) this.renderSlot("menubar", this.menuState(), () => this.renderMenubar());
    const mount = { windows: mountWindowsShell, ios: mountIOSShell, android: mountAndroidShell }[style];
    const shellCleanup = mount?.(this);
    const appCleanup = ["ios", "android"].includes(style) ? mountMobileAppNavigation(this) : null;
    this.styleCleanup = () => { try { appCleanup?.(); } finally { shellCleanup?.(); } };
    if (!initial) {
      this.renderDesktop();
      this.renderDock();
      this.os.windows?.keepWindowsInViewport?.();
    }
    this.tickClock();
  }

  listen(target, name, handler, options) {
    target?.addEventListener?.(name, handler, options);
    this.cleanups.push(() => target?.removeEventListener?.(name, handler, options));
  }

  openDesktopContext(event) {
    const target = event.target;
    const dockItem = target.closest?.(".dos-dock-item[data-dock-app-id]");
    const desktop = target.closest?.(".dos-desktop");
    if (!dockItem && !desktop && target !== this.refs.shell && target !== this.root) return;
    event.preventDefault();
    const icon = target.closest?.("[data-desktop-path]");
    this.contextNode = icon ? this.os.fs.lstat(icon.dataset.desktopPath) : null;
    const appId = dockItem?.dataset.dockAppId || icon?.dataset.desktopAppId;
    this.contextApp = appId ? this.os.apps.list().find((app) => app.id === appId) : null;
    const kind = dockItem ? "dock" : this.contextApp ? "desktop-app" : icon ? "desktop-item" : "desktop";
    this.openPanel(kind, dockItem || icon);
    if (dockItem) this.refs.dock.dataset.contextOpen = "true";
    const menu = this.refs.overlays.firstElementChild;
    const bounds = this.refs.shell.getBoundingClientRect();
    const anchor = (dockItem || icon)?.getBoundingClientRect();
    const x = dockItem && anchor ? anchor.left + anchor.width / 2 - menu.offsetWidth / 2 : event.clientX || anchor?.left || bounds.left;
    const y = dockItem && anchor ? anchor.top - menu.offsetHeight - 8 : event.clientY || anchor?.bottom || bounds.top + 34;
    menu.style.left = `${Math.max(6, Math.min(x - bounds.left, bounds.width - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(34, Math.min(y - bounds.top, bounds.height - menu.offsetHeight - 8))}px`;
  }

  renderSlot(name, state, defaultRender) {
    const previousCleanup = this.slotCleanups.get(name);
    this.slotCleanups.delete(name);
    previousCleanup?.();
    const element = this.refs[name];
    const slot = this.os.uiOptions?.slots?.[name];
    if (typeof slot !== "function") return defaultRender();
    const cleanup = slot({
      element,
      state,
      actions: {
        launch: (id, context) => this.launchApp(id, context),
        openNode: (node) => this.os.openNode(node),
        setAppearance: (next) => this.os.setAppearance?.(next),
      },
      defaultRender,
    });
    if (typeof cleanup === "function") this.slotCleanups.set(name, cleanup);
  }

  renderMenubar() {
    const product = escapeHtml(this.os.session.product || "DindbOS");
    this.refs.menubar.innerHTML = `
      <nav class="dos-app-menus" aria-label="Application menu" role="menubar">
        <button class="dos-system-menu" type="button" data-shell-panel="system" aria-label="${product} menu" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="16" rx="4"/><path d="M8 8h3a4 4 0 0 1 0 8H8zM9 22h6"/></svg></button>
        <button class="dos-active-app" type="button" data-shell-panel="app" aria-haspopup="menu" aria-expanded="false">Desktop</button>
        ${["File", "Edit", "View", "Window", "Help"].map((name) => `<button class="dos-menu-label" type="button" data-shell-panel="${name.toLowerCase()}" aria-haspopup="menu" aria-expanded="false">${name}</button>`).join("")}
      </nav>
      <div class="dos-menu-status">
        <button type="button" class="dos-status-button" data-shell-panel="launcher" aria-label="Search applications" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>
        <button type="button" class="dos-status-button" data-shell-panel="controls" aria-label="Control Center" aria-haspopup="dialog" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="3"/><rect x="3" y="14" width="18" height="6" rx="3"/><circle cx="8" cy="7" r="1"/><circle cx="16" cy="17" r="1"/></svg><span class="dos-mobile-status" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 20v-4m6 4v-8m6 8V8m6 12V4"/></svg><svg viewBox="0 0 24 24"><path d="M3 9q9-8 18 0M6 13q6-6 12 0m-9 4q3-3 6 0"/><circle cx="12" cy="20" r="1"/></svg></span></button>
        <button type="button" class="dos-clock-button" data-shell-panel="calendar" aria-label="Date and calendar" aria-haspopup="dialog" aria-expanded="false"><time class="dos-clock"></time></button>
      </div>`;
    this.refs.clock = this.refs.menubar.querySelector(".dos-clock");
    this.updateMenubar(true);
  }

  menuState() {
    return { session: this.os.session, apps: this.os.apps.list(), activeWindow: this.activeTask() || null, appearance: this.os.appearance };
  }

  activeTask() {
    return this.os.windows?.windows?.get(this.os.windows.activeWindowId);
  }

  updateMenubar(defaultOnly = false) {
    if (!defaultOnly && typeof this.os.uiOptions?.slots?.menubar === "function") {
      this.renderSlot("menubar", this.menuState(), () => this.renderMenubar());
      return;
    }
    const task = this.activeTask();
    const app = task && this.os.apps?.list?.().find((item) => item.id === task.appId);
    const button = this.refs.menubar?.querySelector?.(".dos-active-app");
    if (button) button.textContent = app?.name || task?.appId || "Desktop";
    for (const name of APP_MENU_NAMES) {
      const trigger = this.refs.menubar?.querySelector?.(`[data-shell-panel="${name}"]`);
      if (trigger) trigger.hidden = !applicationMenuItems(this, name, task, app, Boolean(this.editTarget?.isConnected)).length;
    }
  }

  renderDesktop() {
    const desktopPath = this.os.session.desktopPath || this.os.fs.join(this.os.session.home, "Desktop");
    const mobile = ["ios", "android"].includes(this.currentStyle);
    const nodes = this.os.fs.list(desktopPath);
    if (mobile) {
      const present = new Set(nodes.map((node) => this.os.fs.resolveNode(node).appId).filter(Boolean));
      for (const node of this.os.fs.list("/usr/share/applications")) {
        const appId = this.os.fs.resolveNode(node).appId;
        if (appId && !present.has(appId)) { nodes.push(node); present.add(appId); }
      }
    }
    const entries = nodes.map((node) => {
      const resolved = this.os.fs.resolveNode(node);
      const app = resolved.appId && this.os.apps.list().find((item) => item.id === resolved.appId);
      return { node, name: mobile && app ? app.name : node.name, path: node.path, appId: app?.id, category: app?.category, kind: resolved.type, icon: app?.icon || resolved.icon || resolved.type };
    });
    this.renderSlot("desktop", { entries }, () => this.renderer.renderDesktop(entries));
  }

  renderDock() {
    const apps = this.os.apps.list().filter((app) => app.pinned);
    const dockApps = this.os.windows?.dockApps?.(new Set(apps.map((app) => app.id))) || [];
    const appStates = this.os.windows?.appDockStates?.() || {};
    this.renderSlot("dock", { apps, dockApps, appStates }, () => this.renderer.renderDock(apps, dockApps, appStates));
    this.updateMenubar();
  }

  launchApp(id, context) {
    this.closePanel(false);
    if (!context && this.os.windows?.restoreLatestMinimizedApp?.(id)) return;
    if (!context && this.os.windows?.focusLatestAppWindow?.(id)) return;
    return this.os.launch(id, context || {});
  }

  openSettings(section) {
    if (!this.os.apps.has("settings")) return;
    this.closePanel(false);
    const existing = [...this.os.windows.windows.values()].find((entry) => entry.appId === "settings");
    if (existing) {
      this.os.windows.restore(existing.id);
      if (section) {
        const content = this.root.querySelector('.dos-window[data-app-id="settings"] .dos-window-content');
        const CustomEventType = this.root.ownerDocument.defaultView.CustomEvent;
        content?.dispatchEvent(new CustomEventType("dindbos:settings-navigate", { detail: { section } }));
      }
      return existing;
    }
    return this.os.launch("settings", section ? { section } : {});
  }

  handleClick(event) {
    const button = event.target.closest?.("[data-shell-panel]");
    if (button && this.root.contains?.(button)) {
      const panel = button.dataset.shellPanel;
      if (this.activePanel === panel) this.closePanel();
      else this.openPanel(panel, button);
      return;
    }
    const action = event.target.closest?.("[data-shell-action]");
    if (action && !action.disabled) {
      try { Promise.resolve(this.panels.runAction(action.dataset.shellAction, action.dataset)).catch((error) => this.notify(error.message || "The action could not be completed.")); }
      catch (error) { this.notify(error.message || "The action could not be completed."); }
    }
  }

  openPanel(name, trigger) {
    const previousEditor = this.root.ownerDocument?.activeElement;
    this.closePanel(false);
    this.returnFocus = trigger || previousEditor;
    if (isEditable(previousEditor)) this.editTarget = previousEditor;
    this.activePanel = name;
    trigger?.setAttribute?.("aria-expanded", "true");
    trigger?.classList?.add("is-open");
    this.panels.open(name, trigger);
  }

  closePanel(restoreFocus = true) {
    if (!this.activePanel) return;
    this.activePanel = "";
    if (this.refs.dock?.dataset) delete this.refs.dock.dataset.contextOpen;
    this.panels?.disposePanel();
    this.refs.overlays?.replaceChildren?.();
    this.root?.querySelectorAll?.("[data-shell-panel][aria-expanded='true']").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
      button.classList.remove("is-open");
    });
    if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  handleKeyDown(event) {
    const closestHost = event.target?.closest?.(".dindbos-host");
    if (closestHost && closestHost !== this.os.root) return;
    if (!event.defaultPrevented && !this.activePanel && !this.os.windows?.hasVisibleTrustedSurface?.()) {
      const modal = [...this.root.querySelectorAll('[aria-modal="true"]')].some(element => element.closest('.dindbos-host') === this.root && !element.hidden && element.getClientRects().length);
      const task = this.activeTask();
      const app = task && this.os.apps.list().find(entry => entry.id === task.appId);
      const custom = !modal && customAppMenus(this, task, app);
      const item = custom && APP_MENU_NAMES.flatMap(name => Array.isArray(custom.menus[name]) ? custom.menus[name] : []).find(item => item && matchesAccelerator(event, item.accelerator));
      if (item && typeof item.run === "function" && menuItemEnabled(this, app, item, custom.context)) {
        event.preventDefault(); event.stopPropagation();
        try { Promise.resolve(item.run(custom.context)).catch(error => this.notify(error.message || "The menu command failed.")); }
        catch (error) { this.notify(error.message || "The menu command failed."); }
        return;
      }
    }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      this.openDesktopContext(event);
      if (event.defaultPrevented) return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.openPanel("launcher", this.refs.menubar.querySelector("[data-shell-panel='launcher']"));
      return;
    }
    if (event.key === "Escape" && this.activePanel) {
      event.preventDefault();
      event.stopPropagation();
      this.closePanel();
      return;
    }
    if (!this.activePanel) {
      const trigger = event.target.closest?.("[data-shell-panel]");
      if (event.key === "ArrowDown" && trigger) {
        event.preventDefault();
        this.openPanel(trigger.dataset.shellPanel, trigger);
      }
      return;
    }
    if (event.key === "Enter" && event.target.matches?.("[data-shell-search]")) {
      const first = this.refs.overlays.querySelector("[data-launch-result]");
      if (first) { event.preventDefault(); this.panels.runAction("launch", first.dataset); }
      return;
    }
    if (["ArrowLeft", "ArrowRight"].includes(event.key) && this.refs.overlays.querySelector("[role='menu']")) {
      const buttons = [...this.refs.menubar.querySelectorAll(".dos-app-menus [data-shell-panel]")].filter(isVisible);
      const current = buttons.findIndex((button) => button.dataset.shellPanel === this.activePanel);
      const next = buttons[(current + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
      event.preventDefault();
      this.openPanel(next.dataset.shellPanel, next);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (event.target.matches?.("input") && event.key !== "ArrowDown") return;
    const items = [...this.refs.overlays.querySelectorAll("[role='menuitem']:not(:disabled), [data-launch-result]")].filter(isVisible);
    if (!items.length) return;
    const active = this.root.ownerDocument?.activeElement;
    const index = items.indexOf(active);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? items.length - 1 : 1)) % items.length;
    event.preventDefault();
    items[next].focus({ preventScroll: true });
  }

  tickClock() {
    const now = new Date();
    if (!this.refs.clock) return;
    this.refs.clock.dateTime = now.toISOString();
    this.refs.clock.innerHTML = `<span class="dos-clock-date">${escapeHtml(now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</span><span class="dos-clock-time">${escapeHtml(now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(["ios", "android"].includes(this.currentStyle) ? { hour12: false } : {}) }))}</span>`;
    this.refs.clock.title = now.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
  }

  notify(message) {
    if (!this.refs.shell) return;
    globalThis.clearTimeout(this.toastTimer);
    this.toast?.remove();
    this.toast = (this.root.ownerDocument || globalThis.document).createElement("div");
    this.toast.className = "dos-shell-toast";
    this.toast.setAttribute("role", "status");
    this.toast.textContent = message;
    this.refs.shell.appendChild(this.toast);
    this.toastTimer = globalThis.setTimeout(() => { this.toast?.remove(); this.toast = null; }, 4500);
  }

  destroy() {
    const errors = [];
    const attempt = (cleanup) => { try { cleanup(); } catch (error) { errors.push(error); } };
    globalThis.clearTimeout(this.toastTimer);
    this.toast?.remove();
    this.toast = null;
    if (this.clockTimer) globalThis.clearInterval(this.clockTimer);
    this.clockTimer = null;
    attempt(() => this.closePanel(false));
    attempt(() => this.styleCleanup?.());
    this.styleCleanup = null;
    this.currentStyle = null;
    if (this.root?.dataset) delete this.root.dataset.uiStyle;
    const cleanups = [...this.cleanups.splice(0), ...this.slotCleanups.values()];
    this.slotCleanups.clear();
    for (const cleanup of cleanups) attempt(cleanup);
    const renderer = this.renderer;
    this.renderer = null;
    attempt(() => renderer?.unmount?.());
    this.refs = {};
    this.editTarget = null;
    if (errors.length) throw new AggregateError(errors, "Desktop shell cleanup failed");
  }
}

export function isEditable(element) {
  return Boolean(element && (element.isContentEditable || (element.matches?.("input:not([type='button']):not([type='checkbox']):not([type='radio']), textarea") && !element.readOnly && !element.disabled)));
}

export function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function isVisible(element) { return !element.hidden && element.getClientRects?.().length !== 0; }
