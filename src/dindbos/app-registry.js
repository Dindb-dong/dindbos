import { manifestToText, normalizeAppManifest } from "./app-manifest.js?v=20260422-activity-monitor";

export class AppRegistry {
  constructor(os) {
    this.os = os;
    this.apps = new Map();
  }

  register(app) {
    if (!app?.id) throw new Error("App must define an id.");
    const manifest = normalizeAppManifest(app);
    this.apps.set(app.id, { ...app, manifest });
    this.writeManifestFile(manifest);
    this.writeApplicationFile(app, manifest);
  }

  unregister(appId) {
    const app = this.apps.get(appId);
    if (!app) return false;
    this.apps.delete(appId);
    const manifestPath = `/usr/share/dindbos/manifests/${appId}.json`;
    if (this.os.fs.exists(manifestPath)) {
      this.os.fs.remove(manifestPath, "/", {}, this.os.permissions.systemPrincipal());
    }
    return true;
  }

  has(appId) {
    return this.apps.has(appId);
  }

  list() {
    return [...this.apps.values()];
  }

  launch(appId, context = {}) {
    const app = this.apps.get(appId);
    if (!app) throw new Error(`Unknown app: ${appId}`);
    const windowId = app.singleton ? app.id : `${app.id}-${Date.now()}`;
    if (app.singleton && this.os.windows.has(windowId)) return this.os.windows.activate(windowId);
    const process = this.os.processes.spawn(app, context);
    const sandbox = this.os.createSandbox(process);
    this.os.processes.attachWindow(process.pid, windowId);
    return this.os.windows.open({
      id: windowId,
      appId: app.id,
      pid: process.pid,
      title: typeof app.title === "function" ? app.title(context) : app.title || app.name,
      icon: app.icon || "app",
      width: app.width || 760,
      height: app.height || 520,
      singleton: app.singleton,
      render: (content, windowApi) => {
        try {
          return app.render({ os: sandbox, content, window: windowApi, context });
        } catch (error) {
          this.os.processes.crash(process.pid, error);
          content.innerHTML = `
            <section class="crash-app">
              <p class="dos-kicker">Process crashed</p>
              <h2>${escapeHtml(app.name || app.id)}</h2>
              <pre>${escapeHtml(error.message)}</pre>
            </section>
          `;
          windowApi.setTitle(`${app.name || app.id} - crashed`);
          return null;
        }
      },
      onClose: () => this.os.processes.kill(process.pid, "exited"),
    });
  }

  openFile(node, context = {}) {
    const app = this.resolveFileApp(node);
    if (!app) throw new Error(`No app can open ${node.name}`);
    return this.launch(app.id, { node, ...context });
  }

  resolveFileApp(node) {
    if (node.appId && this.apps.has(node.appId)) return this.apps.get(node.appId);
    return this.list().find((app) => (app.accepts || []).some((mime) => matchesMime(node.mime, mime)));
  }

  manifests() {
    return this.list().map((app) => ({ ...app.manifest }));
  }

  getManifest(appId) {
    const app = this.apps.get(appId);
    return app ? { ...app.manifest } : null;
  }

  manifestText(appId) {
    const manifest = this.getManifest(appId);
    return manifest ? manifestToText(manifest) : `manifest: ${appId}: no such app`;
  }

  writeManifestFile(manifest) {
    if (!this.os.fs.exists("/usr/share")) return;
    const system = this.os.permissions.systemPrincipal();
    ["/usr/share/dindbos", "/usr/share/dindbos/manifests"].forEach((path) => {
      if (!this.os.fs.exists(path)) this.os.fs.createDirectory(path, "/", {}, system);
    });
    this.os.fs.writeOrCreateFile(
      `/usr/share/dindbos/manifests/${manifest.id}.json`,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "root", group: "root", permissions: "-rw-r--r--" },
      system,
    );
  }

  writeApplicationFile(app, manifest) {
    if (!this.os.fs.exists("/usr/share/applications")) return;
    const system = this.os.permissions.systemPrincipal();
    const appName = sanitizeLauncherName(typeof app.name === "string" && app.name ? app.name : manifest.name);
    this.os.fs.createApp(
      `/usr/share/applications/${appName}.app`,
      manifest.id,
      app.icon || "app",
      "/",
      { owner: "root", group: "root", permissions: "-rwxr-xr-x" },
      system,
    );
  }
}

function matchesMime(value = "", matcher = "") {
  if (matcher.endsWith("/*")) return value.startsWith(matcher.slice(0, -1));
  return value === matcher;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeLauncherName(value) {
  const name = String(value || "App").trim().replace(/[\\/]+/g, "-");
  return name && name !== "." && name !== ".." ? name : "App";
}
