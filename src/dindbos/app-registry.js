export class AppRegistry {
  constructor(os) {
    this.os = os;
    this.apps = new Map();
  }

  register(app) {
    if (!app?.id) throw new Error("App must define an id.");
    this.apps.set(app.id, app);
  }

  list() {
    return [...this.apps.values()];
  }

  launch(appId, context = {}) {
    const app = this.apps.get(appId);
    if (!app) throw new Error(`Unknown app: ${appId}`);
    const windowId = app.singleton ? app.id : `${app.id}-${Date.now()}`;
    return this.os.windows.open({
      id: windowId,
      appId: app.id,
      title: typeof app.title === "function" ? app.title(context) : app.title || app.name,
      icon: app.icon || "app",
      width: app.width || 760,
      height: app.height || 520,
      singleton: app.singleton,
      render: (content, windowApi) => app.render({ os: this.os, content, window: windowApi, context }),
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
}

function matchesMime(value = "", matcher = "") {
  if (matcher.endsWith("/*")) return value.startsWith(matcher.slice(0, -1));
  return value === matcher;
}
