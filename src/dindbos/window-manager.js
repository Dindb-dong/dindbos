import { canUseCapability } from "./app-manifest.js?v=20260422-browserd";

const MIN_WIDTH = 340;
const MIN_HEIGHT = 240;
const MINIMIZE_ANIMATION_MS = 160;
const TRUSTED_UI_Z_BASE = 100_000;
const WINDOW_PLACEMENTS_DIR = "/var/lib/dindbos/window-placements";

export class WindowManager {
  constructor(os) {
    this.os = os;
    this.layer = null;
    this.taskStrip = null;
    this.windows = new Map();
    this.trustedSurfaces = new Map();
    this.nextTrustedSurfaceId = 1;
    this.z = 20;
    this.cascade = 0;
    this.activeWindowId = "";
    this.lastInputEvent = null;
    this.lastCapture = null;
    this.inputRouter = {
      routed: 0,
      denied: 0,
      lastRoute: null,
    };
    this.shortcutRouter = {
      routed: 0,
      denied: 0,
      lastShortcut: null,
    };
    this.clipboardRouter = {
      copied: 0,
      pasted: 0,
      denied: 0,
      lastClipboard: null,
    };
    this.pointerLock = {
      activeWindowId: "",
      pid: 0,
      appId: "",
      lockedAt: "",
      releasedAt: "",
      releaseReason: "",
      denied: 0,
      lastRequest: null,
    };
    this.surfaceCapture = {
      captured: 0,
      denied: 0,
      lastCapture: null,
      lastDenied: null,
    };
    this.surfaceCleanup = {
      cleaned: 0,
      lastCleanup: null,
    };
    this.boundKeepWindowsInViewport = () => this.keepWindowsInViewport();
    this.boundHandleGlobalKeyDown = (event) => this.handleGlobalKeyDown(event);
    this.boundHandleGlobalPointerDown = (event) => this.routeInputEvent("pointerdown", event);
    this.boundHandleContextMenu = (event) => this.handleBrowserDefaultEvent("contextmenu", event);
    this.boundHandleSelectStart = (event) => this.handleBrowserDefaultEvent("selectstart", event);
    this.boundHandleCompositionStart = (event) => this.routeInputEvent("compositionstart", event);
    this.boundHandleCompositionUpdate = (event) => this.routeInputEvent("compositionupdate", event);
    this.boundHandleCompositionEnd = (event) => this.routeInputEvent("compositionend", event);
    this.boundHandleDragStart = (event) => this.handleBrowserDefaultEvent("dragstart", event);
    this.boundHandleDragOver = (event) => this.handleBrowserDefaultEvent("dragover", event);
    this.boundHandleDrop = (event) => this.handleBrowserDefaultEvent("drop", event);
  }

  mount(layer, taskStrip) {
    this.layer = layer;
    this.taskStrip = taskStrip;
    globalThis.window?.addEventListener?.("resize", this.boundKeepWindowsInViewport);
    globalThis.window?.addEventListener?.("keydown", this.boundHandleGlobalKeyDown);
    globalThis.window?.addEventListener?.("pointerdown", this.boundHandleGlobalPointerDown);
    globalThis.window?.addEventListener?.("contextmenu", this.boundHandleContextMenu, { capture: true });
    globalThis.window?.addEventListener?.("selectstart", this.boundHandleSelectStart, { capture: true });
    globalThis.window?.addEventListener?.("compositionstart", this.boundHandleCompositionStart);
    globalThis.window?.addEventListener?.("compositionupdate", this.boundHandleCompositionUpdate);
    globalThis.window?.addEventListener?.("compositionend", this.boundHandleCompositionEnd);
    globalThis.window?.addEventListener?.("dragstart", this.boundHandleDragStart, { capture: true });
    globalThis.window?.addEventListener?.("dragover", this.boundHandleDragOver, { capture: true });
    globalThis.window?.addEventListener?.("drop", this.boundHandleDrop, { capture: true });
    this.ensureTrustedSurfacesOnTop();
    this.writeCompositorProcfs("mount");
  }

  has(id) {
    return this.windows.has(id);
  }

  activate(id) {
    const task = this.windows.get(id);
    if (!task) return null;
    this.restore(id);
    this.focus(id);
    return task.api;
  }

  open(config) {
    const existing = this.windows.get(config.id);
    if (existing) {
      this.restore(config.id);
      this.focus(config.id);
      return existing.api;
    }

    const frame = document.createElement("section");
    frame.className = "dos-window";
    frame.dataset.windowId = config.id;
    frame.dataset.appId = config.appId;
    const placement = this.initialPlacement(config);
    Object.assign(frame.style, {
      width: `${placement.width}px`,
      height: `${placement.height}px`,
      left: `${placement.left}px`,
      top: `${placement.top}px`,
    });
    frame.classList.toggle("is-maximized", Boolean(placement.maximized));

    const titlebar = document.createElement("header");
    titlebar.className = "dos-window-titlebar";
    titlebar.innerHTML = `
      <strong>${escapeHtml(config.title)}</strong>
      <div class="dos-window-controls">
        <button type="button" data-window-minimize aria-label="Minimize">-</button>
        <button type="button" data-window-maximize aria-label="Maximize">+</button>
        <button type="button" data-window-close aria-label="Close">x</button>
      </div>
    `;

    const content = document.createElement("div");
    content.className = "dos-window-content";
    frame.append(titlebar, content, createResizeHandles());
    this.layer.appendChild(frame);

    const api = {
      id: config.id,
      close: () => this.close(config.id),
      focus: () => this.focus(config.id),
      getState: (key) => cloneState(key ? task.state[key] : task.state),
      setState: (key, value) => {
        task.state[key] = cloneState(value);
        return cloneState(task.state[key]);
      },
      setTitle: (title) => {
        titlebar.querySelector("strong").textContent = title;
        task.title = title;
        this.syncWindowObject(task);
        this.renderTasks();
      },
      setAccessibilityTree: (tree) => this.setAccessibilityTree(config.id, tree),
      getAccessibilityTree: () => cloneState(task.accessibilityTree || null),
      captureSurface: (options = {}) => this.captureSurface({ ...options, requesterWindowId: config.id, scope: "window" }),
      captureDesktop: (options = {}) => this.captureSurface({ ...options, requesterWindowId: config.id, scope: "desktop" }),
    };
    const task = { ...config, frame, titlebar, content, api, state: {}, accessibilityTree: null, minimized: false, maximized: Boolean(placement.maximized), objectId: "", handleId: "" };
    this.windows.set(config.id, task);
    this.registerWindowObject(task);

    titlebar.querySelector("[data-window-minimize]").addEventListener("click", () => this.minimize(config.id));
    titlebar.querySelector("[data-window-maximize]").addEventListener("click", () => this.maximize(config.id));
    titlebar.querySelector("[data-window-close]").addEventListener("click", () => this.close(config.id));
    titlebar.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      this.maximize(config.id);
      event.preventDefault?.();
      event.stopPropagation?.();
    });
    frame.addEventListener("pointerdown", (event) => {
      this.focus(config.id);
      this.routeInputEvent("pointerdown", event, { targetWindowId: config.id });
    });
    makeDraggable(frame, titlebar, () => this.saveWindowPlacement(config.id), {
      onCapture: (capture) => this.recordPointerCapture(config.id, task.pid, "drag", capture),
      onRelease: (capture) => this.releasePointerCapture(config.id, capture.pointerId, "drag-end"),
    });
    makeResizable(frame, () => this.saveWindowPlacement(config.id), {
      onCapture: (capture) => this.recordPointerCapture(config.id, task.pid, "resize", capture),
      onRelease: (capture) => this.releasePointerCapture(config.id, capture.pointerId, "resize-end"),
    });

    config.render(content, api);
    this.os.processes.markReady?.(config.pid);
    this.focus(config.id);
    this.renderTasks();
    this.writeCompositorProcfs("open");
    return api;
  }

  focus(id) {
    const task = this.windows.get(id);
    if (!task) return;
    cancelMinimizeAnimation(task);
    task.frame.hidden = false;
    task.minimized = false;
    this.activeWindowId = id;
    task.frame.style.zIndex = `${++this.z}`;
    this.windows.forEach((item) => item.frame.classList.toggle("is-active", item === task));
    this.os.processes.updateWindowState?.(task.pid, "focused", { windowId: id });
    this.syncWindowObject(task);
    this.renderTasks();
    this.writeCompositorProcfs("focus");
  }

  minimize(id) {
    const task = this.windows.get(id);
    if (!task) return;
    if (task.minimized && task.frame.hidden) return;
    this.releaseProcessCapture(task.pid, "process-suspend");
    task.minimized = true;
    task.frame.hidden = false;
    task.frame.classList.add("is-minimizing");
    clearTimeout(task.minimizeTimer);
    task.minimizeTimer = setTimeout(() => {
      task.minimizeTimer = null;
      if (!task.minimized) return;
      task.frame.hidden = true;
      task.frame.classList.remove("is-minimizing");
    }, MINIMIZE_ANIMATION_MS);
    this.os.processes.updateWindowState?.(task.pid, "minimized", { windowId: id });
    this.syncWindowObject(task);
    if (this.activeWindowId === id) {
      this.activeWindowId = newestVisibleWindowId(this.windows, id);
      this.windows.forEach((item) => item.frame.classList.toggle("is-active", item.id === this.activeWindowId));
    }
    this.renderTasks();
    this.writeCompositorProcfs("minimize");
  }

  restore(id) {
    const task = this.windows.get(id);
    if (!task) return;
    task.minimized = false;
    task.frame.hidden = false;
    this.focus(id);
  }

  maximize(id) {
    const task = this.windows.get(id);
    if (!task) return;
    task.maximized = !task.maximized;
    task.frame.classList.toggle("is-maximized", task.maximized);
    this.saveWindowPlacement(id);
    this.os.processes.updateWindowState?.(task.pid, task.maximized ? "maximized" : "restored", { windowId: id });
    this.syncWindowObject(task);
    this.focus(id);
    this.writeCompositorProcfs(task.maximized ? "maximize" : "restore");
  }

  close(id, options = {}) {
    const task = this.windows.get(id);
    if (!task) return;
    cancelMinimizeAnimation(task);
    this.releasePointerLock(id, "window-close");
    this.releaseWindowCapture(id, "window-close");
    this.saveWindowPlacement(id);
    this.os.processes.updateWindowState?.(task.pid, "closing", { windowId: id });
    this.revokeWindowObject(task, "window-close");
    task.frame.remove();
    this.windows.delete(id);
    if (this.activeWindowId === id) this.activeWindowId = newestWindowId(this.windows);
    this.recordSurfaceCleanup(task, "window-close");
    if (!options.skipOnClose) task.onClose?.();
    this.renderTasks();
    this.writeCompositorProcfs("close");
  }

  handleGlobalKeyDown(event) {
    this.routeInputEvent("keydown", event);
    const shortcut = this.routeShortcutEvent(event);
    if (shortcut.handled) return;
    if (event.altKey && event.key === "Tab") {
      event.preventDefault();
      this.cycleFocus(event.shiftKey ? -1 : 1);
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = String(event.key || "").toLowerCase();
    if (key === "w" && this.activeWindowId) {
      event.preventDefault();
      this.close(this.activeWindowId);
    }
    if (key === "m" && this.activeWindowId) {
      event.preventDefault();
      this.minimize(this.activeWindowId);
    }
  }

  cycleFocus(direction = 1) {
    const nextId = nextFocusWindowId([...this.windows.keys()], this.activeWindowId, direction);
    if (nextId) this.activate(nextId);
    return nextId;
  }

  renderTasks() {
    if (!this.taskStrip) return;
    this.taskStrip.innerHTML = "";
    this.windows.forEach((task, id) => {
      const button = document.createElement("button");
      button.className = "dos-task";
      button.type = "button";
      button.textContent = task.title;
      button.classList.toggle("is-minimized", task.minimized);
      button.addEventListener("click", () => (task.minimized ? this.restore(id) : this.focus(id)));
      this.taskStrip.appendChild(button);
    });
  }

  openTrustedPrompt(prompt = {}, options = {}) {
    const promptId = String(prompt.id || "");
    const existing = promptId ? [...this.trustedSurfaces.values()].find((surface) => surface.promptId === promptId) : null;
    const id = existing?.id || String(prompt.compositorSurfaceId || `trusted-ui-${this.nextTrustedSurfaceId++}`);
    const surface = existing || {
      id,
      promptId,
      ownerPid: Number(prompt.ownerPid || 0),
      appId: String(prompt.appId || ""),
      packageId: String(prompt.packageId || ""),
      capability: String(prompt.capability || ""),
      target: String(prompt.target || ""),
      message: String(prompt.message || ""),
      status: "pending",
      visible: true,
      captureProtected: true,
      compositorOwned: true,
      createdAt: new Date().toISOString(),
      closedAt: "",
      closeReason: "",
      frame: null,
      onDecision: null,
    };
    Object.assign(surface, {
      ownerPid: Number(prompt.ownerPid || surface.ownerPid || 0),
      appId: String(prompt.appId || surface.appId || ""),
      packageId: String(prompt.packageId || surface.packageId || ""),
      capability: String(prompt.capability || surface.capability || ""),
      target: String(prompt.target || surface.target || ""),
      message: String(prompt.message || surface.message || ""),
      status: String(prompt.status || surface.status || "pending"),
      visible: String(prompt.status || surface.status || "pending") === "pending",
    });
    surface.onDecision = options.onDecision || surface.onDecision;
    if (!surface.frame && globalThis.document?.createElement) {
      surface.frame = createTrustedPromptFrame(surface, {
        onDecision: (decision) => surface.onDecision?.(decision, surface),
      });
    } else if (surface.frame) {
      renderTrustedPromptFrame(surface.frame, surface, {
        onDecision: (decision) => surface.onDecision?.(decision, surface),
      });
    }
    this.trustedSurfaces.set(surface.id, surface);
    this.ensureTrustedSurfacesOnTop();
    this.writeCompositorProcfs("trusted-ui-open");
    return publicTrustedSurface(surface);
  }

  updateTrustedPrompt(prompt = {}) {
    const promptId = String(prompt.id || "");
    const surface = [...this.trustedSurfaces.values()].find((entry) => entry.promptId === promptId || entry.id === prompt.compositorSurfaceId);
    if (!surface) return null;
    Object.assign(surface, {
      status: String(prompt.status || surface.status),
      message: String(prompt.message || surface.message || ""),
      visible: String(prompt.status || surface.status) === "pending",
    });
    if (surface.frame) {
      renderTrustedPromptFrame(surface.frame, surface, {
        onDecision: (decision) => surface.onDecision?.(decision, surface),
      });
    }
    this.ensureTrustedSurfacesOnTop();
    this.writeCompositorProcfs("trusted-ui-update");
    return publicTrustedSurface(surface);
  }

  closeTrustedPrompt(idOrPromptId, reason = "closed") {
    const key = String(idOrPromptId || "");
    const surface = this.trustedSurfaces.get(key) || [...this.trustedSurfaces.values()].find((entry) => entry.promptId === key);
    if (!surface) return null;
    surface.visible = false;
    surface.status = surface.status === "pending" ? "closed" : surface.status;
    surface.closedAt = new Date().toISOString();
    surface.closeReason = String(reason || "closed");
    surface.frame?.remove?.();
    this.trustedSurfaces.delete(surface.id);
    this.writeCompositorProcfs("trusted-ui-close");
    return publicTrustedSurface(surface);
  }

  trustedSurfaceStatus() {
    return [...this.trustedSurfaces.values()].map(publicTrustedSurface);
  }

  hasVisibleTrustedSurface() {
    return [...this.trustedSurfaces.values()].some((surface) => surface.visible && surface.captureProtected);
  }

  ensureTrustedSurfacesOnTop() {
    [...this.trustedSurfaces.values()].forEach((surface, index) => {
      if (!surface.frame) return;
      surface.frame.style.zIndex = `${TRUSTED_UI_Z_BASE + index}`;
      surface.frame.dataset.trustedUiSurface = surface.id;
      surface.frame.dataset.captureProtected = "true";
      if (this.layer && surface.frame.parentNode !== this.layer) {
        this.layer.appendChild(surface.frame);
      }
    });
  }

  keepWindowsInViewport() {
    const viewport = {
      width: globalThis.window?.innerWidth || 1024,
      height: globalThis.window?.innerHeight || 768,
    };
    this.windows.forEach((task) => {
      if (task.maximized) return;
      const rect = {
        left: Number.parseFloat(task.frame.style.left) || 0,
        top: Number.parseFloat(task.frame.style.top) || 0,
        width: Number.parseFloat(task.frame.style.width) || task.frame.getBoundingClientRect().width || MIN_WIDTH,
        height: Number.parseFloat(task.frame.style.height) || task.frame.getBoundingClientRect().height || MIN_HEIGHT,
      };
      const next = constrainWindowRect(rect, viewport);
      Object.assign(task.frame.style, {
        left: `${next.left}px`,
        top: `${next.top}px`,
        width: `${next.width}px`,
        height: `${next.height}px`,
      });
    });
    this.writeCompositorProcfs("viewport");
  }

  recordInputEvent(type, event = {}) {
    this.lastInputEvent = {
      type,
      windowId: this.activeWindowId || "",
      key: String(event.key || ""),
      pointerType: String(event.pointerType || ""),
      button: event.button === undefined ? "" : String(event.button),
      x: Number.isFinite(Number(event.clientX)) ? Number(event.clientX) : null,
      y: Number.isFinite(Number(event.clientY)) ? Number(event.clientY) : null,
      altKey: Boolean(event.altKey),
      ctrlKey: Boolean(event.ctrlKey),
      metaKey: Boolean(event.metaKey),
      shiftKey: Boolean(event.shiftKey),
      at: new Date().toISOString(),
    };
    this.writeCompositorProcfs("input");
    return { ...this.lastInputEvent };
  }

  routeInputEvent(type, event = {}, options = {}) {
    const targetWindowId = String(options.targetWindowId || windowIdFromEventTarget(event.target) || this.activeWindowId || "");
    const task = this.windows.get(targetWindowId);
    const route = {
      type: normalizeInputRouteType(type),
      targetWindowId,
      targetPid: task?.pid || 0,
      targetAppId: task?.appId || "",
      source: options.source || "browser-window",
      handled: Boolean(task),
      deniedReason: task ? "" : "no-focused-window",
      at: new Date().toISOString(),
    };
    if (route.handled) this.inputRouter.routed += 1;
    else this.inputRouter.denied += 1;
    this.inputRouter.lastRoute = route;
    this.recordInputEvent(route.type, event);
    this.os.bus?.emit?.("compositor:input", { ...route, input: this.lastInputEvent ? { ...this.lastInputEvent } : null });
    this.writeCompositorProcfs("input-route");
    return { ...route };
  }

  handleBrowserDefaultEvent(type, event = {}) {
    const route = this.routeInputEvent(type, event, { source: "os-input-priority" });
    const browserDefaultPrevented = shouldPreventBrowserDefault(route.type, event, route);
    if (browserDefaultPrevented) event.preventDefault?.();
    this.inputRouter.lastRoute = { ...this.inputRouter.lastRoute, browserDefaultPrevented };
    this.writeCompositorProcfs(browserDefaultPrevented ? "input-priority-claimed" : "input-priority-passthrough");
    return { ...route, browserDefaultPrevented };
  }

  routeShortcutEvent(event = {}) {
    const key = shortcutKeyFromEvent(event);
    const textEntry = isTextEntryEventTarget(event.target);
    const activeTask = this.windows.get(this.activeWindowId);
    const candidates = [...this.windows.values()]
      .flatMap((task) => normalizeTaskShortcuts(task).map((shortcut) => ({ task, shortcut })))
      .filter(({ task, shortcut }) => {
        if (shortcut.key !== key) return false;
        if (shortcut.scope === "global") return true;
        if (shortcut.scope === "text-entry") return textEntry && task.id === this.activeWindowId;
        return !textEntry && task.id === this.activeWindowId;
      });
    const match = candidates.sort((left, right) => shortcutScopeRank(right.shortcut.scope) - shortcutScopeRank(left.shortcut.scope))[0] || null;
    const route = {
      key,
      scope: match?.shortcut.scope || "",
      command: match?.shortcut.command || "",
      targetWindowId: match?.task.id || this.activeWindowId || "",
      targetPid: match?.task.pid || activeTask?.pid || 0,
      targetAppId: match?.task.appId || activeTask?.appId || "",
      textEntry,
      handled: Boolean(match),
      deniedReason: match ? "" : textEntry ? "text-entry-reserved" : "no-shortcut-scope",
      at: new Date().toISOString(),
    };
    if (route.handled) {
      this.shortcutRouter.routed += 1;
      event.preventDefault?.();
      this.os.bus?.emit?.("compositor:shortcut", { ...route });
    } else {
      this.shortcutRouter.denied += 1;
    }
    this.shortcutRouter.lastShortcut = route;
    this.writeCompositorProcfs("shortcut");
    return { ...route };
  }

  routeClipboardEvent(action, event = {}, options = {}) {
    const normalizedAction = normalizeClipboardAction(action);
    const targetWindowId = String(options.targetWindowId || this.activeWindowId || "");
    const task = this.windows.get(targetWindowId);
    const textEntry = options.textEntry ?? isTextEntryEventTarget(event.target);
    const writeText = String(options.text ?? "");
    const canRoute = Boolean(task);
    const route = {
      action: normalizedAction,
      targetWindowId,
      targetPid: task?.pid || 0,
      targetAppId: task?.appId || "",
      textEntry: Boolean(textEntry),
      bytes: 0,
      handled: canRoute,
      deniedReason: canRoute ? "" : "no-focused-window",
      at: new Date().toISOString(),
    };
    if (canRoute && normalizedAction === "copy") {
      const result = this.os.clipboard?.writeText?.(writeText) || { bytes: byteLength(writeText) };
      route.bytes = Number(result.bytes || 0);
      this.clipboardRouter.copied += 1;
    } else if (canRoute && normalizedAction === "paste") {
      const text = String(this.os.clipboard?.readText?.() ?? "");
      route.bytes = byteLength(text);
      if (!text && options.requireContent) {
        route.handled = false;
        route.deniedReason = "clipboard-empty";
        this.clipboardRouter.denied += 1;
      } else {
        this.clipboardRouter.pasted += 1;
      }
    } else {
      this.clipboardRouter.denied += 1;
    }
    this.clipboardRouter.lastClipboard = route;
    this.routeInputEvent(normalizedAction, event, { targetWindowId, source: "clipboard-router" });
    this.os.bus?.emit?.("compositor:clipboard", { ...route });
    this.writeCompositorProcfs("clipboard");
    return { ...route };
  }

  setAccessibilityTree(windowId, tree = {}) {
    const task = this.windows.get(String(windowId || ""));
    if (!task) throw new Error(`accessibility: unknown window ${windowId}`);
    task.accessibilityTree = normalizeAccessibilityNode(tree, {
      windowId: task.id,
      appId: task.appId,
      title: task.title,
    });
    this.writeCompositorProcfs("accessibility");
    this.os.bus?.emit?.("compositor:accessibility", {
      windowId: task.id,
      appId: task.appId,
      pid: task.pid,
      tree: cloneState(task.accessibilityTree),
    });
    return cloneState(task.accessibilityTree);
  }

  captureSurface(request = {}) {
    const scope = normalizeCaptureScope(request.scope);
    const requesterWindowId = String(request.requesterWindowId || "");
    const requester = this.windows.get(requesterWindowId);
    const targetWindowId = scope === "desktop" ? "" : String(request.targetWindowId || requesterWindowId || this.activeWindowId || "");
    const target = scope === "desktop" ? null : this.windows.get(targetWindowId);
    const ownWindow = Boolean(requester && target && requester.id === target.id);
    const requiredCapability = scope === "desktop" ? "compositor.captureDesktop" : "compositor.captureWindow";
    const userApproved = Boolean(request.userApproved || request.approved);
    const system = Boolean(request.system || request.principal?.system);
    const hasCapability = system || Boolean(requester?.manifest && canUseCapability(requester.manifest, requiredCapability));
    const handleCheck = requester && !system
      ? this.assertWindowHandle(requester, [ownWindow ? "capture-self" : scope === "desktop" ? "capture-desktop" : "capture-window"])
      : { ok: true, deniedReason: "" };
    const route = {
      requestId: captureRequestId(),
      scope,
      requesterWindowId,
      requesterPid: requester?.pid || 0,
      requesterAppId: requester?.appId || "",
      targetWindowId,
      targetPid: target?.pid || 0,
      targetAppId: target?.appId || "",
      requiredCapability: ownWindow ? "" : requiredCapability,
      userVisiblePermission: true,
      userApproved: ownWindow || userApproved,
      handled: false,
      deniedReason: "",
      at: new Date().toISOString(),
    };
    if (!requester && !system) route.deniedReason = "requester-window-not-found";
    else if (scope === "window" && !target) route.deniedReason = "target-window-not-found";
    else if (!ownWindow && !system && this.hasVisibleTrustedSurface()) route.deniedReason = "trusted-ui-protected";
    else if (!ownWindow && !hasCapability) route.deniedReason = "capability-denied";
    else if (!ownWindow && !userApproved) route.deniedReason = "user-permission-required";
    else if (!handleCheck.ok) route.deniedReason = handleCheck.deniedReason;
    else route.handled = true;

    if (!route.handled) {
      this.surfaceCapture.denied += 1;
      this.surfaceCapture.lastDenied = route;
      this.writeCompositorProcfs("surface-capture-denied");
      this.os.bus?.emit?.("compositor:capture", { ...route });
      return { ...route };
    }

    const capture = {
      ...route,
      captureId: route.requestId,
      type: "surface-capture",
      format: "metadata+dom-text",
      encoding: "json",
      pixelDataAvailable: false,
      browserBoundary: "DOM-backed captures expose OS surface metadata and bounded text only; pixel screenshots require browser Screen Capture or a permissioned renderer.",
      viewport: {
        width: globalThis.window?.innerWidth || 0,
        height: globalThis.window?.innerHeight || 0,
      },
      surfaces: scope === "desktop"
        ? [...this.windows.values()].map((task) => captureSurfaceForTask(task, this.activeWindowId))
        : [captureSurfaceForTask(target, this.activeWindowId)],
    };
    this.surfaceCapture.captured += 1;
    this.surfaceCapture.lastCapture = summarizeSurfaceCapture(capture);
    this.writeCompositorProcfs("surface-capture");
    this.os.bus?.emit?.("compositor:capture", summarizeSurfaceCapture(capture));
    return cloneState(capture);
  }

  requestPointerLock(windowId = this.activeWindowId, options = {}) {
    const targetWindowId = String(windowId || "");
    const task = this.windows.get(targetWindowId);
    const request = {
      windowId: targetWindowId,
      pid: task?.pid || 0,
      appId: task?.appId || "",
      handled: Boolean(task) && targetWindowId === this.activeWindowId,
      deniedReason: "",
      at: new Date().toISOString(),
    };
    if (!task) request.deniedReason = "window-not-found";
    else if (targetWindowId !== this.activeWindowId) request.deniedReason = "window-not-focused";
    else {
      const handleCheck = this.assertWindowHandle(task, ["pointer-lock"]);
      if (!handleCheck.ok) {
        request.handled = false;
        request.deniedReason = handleCheck.deniedReason;
      }
    }
    if (!request.handled) {
      this.pointerLock.denied += 1;
      this.pointerLock.lastRequest = request;
      this.writeCompositorProcfs("pointer-lock-denied");
      return { ...request };
    }
    const target = options.target || task.content || task.frame;
    target?.requestPointerLock?.();
    this.pointerLock.activeWindowId = targetWindowId;
    this.pointerLock.pid = task.pid;
    this.pointerLock.appId = task.appId;
    this.pointerLock.lockedAt = request.at;
    this.pointerLock.releasedAt = "";
    this.pointerLock.releaseReason = "";
    this.pointerLock.lastRequest = request;
    this.writeCompositorProcfs("pointer-lock");
    this.os.bus?.emit?.("compositor:pointer-lock", { ...request, active: true });
    return { ...request };
  }

  releasePointerLock(windowId = this.pointerLock.activeWindowId, reason = "release") {
    const targetWindowId = String(windowId || "");
    if (!this.pointerLock.activeWindowId || (targetWindowId && targetWindowId !== this.pointerLock.activeWindowId)) return null;
    globalThis.document?.exitPointerLock?.();
    const released = {
      windowId: this.pointerLock.activeWindowId,
      pid: this.pointerLock.pid,
      appId: this.pointerLock.appId,
      lockedAt: this.pointerLock.lockedAt,
      releasedAt: new Date().toISOString(),
      reason: String(reason || "release"),
    };
    this.pointerLock.activeWindowId = "";
    this.pointerLock.pid = 0;
    this.pointerLock.appId = "";
    this.pointerLock.releasedAt = released.releasedAt;
    this.pointerLock.releaseReason = released.reason;
    this.writeCompositorProcfs("pointer-lock-release");
    this.os.bus?.emit?.("compositor:pointer-lock", { ...released, active: false });
    return released;
  }

  recordPointerCapture(windowId, pid, kind, capture = {}) {
    const pointerId = Number(capture.pointerId || 0);
    this.lastCapture = {
      windowId,
      pid,
      kind,
      pointerId,
      target: capture.target || null,
      capturedAt: new Date().toISOString(),
      releasedAt: "",
      releaseReason: "",
    };
    this.writeCompositorProcfs("capture");
    return { ...this.lastCapture, target: undefined };
  }

  releasePointerCapture(windowId, pointerId = 0, reason = "release") {
    if (!this.lastCapture || this.lastCapture.windowId !== windowId) return null;
    if (pointerId && this.lastCapture.pointerId && Number(pointerId) !== Number(this.lastCapture.pointerId)) return null;
    const capture = this.lastCapture;
    if (capture.target?.hasPointerCapture?.(capture.pointerId)) {
      capture.target.releasePointerCapture(capture.pointerId);
    }
    const released = {
      ...capture,
      target: undefined,
      releasedAt: new Date().toISOString(),
      releaseReason: reason,
    };
    this.lastCapture = null;
    this.writeCompositorProcfs("capture-release");
    return released;
  }

  releaseWindowCapture(windowId, reason = "window-cleanup") {
    return this.releasePointerCapture(windowId, 0, reason);
  }

  releaseProcessCapture(pid, reason = "process-cleanup") {
    const processPid = Number(pid || 0);
    if (!processPid) return null;
    const released = {
      pid: processPid,
      reason: String(reason || "process-cleanup"),
      pointerCapture: null,
      pointerLock: null,
    };
    if (this.lastCapture?.pid === processPid) {
      released.pointerCapture = this.releasePointerCapture(this.lastCapture.windowId, this.lastCapture.pointerId, released.reason);
    }
    if (this.pointerLock.pid === processPid) {
      released.pointerLock = this.releasePointerLock(this.pointerLock.activeWindowId, released.reason);
    }
    return released.pointerCapture || released.pointerLock ? released : null;
  }

  recordSurfaceCleanup(task, reason = "surface-cleanup") {
    if (!task) return null;
    const cleanup = {
      windowId: task.id,
      pid: task.pid,
      appId: task.appId,
      reason: String(reason || "surface-cleanup"),
      remainingSurfaceCount: this.windows.size,
      activeWindowId: this.activeWindowId,
      staleCapture: this.lastCapture?.windowId === task.id,
      stalePointerLock: this.pointerLock.activeWindowId === task.id,
      at: new Date().toISOString(),
    };
    this.surfaceCleanup.cleaned += 1;
    this.surfaceCleanup.lastCleanup = cleanup;
    this.os.bus?.emit?.("compositor:surface-cleanup", { ...cleanup });
    return { ...cleanup };
  }

  registerWindowObject(task) {
    if (!task || task.objectId) return null;
    const rights = windowHandleRights(task);
    const object = this.os.objects?.register?.("window", {
      ref: `window:${task.id}`,
      name: task.title || task.id,
      ownerPid: task.pid,
      namespace: task.manifest?.namespace || null,
      user: this.processUser(task.pid),
      rights,
      metadata: windowObjectMetadata(task, this.activeWindowId),
    }) || null;
    task.objectId = object?.id || "";
    const handle = task.objectId ? this.os.objects?.createHandle?.(task.objectId, {
      ownerPid: task.pid,
      user: this.processUser(task.pid),
      uid: this.processCredentials(task.pid)?.uid || 0,
      gid: this.processCredentials(task.pid)?.gid || 0,
      groups: this.processCredentials(task.pid)?.groups || [],
      namespace: task.manifest?.namespace || null,
      rights,
      closeOnExec: true,
      transferPolicy: "no-duplicate",
      metadata: windowHandleMetadata(task),
    }) : null;
    task.handleId = handle?.id || "";
    this.writeWindowProcfs(task);
    return object;
  }

  syncWindowObject(task) {
    if (!task?.objectId) return null;
    const rights = windowHandleRights(task);
    const object = this.os.objects?.update?.(task.objectId, {
      name: task.title || task.id,
      rights,
      metadata: windowObjectMetadata(task, this.activeWindowId),
    }) || null;
    if (task.handleId) {
      this.os.objects?.updateHandle?.(task.handleId, {
        rights,
        metadata: windowHandleMetadata(task),
      });
    }
    this.writeWindowProcfs(task);
    return object;
  }

  revokeWindowObject(task, reason = "window-close") {
    if (!task?.objectId) return null;
    return this.os.objects?.revoke?.(task.objectId, reason) || null;
  }

  assertWindowHandle(task, rights = []) {
    if (!task?.handleId) return { ok: true, deniedReason: "" };
    try {
      this.os.objects?.assertHandle?.(task.handleId, {
        ownerPid: task.pid,
        objectType: "window",
        rights,
      });
      return { ok: true, deniedReason: "" };
    } catch (error) {
      return { ok: false, deniedReason: `handle-${error.code || "denied"}` };
    }
  }

  processCredentials(pid) {
    return this.os.processes?.get?.(pid)?.credentials || null;
  }

  processUser(pid) {
    return this.processCredentials(pid)?.user || this.os.session?.user || "";
  }

  writeWindowProcfs(task) {
    if (!task?.id || !this.os?.fs?.writeOrCreateFile || !this.os?.permissions) return null;
    const system = this.os.permissions.systemPrincipal();
    const pidPath = `/proc/${task.pid}`;
    if (!this.os.fs.exists(pidPath)) return null;
    this.os.fs.writeOrCreateFile(`${pidPath}/window.json`, `${JSON.stringify(windowProcfsRecord(task, this.activeWindowId), null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
      mime: "application/json",
    }, system);
    this.os.objects?.writeProcessHandlesProcfs?.(task.pid);
    return windowProcfsRecord(task, this.activeWindowId);
  }

  compositorStatus() {
    const surfaces = [...this.windows.values()].map((task) => {
      const rect = surfaceRectForTask(task);
      return {
        windowId: task.id,
        objectId: task.objectId || "",
        handleId: task.handleId || "",
        appId: task.appId,
        pid: task.pid,
        title: task.title,
        focused: task.id === this.activeWindowId,
        minimized: Boolean(task.minimized),
        maximized: Boolean(task.maximized),
        hidden: Boolean(task.frame.hidden),
        zIndex: Number(task.frame.style.zIndex || 0),
        paintMode: "dom",
        rect,
        accessibility: task.accessibilityTree ? summarizeAccessibilityTree(task.accessibilityTree) : null,
      };
    });
    const focused = surfaces.find((surface) => surface.focused) || null;
    return {
      service: "dindbos-compositor",
      activeWindowId: this.activeWindowId,
      focusedPid: focused?.pid || 0,
      focusedAppId: focused?.appId || "",
      surfaceCount: surfaces.length,
      captureOwner: this.lastCapture?.windowId || "",
      capture: this.lastCapture ? {
        windowId: this.lastCapture.windowId,
        pid: this.lastCapture.pid,
        kind: this.lastCapture.kind,
        pointerId: this.lastCapture.pointerId,
        capturedAt: this.lastCapture.capturedAt,
      } : null,
      paintMode: "dom",
      viewport: {
        width: globalThis.window?.innerWidth || 0,
        height: globalThis.window?.innerHeight || 0,
      },
      lastInputEvent: this.lastInputEvent ? { ...this.lastInputEvent } : null,
      inputRouter: {
        routed: this.inputRouter.routed,
        denied: this.inputRouter.denied,
        lastRoute: this.inputRouter.lastRoute ? { ...this.inputRouter.lastRoute } : null,
      },
      shortcutRouter: {
        routed: this.shortcutRouter.routed,
        denied: this.shortcutRouter.denied,
        lastShortcut: this.shortcutRouter.lastShortcut ? { ...this.shortcutRouter.lastShortcut } : null,
      },
      clipboardRouter: {
        copied: this.clipboardRouter.copied,
        pasted: this.clipboardRouter.pasted,
        denied: this.clipboardRouter.denied,
        lastClipboard: this.clipboardRouter.lastClipboard ? { ...this.clipboardRouter.lastClipboard } : null,
      },
      pointerLock: {
        activeWindowId: this.pointerLock.activeWindowId,
        pid: this.pointerLock.pid,
        appId: this.pointerLock.appId,
        lockedAt: this.pointerLock.lockedAt,
        releasedAt: this.pointerLock.releasedAt,
        releaseReason: this.pointerLock.releaseReason,
        denied: this.pointerLock.denied,
        lastRequest: this.pointerLock.lastRequest ? { ...this.pointerLock.lastRequest } : null,
      },
      surfaceCapture: {
        captured: this.surfaceCapture.captured,
        denied: this.surfaceCapture.denied,
        lastCapture: this.surfaceCapture.lastCapture ? cloneState(this.surfaceCapture.lastCapture) : null,
        lastDenied: this.surfaceCapture.lastDenied ? { ...this.surfaceCapture.lastDenied } : null,
      },
      surfaceCleanup: {
        cleaned: this.surfaceCleanup.cleaned,
        lastCleanup: this.surfaceCleanup.lastCleanup ? { ...this.surfaceCleanup.lastCleanup } : null,
      },
      trustedSurfaceCount: this.trustedSurfaces.size,
      trustedSurfaces: this.trustedSurfaceStatus(),
      surfaces,
      updatedAt: new Date().toISOString(),
    };
  }

  writeCompositorProcfs(reason = "update") {
    if (!this.os?.fs?.writeOrCreateFile) return null;
    const system = this.os.permissions?.systemPrincipal?.();
    try {
      if (!this.os.fs.exists("/proc")) this.os.fs.createDirectory("/proc", "/", { owner: "root", group: "root" }, system);
      const status = { ...this.compositorStatus(), reason };
      this.os.fs.writeOrCreateFile("/proc/compositor", `${JSON.stringify(status, null, 2)}\n`, "/", {
        owner: "root",
        group: "root",
        permissions: "-r--r--r--",
        mime: "application/json",
      }, system);
      return status;
    } catch {
      return null;
    }
  }

  nextPosition(width, height) {
    const offset = (this.cascade++ % 7) * 28;
    return {
      x: Math.max(12, Math.min(180 + offset, window.innerWidth - Number(width || 0) - 12)),
      y: Math.max(72, Math.min(96 + offset, window.innerHeight - Number(height || 0) - 16)),
    };
  }

  initialPlacement(config) {
    const saved = this.readWindowPlacements()[placementKey(config)] || null;
    const viewport = {
      width: globalThis.window?.innerWidth || 1024,
      height: globalThis.window?.innerHeight || 768,
    };
    if (isMobileWindowViewport(viewport)) return mobileWindowPlacement(viewport);
    const preferred = preferredWindowSize(config, viewport);
    const position = this.nextPosition(preferred.width, preferred.height);
    const fallback = {
      left: position.x,
      top: position.y,
      width: preferred.width,
      height: preferred.height,
      maximized: preferred.maximized,
    };
    return restoreWindowPlacement(saved, fallback, viewport);
  }

  saveWindowPlacement(id) {
    const task = this.windows.get(id);
    if (!task || !this.os.fs) return null;
    const placements = this.readWindowPlacements();
    placements[placementKey(task)] = windowPlacementForTask(task);
    writeWindowPlacements(this.os, placements);
    return placements[placementKey(task)];
  }

  readWindowPlacements() {
    return readWindowPlacements(this.os);
  }
}

export function constrainWindowRect(rect, viewport) {
  const viewportWidth = Number(viewport.width || 1024);
  const viewportHeight = Number(viewport.height || 768);
  const maxWidth = Math.max(160, viewportWidth - 16);
  const maxHeight = Math.max(160, viewportHeight - 66);
  const width = Math.min(Math.max(Number(rect.width || MIN_WIDTH), 160), maxWidth);
  const height = Math.min(Math.max(Number(rect.height || MIN_HEIGHT), 160), maxHeight);
  return {
    left: Math.round(clamp(Number(rect.left || 0), 8, viewportWidth - Math.min(120, width))),
    top: Math.round(clamp(Number(rect.top || 0), 58, viewportHeight - 80)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function nextFocusWindowId(ids, activeId, direction = 1) {
  const visible = ids.filter(Boolean);
  if (!visible.length) return "";
  const activeIndex = visible.indexOf(activeId);
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;
  const offset = direction < 0 ? -1 : 1;
  return visible[(currentIndex + offset + visible.length) % visible.length];
}

export function snapZoneForPoint(point, viewport, threshold = 24) {
  const x = Number(point.x || 0);
  const y = Number(point.y || 0);
  const width = Number(viewport.width || 1024);
  const height = Number(viewport.height || 768);
  if (y <= threshold) return "top";
  if (x <= threshold) return "left";
  if (x >= width - threshold) return "right";
  if (y >= height - threshold) return "bottom";
  return "";
}

export function snapWindowRect(zone, viewport) {
  const width = Number(viewport.width || 1024);
  const height = Number(viewport.height || 768);
  const top = 58;
  const bottomInset = 16;
  const availableHeight = Math.max(160, height - top - bottomInset);
  const rightStart = Math.round(width / 2);
  if (zone === "left") return { left: 8, top, width: Math.max(160, rightStart - 8), height: availableHeight };
  if (zone === "right") return { left: rightStart, top, width: Math.max(160, width - rightStart - 8), height: availableHeight };
  if (zone === "bottom") return { left: 8, top: Math.round(height / 2), width: Math.max(160, width - 16), height: Math.max(160, height - Math.round(height / 2) - bottomInset) };
  if (zone === "top") return { left: 8, top, width: Math.max(160, width - 16), height: availableHeight };
  return null;
}

export function isMobileWindowViewport(viewport) {
  return Number(viewport.width || 0) <= 700;
}

export function mobileWindowPlacement(viewport) {
  const width = Math.max(200, Number(viewport.width || 390) - 20);
  const height = Math.max(160, Number(viewport.height || 640) - 162);
  return {
    left: 10,
    top: 70,
    width,
    height,
    maximized: true,
  };
}

export function preferredWindowSize(config = {}, viewport = {}) {
  const viewportWidth = Number(viewport.width || 1024);
  const viewportHeight = Number(viewport.height || 768);
  const hasExplicitWidth = Number.isFinite(Number(config.width));
  const hasExplicitHeight = Number.isFinite(Number(config.height));
  if (hasExplicitWidth || hasExplicitHeight) {
    return {
      width: hasExplicitWidth ? Number(config.width) : 760,
      height: hasExplicitHeight ? Number(config.height) : 520,
      maximized: false,
    };
  }
  return {
    width: Math.max(MIN_WIDTH, Math.round(viewportWidth - 56)),
    height: Math.max(MIN_HEIGHT, Math.round(viewportHeight - 112)),
    maximized: false,
  };
}

export function restoreWindowPlacement(saved, fallback, viewport) {
  const candidate = saved && typeof saved === "object" ? saved : fallback;
  const constrained = constrainWindowRect({
    left: candidate.left ?? fallback.left,
    top: candidate.top ?? fallback.top,
    width: candidate.width ?? fallback.width,
    height: candidate.height ?? fallback.height,
  }, viewport);
  return {
    ...constrained,
    maximized: Boolean(candidate.maximized),
  };
}

export function readWindowPlacements(os) {
  try {
    const path = windowPlacementsPath(os);
    if (!os?.fs?.exists?.(path)) return {};
    const parsed = JSON.parse(os.fs.readFile(path, "/", os.permissions?.systemPrincipal?.()));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeWindowPlacements(os, placements) {
  if (!os?.fs) return;
  const system = os.permissions?.systemPrincipal?.();
  ensureDirectory(os, "/var", system);
  ensureDirectory(os, "/var/lib", system);
  ensureDirectory(os, "/var/lib/dindbos", system);
  ensureDirectory(os, WINDOW_PLACEMENTS_DIR, system);
  os.fs.writeOrCreateFile(
    windowPlacementsPath(os),
    `${JSON.stringify(placements || {}, null, 2)}\n`,
    "/",
    { mime: "application/json", owner: windowPlacementUser(os), group: "users", permissions: "-rw-------" },
    system,
  );
}

export function windowPlacementsPath(os) {
  const user = encodeURIComponent(windowPlacementUser(os));
  return `${WINDOW_PLACEMENTS_DIR}/${user && user !== "." && user !== ".." ? user : "guest"}.json`;
}

function windowPlacementUser(os) {
  return String(os?.session?.user || "guest");
}

function createResizeHandles() {
  const fragment = document.createDocumentFragment();
  ["right", "left", "bottom-right", "bottom-left"].forEach((edge) => {
    const handle = document.createElement("span");
    handle.className = `dos-resize dos-resize-${edge}`;
    handle.dataset.resize = edge;
    fragment.appendChild(handle);
  });
  return fragment;
}

function makeDraggable(frame, titlebar, onPlacement = () => {}, captureHooks = {}) {
  let drag = null;
  const move = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const next = constrainWindowRect(
      {
        left: drag.left + event.clientX - drag.x,
        top: drag.top + event.clientY - drag.y,
        width: drag.width,
        height: drag.height,
      },
      viewport,
    );
    frame.style.left = `${next.left}px`;
    frame.style.top = `${next.top}px`;
    event.preventDefault?.();
  };
  const end = (event = {}) => {
    if (!drag || (event.pointerId && event.pointerId !== drag.pointerId)) return;
    const endedDrag = drag;
    drag = null;
    frame.classList.remove("is-dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (event.type !== "pointercancel") {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const zone = snapZoneForPoint({ x: event.clientX, y: event.clientY }, viewport);
      const snapped = snapWindowRect(zone, viewport);
      if (snapped) {
        Object.assign(frame.style, {
          left: `${snapped.left}px`,
          top: `${snapped.top}px`,
          width: `${snapped.width}px`,
          height: `${snapped.height}px`,
        });
      }
    }
    if (titlebar.hasPointerCapture?.(endedDrag.pointerId)) titlebar.releasePointerCapture(endedDrag.pointerId);
    onPlacement();
    captureHooks.onRelease?.({ pointerId: endedDrag.pointerId, target: titlebar });
    event.preventDefault?.();
  };
  titlebar.addEventListener("pointerdown", (event) => {
    if (event.button > 0 || event.target.closest("button") || frame.classList.contains("is-maximized")) return;
    const rect = windowLocalRect(frame);
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    frame.classList.add("is-dragging");
    titlebar.setPointerCapture(event.pointerId);
    captureHooks.onCapture?.({ pointerId: event.pointerId, target: titlebar });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    event.preventDefault?.();
    event.stopPropagation?.();
  });
}

function windowLocalRect(frame) {
  const viewportRect = typeof frame.getBoundingClientRect === "function" ? frame.getBoundingClientRect() : {};
  const layerRect = typeof frame.offsetParent?.getBoundingClientRect === "function"
    ? frame.offsetParent.getBoundingClientRect()
    : { left: 0, top: 0 };
  const styleLeft = Number.parseFloat(frame.style.left);
  const styleTop = Number.parseFloat(frame.style.top);
  return {
    left: Number.isFinite(styleLeft) ? styleLeft : Number(viewportRect.left || 0) - Number(layerRect.left || 0),
    top: Number.isFinite(styleTop) ? styleTop : Number(viewportRect.top || 0) - Number(layerRect.top || 0),
    width: Number.parseFloat(frame.style.width) || Number(viewportRect.width || MIN_WIDTH),
    height: Number.parseFloat(frame.style.height) || Number(viewportRect.height || MIN_HEIGHT),
  };
}

function makeResizable(frame, onPlacement = () => {}, captureHooks = {}) {
  frame.querySelectorAll("[data-resize]").forEach((handle) => {
    let start = null;
    const move = (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      let left = start.left;
      let width = start.width;
      let height = start.height;
      if (start.edge.includes("right")) width = clamp(start.width + dx, MIN_WIDTH, window.innerWidth - start.left - 8);
      if (start.edge.includes("left")) {
        width = clamp(start.width - dx, MIN_WIDTH, start.left + start.width - 8);
        left = start.left + start.width - width;
      }
      if (start.edge.includes("bottom")) height = clamp(start.height + dy, MIN_HEIGHT, window.innerHeight - start.top - 8);
      Object.assign(frame.style, { left: `${left}px`, width: `${width}px`, height: `${height}px` });
    };
    const end = () => {
      const pointerId = start?.pointerId || 0;
      start = null;
      onPlacement();
      captureHooks.onRelease?.({ pointerId, target: handle });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointerdown", (event) => {
      if (frame.classList.contains("is-maximized")) return;
      const rect = frame.getBoundingClientRect();
      start = { edge: handle.dataset.resize, pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      handle.setPointerCapture?.(event.pointerId);
      captureHooks.onCapture?.({ pointerId: event.pointerId, target: handle });
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      event.preventDefault();
      event.stopPropagation();
    });
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function newestWindowId(windows) {
  return [...windows.keys()].at(-1) || "";
}

function newestVisibleWindowId(windows, exceptId = "") {
  return [...windows.values()].filter((task) => task.id !== exceptId && !task.minimized).at(-1)?.id || "";
}

function windowIdFromEventTarget(target) {
  return String(target?.closest?.("[data-window-id]")?.dataset?.windowId || target?.dataset?.windowId || "");
}

function shouldPreventBrowserDefault(type, event = {}, route = {}) {
  const target = event.target || null;
  const osSurface = Boolean(route.targetWindowId || target?.closest?.(".dos-shell, .dos-window, .dos-desktop, .dos-dock, .dos-menubar"));
  if (!osSurface) return false;
  if (type === "contextmenu" || type === "dragover" || type === "drop") return true;
  if (type === "selectstart") return !isTextEntryEventTarget(target);
  if (type === "dragstart") return !isOsManagedDragTarget(target);
  return false;
}

function isOsManagedDragTarget(target) {
  return Boolean(target?.closest?.("[data-path], [data-drop-path], [draggable='true'], .dos-window-titlebar, [data-resize]"));
}

function normalizeInputRouteType(type) {
  const value = String(type || "input").toLowerCase();
  if (["pointerdown", "pointermove", "pointerup", "keydown", "keyup", "contextmenu", "selectstart", "compositionstart", "compositionupdate", "compositionend", "dragstart", "dragover", "drop", "paste", "copy"].includes(value)) {
    return value;
  }
  return "input";
}

function normalizeTaskShortcuts(task) {
  const shortcuts = Array.isArray(task.shortcuts) ? task.shortcuts : [];
  return shortcuts.map((shortcut) => ({
    key: normalizeShortcutKey(shortcut.key || ""),
    scope: normalizeShortcutScope(shortcut.scope || "focused"),
    command: String(shortcut.command || shortcut.key || "").trim(),
  })).filter((shortcut) => shortcut.key);
}

function shortcutKeyFromEvent(event = {}) {
  const parts = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.metaKey) parts.push("meta");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(normalizeShortcutKey(event.key || ""));
  return parts.filter(Boolean).join("+");
}

function normalizeShortcutKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeShortcutScope(value) {
  const scope = String(value || "focused").toLowerCase();
  return ["global", "focused", "text-entry"].includes(scope) ? scope : "focused";
}

function normalizeClipboardAction(action) {
  const value = String(action || "paste").toLowerCase();
  return value === "copy" ? "copy" : "paste";
}

function normalizeCaptureScope(scope) {
  return String(scope || "window").toLowerCase() === "desktop" ? "desktop" : "window";
}

function captureRequestId() {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function captureSurfaceForTask(task, activeWindowId = "") {
  const rect = surfaceRectForTask(task);
  return {
    windowId: task.id,
    objectId: task.objectId || "",
    handleId: task.handleId || "",
    appId: task.appId,
    pid: task.pid,
    title: task.title,
    focused: task.id === activeWindowId,
    minimized: Boolean(task.minimized),
    hidden: Boolean(task.frame.hidden),
    paintMode: "dom",
    rect,
    text: extractElementText(task.content),
    accessibility: task.accessibilityTree ? summarizeAccessibilityTree(task.accessibilityTree) : null,
  };
}

function createTrustedPromptFrame(surface, options = {}) {
  const frame = document.createElement("aside");
  frame.className = "trusted-ui-surface";
  frame.dataset.trustedUiSurface = surface.id;
  frame.dataset.captureProtected = "true";
  frame.setAttribute?.("role", "dialog");
  frame.setAttribute?.("aria-modal", "true");
  renderTrustedPromptFrame(frame, surface, options);
  return frame;
}

function renderTrustedPromptFrame(frame, surface, options = {}) {
  if (!frame) return null;
  frame.textContent = "";
  const dialog = document.createElement("section");
  dialog.className = "trusted-ui-dialog";
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = "DindbOS Trusted UI";
  const badge = document.createElement("span");
  badge.textContent = "Compositor owned";
  header.append(title, badge);
  const body = document.createElement("div");
  body.className = "trusted-ui-body";
  const capability = document.createElement("p");
  capability.textContent = surface.capability || "permission request";
  const target = document.createElement("small");
  target.textContent = surface.target || surface.appId || "system resource";
  const message = document.createElement("p");
  message.textContent = surface.message || "A privileged operation needs confirmation.";
  body.append(capability, target, message);
  const actions = document.createElement("footer");
  const deny = document.createElement("button");
  deny.type = "button";
  deny.textContent = "Deny";
  deny.addEventListener?.("click", () => options.onDecision?.("denied"));
  const allow = document.createElement("button");
  allow.type = "button";
  allow.textContent = "Allow";
  allow.dataset.primary = "true";
  allow.addEventListener?.("click", () => options.onDecision?.("granted"));
  actions.append(deny, allow);
  dialog.append(header, body, actions);
  frame.append(dialog);
  return frame;
}

function publicTrustedSurface(surface) {
  return {
    id: surface.id,
    promptId: surface.promptId,
    ownerPid: surface.ownerPid,
    appId: surface.appId,
    packageId: surface.packageId,
    capability: surface.capability,
    target: surface.target,
    status: surface.status,
    visible: Boolean(surface.visible),
    captureProtected: Boolean(surface.captureProtected),
    compositorOwned: Boolean(surface.compositorOwned),
    rect: trustedSurfaceRect(surface),
    zIndex: Number(surface.frame?.style?.zIndex || TRUSTED_UI_Z_BASE),
    createdAt: surface.createdAt,
    closedAt: surface.closedAt,
    closeReason: surface.closeReason,
  };
}

function trustedSurfaceRect(surface) {
  const rect = typeof surface.frame?.getBoundingClientRect === "function" ? surface.frame.getBoundingClientRect() : {};
  return {
    left: Math.round(rect.left || 0),
    top: Math.round(rect.top || 0),
    width: Math.round(rect.width || 0),
    height: Math.round(rect.height || 0),
  };
}

function windowHandleRights(task) {
  return [
    "inspect",
    "focus",
    "minimize",
    "maximize",
    "close",
    "capture-self",
    "pointer-lock",
    canUseCapability(task.manifest || {}, "compositor.captureWindow") ? "capture-window" : "",
    canUseCapability(task.manifest || {}, "compositor.captureDesktop") ? "capture-desktop" : "",
  ].filter(Boolean);
}

function windowObjectMetadata(task, activeWindowId = "") {
  return {
    windowId: task.id,
    appId: task.appId || "",
    pid: task.pid || 0,
    title: task.title || "",
    focused: task.id === activeWindowId,
    minimized: Boolean(task.minimized),
    maximized: Boolean(task.maximized),
    hidden: Boolean(task.frame?.hidden),
    rect: surfaceRectForTask(task),
  };
}

function windowHandleMetadata(task) {
  return {
    windowId: task.id,
    appId: task.appId || "",
    objectId: task.objectId || "",
    title: task.title || "",
  };
}

function windowProcfsRecord(task, activeWindowId = "") {
  return {
    ...windowObjectMetadata(task, activeWindowId),
    objectId: task.objectId || "",
    handleId: task.handleId || "",
  };
}

function summarizeSurfaceCapture(capture) {
  return {
    captureId: capture.captureId,
    scope: capture.scope,
    format: capture.format,
    pixelDataAvailable: Boolean(capture.pixelDataAvailable),
    requesterWindowId: capture.requesterWindowId,
    requesterPid: capture.requesterPid,
    requesterAppId: capture.requesterAppId,
    targetWindowId: capture.targetWindowId,
    targetPid: capture.targetPid,
    targetAppId: capture.targetAppId,
    surfaceCount: Array.isArray(capture.surfaces) ? capture.surfaces.length : 0,
    userVisiblePermission: Boolean(capture.userVisiblePermission),
    userApproved: Boolean(capture.userApproved),
    at: capture.at,
  };
}

function extractElementText(element) {
  const chunks = [];
  collectElementText(element, chunks);
  return chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, 4096);
}

function collectElementText(element, chunks) {
  if (!element || chunks.join(" ").length > 4096) return;
  if (typeof element.innerText === "string" && element.innerText.trim()) {
    chunks.push(element.innerText);
    return;
  }
  if (typeof element.textContent === "string" && element.textContent.trim()) {
    chunks.push(element.textContent);
    return;
  }
  const children = Array.isArray(element.children) ? element.children : [...(element.children || [])];
  children.forEach((child) => collectElementText(child, chunks));
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

function normalizeAccessibilityNode(node = {}, fallback = {}) {
  const value = node && typeof node === "object" ? node : {};
  const children = Array.isArray(value.children) ? value.children.slice(0, 100) : [];
  return {
    role: String(value.role || "window"),
    name: String(value.name || fallback.title || fallback.appId || fallback.windowId || ""),
    value: value.value === undefined ? "" : String(value.value),
    bounds: normalizeAccessibilityBounds(value.bounds),
    state: normalizeAccessibilityState(value.state),
    actions: Array.isArray(value.actions) ? value.actions.map((action) => String(action || "")).filter(Boolean).slice(0, 20) : [],
    focus: Boolean(value.focus),
    children: children.map((child) => normalizeAccessibilityNode(child)),
  };
}

function normalizeAccessibilityBounds(bounds = {}) {
  const value = bounds && typeof bounds === "object" ? bounds : {};
  return {
    left: Number(value.left || 0),
    top: Number(value.top || 0),
    width: Number(value.width || 0),
    height: Number(value.height || 0),
  };
}

function normalizeAccessibilityState(state = {}) {
  if (!state || typeof state !== "object") return {};
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [String(key), typeof value === "boolean" ? value : String(value)]));
}

function summarizeAccessibilityTree(tree) {
  return {
    role: tree.role,
    name: tree.name,
    focus: Boolean(tree.focus),
    actions: Array.isArray(tree.actions) ? [...tree.actions] : [],
    nodeCount: countAccessibilityNodes(tree),
  };
}

function countAccessibilityNodes(node) {
  return 1 + (Array.isArray(node?.children) ? node.children.reduce((total, child) => total + countAccessibilityNodes(child), 0) : 0);
}

function shortcutScopeRank(scope) {
  if (scope === "text-entry") return 3;
  if (scope === "focused") return 2;
  if (scope === "global") return 1;
  return 0;
}

function isTextEntryEventTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || target.nodeName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable === true;
}

function cancelMinimizeAnimation(task) {
  clearTimeout(task.minimizeTimer);
  task.minimizeTimer = null;
  task.frame.classList.remove("is-minimizing");
}

function cloneState(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function placementKey(config) {
  return config.appId || config.id;
}

function windowPlacementForTask(task) {
  return {
    left: Number.parseFloat(task.frame.style.left) || 0,
    top: Number.parseFloat(task.frame.style.top) || 0,
    width: Number.parseFloat(task.frame.style.width) || task.width || MIN_WIDTH,
    height: Number.parseFloat(task.frame.style.height) || task.height || MIN_HEIGHT,
    maximized: Boolean(task.maximized),
  };
}

function surfaceRectForTask(task) {
  const rect = typeof task.frame.getBoundingClientRect === "function" ? task.frame.getBoundingClientRect() : {};
  return {
    left: Math.round(Number.parseFloat(task.frame.style.left) || rect.left || 0),
    top: Math.round(Number.parseFloat(task.frame.style.top) || rect.top || 0),
    width: Math.round(Number.parseFloat(task.frame.style.width) || rect.width || task.width || MIN_WIDTH),
    height: Math.round(Number.parseFloat(task.frame.style.height) || rect.height || task.height || MIN_HEIGHT),
  };
}

function ensureDirectory(os, path, principal) {
  if (!os.fs.exists(path)) {
    os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, principal);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
