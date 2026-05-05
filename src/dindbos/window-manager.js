const MIN_WIDTH = 340;
const MIN_HEIGHT = 240;
const MINIMIZE_ANIMATION_MS = 160;
const WINDOW_PLACEMENTS_PATH = "/var/lib/dindbos/window-placements.json";

export class WindowManager {
  constructor(os) {
    this.os = os;
    this.layer = null;
    this.taskStrip = null;
    this.windows = new Map();
    this.z = 20;
    this.cascade = 0;
    this.activeWindowId = "";
    this.lastInputEvent = null;
    this.lastCapture = null;
    this.boundKeepWindowsInViewport = () => this.keepWindowsInViewport();
    this.boundHandleGlobalKeyDown = (event) => this.handleGlobalKeyDown(event);
    this.boundHandleGlobalPointerDown = (event) => this.recordInputEvent("pointerdown", event);
  }

  mount(layer, taskStrip) {
    this.layer = layer;
    this.taskStrip = taskStrip;
    globalThis.window?.addEventListener?.("resize", this.boundKeepWindowsInViewport);
    globalThis.window?.addEventListener?.("keydown", this.boundHandleGlobalKeyDown);
    globalThis.window?.addEventListener?.("pointerdown", this.boundHandleGlobalPointerDown);
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
        this.renderTasks();
      },
    };
    const task = { ...config, frame, titlebar, content, api, state: {}, minimized: false, maximized: Boolean(placement.maximized) };
    this.windows.set(config.id, task);

    titlebar.querySelector("[data-window-minimize]").addEventListener("click", () => this.minimize(config.id));
    titlebar.querySelector("[data-window-maximize]").addEventListener("click", () => this.maximize(config.id));
    titlebar.querySelector("[data-window-close]").addEventListener("click", () => this.close(config.id));
    frame.addEventListener("pointerdown", () => this.focus(config.id));
    makeDraggable(frame, titlebar, () => this.saveWindowPlacement(config.id));
    makeResizable(frame, () => this.saveWindowPlacement(config.id));

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
    this.renderTasks();
    this.writeCompositorProcfs("focus");
  }

  minimize(id) {
    const task = this.windows.get(id);
    if (!task) return;
    if (task.minimized && task.frame.hidden) return;
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
    this.focus(id);
    this.writeCompositorProcfs(task.maximized ? "maximize" : "restore");
  }

  close(id, options = {}) {
    const task = this.windows.get(id);
    if (!task) return;
    cancelMinimizeAnimation(task);
    this.saveWindowPlacement(id);
    this.os.processes.updateWindowState?.(task.pid, "closing", { windowId: id });
    task.frame.remove();
    this.windows.delete(id);
    if (this.activeWindowId === id) this.activeWindowId = newestWindowId(this.windows);
    if (!options.skipOnClose) task.onClose?.();
    this.renderTasks();
    this.writeCompositorProcfs("close");
  }

  handleGlobalKeyDown(event) {
    this.recordInputEvent("keydown", event);
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

  compositorStatus() {
    const surfaces = [...this.windows.values()].map((task) => {
      const rect = surfaceRectForTask(task);
      return {
        windowId: task.id,
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
      paintMode: "dom",
      viewport: {
        width: globalThis.window?.innerWidth || 0,
        height: globalThis.window?.innerHeight || 0,
      },
      lastInputEvent: this.lastInputEvent ? { ...this.lastInputEvent } : null,
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
      x: Math.max(12, Math.min(180 + offset, window.innerWidth - width - 12)),
      y: Math.max(72, Math.min(96 + offset, window.innerHeight - height - 16)),
    };
  }

  initialPlacement(config) {
    const saved = this.readWindowPlacements()[placementKey(config)] || null;
    const viewport = {
      width: globalThis.window?.innerWidth || 1024,
      height: globalThis.window?.innerHeight || 768,
    };
    if (isMobileWindowViewport(viewport)) return mobileWindowPlacement(viewport);
    const position = this.nextPosition(config.width, config.height);
    const fallback = {
      left: position.x,
      top: position.y,
      width: config.width,
      height: config.height,
      maximized: false,
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
    if (!os?.fs?.exists?.(WINDOW_PLACEMENTS_PATH)) return {};
    const parsed = JSON.parse(os.fs.readFile(WINDOW_PLACEMENTS_PATH, "/", os.permissions?.systemPrincipal?.()));
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
  os.fs.writeOrCreateFile(
    WINDOW_PLACEMENTS_PATH,
    `${JSON.stringify(placements || {}, null, 2)}\n`,
    "/",
    { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
    system,
  );
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

function makeDraggable(frame, titlebar, onPlacement = () => {}) {
  let drag = null;
  titlebar.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button") || frame.classList.contains("is-maximized")) return;
    const rect = frame.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    titlebar.setPointerCapture(event.pointerId);
  });
  titlebar.addEventListener("pointermove", (event) => {
    if (!drag) return;
    frame.style.left = `${clamp(drag.left + event.clientX - drag.x, 8, window.innerWidth - 120)}px`;
    frame.style.top = `${clamp(drag.top + event.clientY - drag.y, 58, window.innerHeight - 80)}px`;
  });
  titlebar.addEventListener("pointerup", (event) => {
    if (drag) {
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
      onPlacement();
    }
    drag = null;
    if (titlebar.hasPointerCapture(event.pointerId)) titlebar.releasePointerCapture(event.pointerId);
  });
}

function makeResizable(frame, onPlacement = () => {}) {
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
      start = null;
      onPlacement();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointerdown", (event) => {
      if (frame.classList.contains("is-maximized")) return;
      const rect = frame.getBoundingClientRect();
      start = { edge: handle.dataset.resize, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
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
