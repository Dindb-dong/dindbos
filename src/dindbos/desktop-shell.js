import { createDesktopRenderer } from "../ui/desktop-view.js?v=20260506-design-react";

export class DesktopShell {
  constructor(os) {
    this.os = os;
    this.refs = {};
    this.renderer = null;
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
    this.renderer = createDesktopRenderer({
      desktopElement: this.refs.desktop,
      dockElement: this.refs.dock,
      isMobile: () => window.matchMedia("(max-width: 760px)").matches,
      onOpenNode: (node) => this.os.openNode(node),
      onLaunchApp: (id) => this.os.launch(id),
    });
    root.querySelector("[data-launch='portfolio']").addEventListener("click", () => this.os.launch("portfolio"));
    window.setInterval(() => this.tickClock(), 1000);
    this.tickClock();
  }

  renderDesktop() {
    const desktopPath = this.os.session.desktopPath || this.os.fs.join(this.os.session.home, "Desktop");
    const entries = this.os.fs.list(desktopPath).map((node) => {
      const resolved = this.os.fs.resolveNode(node);
      return {
        node,
        name: node.name,
        path: node.path,
        icon: resolved.icon || resolved.type,
      };
    });
    this.renderer.renderDesktop(entries);
  }

  renderDock() {
    const apps = this.os.apps.list().filter((app) => app.pinned);
    this.renderer.renderDock(apps);
  }

  tickClock() {
    this.refs.clock.textContent = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
