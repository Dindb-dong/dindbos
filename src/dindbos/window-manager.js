const MIN_WIDTH = 340;
const MIN_HEIGHT = 240;

export class WindowManager {
  constructor(os) {
    this.os = os;
    this.layer = null;
    this.taskStrip = null;
    this.windows = new Map();
    this.z = 20;
    this.cascade = 0;
  }

  mount(layer, taskStrip) {
    this.layer = layer;
    this.taskStrip = taskStrip;
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
    const position = this.nextPosition(config.width, config.height);
    Object.assign(frame.style, {
      width: `${config.width}px`,
      height: `${config.height}px`,
      left: `${position.x}px`,
      top: `${position.y}px`,
    });

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
      setTitle: (title) => {
        titlebar.querySelector("strong").textContent = title;
        task.title = title;
        this.renderTasks();
      },
    };
    const task = { ...config, frame, titlebar, content, api, minimized: false, maximized: false };
    this.windows.set(config.id, task);

    titlebar.querySelector("[data-window-minimize]").addEventListener("click", () => this.minimize(config.id));
    titlebar.querySelector("[data-window-maximize]").addEventListener("click", () => this.maximize(config.id));
    titlebar.querySelector("[data-window-close]").addEventListener("click", () => this.close(config.id));
    frame.addEventListener("pointerdown", () => this.focus(config.id));
    makeDraggable(frame, titlebar);
    makeResizable(frame);

    config.render(content, api);
    this.focus(config.id);
    this.renderTasks();
    return api;
  }

  focus(id) {
    const task = this.windows.get(id);
    if (!task) return;
    task.frame.hidden = false;
    task.minimized = false;
    task.frame.style.zIndex = `${++this.z}`;
    this.windows.forEach((item) => item.frame.classList.toggle("is-active", item === task));
    this.renderTasks();
  }

  minimize(id) {
    const task = this.windows.get(id);
    if (!task) return;
    task.minimized = true;
    task.frame.hidden = true;
    this.renderTasks();
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
    this.focus(id);
  }

  close(id) {
    const task = this.windows.get(id);
    if (!task) return;
    task.frame.remove();
    this.windows.delete(id);
    this.renderTasks();
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

  nextPosition(width, height) {
    const offset = (this.cascade++ % 7) * 28;
    return {
      x: Math.max(12, Math.min(180 + offset, window.innerWidth - width - 12)),
      y: Math.max(72, Math.min(96 + offset, window.innerHeight - height - 16)),
    };
  }
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

function makeDraggable(frame, titlebar) {
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
    drag = null;
    if (titlebar.hasPointerCapture(event.pointerId)) titlebar.releasePointerCapture(event.pointerId);
  });
}

function makeResizable(frame) {
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

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
