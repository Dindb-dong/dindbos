import { defineApp } from "../sdk/app-definition.js";
import { manifestToText, normalizeAppManifest } from "./app-manifest.js";

export class AppRegistry {
  constructor(os) {
    this.os = os;
    this.apps = new Map();
    this.launchSeq = 0;
  }

  register(app) {
    app = defineApp(app);
    const manifest = normalizeAppManifest(app);
    const previous = this.apps.get(app.id) || null;
    const beforeRoot = this.os.fs.snapshot();
    try {
      this.apps.set(app.id, { ...app, manifest });
      this.writeManifestFile(manifest);
      this.removePreviousApplicationFile(previous, app, manifest);
      this.writeApplicationFile(app, manifest);
      this.writeDesktopApplicationFile(app, manifest);
      return this.getManifest(app.id);
    } catch (error) {
      this.os.fs.root = beforeRoot;
      if (previous) this.apps.set(app.id, previous);
      else this.apps.delete(app.id);
      throw error;
    }
  }

  unregister(appId) {
    const app = this.apps.get(appId);
    if (!app) return false;
    const beforeRoot = this.os.fs.snapshot();
    try {
      this.apps.delete(appId);
      const system = this.os.permissions.systemPrincipal();
      const manifestPath = `/usr/share/dindbos/manifests/${appId}.json`;
      if (this.os.fs.exists(manifestPath)) this.os.fs.remove(manifestPath, "/", {}, system);
      const applicationPath = this.applicationPathFor(app, app.manifest);
      if (this.os.fs.exists(applicationPath)) this.os.fs.remove(applicationPath, "/", {}, system);
      const desktopPath = this.desktopApplicationPathFor(app, app.manifest);
      if (desktopPath && this.os.fs.exists(desktopPath)) this.os.fs.remove(desktopPath, "/", {}, system);
      for (const [id, task] of this.os.windows?.windows || []) {
        if (task.appId === appId) this.os.windows.close(id, { force: true });
      }
      if (this.os.shell?.renderer) this.os.shell.renderDesktop();
      return true;
    } catch (error) {
      this.os.fs.root = beforeRoot;
      this.apps.set(appId, app);
      throw error;
    }
  }

  has(appId) {
    return this.apps.has(appId);
  }

  list() {
    return [...this.apps.values()];
  }

  launch(appId, context = {}) {
    this.os.assertSessionUnlocked?.("launch");
    const app = this.apps.get(appId);
    if (!app) throw new Error(`Unknown app: ${appId}`);
    const windowId = app.singleton ? app.id : `${app.id}-${Date.now()}-${++this.launchSeq}`;
    if (app.singleton && this.os.windows.has(windowId)) return this.os.windows.activate(windowId);
    const launchContext = resolveLaunchContext(app, context, this.os);
    const title = typeof app.title === "function" ? app.title(launchContext) : app.title || app.name;
    const process = this.os.processes.spawn(app, launchContext);
    const sandbox = this.os.createSandbox(process);
    this.os.processes.attachWindow(process.pid, windowId);
    return this.os.windows.open({
      id: windowId,
      appId: app.id,
      context: launchContext,
      pid: process.pid,
      title,
      icon: app.icon || "app",
      width: app.width,
      height: app.height,
      singleton: app.singleton,
      manifest: app.manifest,
      shortcuts: app.manifest?.shortcuts || [],
      render: (content, windowApi) => {
        try {
          const cleanup = app.render({ os: sandbox, content, window: windowApi, context: launchContext });
          return typeof cleanup === "function" || typeof app.dispose === "function" ? () => {
            try { if (typeof cleanup === "function") cleanup(); }
            finally { app.dispose?.({ os: sandbox, content, window: windowApi, context: launchContext }); }
          } : cleanup;
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
    return this.list()
      .map((app, index) => ({ app, index }))
      .filter(({ app }) => (app.accepts || []).some((mime) => matchesMime(node.mime, mime)))
      .sort((left, right) => (right.app.associationPriority || 0) - (left.app.associationPriority || 0) || left.index - right.index)
      [0]?.app || null;
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
    this.os.fs.atomicWriteOrCreateFile(
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
    this.os.fs.createApp(
      this.applicationPathFor(app, manifest),
      manifest.id,
      typeof app.icon === "string" ? app.icon : "app",
      "/",
      { owner: "root", group: "root", permissions: "-rwxr-xr-x" },
      system,
    );
  }

  writeDesktopApplicationFile(app, manifest) {
    const desktopPath = this.desktopApplicationPathFor(app, manifest);
    if (!desktopPath) return;
    const system = this.os.permissions.systemPrincipal();
    this.os.fs.createApp(
      desktopPath,
      manifest.id,
      typeof app.icon === "string" ? app.icon : "app",
      "/",
      { owner: this.os.session?.user || "guest", group: this.os.session?.groups?.[0] || "users", permissions: "-rwxr-xr-x" },
      system,
    );
  }

  removePreviousApplicationFile(previous, app, manifest) {
    if (!previous || !this.os.fs.exists("/usr/share/applications")) return;
    const previousPath = this.applicationPathFor(previous, previous.manifest);
    const nextPath = this.applicationPathFor(app, manifest);
    if (previousPath !== nextPath && this.os.fs.exists(previousPath)) {
      this.os.fs.remove(previousPath, "/", {}, this.os.permissions.systemPrincipal());
    }
    const previousDesktopPath = this.desktopApplicationPathFor(previous, previous.manifest);
    const nextDesktopPath = this.desktopApplicationPathFor(app, manifest);
    if (previousDesktopPath && previousDesktopPath !== nextDesktopPath && this.os.fs.exists(previousDesktopPath)) {
      this.os.fs.remove(previousDesktopPath, "/", {}, this.os.permissions.systemPrincipal());
    }
  }

  applicationPathFor(app, manifest = app?.manifest || {}) {
    const appName = sanitizeLauncherName(typeof app?.name === "string" && app.name ? app.name : manifest.name);
    return `/usr/share/applications/${appName}.app`;
  }

  desktopApplicationPathFor(app, manifest = app?.manifest || {}) {
    if (app?.desktop === false) return "";
    if (app?.desktop !== true && app?.pinned !== true) return "";
    const desktopPath = this.os.session?.desktopPath || this.os.fs?.join?.(this.os.session?.home || "/home/guest", "Desktop");
    if (!desktopPath || !this.os.fs.exists(desktopPath)) return "";
    const appName = sanitizeLauncherName(typeof app?.name === "string" && app.name ? app.name : manifest.name);
    return this.os.fs.join(desktopPath, `${appName}.app`);
  }
}

function resolveLaunchContext(app, context = {}, os = null) {
  if (typeof app.resolveLaunchContext !== "function") return context;
  const resolved = app.resolveLaunchContext(context, os);
  if (!resolved || typeof resolved !== "object") return context;
  return { ...context, ...resolved };
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
