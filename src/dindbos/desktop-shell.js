export class DesktopShell {
  constructor(os) {
    this.os = os;
    this.refs = {};
  }

  mount(root) {
    root.innerHTML = `
      <main class="dos-shell">
        <header class="dos-menubar">
          <button class="dos-brand" type="button" data-launch="portfolio">DindbOS.js</button>
          <nav class="dos-taskstrip" aria-label="Open windows"></nav>
          <time class="dos-clock"></time>
        </header>
        <section class="dos-desktop" aria-label="Desktop"></section>
        <aside class="dos-dock" aria-label="Pinned apps"></aside>
        <section class="dos-window-layer" aria-live="polite"></section>
      </main>
    `;
    this.refs.shell = root.querySelector(".dos-shell");
    this.refs.desktop = root.querySelector(".dos-desktop");
    this.refs.dock = root.querySelector(".dos-dock");
    this.refs.windowLayer = root.querySelector(".dos-window-layer");
    this.refs.taskStrip = root.querySelector(".dos-taskstrip");
    this.refs.clock = root.querySelector(".dos-clock");
    root.querySelector("[data-launch='portfolio']").addEventListener("click", () => this.os.launch("portfolio"));
    window.setInterval(() => this.tickClock(), 1000);
    this.tickClock();
  }

  renderDesktop() {
    const desktop = this.refs.desktop;
    desktop.innerHTML = "";
    this.os.fs.list("/Desktop").forEach((node) => {
      desktop.appendChild(this.createIcon(node));
    });
  }

  renderDock() {
    const dock = this.refs.dock;
    dock.innerHTML = "";
    this.os.apps.list().filter((app) => app.pinned).forEach((app) => {
      const button = document.createElement("button");
      button.className = "dos-dock-item";
      button.type = "button";
      button.dataset.icon = app.icon || "app";
      button.textContent = app.name;
      button.addEventListener("click", () => this.os.launch(app.id));
      dock.appendChild(button);
    });
  }

  createIcon(node) {
    const resolved = this.os.fs.resolveNode(node);
    const button = document.createElement("button");
    button.className = "dos-icon";
    button.type = "button";
    button.dataset.icon = resolved.icon || resolved.type;
    button.innerHTML = `
      <span class="dos-icon-art"></span>
      <span class="dos-icon-label">${escapeHtml(node.name)}</span>
    `;
    button.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 760px)").matches) this.os.openNode(node);
    });
    button.addEventListener("dblclick", () => this.os.openNode(node));
    return button;
  }

  tickClock() {
    this.refs.clock.textContent = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
