import { mountAppIcon } from "../../ui/app-icon.js";
import { renderDocumentEditor } from "./document-editor.js";
import { renderNotes, renderReminders, renderCalendar } from "./productivity.js";
import { renderPhotos, renderMusic } from "./media.js";
import { renderClock } from "./clock.js";
import { renderApplications } from "./applications.js";
import { executeFilesContextCommand, readFilesTags, remapFilesTags, forgetFilesTags } from "./files-context-commands.js";
import { appearanceMarkup, wireAppearanceControls, welcomeMarkup, wallpaperSettingsMarkup, desktopSettingsMarkup, wireWallpaperPreviews } from "./appearance.js";
import { base64ToBytes, bytesToBase64, fileContentPreview } from "../file-data.js";
import {
  BROWSERD_FRAME_ENCODING,
  BROWSERD_FRAME_TRANSPORT,
  BrowserCompanionClient,
  browserProviderHealthUrl,
  pasteClipboardText,
} from "../browser-client.js";
import { ShellSession } from "../shell.js";

const FILES_OPERATION_HISTORY_LIMIT = 12;
const FILES_OPERATION_YIELD_INTERVAL_MS = 12;
const FILES_OPERATION_YIELD_STEP_INTERVAL = 24;
const FILES_COLUMN_ENTRY_LIMIT = 250;
const FILES_SEARCH_RESULT_LIMIT = 200;
export const BROWSER_LOCAL_HTML_SANDBOX = "allow-scripts allow-forms allow-popups";
const BROWSER_CLOSED_TAB_LIMIT = 8;
const DEFAULT_PORTFOLIO_DATA = {
  name: "DindbOS.js",
  summary: "Browser-native OS runtime mounted by the host application.",
  projects: [
    {
      name: "Runtime",
      type: "Web OS",
      description: "Files, processes, packages, permissions, browser brokers, and diagnostics inside browser constraints.",
    },
  ],
};

export function installBuiltinApps(os, options = {}) {
  const include = options.include ? new Set(options.include) : null;
  const exclude = new Set(options.exclude || []);
  const register = (app) => {
    if ((!include || include.has(app.id)) && !exclude.has(app.id)) os.registerApp(app);
  };
  const appearance = {
    get: () => os.appearance || {},
    set: (patch) => os.setAppearance?.(patch),
    subscribe: (listener) => os.bus?.on?.("appearance:change", listener) || (() => {}),
  };
  const portfolioData = options.portfolioData || DEFAULT_PORTFOLIO_DATA;
  const includePortfolio = options.includePortfolio !== false;
  const userHome = os.session.home || "/home/guest";
  const userDocumentReadRoots = documentReadRoots(userHome);
  const userDocumentWriteRoots = documentWriteRoots(userHome);

  if (includePortfolio) {
    register({
      id: "portfolio",
      name: "Portfolio",
      title: "Portfolio.app",
      icon: "portfolio",
      pinned: true,
      singleton: true,
      width: 860,
      height: 620,
      manifest: {
        capabilities: ["app.launch"],
        fileSystem: { read: ["/mnt/portfolio", userHome], write: [] },
      },
      render: ({ content }) => renderPortfolio(content, portfolioData),
    });
  }

  register({
    id: "files", chrome: "integrated", sidebarWidth: 205,
    name: "Files",
    title: ({ path = "/" }) => `Files - ${path}`,
    icon: "files",
    pinned: true,
    width: 760,
    height: 520,
    accepts: ["inode/directory"],
    manifest: {
      capabilities: ["app.launch", "storage.read", "storage.manage", "localMount.read", "localMount.manage"],
      fileSystem: { read: ["/"], write: userDocumentWriteRoots },
    },
    render: ({ os: runtime, content, context, window }) => (
      renderFiles(runtime, content, context.path || runtime.session.home || "/", window, context)
    ),
  });

  register({
    id: "applications", chrome: "integrated", name: "Applications", title: "Applications", icon: "applications",
    singleton: true, pinned: true, desktop: false, width: 960, height: 680,
    manifest: { capabilities: ["app.launch"], fileSystem: { read: [], write: [] } },
    render: ({ os: runtime, content, context, window }) => renderApplications(runtime, content, { ...context, launchApp: (id) => os.shell.launchApp(id) }, window),
  });

  register({
    id: "terminal",
    name: "Terminal",
    title: "Terminal.app",
    icon: "terminal",
    pinned: true,
    singleton: true,
    width: 760,
    height: 460,
    manifest: {
      capabilities: [
        "app.launch",
        "process.read",
        "process.manage",
        "storage.read",
        "storage.manage",
        "package.read",
        "package.manage",
        "npm.install",
        "node.execute",
        "localMount.read",
        "localMount.manage",
      ],
      fileSystem: { read: ["/"], write: [...userDocumentWriteRoots, "/opt", "/usr/share/applications", "/var/lib/dindbos/packages"] },
    },
    render: ({ os: runtime, content }) => renderTerminal(runtime, content),
  });

  register({
    id: "activity-monitor",
    name: "Activity Monitor",
    title: "Activity Monitor.app",
    icon: "activity",
    pinned: true,
    singleton: true,
    width: 780,
    height: 520,
    manifest: {
      capabilities: ["app.launch", "process.read", "process.manage", "service.read", "service.manage"],
      fileSystem: { read: ["/proc"], write: [] },
    },
    render: ({ os: runtime, content }) => renderActivityMonitor(runtime, content),
  });

  register({
    id: "text", chrome: "document",
    name: "TextEdit",
    title: ({ node }) => node?.name || "TextEdit",
    icon: "text",
    accepts: ["text/plain", "text/markdown", "application/json", "application/x-dindbos-command"],
    width: 720,
    height: 520,
    manifest: {
      capabilities: ["storage.read", "storage.manage", "localMount.read", "localMount.manage"],
      fileSystem: { read: userDocumentReadRoots, write: userDocumentWriteRoots },
    },
    render: ({ os: runtime, content, context, window }) => renderText(runtime, content, context.node, window),
  });

  register({
    id: "browser", chrome: "integrated",
    name: "Browser",
    title: ({ node, url }) => node?.name || url || "Browser.app",
    icon: "browser",
    pinned: true,
    width: 940,
    height: 640,
    associationPriority: 20,
    accepts: ["text/html"],
    manifest: {
      capabilities: ["localMount.read"],
      fileSystem: { read: userDocumentReadRoots, write: [] },
    },
    render: ({ os: runtime, content, context, window }) => renderBrowser(runtime, content, context, window),
  });

  register({
    id: "viewer", chrome: "integrated",
    name: "Viewer",
    title: ({ node }) => node?.name || "Viewer",
    icon: "pdf",
    accepts: ["application/pdf", "image/*", "text/markdown", "application/x-dindbos-deck"],
    associationPriority: 10,
    width: 820,
    height: 560,
    manifest: {
      capabilities: ["app.launch", "localMount.read"],
      fileSystem: { read: userDocumentReadRoots, write: [] },
    },
    render: ({ os: runtime, content, context }) => renderViewer(runtime, content, context.node),
  });

  register({
    id: "calculator", chrome: "integrated", minWidth: 230, minHeight: 408,
    name: "Calculator",
    title: "Calculator.app",
    icon: "calculator",
    pinned: true,
    singleton: true,
    width: 230,
    height: 408,
    manifest: {
      fileSystem: { read: [], write: [] },
    },
    render: ({ content }) => renderCalculator(content),
  });

  register({
    id: "settings", chrome: "integrated", sidebarWidth: 232,
    name: "Settings",
    title: "Settings",
    icon: "settings",
    pinned: true,
    singleton: true,
    width: 740,
    height: 625,
    manifest: {
      capabilities: ["process.read", "storage.read", "storage.manage", "package.read", "localMount.read", "localMount.manage", "service.read", "service.manage", "keychain.read", "browser.read"],
      fileSystem: { read: ["/etc", "/proc", userHome], write: [] },
    },
    render: ({ content, os: runtime, context }) => renderSettings(runtime, content, appearance, context?.section || context?.settingsSection),
  });
  for (const [id, name, render, width, height, accepts] of [
    ["notes", "Notes", renderNotes, 840, 580],
    ["reminders", "Reminders", renderReminders, 780, 560],
    ["calendar", "Calendar", renderCalendar, 880, 630],
    ["clock", "Clock", renderClock, 680, 560],
    ["photos", "Photos", renderPhotos, 820, 580, ["image/*"]],
    ["music", "Music", renderMusic, 820, 580, ["audio/*"]],
  ]) {
    register({
      id, name, icon: id, title: name, singleton: true, desktop: false, pinned: false, width, height,
      chrome: "integrated",
      ...({ notes: 180, reminders: 240, calendar: 200, photos: 168, music: 180 }[id] ? { sidebarWidth: { notes: 180, reminders: 240, calendar: 200, photos: 168, music: 180 }[id] } : {}),
      ...(accepts ? { accepts } : {}),
      manifest: {
        capabilities: id === "clock" ? [] : ["storage.read"],
        fileSystem: { read: id === "clock" ? [] : ["photos", "music"].includes(id) ? userDocumentReadRoots : [userHome], write: id === "clock" ? [] : [userHome] },
      },
      render: ({ os: runtime, content, context, window }) => render(runtime, content, context, window),
    });
  }
  if (options.includeWelcome) {
    register({
      id: "welcome", name: "Welcome", title: "Welcome to DindbOS", icon: "welcome",
      singleton: true, pinned: true, width: 880, height: 640,
      manifest: { capabilities: ["app.launch"], fileSystem: { read: [], write: [] } },
      render: ({ content, os: runtime }) => {
        content.innerHTML = welcomeMarkup(appearance.get());
        const cleanup = wireAppearanceControls(content, appearance);
        const iconCleanups = [...content.querySelectorAll("[data-welcome-icon]")].map((element) => mountAppIcon(element, element.dataset.welcomeIcon));
        content.querySelectorAll("[data-welcome-launch]").forEach((button) => {
          button.disabled = !os.apps.has(button.dataset.welcomeLaunch);
          button.addEventListener("click", () => runtime.launch(button.dataset.welcomeLaunch));
        });
        return () => { cleanup(); iconCleanups.forEach((dispose) => dispose()); };
      },
    });
  }
}

function documentReadRoots(userHome) {
  return uniquePaths([userHome, "/mnt/portfolio", "/tmp"]);
}

function documentWriteRoots(userHome) {
  return uniquePaths([userHome, "/mnt/portfolio", "/tmp"]);
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function renderPortfolio(content, data) {
  content.innerHTML = `
    <section class="portfolio-app">
      <p class="dos-kicker">Running on DindbOS.js</p>
      <h1>${escapeHtml(data.name)}</h1>
      <p>${escapeHtml(data.summary)}</p>
      <div class="portfolio-grid">
        ${data.projects.map((project) => `
          <article>
            <strong>${escapeHtml(project.name)}</strong>
            <span>${escapeHtml(project.type)}</span>
            <p>${escapeHtml(project.description)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderFiles(os, content, path, windowApi, context = {}) {
  const sidebar = [
    { section: "Favorites", items: [
      { label: "Home", path: os.session.home || "/home/guest", icon: "home" },
      { label: "Desktop", path: os.fs.join(os.session.home || "/home/guest", "Desktop"), icon: "desktop" },
      { label: "Documents", path: os.fs.join(os.session.home || "/home/guest", "Documents"), icon: "document" },
      { label: "Downloads", path: os.fs.join(os.session.home || "/home/guest", "Downloads"), icon: "download" },
      { label: "Trash", path: os.fs.join(os.session.home || "/home/guest", ".Trash"), icon: "trash" },
      { label: "Applications", path: "/usr/share/applications", icon: "app" },
    ] },
    { section: "Locations", items: [
      { label: "DindbOS", path: "/", icon: "device" },
      { label: "Portfolio", path: "/mnt/portfolio", icon: "folder" },
      { label: "System", path: "/etc", icon: "settings" },
      { label: "Logs", path: "/var/log", icon: "text" },
    ] },
  ];
  const favoritesPath = os.fs.join(os.session.home || "/home/guest", ".config/dindbos/files-favorites.json");
  const defaultFavorites = sidebar[0].items;
  let favoritePaths = defaultFavorites.map((item) => item.path);
  try {
    if (os.fs.exists(favoritesPath)) {
      const saved = JSON.parse(os.fs.readFile(favoritesPath));
      if (Array.isArray(saved) && saved.every((item) => typeof item === "string" && item.startsWith("/"))) favoritePaths = [...new Set(saved)];
    }
  } catch { /* Preserve unreadable preferences; the built-in shortcuts remain usable. */ }
  const favoriteItems = () => favoritePaths.map((path) => defaultFavorites.find((item) => item.path === path) || { path, label: os.fs.basename(path) || "DindbOS", icon: "folder" });
  const saveFavorites = async (next) => {
    const previous = favoritePaths;
    favoritePaths = [...new Set(next)];
    try {
      const home = os.session.home || "/home/guest";
      for (const directory of [os.fs.join(home, ".config"), os.fs.join(home, ".config/dindbos")]) if (!os.fs.exists(directory)) os.fs.createDirectory(directory, "/", { owner: os.session.user, group: os.session.groups?.[0] || "users" });
      const text = JSON.stringify(favoritePaths);
      if (os.fs.exists(favoritesPath)) os.fs.writeFile(favoritesPath, text);
      else os.fs.createFile(favoritesPath, "/", { content: text, mime: "application/json" });
      await syncAppStorage(os);
      await draw(currentPath, selectedPath, { preserveSelection: true });
    } catch (error) { favoritePaths = previous; windowApi.setTitle(`Files — Could not save Favorites: ${error.message}`); }
  };
  const addFavorite = async (path, target = null, after = false) => {
    if (typeof path !== "string" || !path.startsWith("/")) throw new Error("Drag a folder from this desktop to add it to Favorites.");
    const node = os.fs.resolveNode(os.fs.resolve(path) || os.fs.stat(path));
    if (!["directory", "mount"].includes(node?.type)) throw new Error("Only folders can be added to Favorites.");
    const normalized = os.fs.normalize(path);
    if (normalized === target) return;
    const next = favoritePaths.filter((item) => item !== normalized);
    const targetIndex = target ? next.indexOf(target) : -1;
    next.splice(targetIndex < 0 ? next.length : targetIndex + (after ? 1 : 0), 0, normalized);
    await saveFavorites(next);
  };
  let currentPath = os.fs.normalize(path);
  let selectedPath = currentPath;
  let clipboard = null;
  let clickTimer = null;
  let searchQuery = "";
  let searchOpen = false;
  let searchTimer = null;
  const transferredTab = context.filesTab || {};
  let sortMode = ["kind-name", "name", "modified", "size"].includes(transferredTab.sortMode) ? transferredTab.sortMode : "kind-name";
  let viewMode = ["icons", "list", "columns"].includes(transferredTab.viewMode) ? transferredTab.viewMode : "icons";
  let inspectorOpen = false;
  let disposed = false;
  let drawGeneration = 0;
  let fileOperation = null;
  let operationHistory = [];
  let selectedPaths = new Set([selectedPath]);
  let selectionAnchorPath = selectedPath;
  const restoredHistory = Array.isArray(transferredTab.history) ? transferredTab.history.filter((item) => typeof item === "string" && item.startsWith("/")).map((item) => os.fs.normalize(item)) : [];
  const restoredIndex = Number.isInteger(transferredTab.historyIndex) ? Math.max(0, Math.min(restoredHistory.length - 1, transferredTab.historyIndex)) : 0;
  const navigationHistory = restoredHistory[restoredIndex] === currentPath ? restoredHistory : [currentPath];
  let navigationIndex = navigationHistory === restoredHistory ? restoredIndex : 0;
  let dismissToolbarMenus = null;
  let disconnectColumns = null;
  let fileIconCleanups = [];
  let cancelInlineRename = () => {};
  let tabSequence = 1;
  let activeTabId = "1";
  const folderTabs = [{ id: "1", path: currentPath, history: [...navigationHistory], historyIndex: navigationIndex }];
  let cancelTabDrag = () => {};
  let suppressTabClick = false;
  let tabClickResetTimer = null;
  const pendingTabTransfers = new Set();
  const suppressDragClick = () => {
    suppressTabClick = true;
    window.clearTimeout(tabClickResetTimer);
    tabClickResetTimer = window.setTimeout(() => { suppressTabClick = false; }, 0);
  };
  const moveFolderTab = (id, targetId, after) => {
    if (id === targetId) return;
    const index = folderTabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [tab] = folderTabs.splice(index, 1);
    const targetIndex = folderTabs.findIndex((item) => item.id === targetId);
    folderTabs.splice(targetIndex < 0 ? folderTabs.length : targetIndex + (after ? 1 : 0), 0, tab);
    draw(currentPath, selectedPath, { preserveSelection: true, skipHistory: true, focusTab: true });
  };
  const detachFolderTab = (id, bounds) => {
    const tab = folderTabs.find((item) => item.id === id);
    if (!tab) return;
    const snapshot = { path: tab.path, history: [...tab.history], historyIndex: tab.historyIndex };
    let settled = false;
    let openedWindow = null;
    const cancel = () => { settled = true; pendingTabTransfers.delete(cancel); };
    const finish = (error = null) => {
      if (settled) return;
      cancel();
      if (disposed) return;
      if (error) { openedWindow?.close(); windowApi.setTitle(`Files — Could not detach tab: ${error.message || error}`); return; }
      const index = folderTabs.indexOf(tab);
      // Navigation or closing the source during the target's async mount must not discard new work.
      if (index < 0 || tab.path !== snapshot.path || tab.historyIndex !== snapshot.historyIndex || JSON.stringify(tab.history) !== JSON.stringify(snapshot.history)) return;
      if (folderTabs.length === 1) { windowApi.close(); return; }
      folderTabs.splice(index, 1);
      if (activeTabId === id) selectFolderTab(folderTabs[Math.max(0, index - 1)].id);
      else draw(currentPath, selectedPath, { preserveSelection: true, skipHistory: true });
    };
    pendingTabTransfers.add(cancel);
    try {
      openedWindow = os.launch("files", { path: snapshot.path, filesTab: { history: snapshot.history, historyIndex: snapshot.historyIndex, viewMode, sortMode }, filesTabTransfer: { ready: () => finish(), onError: (error) => finish(error) } });
      openedWindow?.setBounds?.(bounds);
    } catch (error) { finish(error); }
  };
  const selectFolderTab = (id, focusTab = false) => {
    const tab = folderTabs.find((item) => item.id === id);
    if (!tab) return;
    activeTabId = tab.id;
    navigationHistory.splice(0, navigationHistory.length, ...tab.history);
    navigationIndex = tab.historyIndex;
    draw(tab.path, null, { skipHistory: true, focusTab });
  };
  const addFolderTab = () => {
    const tab = { id: String(++tabSequence), path: currentPath, history: [currentPath], historyIndex: 0 };
    folderTabs.push(tab);
    selectFolderTab(tab.id);
  };

  const draw = async (nextPath, nextSelectedPath = null, options = {}) => {
    cancelInlineRename();
    contextMenuCleanups.get(content)?.();
    dismissToolbarMenus?.();
    disconnectColumns?.();
    cancelTabDrag();
    if (disposed) return;
    const generation = ++drawGeneration;
    currentPath = os.fs.normalize(nextPath);
    if (!os.fs.resolve(currentPath)) currentPath = os.session.home || "/";
    if (!options.skipHistory && navigationHistory[navigationIndex] !== currentPath) {
      navigationHistory.splice(navigationIndex + 1);
      navigationHistory.push(currentPath);
      navigationIndex = navigationHistory.length - 1;
    }
    const activeTab = folderTabs.find((tab) => tab.id === activeTabId);
    Object.assign(activeTab, { path: currentPath, history: [...navigationHistory], historyIndex: navigationIndex });
    if (os.localMounts?.isMountedPath(currentPath)) await os.localMounts.syncDirectory(currentPath);
    selectedPath = nextSelectedPath ? os.fs.normalize(nextSelectedPath) : currentPath;
    if (!options.preserveSelection) {
      selectedPaths = new Set([selectedPath]);
      selectionAnchorPath = selectedPath;
    }
    const currentStat = os.fs.stat(currentPath);
    windowApi.setTitle(currentPath === (os.session.home || "/home/guest") ? "Home" : currentPath === "/" ? "DindbOS" : os.fs.basename(currentPath));
    const query = searchQuery.trim();
    const columns = query ? buildSearchColumns(os, currentPath, selectedPath, query, sortMode) : buildFileColumns(os, currentPath, selectedPath, sortMode);
    const visibleCount = columns.reduce((total, column) => total + column.entries.length, 0);
    const currentColumn = columns.find((column) => column.path === currentPath) || columns[columns.length - 1];
    const currentVisibleCount = Number(currentColumn?.entries?.length || 0);
    const currentTotalCount = Number(currentColumn?.totalEntries || currentVisibleCount);
    const cappedSearch = Boolean(query && columns.some((column) => column.capped));
    const selected = os.fs.lstat(selectedPath) || os.fs.stat(selectedPath);
    const mountStatus = await mountStatusForPath(os, currentPath);
    const latestMountOperation = safeRead(() => os.localMounts.operations()[0], null);
    const visibleOperation = latestMountOperation?.status === "running"
      ? latestMountOperation
      : fileOperation || latestMountOperation;
    const diagnostics = buildFilesDiagnostics(os, currentPath, [...selectedPaths], operationHistory, visibleOperation, mountStatus);
    if (disposed || generation !== drawGeneration) return;
    const visibleColumns = viewMode === "columns" ? columns : [currentColumn];
    fileIconCleanups.forEach((cleanup) => cleanup());
    fileIconCleanups = [];
    sidebar[0].items = favoriteItems();
    const activeSidebarItem = sidebar.flatMap((group) => group.items).filter((item) => isWithinPath(currentPath, item.path)).sort((a, b) => b.path.length - a.path.length)[0];

    content.innerHTML = `
      <section class="files-app${inspectorOpen ? " has-inspector" : ""}" tabindex="0" data-files-view="${viewMode}" style="--app-sidebar-width:205px">
        <aside class="files-sidebar">
          ${sidebar.map((group) => `
            <section ${group.section === "Favorites" ? 'data-files-favorites aria-label="Favorites"' : ""}>
              <h3>${escapeHtml(group.section)}</h3>
              ${group.items.map((item) => `
                <button type="button" data-nav="${escapeAttr(item.path)}" data-icon="${escapeAttr(item.icon)}" ${group.section === "Favorites" ? 'draggable="true" data-favorite="true"' : ""} aria-current="${activeSidebarItem === item ? "page" : "false"}" class="${activeSidebarItem === item ? "is-active" : ""}">
                  <span class="dos-mini-icon">${filesMiniIcon(item.icon)}</span>
                  ${escapeHtml(item.label)}
                </button>
              `).join("")}
              ${group.section === "Favorites" ? '<div class="files-favorite-dropzone" data-favorite-drop>Add folder to Favorites</div>' : ""}
            </section>
          `).join("")}
        </aside>
        <div class="files-main">
          <div class="files-toolbar files-commandbar" data-window-drag role="toolbar" aria-label="File actions">
            <div class="files-history">
              <button type="button" data-files-back aria-label="Back" title="Back" ${navigationIndex === 0 ? "disabled" : ""}>${filesToolIcon("back")}</button>
              <button type="button" data-files-forward aria-label="Forward" title="Forward" ${navigationIndex >= navigationHistory.length - 1 ? "disabled" : ""}>${filesToolIcon("forward")}</button>
            </div>
            <strong class="files-folder-title" title="${escapeAttr(currentPath)}">${escapeHtml(currentPath === (os.session.home || "/home/guest") ? "Home" : currentPath === "/" ? "DindbOS" : os.fs.basename(currentPath))}</strong>
            <span class="files-toolbar-spacer"></span>
            <details class="files-toolbar-menu files-view-menu">
              <summary data-no-drag aria-label="File view" title="Change view">${filesToolIcon(viewMode)}${filesToolIcon("chevron")}</summary>
              <div class="files-action-menu" data-glass-surface="menu" data-files-menu-kind="view" role="menu" aria-label="File view">
                ${[["list", "as List"], ["columns", "as Columns"], ["icons", "as Icons"]].map(([value, label]) => `<button type="button" role="menuitemradio" aria-checked="${viewMode === value}" data-files-view="${value}"><span class="files-menu-check" aria-hidden="true">${viewMode === value ? "✓" : ""}</span><span>${filesToolIcon(value)}</span>${label}</button>`).join("")}
              </div>
            </details>
            <details class="files-toolbar-menu files-sort-menu">
              <summary data-no-drag aria-label="Sort files" title="Sort files">${filesToolIcon("sort")}${filesToolIcon("chevron")}</summary>
              <div class="files-action-menu" data-glass-surface="menu" data-files-menu-kind="sort" role="menu" aria-label="Sort files">
                ${[["kind-name", "Kind"], ["name", "Name"], ["modified", "Date Modified"], ["size", "Size"]].map(([value, label]) => `<button type="button" role="menuitemradio" aria-checked="${sortMode === value}" data-files-sort="${value}"><span class="files-menu-check" aria-hidden="true">${sortMode === value ? "✓" : ""}</span>${label}</button>`).join("")}
              </div>
            </details>
            <div class="files-tools-group">
            <button type="button" data-action="new-folder" aria-label="New Folder" title="New Folder">${filesToolIcon("new-folder")}</button>
            <button type="button" data-action="import" aria-label="Import" title="Import files">${filesToolIcon("import")}</button>
            <details class="files-more-actions files-toolbar-menu">
              <summary data-no-drag aria-label="More file actions" title="More actions">${filesToolIcon("more")}</summary>
              <div class="files-action-menu" data-glass-surface="menu" role="menu" aria-label="More file actions">
                ${[["favorite-current", "Add Current Folder to Favorites"], ["new-file", "New File"], ["rename", "Rename"], ["duplicate", "Duplicate"], ["copy", "Copy"], ["paste", "Paste"], ["trash", "Move to Trash"], ["export", "Export"], ["info", "Get Info"], ["mount-local", "Mount Local Folder"], ["delete", "Delete Permanently"]].map(([action, label]) => `<button type="button" role="menuitem" data-action="${action}">${label}</button>`).join("")}
              </div>
            </details>
            </div>
            <button type="button" data-files-search-toggle aria-label="Search" title="Search" ${searchOpen ? 'hidden' : ''}>${filesToolIcon("search")}</button>
            <label class="files-search-field" ${searchOpen ? '' : 'hidden'}>${filesToolIcon("search")}<input type="search" data-files-search aria-label="Search files" placeholder="Search" value="${escapeAttr(searchQuery)}" /></label>
          </div>
          <div class="files-tabstrip" role="tablist" aria-label="Folder tabs">
            <div class="files-tabs">${folderTabs.map((tab) => `<div class="files-tab-item${tab.id === activeTabId ? ' is-current' : ''}"><button type="button" role="tab" data-files-tab="${tab.id}" aria-selected="${tab.id === activeTabId}" tabindex="${tab.id === activeTabId ? '0' : '-1'}" title="${escapeAttr(tab.path)}">${escapeHtml(tab.path === (os.session.home || '/home/guest') ? 'Home' : os.fs.basename(tab.path) || 'DindbOS')}</button>${folderTabs.length > 1 ? `<button type="button" class="files-tab-close" data-files-close-tab="${tab.id}" aria-label="Close ${escapeAttr(tab.path === (os.session.home || '/home/guest') ? 'Home' : os.fs.basename(tab.path) || 'DindbOS')} tab">×</button>` : ''}</div>`).join('')}</div>
            <button type="button" data-files-new-tab aria-label="New tab" title="New tab">+</button>
          </div>
          <div class="files-dropzone" aria-hidden="true">Drop to import into ${escapeHtml(os.fs.basename(currentPath) || "DindbOS")}</div>
          ${mountStatus ? renderMountStatusBanner(mountStatus) : ""}
          ${renderFilesOperation(visibleOperation)}
          <div class="files-column-view" role="tree" data-drop-target="true" data-drop-path="${escapeAttr(currentPath)}">
            ${visibleColumns.filter(Boolean).map((column) => `
              <div class="files-column" data-column="${escapeAttr(column.path)}">
                ${column.entries.map((entry) => {
                  const stat = os.fs.lstat(entry.path) || os.fs.stat(entry.path);
                  const resolved = os.fs.resolveNode(entry);
                  const isSelected = selectedPaths.has(entry.path);
                  return `
                    <button
                      type="button"
                      class="files-row ${isSelected ? "is-selected" : ""}"
                      aria-selected="${isSelected ? "true" : "false"}"
                      data-path="${escapeAttr(entry.path)}"
                      data-openable="${resolved.type === "directory" || resolved.type === "mount" ? "false" : "true"}"
                      data-drop-path="${resolved.type === "directory" || resolved.type === "mount" ? escapeAttr(entry.path) : ""}"
                      data-icon="${escapeAttr(entry.icon || resolved.icon || resolved.type)}"
                      draggable="true"
                    >
                      <span class="dos-mini-icon"><span class="files-list-glyph">${filesMiniIcon(entry.icon || resolved.icon || resolved.type)}</span><span class="files-entry-art" aria-hidden="true">${filesEntryArtwork(os, entry, resolved, stat, viewMode === "icons")}</span></span>
                      <span class="files-row-name">${escapeHtml(entry.name)}</span>
                      <small>${escapeHtml(rowKind(os, entry, stat))}</small>
                    </button>
                  `;
                }).join("")}
                ${!column.entries.length ? `<div class="files-empty"><strong>This folder is empty</strong><span>Add a file or create a folder to get started.</span></div>` : ""}
                ${column.capped ? `
                  <div class="files-column-limit" data-files-column-limit>
                    Showing ${escapeHtml(`${column.entries.length} of ${column.totalEntries}${query ? "+" : ""}`)}. Use search or sorting to narrow this folder.
                  </div>
                ` : ""}
              </div>
            `).join("")}
          </div>
          <div class="files-status">
            <span>${query ? `${visibleCount}${cappedSearch ? "+" : ""} matches` : currentColumn?.capped ? `${currentVisibleCount}/${currentTotalCount} visible` : `${currentTotalCount} items`} · ${selectedPath === currentPath ? 0 : selectedPaths.size} selected</span>
            <nav class="files-breadcrumb" aria-label="Current folder">${renderBreadcrumb(os, currentPath)}</nav>
          </div>
        </div>
        <aside class="files-inspector" ${inspectorOpen ? "" : "hidden"}>
          ${selected ? renderInspector(selected) : "<p>No selection</p>"}
          ${renderFilesDiagnostics(diagnostics)}
          ${renderFilesOperationHistory(operationHistory)}
        </aside>
      </section>
    `;
    const appRoot = content.querySelector(".files-app");
    appRoot.dataset.filesPath = currentPath;
    const registeredApps = new Map(os.apps.list().map((app) => [app.id, app]));
    fileIconCleanups = [...content.querySelectorAll("[data-files-app-icon]")].map((element) => mountAppIcon(element, registeredApps.get(element.dataset.filesAppIcon)?.icon || element.dataset.filesIconFallback || "app"));
    content.querySelectorAll("[data-files-tab]").forEach((button) => {
      button.addEventListener("click", (event) => {
        if (suppressTabClick) { suppressTabClick = false; event.preventDefault(); return; }
        selectFolderTab(button.dataset.filesTab, true);
      });
      button.addEventListener("dragstart", (event) => event.preventDefault());
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        cancelTabDrag();
        const frame = content.closest(".dos-window");
        const host = content.closest(".dindbos-host");
        if (!frame || !host) return;
        const pointerId = event.pointerId;
        const origin = { x: event.clientX, y: event.clientY };
        const frameBounds = frame.getBoundingClientRect();
        const tabBounds = button.getBoundingClientRect();
        const stripBounds = content.querySelector(".files-tabs").getBoundingClientRect();
        // Keep the grab point within the detached tab rather than anchoring to its old tab index.
        const grabOffset = { x: stripBounds.left - frameBounds.left + origin.x - tabBounds.left, y: origin.y - frameBounds.top };
        let dragging = false;
        let preview = null;
        let targetId = null;
        let after = false;
        const clearMarkers = () => content.querySelectorAll(".is-tab-drop-before, .is-tab-drop-after").forEach((item) => item.classList.remove("is-tab-drop-before", "is-tab-drop-after"));
        const cleanup = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", cancel);
          window.removeEventListener("keydown", keydown, true);
          if (button.hasPointerCapture?.(pointerId)) button.releasePointerCapture(pointerId);
          preview?.remove(); clearMarkers();
          frame.classList.remove("is-tab-dragging");
          cancelTabDrag = () => {};
        };
        const cancel = () => { if (dragging) suppressDragClick(); cleanup(); };
        const keydown = (keyEvent) => {
          if (keyEvent.key !== "Escape") return;
          keyEvent.preventDefault(); keyEvent.stopPropagation(); cancel();
        };
        const move = (moveEvent) => {
          if (moveEvent.pointerId !== pointerId) return;
          if (!dragging && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 6) return;
          if (!dragging) {
            dragging = true;
            frame.classList.add("is-tab-dragging");
            preview = document.createElement("div");
            preview.className = "files-tab-drag-preview";
            preview.textContent = button.textContent;
            preview.setAttribute("aria-hidden", "true");
            host.appendChild(preview);
          }
          const hostBounds = host.getBoundingClientRect();
          Object.assign(preview.style, { left: `${moveEvent.clientX - hostBounds.left + 12}px`, top: `${moveEvent.clientY - hostBounds.top + 12}px` });
          clearMarkers(); targetId = null;
          const strip = content.querySelector(".files-tabs").getBoundingClientRect();
          if (moveEvent.clientY >= strip.top - 8 && moveEvent.clientY <= strip.bottom + 8 && moveEvent.clientX >= strip.left && moveEvent.clientX <= strip.right) {
            const tabs = [...content.querySelectorAll("[data-files-tab]")];
            const target = tabs.find((item) => moveEvent.clientX < item.getBoundingClientRect().right) || tabs.at(-1);
            const bounds = target.getBoundingClientRect();
            targetId = target.dataset.filesTab;
            after = moveEvent.clientX > bounds.left + bounds.width / 2;
            if (targetId !== button.dataset.filesTab) target.closest(".files-tab-item").classList.add(after ? "is-tab-drop-after" : "is-tab-drop-before");
          }
          moveEvent.preventDefault();
        };
        const end = (endEvent) => {
          if (endEvent.pointerId !== pointerId) return;
          const wasDragging = dragging;
          const bounds = frame.getBoundingClientRect();
          const outside = endEvent.clientX < bounds.left || endEvent.clientX > bounds.right || endEvent.clientY < bounds.top || endEvent.clientY > bounds.bottom;
          const dropTarget = targetId;
          const dropAfter = after;
          cleanup();
          if (!wasDragging || disposed) return;
          suppressDragClick();
          endEvent.preventDefault();
          if (outside) {
            const hostBounds = host.getBoundingClientRect();
            detachFolderTab(button.dataset.filesTab, { left: endEvent.clientX - hostBounds.left - grabOffset.x, top: endEvent.clientY - hostBounds.top - grabOffset.y, width: frameBounds.width, height: frameBounds.height });
          }
          else if (dropTarget) moveFolderTab(button.dataset.filesTab, dropTarget, dropAfter);
        };
        cancelTabDrag = cancel;
        button.setPointerCapture?.(pointerId);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("keydown", keydown, true);
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const index = folderTabs.findIndex((tab) => tab.id === button.dataset.filesTab);
        const next = event.key === "Home" ? 0 : event.key === "End" ? folderTabs.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + folderTabs.length) % folderTabs.length;
        selectFolderTab(folderTabs[next].id, true);
      });
    });
    content.querySelector("[data-files-new-tab]").addEventListener("click", addFolderTab);
    content.querySelectorAll("[data-files-close-tab]").forEach((button) => button.addEventListener("click", () => {
      const index = folderTabs.findIndex((tab) => tab.id === button.dataset.filesCloseTab);
      const closingActive = folderTabs[index]?.id === activeTabId;
      if (index < 0 || folderTabs.length < 2) return;
      folderTabs.splice(index, 1);
      if (closingActive) selectFolderTab(folderTabs[Math.max(0, index - 1)].id);
      else draw(currentPath, selectedPath, { preserveSelection: true, skipHistory: true });
    }));
    const paintSelection = () => {
      content.querySelectorAll(".files-row").forEach((row) => {
        const selected = selectedPaths.has(row.dataset.path);
        row.classList.toggle("is-selected", selected);
        row.setAttribute("aria-selected", String(selected));
      });
      const status = content.querySelector(".files-status > span");
      if (status) status.textContent = status.textContent.replace(/ · \d+ selected$/, ` · ${selectedPaths.size} selected`);
      if (inspectorOpen) {
        const node = os.fs.lstat(selectedPath) || os.fs.stat(selectedPath);
        const inspector = content.querySelector(".files-inspector");
        inspector.innerHTML = `${node ? renderInspector(node) : "<p>No selection</p>"}${renderFilesDiagnostics(buildFilesDiagnostics(os, currentPath, [...selectedPaths], operationHistory, visibleOperation, mountStatus))}${renderFilesOperationHistory(operationHistory)}`;
      }
    };
    content.querySelectorAll("[data-nav]").forEach((button) => {
      button.addEventListener("click", () => draw(button.dataset.nav));
    });
    const favoritesSection = content.querySelector("[data-files-favorites]");
    const clearSidebarDrag = () => {
      content.querySelectorAll(".is-drop-target, .is-favorite-before, .is-favorite-after").forEach((item) => item.classList.remove("is-drop-target", "is-favorite-before", "is-favorite-after"));
      favoritesSection.classList.remove("is-favorite-drop");
    };
    const reportSidebarError = (error) => windowApi.setTitle(`Files — ${error.message}`);
    const reorderFavorite = async (source, target, after = false) => {
      if (source === target) return;
      const next = favoritePaths.filter((path) => path !== source);
      const index = target ? next.indexOf(target) : next.length;
      next.splice(index < 0 ? next.length : index + (after ? 1 : 0), 0, source);
      await saveFavorites(next);
    };
    content.querySelectorAll("[data-nav]").forEach((button) => {
      if (button.dataset.favorite) {
        button.addEventListener("dragstart", (event) => {
          event.dataTransfer.setData("application/x-dindbos-sidebar-favorite", button.dataset.nav);
          event.dataTransfer.setData("application/x-dindbos-path", button.dataset.nav);
          event.dataTransfer.effectAllowed = "move";
        });
        const favoriteMenu = (event) => {
          event.preventDefault(); event.stopPropagation();
          const index = favoritePaths.indexOf(button.dataset.nav);
          showFilesActionMenu(content, event, [["remove", "Remove from Favorites"], ["up", "Move Up", index === 0], ["down", "Move Down", index === favoritePaths.length - 1]], async (action) => {
            if (action === "remove") await saveFavorites(favoritePaths.filter((path) => path !== button.dataset.nav));
            else {
              const next = [...favoritePaths];
              const to = index + (action === "up" ? -1 : 1);
              if (to >= 0 && to < next.length) { [next[index], next[to]] = [next[to], next[index]]; await saveFavorites(next); }
            }
          }, "Favorite actions");
        };
        button.addEventListener("contextmenu", favoriteMenu);
        button.addEventListener("keydown", (event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            const box = button.getBoundingClientRect(); favoriteMenu({ target: button, clientX: box.left + 20, clientY: box.bottom, preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() });
          }
        });
      }
      button.addEventListener("dragover", (event) => {
        if (![...event.dataTransfer.types].some((type) => ["application/x-dindbos-sidebar-favorite", "application/x-dindbos-path", "Files"].includes(type))) return;
        event.preventDefault(); event.stopPropagation(); clearSidebarDrag();
        const types = [...event.dataTransfer.types];
        const bounds = button.getBoundingClientRect();
        const offset = event.clientY - bounds.top;
        const reordering = types.includes("application/x-dindbos-sidebar-favorite") && button.dataset.favorite;
        const inserting = button.dataset.favorite && types.includes("application/x-dindbos-path") && !types.includes("Files") && (reordering || offset < bounds.height / 4 || offset > bounds.height * 3 / 4);
        const after = offset > bounds.height / 2;
        button.classList.add(inserting ? after ? "is-favorite-after" : "is-favorite-before" : "is-drop-target");
        event.dataTransfer.dropEffect = inserting ? reordering ? "move" : "copy" : types.includes("Files") ? "copy" : "move";
      });
      button.addEventListener("dragleave", () => button.classList.remove("is-drop-target", "is-favorite-before", "is-favorite-after"));
      button.addEventListener("drop", async (event) => {
        event.preventDefault(); event.stopPropagation();
        const bounds = button.getBoundingClientRect();
        const offset = event.clientY - bounds.top;
        const after = offset > bounds.height / 2;
        const inserting = button.classList.contains("is-favorite-before") || button.classList.contains("is-favorite-after") || (button.dataset.favorite && [...event.dataTransfer.types].includes("application/x-dindbos-path") && ![...event.dataTransfer.types].includes("Files") && (offset < bounds.height / 4 || offset > bounds.height * 3 / 4));
        clearSidebarDrag();
        try {
          const sourceFavorite = event.dataTransfer.getData("application/x-dindbos-sidebar-favorite");
          if (sourceFavorite && button.dataset.favorite) await reorderFavorite(sourceFavorite, button.dataset.nav, after);
          else if (inserting) await addFavorite(event.dataTransfer.getData("application/x-dindbos-path"), button.dataset.nav, after);
          else await handleFilesDrop(os, event, button.dataset.nav, draw, windowApi, content, (operation) => { operationHistory = recordFilesOperationHistory(operationHistory, operation); });
        } catch (error) { reportSidebarError(error); }
      });
    });
    const favoriteBoundary = (clientY) => {
      const buttons = [...favoritesSection.querySelectorAll("[data-favorite]")];
      const next = buttons.find((button) => clientY < button.getBoundingClientRect().top + button.offsetHeight / 2);
      return next ? { button: next, after: false } : { button: buttons.at(-1), after: true };
    };
    favoritesSection.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes("application/x-dindbos-path")) return;
      event.preventDefault(); event.stopPropagation(); clearSidebarDrag();
      const boundary = favoriteBoundary(event.clientY);
      if (boundary.button) boundary.button.classList.add(boundary.after ? "is-favorite-after" : "is-favorite-before");
      else favoritesSection.classList.add("is-favorite-drop");
      event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-dindbos-sidebar-favorite") ? "move" : "copy";
    });
    favoritesSection.addEventListener("dragleave", (event) => { if (!favoritesSection.contains(event.relatedTarget)) clearSidebarDrag(); });
    favoritesSection.addEventListener("drop", async (event) => {
      event.preventDefault(); event.stopPropagation();
      const boundary = favoriteBoundary(event.clientY);
      clearSidebarDrag();
      try {
        const favorite = event.dataTransfer.getData("application/x-dindbos-sidebar-favorite");
        if (favorite) await reorderFavorite(favorite, boundary.button?.dataset.nav, boundary.after);
        else await addFavorite(event.dataTransfer.getData("application/x-dindbos-path"), boundary.button?.dataset.nav, boundary.after);
      } catch (error) { reportSidebarError(error); }
    });
    appRoot.addEventListener("dragend", clearSidebarDrag);
    content.querySelector("[data-files-inspector]")?.addEventListener("click", () => {
      inspectorOpen = !inspectorOpen;
      draw(currentPath, selectedPath, { preserveSelection: true });
    });
    content.querySelector("[data-files-back]").addEventListener("click", () => {
      if (navigationIndex > 0) draw(navigationHistory[--navigationIndex], null, { skipHistory: true });
    });
    content.querySelector("[data-files-forward]").addEventListener("click", () => {
      if (navigationIndex < navigationHistory.length - 1) draw(navigationHistory[++navigationIndex], null, { skipHistory: true });
    });
    content.querySelectorAll("button[data-files-view]").forEach((button) => button.addEventListener("click", () => {
      viewMode = button.dataset.filesView;
      draw(currentPath, selectedPath, { preserveSelection: true });
    }));
    const menuLayer = document.createElement("div");
    menuLayer.className = "files-menu-layer";
    content.appendChild(menuLayer);
    const toolbarMenus = new Map([...content.querySelectorAll("details.files-toolbar-menu")].map((details, index) => {
      const menu = details.querySelector(".files-action-menu");
      menu.id = `files-menu-${windowApi.id || "window"}-${generation}-${index}`;
      details.querySelector("summary").setAttribute("aria-controls", menu.id);
      return [details, menu];
    }));
    const closeToolbarMenu = (details, restoreFocus = false) => {
      details.open = false;
      const menu = toolbarMenus.get(details);
      if (menu && menu.parentElement !== details) details.appendChild(menu);
      if (restoreFocus) details.querySelector("summary")?.focus({ preventScroll: true });
    };
    const positionToolbarMenu = (details) => {
      const menu = toolbarMenus.get(details);
      if (!menu || !details.open) return;
      const bounds = content.getBoundingClientRect();
      const anchor = details.querySelector("summary").getBoundingClientRect();
      menu.style.maxHeight = `${Math.max(40, bounds.height - 8)}px`;
      const left = Math.max(4, Math.min(anchor.right - bounds.left - menu.offsetWidth, bounds.width - menu.offsetWidth - 4));
      let top = anchor.bottom - bounds.top + 5;
      if (top + menu.offsetHeight > bounds.height - 4) top = anchor.top - bounds.top - menu.offsetHeight - 5;
      menu.style.left = `${left}px`;
      menu.style.top = `${Math.max(4, Math.min(top, bounds.height - menu.offsetHeight - 4))}px`;
    };
    const openToolbarMenu = (details) => {
      for (const other of toolbarMenus.keys()) if (other !== details) closeToolbarMenu(other);
      const menu = toolbarMenus.get(details);
      details.open = true;
      if (menu.parentElement !== menuLayer) menuLayer.appendChild(menu);
      positionToolbarMenu(details);
    };
    for (const [details] of toolbarMenus) {
      details.querySelector("summary").addEventListener("click", (event) => {
        event.preventDefault();
        if (details.open) closeToolbarMenu(details);
        else openToolbarMenu(details);
      });
      details.addEventListener("toggle", () => details.open ? openToolbarMenu(details) : closeToolbarMenu(details));
    }
    const dismissOutsideToolbar = (event) => {
      for (const [details, menu] of toolbarMenus) if (details.open && !details.contains(event.target) && !menu.contains(event.target)) closeToolbarMenu(details);
    };
    const toolbarKeyDown = (event) => {
      const details = event.target.closest("details.files-toolbar-menu") || [...toolbarMenus].find(([, menu]) => menu.contains(event.target))?.[0];
      if (!details) return;
      const items = [...toolbarMenus.get(details).querySelectorAll("button:not(:disabled)")];
      const index = items.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); openToolbarMenu(details);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : index < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0) : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus({ preventScroll: true });
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeToolbarMenu(details, true); }
    };
    const repositionMenus = () => { for (const details of toolbarMenus.keys()) positionToolbarMenu(details); };
    const menuObserver = typeof ResizeObserver === "function" ? new ResizeObserver(repositionMenus) : null;
    menuObserver?.observe(content);
    document.addEventListener("pointerdown", dismissOutsideToolbar, true);
    content.addEventListener("keydown", toolbarKeyDown);
    content.addEventListener("scroll", repositionMenus, true);
    menuLayer.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); });
    dismissToolbarMenus = () => {
      document.removeEventListener("pointerdown", dismissOutsideToolbar, true);
      content.removeEventListener("keydown", toolbarKeyDown);
      content.removeEventListener("scroll", repositionMenus, true);
      menuObserver?.disconnect();
      for (const details of toolbarMenus.keys()) closeToolbarMenu(details);
    };
    if (viewMode === "columns") {
      const columnView = content.querySelector(".files-column-view");
      const revealCurrentColumn = () => { columnView.scrollLeft = columnView.scrollWidth; };
      revealCurrentColumn();
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(revealCurrentColumn);
        observer.observe(columnView);
        disconnectColumns = () => observer.disconnect();
      }
    }
    const searchInput = content.querySelector("[data-files-search]");
    const openSearch = () => {
      searchOpen = true;
      content.querySelector(".files-search-field").hidden = false;
      content.querySelector("[data-files-search-toggle]").hidden = true;
      searchInput.focus();
    };
    content.querySelector("[data-files-search-toggle]").addEventListener("click", openSearch);
    searchInput.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      searchQuery = ""; searchOpen = false; window.clearTimeout(searchTimer);
      draw(currentPath, selectedPath, { focusSearchToggle: true });
    });
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => draw(currentPath, selectedPath, { focusSearch: true }), 120);
    });
    content.querySelectorAll("button[data-files-sort]").forEach((button) => button.addEventListener("click", () => {
      sortMode = button.dataset.filesSort || "kind-name";
      draw(currentPath, selectedPath, { preserveSelection: true });
    }));
    content.querySelectorAll("[data-path]").forEach((button) => {
      button.addEventListener("click", (event) => {
        clearTimeout(clickTimer);
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          const column = columns.find((item) => item.entries.some((entry) => entry.path === button.dataset.path));
          const nextSelection = updateFilesSelection([...selectedPaths], column?.entries.map((entry) => entry.path) || [], button.dataset.path, {
            mode: event.shiftKey ? "range" : "toggle",
            anchorPath: selectionAnchorPath,
          });
          selectedPaths = new Set(nextSelection.selectedPaths);
          selectionAnchorPath = nextSelection.anchorPath;
          draw(currentPath, button.dataset.path, { preserveSelection: true });
          return;
        }
        selectedPaths = new Set([button.dataset.path]);
        selectionAnchorPath = button.dataset.path;
        selectedPath = button.dataset.path;
        const node = os.fs.resolve(selectedPath) || os.fs.lstat(selectedPath);
        const resolved = os.fs.resolveNode(node);
        if (viewMode === "columns" && (resolved.type === "directory" || resolved.type === "mount")) draw(selectedPath, selectedPath);
        else paintSelection();
      });
      button.addEventListener("dblclick", () => {
        clearTimeout(clickTimer);
        const node = os.fs.resolveNode(os.fs.resolve(button.dataset.path) || os.fs.lstat(button.dataset.path));
        if (node.type === "directory" || node.type === "mount") draw(button.dataset.path, button.dataset.path);
        else os.openPath(button.dataset.path);
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(clickTimer);
        selectedPath = button.dataset.path;
        if (!selectedPaths.has(selectedPath)) {
          selectedPaths = new Set([selectedPath]);
          selectionAnchorPath = selectedPath;
        }
        content.querySelectorAll(".files-row").forEach((row) => {
          const selected = selectedPaths.has(row.dataset.path);
          row.classList.toggle("is-selected", selected);
          row.setAttribute("aria-selected", String(selected));
        });
        const selectionStatus = content.querySelector(".files-status > span");
        if (selectionStatus) selectionStatus.textContent = selectionStatus.textContent.replace(/ · \d+ selected$/, ` · ${selectedPaths.size} selected`);
        showFilesContextMenu(content, event, selectedPath, clipboard, runAction, false, Boolean(button.dataset.dropPath), os, selectedPaths);
      });
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("application/x-dindbos-path", button.dataset.path);
        event.dataTransfer.effectAllowed = "copyMove";
      });
      if (button.dataset.dropPath) {
        button.addEventListener("dragover", (event) => {
          event.preventDefault();
          event.stopPropagation();
          button.classList.add("is-drop-target");
        });
        button.addEventListener("dragleave", () => button.classList.remove("is-drop-target"));
        button.addEventListener("drop", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          button.classList.remove("is-drop-target");
          await handleFilesDrop(os, event, button.dataset.dropPath, draw, windowApi, content, (operation) => {
            operationHistory = recordFilesOperationHistory(operationHistory, operation);
          });
        });
      }
    });
    content.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        await runAction(button.dataset.action);
      });
    });
    content.querySelectorAll("[data-mount-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        await runAction(button.dataset.mountAction, button.dataset.mountPath || currentPath);
      });
    });
    appRoot.addEventListener("keydown", async (event) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault(); event.stopPropagation(); openSearch(); return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "t") {
        event.preventDefault(); event.stopPropagation(); addFolderTab(); return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "w" && folderTabs.length > 1) {
        event.preventDefault(); event.stopPropagation(); content.querySelector(`[data-files-close-tab="${activeTabId}"]`)?.click(); return;
      }
      if (event.key === "Escape") {
        content.querySelectorAll("details.files-toolbar-menu[open]").forEach((details) => closeToolbarMenu(details, true));
      }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        const row = [...content.querySelectorAll(".files-row")].find((item) => item.dataset.path === selectedPath);
        const box = (row || appRoot).getBoundingClientRect();
        showFilesContextMenu(content, { clientX: box.left + 24, clientY: box.top + 24 }, selectedPath, clipboard, runAction, selectedPath === currentPath, Boolean(row?.dataset.dropPath));
        return;
      }
      if (event.target.closest(".files-commandbar, .files-sidebar, input, textarea, select, [contenteditable='true']")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        await runAction("copy");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        await runAction("paste");
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        await runAction("rename");
        return;
      }
      if (event.key === "Delete") {
        event.preventDefault();
        await runAction("trash");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        openSelectedPath();
        return;
      }
      if (viewMode === "icons" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const rows = [...content.querySelectorAll(".files-row")];
        const grid = content.querySelector(".files-column");
        const gridColumns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter((track) => Number.parseFloat(track) > 0).length);
        const index = Math.max(0, rows.findIndex((row) => row.dataset.path === selectedPath));
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -gridColumns, ArrowDown: gridColumns }[event.key] || 0;
        const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + step));
        if (rows[next]) {
          selectedPath = rows[next].dataset.path;
          selectedPaths = new Set([selectedPath]); selectionAnchorPath = selectedPath;
          paintSelection(); rows[next].focus({ preventScroll: true }); rows[next].scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (currentPath !== "/") await draw(os.fs.dirname(currentPath), currentPath, { focusSelected: true });
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const node = os.fs.resolve(selectedPath) || os.fs.lstat(selectedPath);
        const resolved = os.fs.resolveNode(node);
        if (resolved.type === "directory" || resolved.type === "mount") await draw(selectedPath, selectedPath, { focusSelected: true });
        return;
      }
      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const column = columns.find((item) => item.entries.some((entry) => entry.path === selectedPath)) || columns.at(-1);
        const nextSelection = moveFilesKeyboardSelection(selectedPath, column?.entries.map((entry) => entry.path) || [], event.key);
        selectedPath = nextSelection.selectedPath || selectedPath;
        selectedPaths = new Set(nextSelection.selectedPaths);
        selectionAnchorPath = nextSelection.anchorPath;
        await draw(currentPath, selectedPath, { preserveSelection: true, focusSelected: true });
      }
    });
    appRoot.addEventListener("contextmenu", (event) => {
      if (event.target.closest("[data-path], .files-sidebar, input, textarea")) return;
      event.preventDefault();
      event.stopPropagation();
      showFilesContextMenu(content, event, currentPath, clipboard, runAction, true, false, os, selectedPaths);
    });
    const dropTarget = content.querySelector("[data-drop-target]");
    const dropzone = content.querySelector(".files-dropzone");
    const setDragging = (value) => {
      dropzone.classList.toggle("is-active", value);
      dropTarget.classList.toggle("is-dragging", value);
    };
    dropTarget.addEventListener("dragover", (event) => {
      event.preventDefault();
      setDragging(true);
    });
    dropTarget.addEventListener("dragleave", () => setDragging(false));
    dropTarget.addEventListener("drop", async (event) => {
      event.preventDefault();
      setDragging(false);
      await handleFilesDrop(os, event, currentPath, draw, windowApi, content, (operation) => {
        operationHistory = recordFilesOperationHistory(operationHistory, operation);
      });
    });
    if (options.focusTab) content.querySelector(`[data-files-tab="${activeTabId}"]`)?.focus();
    if (options.focusSearchToggle) content.querySelector("[data-files-search-toggle]")?.focus();
    if (options.focusSearch) {
      const nextSearchInput = content.querySelector("[data-files-search]");
      nextSearchInput.focus();
      nextSearchInput.setSelectionRange(nextSearchInput.value.length, nextSearchInput.value.length);
    }
    if (options.focusSelected) {
      const focusedRow = [...content.querySelectorAll("[data-path]")].find((row) => row.dataset.path === selectedPath);
      focusedRow?.focus();
    }
  };
  const openSelectedPath = () => {
    const node = os.fs.resolve(selectedPath) || os.fs.lstat(selectedPath);
    const resolved = os.fs.resolveNode(node);
    if (resolved.type === "directory" || resolved.type === "mount") {
      draw(selectedPath, selectedPath);
      return;
    }
    os.openPath(selectedPath);
  };
  const beginInlineRename = (targetPath) => {
    cancelInlineRename();
    const row = [...content.querySelectorAll(".files-row")].find((element) => element.dataset.path === targetPath);
    const name = row?.querySelector(".files-row-name");
    const appRoot = content.querySelector(".files-app");
    if (!name || !appRoot) { windowApi.setTitle("Files — Select an item to rename"); return; }
    const originalName = os.fs.basename(targetPath);
    const originalDirectory = currentPath;
    const originalTab = activeTabId;
    const editor = document.createElement("div");
    editor.className = "files-rename-editor";
    editor.innerHTML = '<input type="text" data-files-rename aria-label="Rename item" spellcheck="false" autocomplete="off"><span class="files-rename-error" role="alert" hidden></span>';
    const input = editor.querySelector("input");
    const errorMessage = editor.querySelector("[role='alert']");
    input.value = originalName;
    let finished = false;
    let committing = false;
    const position = () => {
      const box = name.getBoundingClientRect(), rootBox = appRoot.getBoundingClientRect();
      const width = Math.max(90, Math.min(240, box.width + 12, rootBox.width - 12));
      Object.assign(editor.style, { left: `${Math.max(4, Math.min(box.left - rootBox.left - 6, rootBox.width - width - 4))}px`, top: `${box.top - rootBox.top - 3}px`, width: `${width}px` });
    };
    const close = (restoreFocus = false) => {
      if (finished) return;
      finished = true;
      content.removeEventListener("scroll", position, true);
      observer?.disconnect();
      editor.remove();
      row.classList.remove("is-renaming"); row.draggable = true;
      cancelInlineRename = () => {};
      if (restoreFocus && row.isConnected) row.focus({ preventScroll: true });
    };
    const commit = async () => {
      if (finished || committing) return;
      if (input.value === originalName) { close(true); return; }
      committing = true; input.readOnly = true;
      input.removeAttribute("aria-invalid"); errorMessage.hidden = true;
      try {
        const result = await handleFileAction(os, originalDirectory, targetPath, "rename", { renameTo: input.value });
        let storageError = result.warning ? new Error(result.warning) : null;
        try { await syncAppStorage(os); } catch (error) { storageError = error; }
        const stillEditing = !finished && !disposed && currentPath === originalDirectory && activeTabId === originalTab;
        close();
        if (stillEditing) await draw(result.path, result.selectedPath, { focusSelected: true });
        if (!disposed && storageError) windowApi.setTitle(`Files — Renamed, but could not save: ${storageError.message}`);
      } catch (error) {
        if (finished || disposed) return;
        committing = false; input.readOnly = false;
        input.setAttribute("aria-invalid", "true");
        errorMessage.textContent = error.message || "Could not rename this item."; errorMessage.hidden = false;
        input.focus({ preventScroll: true });
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void commit(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (!event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation();
    });
    input.addEventListener("blur", () => { void commit(); });
    editor.addEventListener("pointerdown", (event) => event.stopPropagation());
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(position) : null;
    observer?.observe(appRoot);
    row.classList.add("is-renaming"); row.draggable = false;
    appRoot.appendChild(editor);
    content.addEventListener("scroll", position, true);
    cancelInlineRename = close;
    position(); input.focus({ preventScroll: true });
    const node = os.fs.resolveNode(os.fs.resolve(targetPath) || os.fs.lstat(targetPath));
    const dot = originalName.lastIndexOf(".");
    input.setSelectionRange(0, ["directory", "mount"].includes(node?.type) || dot <= 0 ? originalName.length : dot);
  };
  const runAction = async (action, actionPath = selectedPath) => {
    if (disposed) return;
    if (action === "rename") {
      content.querySelector(".files-more-actions")?.removeAttribute("open");
      beginInlineRename(actionPath);
      return;
    }
    if (action === "info") {
      inspectorOpen = !inspectorOpen;
      if (!selectedPaths.has(actionPath)) selectedPaths = new Set([actionPath]);
      await draw(currentPath, actionPath, { preserveSelection: true });
      return;
    }
    if (action === "favorite" || action === "favorite-current") {
      try { await addFavorite(action === "favorite-current" ? currentPath : actionPath); } catch (error) { windowApi.setTitle(`Files — ${error.message}`); }
      return;
    }
    content.querySelector(".files-more-actions")?.removeAttribute("open");
    const reporter = createFilesOperationReporter(content, operationLabel(action));
    try {
      const result = await handleFileAction(os, currentPath, actionPath, action, {
        clipboard,
        conflictPolicy: "prompt",
        reporter,
        selectedPaths: [...selectedPaths],
      });
      if (Object.hasOwn(result, "clipboard")) clipboard = result.clipboard;
      await syncAppStorage(os);
      if (reporter.started) {
        fileOperation = reporter.complete("Complete");
        operationHistory = recordFilesOperationHistory(operationHistory, fileOperation);
      }
      selectedPaths = new Set([result.selectedPath || result.path || currentPath]);
      if (action === "new-folder") searchQuery = "";
      await draw(result.path || currentPath, result.selectedPath || result.path || currentPath);
      if (action === "new-folder" && !disposed) beginInlineRename(result.selectedPath);
      if (result.warning || reporter.warning) windowApi.setTitle(`Files — ${result.warning || reporter.warning}`);
    } catch (error) {
      if (reporter.started) {
        fileOperation = error.name === "AbortError" ? reporter.cancel(error.message) : reporter.fail(error);
        operationHistory = recordFilesOperationHistory(operationHistory, fileOperation);
      }
      windowApi.setTitle(`Files - ${error.message}`);
      updateFilesOperation(content, fileOperation);
    }
  };
  let initialDrawFinished = false;
  const finishInitialDraw = (error = null) => {
    if (initialDrawFinished) return;
    initialDrawFinished = true;
    const handler = error ? context.filesTabTransfer?.onError : context.filesTabTransfer?.ready;
    if (typeof handler === "function") handler(error);
  };
  draw(path).then(() => finishInitialDraw(disposed ? new Error("Finder window closed before opening") : null)).catch((error) => {
    if (!disposed) windowApi.setTitle(`Files - ${error.message}`);
    finishInitialDraw(error);
  });
  return () => {
    disposed = true;
    cancelInlineRename();
    finishInitialDraw(new Error("Finder window closed before opening"));
    for (const cancel of pendingTabTransfers) cancel();
    window.clearTimeout(tabClickResetTimer);
    cancelTabDrag();
    fileIconCleanups.forEach((cleanup) => cleanup());
    fileIconCleanups = [];
    contextMenuCleanups.get(content)?.();
    dismissToolbarMenus?.();
    disconnectColumns?.();
    drawGeneration += 1;
    window.clearTimeout(clickTimer);
    window.clearTimeout(searchTimer);
  };
}

function filesToolIcon(name) {
  const paths = {
    back: '<path d="m12 4-6 6 6 6"/>', forward: '<path d="m8 4 6 6-6 6"/>',
    chevron: '<path d="m6 8 4 4 4-4"/>',
    list: '<path d="M7 5h10M7 10h10M7 15h10M3 5h.1M3 10h.1M3 15h.1"/>',
    icons: '<rect x="2" y="2" width="6" height="6" rx="1"/><rect x="12" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="12" y="12" width="6" height="6" rx="1"/>',
    columns: '<rect x="2" y="3" width="16" height="14" rx="2"/><path d="M8 3v14m5-14v14"/>',
    sort: '<path d="M2 3h16M2 17h16"/><rect x="2" y="6" width="6" height="8" rx="1"/><rect x="11" y="6" width="7" height="3" rx=".7"/><rect x="11" y="11" width="7" height="3" rx=".7"/>',
    'new-folder': '<path d="M2 5h5l2 2h9v10H2Z"/><path d="M10 9v6m-3-3h6"/>',
    import: '<path d="M10 2v10m-4-4 4 4 4-4M3 13v5h14v-5"/>',
    more: '<circle cx="4" cy="10" r=".9"/><circle cx="10" cy="10" r=".9"/><circle cx="16" cy="10" r=".9"/>',
    info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5m0-8v.1"/>',
    search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/>',
  };
  return `<svg class="files-tool-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.more}</svg>`;
}

function filesEntryArtwork(os, entry, resolved, stat, showDocument = true) {
  if (resolved.type === "app" || resolved.appId) return `<span class="files-application-art" data-files-app-icon="${escapeAttr(resolved.appId || "")}" data-files-icon-fallback="${escapeAttr(entry.icon || resolved.icon || "app")}"></span>`;
  if (!showDocument) return "";
  if (["directory", "mount"].includes(resolved.type)) return '<svg class="files-folder-art" viewBox="0 0 80 70" aria-hidden="true"><path fill="#73c8fa" d="M3 13a5 5 0 0 1 5-5h23l8 7h33a5 5 0 0 1 5 5v39a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z"/><path fill="#9eddff" d="M4 18h72v7H4z"/><path fill="#5ab9ef" d="M3 24h74v35a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z"/><path fill="none" stroke="#c7edff" d="M5 25h70"/></svg>';
  let preview = "";
  const mime = resolved.mime || stat?.mime || "";
  if ((mime.startsWith("text/") || /json|javascript|xml/.test(mime)) && Number(stat?.size || 0) < 65536) {
    preview = safeRead(() => String(os.fs.readFile(entry.path)).slice(0, 600), "");
  }
  const extension = (entry.name.split(".").pop() || "").slice(0, 5).toUpperCase();
  return `<span class="files-document-art">${preview ? `<pre>${escapeHtml(preview)}</pre>` : `<span class="files-document-extension">${escapeHtml(extension)}</span>`}</span>`;
}

function filesMiniIcon(type) {
  const paths = {
    folder: '<path d="M2 5h5l2 2h9v11H2Z"/>',
    directory: '<path d="M2 5h5l2 2h9v11H2Z"/>',
    home: '<path d="m2 9 8-7 8 7v9h-6v-6H8v6H2Z"/>',
    desktop: '<rect x="2" y="3" width="16" height="11" rx="1.5"/><path d="M7 18h6m-3-4v4"/>',
    document: '<path d="M5 2h7l4 4v12H5Zm7 0v5h4M8 10h5m-5 3h5"/>',
    download: '<path d="M10 2v11m-4-4 4 4 4-4M3 14v4h14v-4"/>',
    trash: '<path d="M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7m4-7v7"/>',
    app: '<rect x="2" y="2" width="6" height="6" rx="1"/><rect x="12" y="2" width="6" height="6" rx="1"/><rect x="2" y="12" width="6" height="6" rx="1"/><rect x="12" y="12" width="6" height="6" rx="1"/>',
    device: '<rect x="3" y="2" width="14" height="16" rx="2"/><path d="M6 14h8m0-3h.1"/>',
    settings: '<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="2"/><path d="M10 1v3m0 12v3M1 10h3m12 0h3"/>',
  };
  return `<svg class="files-mini-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${paths[type] || paths.document}</svg>`;
}

function buildFileColumns(os, currentPath, selectedPath, sortMode = "kind-name") {
  const normalizedCurrent = os.fs.normalize(currentPath);
  const chain = [];
  let cursor = normalizedCurrent;
  while (cursor !== "/") {
    chain.unshift(cursor);
    cursor = os.fs.dirname(cursor);
  }
  chain.unshift("/");
  return chain.map((columnPath, index) => {
    const selectedInColumn = chain[index + 1] || selectedPath;
    const limited = limitFilesColumnEntries(sortFilesEntries(os, os.fs.list(columnPath), sortMode), selectedInColumn);
    return {
      path: columnPath,
      selectedPath: selectedInColumn,
      entries: limited.entries,
      totalEntries: limited.total,
      capped: limited.capped,
      hiddenEntries: limited.hidden,
    };
  });
}

function buildSearchColumns(os, currentPath, selectedPath, query, sortMode = "kind-name") {
  const results = searchFileEntries(os, currentPath, query, { limit: FILES_SEARCH_RESULT_LIMIT + 1 });
  const limited = limitFilesColumnEntries(sortFilesEntries(os, results, sortMode), selectedPath, FILES_SEARCH_RESULT_LIMIT);
  return [{
    path: currentPath,
    selectedPath,
    entries: limited.entries,
    totalEntries: limited.total,
    capped: limited.capped,
    hiddenEntries: limited.hidden,
  }];
}

export function limitFilesColumnEntries(entries = [], selectedPath = "", limit = FILES_COLUMN_ENTRY_LIMIT) {
  const all = entries.filter(Boolean);
  const max = Math.max(1, Number(limit || FILES_COLUMN_ENTRY_LIMIT));
  if (all.length <= max) {
    return { entries: all, total: all.length, capped: false, hidden: 0 };
  }
  const visible = all.slice(0, max);
  const selectedIndex = all.findIndex((entry) => entry.path === selectedPath);
  if (selectedIndex >= max) visible[max - 1] = all[selectedIndex];
  return {
    entries: visible,
    total: all.length,
    capped: true,
    hidden: all.length - visible.length,
  };
}

export function sortFilesEntries(os, entries = [], mode = "kind-name") {
  const normalizedMode = String(mode || "kind-name");
  const decorated = entries.map((entry, index) => ({
    entry,
    index,
    stat: safeRead(() => os.fs.stat(entry.path), null) || safeRead(() => os.fs.lstat(entry.path), null) || entry,
    resolved: safeRead(() => os.fs.resolveNode(entry), entry) || entry,
  }));
  decorated.sort((left, right) => {
    const direction = normalizedMode === "modified" || normalizedMode === "size" ? -1 : 1;
    if (normalizedMode === "kind-name") {
      return compareFilesKind(left, right) || compareFilesName(left, right) || left.index - right.index;
    }
    if (normalizedMode === "size") {
      return (Number(left.stat?.size || 0) - Number(right.stat?.size || 0)) * direction
        || compareFilesKind(left, right)
        || compareFilesName(left, right)
        || left.index - right.index;
    }
    if (normalizedMode === "modified") {
      return (fileModifiedTime(left.stat) - fileModifiedTime(right.stat)) * direction
        || compareFilesKind(left, right)
        || compareFilesName(left, right)
        || left.index - right.index;
    }
    return compareFilesName(left, right) || left.index - right.index;
  });
  return decorated.map((item) => item.entry);
}

function compareFilesKind(left, right) {
  return fileKindRank(left.resolved) - fileKindRank(right.resolved);
}

function compareFilesName(left, right) {
  return String(left.entry?.name || "").localeCompare(String(right.entry?.name || ""), undefined, { numeric: true, sensitivity: "base" });
}

function fileKindRank(node) {
  const type = node?.type || "";
  if (type === "mount") return 0;
  if (type === "directory") return 1;
  if (type === "app") return 2;
  if (type === "file") return 3;
  return 4;
}

function fileModifiedTime(stat) {
  const time = new Date(stat?.modified || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function searchFileEntries(os, rootPath, query, options = {}) {
  const filters = parseFilesSearchQuery(query);
  const results = [];
  const limit = Math.max(0, Number(options.limit || 0));
  const maxDepth = Math.max(0, Number(options.maxDepth ?? 8));
  const visit = (directory, depth = 0) => {
    if (depth > maxDepth || (limit && results.length >= limit)) return;
    const entries = safeRead(() => os.fs.list(directory), []);
    for (const entry of entries) {
      if (limit && results.length >= limit) return;
      const stat = os.fs.stat(entry.path) || os.fs.lstat(entry.path) || entry;
      const resolved = os.fs.resolveNode(entry);
      if (matchesFilesSearch(entry, resolved, stat, filters)) {
        results.push(entry);
      }
      if (resolved.type === "directory" || resolved.type === "mount") visit(entry.path, depth + 1);
    }
  };
  visit(rootPath);
  return results;
}

export function parseFilesSearchQuery(query = "") {
  const filters = { text: [], type: "", ext: "", min: 0, max: 0, modified: "" };
  String(query || "").trim().split(/\s+/).filter(Boolean).forEach((token) => {
    const [rawKey, ...rawValue] = token.split(":");
    const key = rawKey.toLowerCase();
    const value = rawValue.join(":").trim();
    if (!value) {
      filters.text.push(token.toLowerCase());
      return;
    }
    if (key === "type") filters.type = value.toLowerCase();
    else if (key === "ext") filters.ext = value.replace(/^\./, "").toLowerCase();
    else if (key === "min") filters.min = parseSizeFilter(value);
    else if (key === "max") filters.max = parseSizeFilter(value);
    else if (key === "modified") filters.modified = value.toLowerCase();
    else filters.text.push(token.toLowerCase());
  });
  return filters;
}

function matchesFilesSearch(entry, resolved, stat, filters) {
  const haystack = `${entry.name || ""} ${entry.path || ""}`.toLowerCase();
  if (filters.text.some((needle) => !haystack.includes(needle))) return false;
  if (filters.type && !matchesFilesSearchType(resolved, stat, filters.type)) return false;
  if (filters.ext && fileExtension(entry.name || "") !== filters.ext) return false;
  const size = Number(stat?.size || resolved?.size || 0);
  if (filters.min && size < filters.min) return false;
  if (filters.max && size > filters.max) return false;
  if (filters.modified && !matchesModifiedFilter(stat?.modified || resolved?.modified, filters.modified)) return false;
  return true;
}

function matchesFilesSearchType(resolved, stat, type) {
  if (type === "folder" || type === "directory") return resolved.type === "directory" || resolved.type === "mount";
  if (type === "file") return resolved.type === "file";
  if (type === "app") return resolved.type === "app";
  const mime = String(stat?.mime || resolved?.mime || "").toLowerCase();
  if (type === "image") return mime.startsWith("image/");
  if (type === "text") return mime.startsWith("text/") || mime === "application/json";
  if (type === "pdf") return mime === "application/pdf";
  return mime.includes(type);
}

function parseSizeFilter(value) {
  const match = String(value || "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2] || "b";
  const scale = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[unit] || 1;
  return Math.round(amount * scale);
}

function matchesModifiedFilter(value, filter) {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  const now = Date.now();
  if (filter === "today") return new Date(value).toDateString() === new Date(now).toDateString();
  const match = filter.match(/^([<>]=?)(\d{4}-\d{2}-\d{2})$/);
  if (!match) return String(value).toLowerCase().startsWith(filter);
  const target = new Date(`${match[2]}T00:00:00`).getTime();
  if (match[1] === ">") return time > target;
  if (match[1] === ">=") return time >= target;
  if (match[1] === "<") return time < target;
  return time <= target;
}

function fileExtension(name) {
  const base = String(name || "").toLowerCase();
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index + 1) : "";
}

export function updateFilesSelection(selectedPaths = [], visiblePaths = [], path = "", options = {}) {
  const mode = options.mode || "single";
  const current = new Set(selectedPaths.filter(Boolean));
  const target = String(path || "");
  if (!target) return { selectedPaths: [...current], anchorPath: options.anchorPath || "" };
  if (mode === "single") return { selectedPaths: [target], anchorPath: target };
  if (mode === "toggle") {
    if (current.has(target) && current.size > 1) current.delete(target);
    else current.add(target);
    return { selectedPaths: [...current], anchorPath: target };
  }
  if (mode === "range") {
    const anchor = options.anchorPath && visiblePaths.includes(options.anchorPath) ? options.anchorPath : target;
    const start = visiblePaths.indexOf(anchor);
    const end = visiblePaths.indexOf(target);
    if (start < 0 || end < 0) return { selectedPaths: [target], anchorPath: target };
    const [left, right] = start <= end ? [start, end] : [end, start];
    visiblePaths.slice(left, right + 1).forEach((item) => current.add(item));
    return { selectedPaths: [...current], anchorPath: anchor };
  }
  return { selectedPaths: [target], anchorPath: target };
}

export function moveFilesKeyboardSelection(selectedPath = "", visiblePaths = [], key = "ArrowDown") {
  const paths = visiblePaths.filter(Boolean);
  if (!paths.length) return { selectedPath, selectedPaths: selectedPath ? [selectedPath] : [], anchorPath: selectedPath };
  const currentIndex = paths.indexOf(selectedPath);
  const lastIndex = paths.length - 1;
  let nextIndex = currentIndex >= 0 ? currentIndex : 0;
  if (key === "ArrowUp") nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
  else if (key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : Math.min(lastIndex, currentIndex + 1);
  else if (key === "Home") nextIndex = 0;
  else if (key === "End") nextIndex = lastIndex;
  const nextPath = paths[nextIndex];
  return { selectedPath: nextPath, selectedPaths: [nextPath], anchorPath: nextPath };
}

export function filesActionTargets(currentPath, selectedPath, selectedPaths = []) {
  const unique = [...new Set(selectedPaths.filter((path) => path && path !== currentPath))];
  if (unique.length) return unique;
  if (selectedPath && selectedPath !== currentPath) return [selectedPath];
  return [];
}

function renderBreadcrumb(os, currentPath) {
  const normalized = os.fs.normalize(currentPath);
  const parts = normalized.split("/").filter(Boolean);
  const crumbs = [{ label: "DindbOS", path: "/" }];
  let cursor = "/";
  parts.forEach((part) => {
    cursor = os.fs.join(cursor, part);
    crumbs.push({ label: part, path: cursor });
  });
  return crumbs.map((crumb, index) => `
    <button type="button" data-nav="${escapeAttr(crumb.path)}">
      ${escapeHtml(crumb.label)}
    </button>
    ${index < crumbs.length - 1 ? '<span aria-hidden="true">›</span>' : ""}
  `).join("");
}

async function mountStatusForPath(os, currentPath) {
  if (!os.localMounts?.isMountedPath(currentPath)) return null;
  const normalized = os.fs.normalize(currentPath);
  const statuses = await os.localMounts.status();
  return statuses.find((mount) => (
    normalized === mount.path || normalized.startsWith(`${mount.path}/`)
  )) || null;
}

function renderMountStatusBanner(mount) {
  const status = mount.status || mount.permission || "mounted";
  const needsAccess = status !== "mounted" || (mount.permission && mount.permission !== "granted");
  return `
    <div class="files-mount-banner" data-mount-status="${escapeAttr(status)}">
      <div>
        <strong>${escapeHtml(mount.handleName || mount.name || mount.path)}</strong>
        <span>${escapeHtml(mount.path)} · ${escapeHtml(mount.access || mount.mode || "local folder")} · ${escapeHtml(status)}</span>
        ${mount.error ? `<small>${escapeHtml(mount.error)}</small>` : ""}
      </div>
      <div>
        ${needsAccess ? `<button type="button" data-mount-action="remount-mount" data-mount-path="${escapeAttr(mount.path)}">Allow Access</button>` : ""}
        <button type="button" data-mount-action="remount-mount" data-mount-path="${escapeAttr(mount.path)}">Sync</button>
        <button type="button" data-mount-action="forget-mount" data-mount-path="${escapeAttr(mount.path)}">Forget</button>
      </div>
    </div>
  `;
}

function renderFilesOperation(operation) {
  if (!operation) return `<div class="files-operation" data-empty="true"></div>`;
  const total = Number(operation.total || 0);
  const done = Number(operation.done || 0);
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const status = operation.status || "running";
  const label = operation.label || operation.kind || "operation";
  const detail = operation.error || operation.detail || operation.source || "";
  const cancellable = operation.cancellable && status === "running";
  return `
    <div class="files-operation" data-operation-status="${escapeAttr(status)}">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <span>${total > 0 ? `${done}/${total}` : status} · ${escapeHtml(detail)}</span>
        ${cancellable ? `<button type="button" data-files-operation-cancel="${escapeAttr(operation.id || "")}">Cancel</button>` : ""}
      </div>
      <div class="files-operation-meter" aria-label="${escapeAttr(label)} progress">
        <span style="width:${percent}%"></span>
      </div>
    </div>
  `;
}

function updateFilesOperation(content, operation) {
  const target = content.querySelector(".files-operation");
  if (target) target.outerHTML = renderFilesOperation(operation);
}

export function recordFilesOperationHistory(history = [], operation = {}, options = {}) {
  const limit = Number(options.limit || FILES_OPERATION_HISTORY_LIMIT);
  const detail = operation.error || operation.detail || operation.destination || operation.source || "";
  const item = {
    id: operation.id || `files-history-${Date.now()}`,
    label: operation.label || operation.kind || "Operation",
    status: operation.status || "complete",
    detail,
    done: Number(operation.done || 0),
    total: Number(operation.total || 0),
    startedAt: operation.startedAt || "",
    finishedAt: operation.finishedAt || new Date().toISOString(),
  };
  return [item, ...history].slice(0, Math.max(1, limit));
}

function renderFilesOperationHistory(history = []) {
  return `
    <section class="files-operation-history">
      <p class="dos-kicker">Operation Log</p>
      ${history.length ? `
        <ol>
          ${history.map((item) => `
            <li data-operation-history-status="${escapeAttr(item.status)}">
              <strong>${escapeHtml(item.label)}</strong>
              <span>${escapeHtml(item.status)} · ${escapeHtml(item.detail || "Complete")}</span>
              <small>${escapeHtml(shortTime(item.finishedAt || item.startedAt))}</small>
            </li>
          `).join("")}
        </ol>
      ` : "<p>No operations yet</p>"}
    </section>
  `;
}

export function buildFilesDiagnostics(os, currentPath = "/", selectedPaths = [], operationHistory = [], operation = null, mountStatus = null) {
  const entries = safeRead(() => os.fs.list(currentPath), []);
  const counts = entries.reduce((summary, entry) => {
    const resolved = safeRead(() => os.fs.resolveNode(entry), entry);
    if (resolved.type === "directory") summary.folders += 1;
    else if (resolved.type === "mount") summary.mounts += 1;
    else if (resolved.type === "app") summary.apps += 1;
    else summary.files += 1;
    return summary;
  }, { files: 0, folders: 0, apps: 0, mounts: 0 });
  const latest = operation || operationHistory[0] || null;
  const localMountActive = Boolean(safeRead(() => os.localMounts?.isMountedPath?.(currentPath), false));
  const conflicts = localMountActive
    ? Number(mountStatus?.conflicts?.length || safeRead(() => os.localMounts?.conflictStatus?.(currentPath)?.length, 0))
    : 0;
  const lastStatus = latest?.status || "idle";
  const advice = conflicts > 0
    ? "Resolve local mount sync conflicts before writing."
    : lastStatus === "error" || lastStatus === "cancelled"
      ? "Check Operation Log before retrying."
      : entries.length > 150
        ? "Use search filters to narrow large folders."
        : "Use Terminal doctor for full runtime diagnostics.";
  return {
    path: os.fs.normalize(currentPath),
    items: entries.length,
    selected: selectedPaths.filter(Boolean).length,
    files: counts.files,
    folders: counts.folders,
    apps: counts.apps,
    mounts: counts.mounts,
    localMountActive,
    mountStatus: mountStatus?.status || "",
    conflicts,
    lastOperation: latest?.label || latest?.kind || "none",
    lastStatus,
    advice,
  };
}

function renderFilesDiagnostics(diagnostics) {
  return `
    <section class="files-diagnostics" data-files-diagnostics>
      <p class="dos-kicker">Troubleshooting</p>
      <dl>
        <div><dt>Folder</dt><dd>${escapeHtml(`${diagnostics.items} items · ${diagnostics.files} files · ${diagnostics.folders} folders`)}</dd></div>
        <div><dt>Selection</dt><dd>${escapeHtml(`${diagnostics.selected} selected`)}</dd></div>
        <div><dt>Mount</dt><dd>${escapeHtml(diagnostics.localMountActive ? `${diagnostics.mountStatus || "mounted"} · ${diagnostics.conflicts} conflicts` : "VFS")}</dd></div>
        <div><dt>Last Op</dt><dd>${escapeHtml(`${diagnostics.lastOperation} · ${diagnostics.lastStatus}`)}</dd></div>
      </dl>
      <p>${escapeHtml(diagnostics.advice)}</p>
    </section>
  `;
}

function createFilesOperationReporter(content, label) {
  const controller = new AbortController();
  const reporter = {
    label,
    signal: controller.signal,
    scheduler: createFilesOperationScheduler(),
    started: false,
    state: null,
    cancel(detail = "Cancelled") {
      controller.abort();
      if (!this.started) this.start(1, detail);
      this.state = {
        ...this.state,
        detail,
        error: detail,
        status: "cancelled",
        finishedAt: new Date().toISOString(),
      };
      updateFilesOperation(content, this.state);
      return this.state;
    },
    start(total = 0, detail = "") {
      this.started = true;
      this.state = {
        id: `files-${Date.now()}`,
        label: this.label,
        kind: this.label,
        total,
        done: 0,
        detail,
        status: "running",
        cancellable: true,
        startedAt: new Date().toISOString(),
      };
      updateFilesOperation(content, this.state);
      return this.state;
    },
    progress(operation = {}) {
      if (!this.started) this.start(operation.total || 0, operation.detail || operation.source || "");
      this.state = {
        ...this.state,
        ...operation,
        label: this.label,
        status: operation.status || this.state.status || "running",
        cancellable: this.state.cancellable !== false,
      };
      updateFilesOperation(content, this.state);
      return this.state;
    },
    step(detail = "", increment = 1) {
      if (!this.started) this.start(0, detail);
      this.state = {
        ...this.state,
        done: Number(this.state.done || 0) + increment,
        detail: detail || this.state.detail,
        status: "running",
        cancellable: this.state.cancellable !== false,
      };
      updateFilesOperation(content, this.state);
      return this.state;
    },
    complete(detail = "Complete") {
      if (!this.started) this.start(1, detail);
      this.state = {
        ...this.state,
        done: this.state.total || this.state.done || 1,
        detail,
        status: "complete",
        cancellable: false,
        finishedAt: new Date().toISOString(),
      };
      updateFilesOperation(content, this.state);
      return this.state;
    },
    fail(error) {
      if (!this.started) this.start(1, error?.message || "Failed");
      this.state = {
        ...this.state,
        detail: error?.message || String(error),
        error: error?.message || String(error),
        status: "error",
        cancellable: false,
        finishedAt: new Date().toISOString(),
      };
      updateFilesOperation(content, this.state);
      return this.state;
    },
  };
  content.addEventListener("click", (event) => {
    if (!event.target?.matches?.("[data-files-operation-cancel]")) return;
    if (event.target.dataset.filesOperationCancel !== reporter.state?.id) return;
    reporter.cancel();
  });
  return reporter;
}

export function assertFilesOperationActive(signal, detail = "Files operation cancelled") {
  if (signal?.aborted) {
    const error = new Error(detail);
    error.name = "AbortError";
    throw error;
  }
}

export function createFilesOperationScheduler(options = {}) {
  return {
    intervalMs: Number(options.intervalMs ?? FILES_OPERATION_YIELD_INTERVAL_MS),
    stepInterval: Number(options.stepInterval ?? FILES_OPERATION_YIELD_STEP_INTERVAL),
    steps: 0,
    lastYieldAt: Date.now(),
    yield: typeof options.yield === "function" ? options.yield : null,
  };
}

export async function scheduleFilesOperation(reporter = null, detail = "") {
  assertFilesOperationActive(reporter?.signal);
  const scheduler = reporter?.scheduler;
  if (!scheduler) return false;
  scheduler.steps = Number(scheduler.steps || 0) + 1;
  const now = Date.now();
  const stepDue = scheduler.stepInterval <= 1 || scheduler.steps % scheduler.stepInterval === 0;
  const timeDue = now - Number(scheduler.lastYieldAt || 0) >= scheduler.intervalMs;
  if (!stepDue && !timeDue) return false;
  scheduler.lastYieldAt = now;
  if (typeof scheduler.yield === "function") await scheduler.yield({ detail, steps: scheduler.steps });
  else await new Promise((resolve) => setTimeout(resolve, 0));
  assertFilesOperationActive(reporter?.signal);
  return true;
}

function operationLabel(action) {
  return ({
    copy: "Copy",
    paste: "Paste",
    duplicate: "Duplicate",
    trash: "Move to Trash",
    delete: "Delete",
    import: "Import",
    export: "Export",
    rename: "Rename",
    "mount-local": "Mount Local Folder",
    "remount-mount": "Request Folder Access",
    "forget-mount": "Forget Folder Mount",
  })[action] || action;
}

const contextMenuCleanups = new WeakMap();

function showFilesContextMenu(content, event, targetPath, clipboard, runAction, background = false, folder = false, os, selection = new Set()) {
  const node = os?.fs.resolve(targetPath);
  const name = os?.fs.basename(targetPath) || "Item";
  const multiple = !background && selection.size > 1;
  const compatible = !folder && node ? os.apps.list().filter(app => app.id === node.appId || (app.accepts || []).some(mime => mime === node.mime || mime === "*/*" || mime.endsWith("/*") && node.mime?.startsWith(mime.slice(0, -1)))).sort((a, b) => Number(b.id === node.appId) - Number(a.id === node.appId) || Number(b.associationPriority || 0) - Number(a.associationPriority || 0)) : [];
  const openWith = compatible.map((app, index) => ({ action: `open-with:${app.id}`, label: `${app.name}${index === 0 ? " (Default)" : ""}`, icon: app.icon || "app" }));
  let tags = []; let tagsUnavailable = "";
  try { tags = readFilesTags(os, targetPath); } catch (error) { tagsUnavailable = error.message; }
  const actions = background ? [
    ["new-folder", "New Folder"], ["new-file", "New File"], ["import", "Import Files…"], null,
    ["paste", clipboard ? `Paste ${clipboard.name || "Item"}` : "Paste", !clipboard], null,
    ["info", "Get Info"],
  ] : [
    ["open", "Open"], ...(!folder ? [["open-with", "Open With", multiple || !openWith.length, openWith]] : [["open-new-window", "Open in New Window"]]), null,
    ["trash", "Move to Trash"], null,
    ["info", "Get Info"], ["rename", "Rename", multiple],
    ["compress", multiple ? `Compress ${selection.size} Items` : `Compress “${name}”`],
    ["duplicate", "Duplicate", multiple], ["make-alias", "Make Alias", typeof os?.fs.createSymlink !== "function" || multiple],
    ...(!folder ? [["quick-look", `Quick Look “${name}”`, multiple || !os?.apps.list().some(app => app.id === "viewer")]] : []),
    ["copy", "Copy"], null,
    ["share", "Share…", folder || multiple, [["export", "Download a Copy…"], ["copy-path", "Copy Path"]]], null,
    ...(tagsUnavailable ? [["tags-unavailable", `Tags unavailable: ${tagsUnavailable}`, true]] : [{ colors: true, tags }]), null,
    ["quick-actions", "Quick Actions", false, [["copy-path", "Copy Path"], ...(folder ? [["favorite", "Add to Favorites"]] : [["export", "Export…"]])]],
  ];
  showFilesActionMenu(content, event, actions, action => runAction(action, targetPath), background ? "Folder actions" : "File actions");
}

function showFilesActionMenu(content, event, actions, runAction, label) {
  contextMenuCleanups.get(content)?.();
  const previousFocus = document.activeElement;
  const panels = [];
  const commands = new Map();
  const iconCleanups = [];
  let activeSubmenu = null;
  const normalize = item => Array.isArray(item) ? { action: item[0], label: item[1], disabled: item[2], children: item[3] } : item;
  const makePanel = (entries, panelLabel) => {
    const panel = document.createElement("div");
    panel.className = "files-context-menu";
    panel.dataset.glassSurface = "menu";
    panel.setAttribute("role", "menu"); panel.setAttribute("aria-label", panelLabel);
    const scroller = document.createElement("div"); scroller.className = "files-context-scroll"; panel.append(scroller);
    for (const source of entries) {
      if (!source) { const divider = document.createElement("div"); divider.className = "files-context-divider"; divider.setAttribute("role", "separator"); scroller.append(divider); continue; }
      const item = normalize(source);
      if (item.colors) {
        const group = document.createElement("div"); group.className = "files-context-colors"; group.setAttribute("role", "group"); group.setAttribute("aria-label", "Tags");
        for (const color of ["red", "orange", "yellow", "green", "blue", "purple", "gray", "none"]) {
          const button = document.createElement("button"); button.type = "button"; button.dataset.contextAction = `tag:${color}`; button.className = "files-context-tag"; button.style.setProperty("--tag-color", ({ red:"#ff6059",orange:"#ffa143",yellow:"#ffd23f",green:"#50c75a",blue:"#3298ff",purple:"#bd5be5",gray:"#999",none:"transparent" })[color]); button.setAttribute("aria-label", color === "none" ? "Remove Tag" : `${color[0].toUpperCase() + color.slice(1)} Tag`); button.title = button.getAttribute("aria-label"); button.disabled = Boolean(item.disabled); button.setAttribute("aria-pressed", String(color !== "none" && item.tags?.includes(color))); if (color === "none") button.textContent = "×"; group.append(button);
          commands.set(button, { action: `tag:${color}` });
        }
        scroller.append(group); continue;
      }
      const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "menuitem"); button.dataset.contextAction = item.action; button.disabled = Boolean(item.disabled); button.title = item.label;
      const text = document.createElement("span"); text.textContent = item.label; text.className = "files-context-label";
      if (item.icon) { const icon = document.createElement("span"); icon.className = "files-context-icon"; button.append(icon); iconCleanups.push(mountAppIcon(icon, item.icon)); }
      button.append(text);
      if (item.children) { button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false"); const arrow = document.createElement("span"); arrow.textContent = "›"; arrow.className = "files-context-chevron"; button.append(arrow); }
      else if (["copy", "paste"].includes(item.action)) { const kbd = document.createElement("kbd"); kbd.textContent = item.action === "copy" ? "⌘C" : "⌘V"; button.append(kbd); }
      commands.set(button, item); scroller.append(button);
    }
    panel.addEventListener("contextmenu", nextEvent => { nextEvent.preventDefault(); nextEvent.stopPropagation(); });
    content.append(panel); panels.push(panel); return panel;
  };
  const bounds = content.getBoundingClientRect();
  const position = (panel, left, top) => {
    panel.style.maxHeight = `${Math.max(40, bounds.height - 8)}px`;
    panel.style.left = `${Math.max(4, Math.min(left, bounds.width - panel.offsetWidth - 4))}px`;
    panel.style.top = `${Math.max(4, Math.min(top, bounds.height - panel.offsetHeight - 4))}px`;
  };
  const menu = makePanel(actions, label);
  position(menu, event.clientX - bounds.left, event.clientY - bounds.top);
  const closeSubmenu = () => { if (activeSubmenu) { activeSubmenu.trigger.setAttribute("aria-expanded", "false"); activeSubmenu.panel.remove(); panels.splice(panels.indexOf(activeSubmenu.panel), 1); activeSubmenu = null; } };
  const openSubmenu = (trigger, item, focus = false) => {
    if (activeSubmenu?.trigger === trigger) { if (focus) activeSubmenu.panel.querySelector("button:not(:disabled)")?.focus({preventScroll:true}); return; }
    closeSubmenu();
    const panel = makePanel(item.children || [], `${item.label} submenu`);
    trigger.setAttribute("aria-expanded", "true");
    const anchor = trigger.getBoundingClientRect();
    const right = menu.offsetLeft + menu.offsetWidth - 3;
    const left = right + panel.offsetWidth <= bounds.width - 4 ? right : menu.offsetLeft - panel.offsetWidth + 3;
    position(panel, left >= 4 ? left : menu.offsetLeft + 24, anchor.top - bounds.top - 5);
    activeSubmenu = { trigger, panel };
    if (focus) panel.querySelector("button:not(:disabled)")?.focus({preventScroll:true});
  };
  let closed = false;
  const close = () => { if (closed) return; closed = true; panels.forEach(panel => panel.remove()); iconCleanups.forEach(cleanup => cleanup()); document.removeEventListener("pointerdown", outside, true); content.removeEventListener("keydown", keydown); content.removeEventListener("pointerover", hover); content.removeEventListener("click", click); contextMenuCleanups.delete(content); };
  const outside = nextEvent => { if (!panels.some(panel => panel.contains(nextEvent.target))) close(); };
  const keydown = keyEvent => {
    const panel = panels.find(panel => panel.contains(keyEvent.target)); if (!panel) return;
    const items = [...panel.querySelectorAll("button:not(:disabled)")];
    const current = document.activeElement; const index = items.indexOf(current);
    if (keyEvent.key === "Escape") { keyEvent.preventDefault(); keyEvent.stopPropagation(); close(); (previousFocus?.isConnected ? previousFocus : content.querySelector(".files-app"))?.focus({preventScroll:true}); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(keyEvent.key)) { keyEvent.preventDefault(); keyEvent.stopPropagation(); const next = keyEvent.key === "Home" ? 0 : keyEvent.key === "End" ? items.length - 1 : (index + (keyEvent.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items[next]?.focus({preventScroll:true}); }
    if (keyEvent.key === "ArrowRight" && commands.get(current)?.children) { keyEvent.preventDefault(); keyEvent.stopPropagation(); openSubmenu(current, commands.get(current), true); }
    if (keyEvent.key === "ArrowLeft" && activeSubmenu?.panel === panel) { keyEvent.preventDefault(); keyEvent.stopPropagation(); const trigger = activeSubmenu.trigger; closeSubmenu(); trigger.focus({preventScroll:true}); }
  };
  content.addEventListener("keydown", keydown);
  const hover = nextEvent => { const button = nextEvent.target.closest?.("button"); if (!button || !menu.contains(button)) return; const item = commands.get(button); if (item?.children && !button.disabled) openSubmenu(button, item); else closeSubmenu(); };
  content.addEventListener("pointerover", hover);
  // Delegate so submenus created after opening use the same command lifecycle.
  const click = async nextEvent => {
    const button = nextEvent.target.closest?.("button"); if (!button || !commands.has(button) || button.disabled) return;
    const item = commands.get(button);
    if (item.children) { openSubmenu(button, item, true); return; }
    close();
    try { await runAction(item.action); } catch { /* The owning app reports operation failures. */ }
  };
  content.addEventListener("click", click);
  contextMenuCleanups.set(content, close);
  document.addEventListener("pointerdown", outside, true);
  menu.querySelector("button:not(:disabled)")?.focus({preventScroll:true});
}

async function handleFilesDrop(os, event, destinationPath, draw, windowApi, content, onHistory = null) {
  const reporter = createFilesOperationReporter(content, "Drop");
  const conflict = { conflictPolicy: "prompt" };
  try {
    const sourcePath = event.dataTransfer?.getData("application/x-dindbos-path");
    if (sourcePath) {
      const moved = await movePathIntoDirectory(os, sourcePath, destinationPath, reporter, conflict);
      onHistory?.(reporter.complete("Complete"));
      await syncAppStorage(os);
      await draw(destinationPath, moved || destinationPath);
      if (reporter.warning) windowApi.setTitle(`Files — ${reporter.warning}`);
      return;
    }
    const imported = await importDroppedFiles(os, destinationPath, event.dataTransfer?.files || [], reporter, conflict);
    onHistory?.(reporter.complete("Complete"));
    await syncAppStorage(os);
    await draw(destinationPath, imported[0] || destinationPath);
  } catch (error) {
    onHistory?.(reporter.fail(error));
    windowApi.setTitle(`Files - ${error.message}`);
  }
}

function isWithinPath(path, rootPath) {
  const normalizedPath = rootPath === "/" ? path : path.replace(/\/$/, "");
  const normalizedRoot = rootPath.replace(/\/$/, "") || "/";
  if (normalizedRoot === "/") return normalizedPath === "/";
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function rowKind(os, entry, stat) {
  if (os.fs.isLink(entry)) return `alias -> ${entry.target}`;
  if (entry.type === "mount") return "mounted folder";
  if (entry.type === "directory") return "folder";
  if (entry.type === "app") return "application";
  return stat?.mime || entry.type;
}

function renderInspector(stat) {
  return `
    <p class="dos-kicker">Inspector</p>
    <h3>${escapeHtml(stat.name)}</h3>
    <dl>
      <div><dt>Path</dt><dd>${escapeHtml(stat.path)}</dd></div>
      <div><dt>Kind</dt><dd>${escapeHtml(stat.type)}</dd></div>
      ${stat.target ? `<div><dt>Target</dt><dd>${escapeHtml(stat.target)}</dd></div>` : ""}
      <div><dt>Mode</dt><dd>${escapeHtml(stat.permissions)}</dd></div>
      <div><dt>Access</dt><dd>${escapeHtml(permissionSummary(stat.permissions))}</dd></div>
      <div><dt>Owner</dt><dd>${escapeHtml(`${stat.owner}:${stat.group}`)}</dd></div>
      <div><dt>Size</dt><dd>${escapeHtml(formatBytes(stat.size))}</dd></div>
      <div><dt>Modified</dt><dd>${escapeHtml(shortTime(stat.modified))}</dd></div>
    </dl>
  `;
}

function permissionSummary(mode = "") {
  const normalized = String(mode).padEnd(10, "-");
  return [
    `owner ${normalized.slice(1, 4)}`,
    `group ${normalized.slice(4, 7)}`,
    `other ${normalized.slice(7, 10)}`,
  ].join(" · ");
}

async function handleFileAction(os, currentPath, selectedPath, action, state = {}) {
  const reporter = state.reporter || null;
  const contextual = await executeFilesContextCommand(os, currentPath, selectedPath, action, state);
  if (contextual) return contextual;
  if (action.startsWith("open-with:")) {
    const appId = action.slice(10);
    if (!os.apps.list().some(app => app.id === appId)) throw new Error("The selected application is no longer installed");
    os.launch(appId, { node: os.fs.resolve(selectedPath), path: selectedPath });
    return { path: currentPath, selectedPath };
  }
  if (["quick-look", "open-new-window"].includes(action)) {
    const appId = { "quick-look": "viewer", "open-new-window": "files" }[action];
    if (!os.apps.list().some(app => app.id === appId)) throw new Error("The application is not installed");
    os.launch(appId, { node: os.fs.resolve(selectedPath), path: selectedPath, cwd: selectedPath });
    return { path: currentPath, selectedPath };
  }
  if (action === "copy-path") {
    if (!globalThis.navigator?.clipboard?.writeText) throw new Error("Clipboard access is unavailable");
    await globalThis.navigator.clipboard.writeText(selectedPath);
    return { path: currentPath, selectedPath };
  }
  if (action === "mount-local") {
    if (!os.localMounts?.supported()) throw new Error("File System Access API is not available");
    reporter?.start(1, "Waiting for folder picker");
    const mount = await os.localMounts.mountLocal();
    reporter?.step(mount.path);
    return { path: mount.path, selectedPath: mount.path };
  }
  if (action === "remount-mount") {
    reporter?.start(1, selectedPath);
    const mount = await os.localMounts.requestAccess(selectedPath);
    reporter?.step(mount.path);
    return { path: mount.path, selectedPath: mount.path };
  }
  if (action === "forget-mount") {
    reporter?.start(1, selectedPath);
    await os.localMounts.forgetMount(selectedPath);
    reporter?.step(selectedPath);
    return { path: os.session.home || "/", selectedPath: os.session.home || "/" };
  }
  if (action === "new-folder") {
    const target = await uniqueDestinationPath(os, currentPath, "Untitled Folder");
    if (os.localMounts?.isMountedPath(currentPath)) {
      await os.localMounts.createDirectory(target);
      return { path: currentPath, selectedPath: target };
    }
    os.fs.createDirectory(target);
    return { path: currentPath, selectedPath: target };
  }
  if (action === "new-file") {
    const target = uniquePath(os, currentPath, "untitled.txt");
    if (os.localMounts?.isMountedPath(currentPath)) {
      await os.localMounts.writeFile(target, "");
      return { path: currentPath, selectedPath: target };
    }
    os.fs.createFile(target, "/", { content: "" });
    return { path: currentPath, selectedPath: target };
  }
  if (action === "open") {
    const target = actionTarget(currentPath, selectedPath);
    os.openPath(target);
    return { path: currentPath, selectedPath: target };
  }
  if (action === "rename") {
    const target = actionTarget(currentPath, selectedPath);
    const currentName = os.fs.basename(target);
    const inline = Object.hasOwn(state, "renameTo");
    const nextName = inline ? String(state.renameTo) : prompt("Rename", currentName);
    if ((!inline && !nextName) || nextName === currentName) return { path: currentPath, selectedPath: target };
    if (String(nextName).includes("/") || String(nextName).includes("\0")) throw new Error("Names cannot contain a slash or null character.");
    const destination = os.fs.join(os.fs.dirname(target), sanitizeFileName(nextName));
    if (await importPathExists(os, destination)) throw new Error(`An item named “${os.fs.basename(destination)}” already exists.`);
    if (os.localMounts?.isMountedPath(target)) await movePath(os, target, destination, reporter, state);
    else { os.fs.move(target, destination); maintainFilesTags(() => remapFilesTags(os, target, destination), state); }
    return { path: os.fs.dirname(destination), selectedPath: destination, warning: state.warning || reporter?.warning };
  }
  if (action === "duplicate") {
    const target = actionTarget(currentPath, selectedPath);
    const destination = await uniqueDestinationPath(os, os.fs.dirname(target), duplicateName(os.fs.basename(target)));
    await copyPath(os, target, destination, reporter);
    return { path: os.fs.dirname(destination), selectedPath: destination };
  }
  if (action === "copy") {
    const target = actionTarget(currentPath, selectedPath);
    return {
      path: currentPath,
      selectedPath: target,
      clipboard: { action: "copy", path: target, name: os.fs.basename(target) },
    };
  }
  if (action === "paste") {
    if (!state.clipboard?.path) throw new Error("Clipboard is empty");
    const pasted = await copyPathIntoDirectory(os, state.clipboard.path, currentPath, reporter, state);
    return { path: currentPath, selectedPath: pasted || currentPath, clipboard: state.clipboard };
  }
  if (action === "trash") {
    const targets = filesActionTargets(currentPath, selectedPath, state.selectedPaths);
    if (!targets.length) throw new Error("Select an item first");
    reporter?.start(targets.length, `Moving ${targets.length} item${targets.length === 1 ? "" : "s"} to Trash`);
    let trashed = currentPath;
    for (const target of targets) {
      trashed = await movePathToTrash(os, target);
      reporter?.step(target);
    }
    return { path: currentPath, selectedPath: targets.length === 1 ? trashed : currentPath };
  }
  if (action === "import") {
    const imported = await importFilesWithPicker(os, currentPath, reporter, state);
    return { path: currentPath, selectedPath: imported[0] || currentPath };
  }
  if (action === "export") {
    if (selectedPath === currentPath) await exportPath(os, currentPath, reporter, state);
    else await exportPath(os, selectedPath, reporter, state);
    return { path: currentPath, selectedPath };
  }
  if (action === "delete") {
    const targets = filesActionTargets(currentPath, selectedPath, state.selectedPaths);
    if (!targets.length) throw new Error("Select an item first");
    reporter?.start(targets.length, `Deleting ${targets.length} item${targets.length === 1 ? "" : "s"}`);
    for (const target of targets) {
      await removePath(os, target, reporter);
      reporter?.step(target);
    }
    return { path: currentPath, selectedPath: currentPath };
  }
  return { path: currentPath, selectedPath };
}

async function importFilesWithPicker(os, currentPath, reporter = null, options = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);
  try {
    const files = await new Promise((resolve) => {
      input.addEventListener("change", () => resolve(input.files || []), { once: true });
      input.click();
    });
    return importDroppedFiles(os, currentPath, files, reporter, options);
  } finally {
    input.remove();
  }
}

export async function importDroppedFiles(os, currentPath, fileList, reporter = null, options = {}) {
  const files = [...fileList];
  const imported = [];
  if (files.length) reporter?.start(files.length, `Importing ${files.length} file${files.length === 1 ? "" : "s"}`);
  for (const file of files) {
    if (file.name.endsWith(".dindbos-export.json")) {
      imported.push(...await importDindbArchive(os, currentPath, file, reporter, options));
      reporter?.step(file.name);
      await scheduleFilesOperation(reporter, file.name);
      continue;
    }
    const conflict = await planImportPath(os, currentPath, file.name || "upload.bin", { ...options, reporter });
    if (!conflict) {
      reporter?.step(file.name || "skipped");
      await scheduleFilesOperation(reporter, file.name || "skipped");
      continue;
    }
    const target = conflict.path;
    if (!os.localMounts?.isMountedPath(currentPath)) reserveImportStorage(os, fileByteLength(file), {
      scope: "files-import",
      source: "dropped-file",
      path: target,
      name: file.name || "upload.bin",
    });
    await ensureImportParent(os, os.fs.dirname(target));
    await replaceExistingPath(os, target, conflict, reporter);
    if (os.localMounts?.isMountedPath(currentPath)) await os.localMounts.writeFileBlob(target, file, "/", { mime: file.type || mimeFromName(target) });
    else await os.fs.writeOrCreateFileBlob(target, file, "/", { mime: file.type || mimeFromName(target), owner: "guest", group: "users", permissions: "-rw-r--r--" });
    imported.push(target);
    reporter?.step(target);
    await scheduleFilesOperation(reporter, target);
  }
  return imported;
}

export async function importDindbArchive(os, currentPath, file, reporter = null, options = {}) {
  const archive = JSON.parse(await file.text());
  if (archive?.kind !== "dindbos-export-v1" || !Array.isArray(archive.entries)) throw new Error("Invalid DindbOS export");
  if (os.localMounts?.isMountedPath(currentPath)) return importDindbArchiveDirect(os, currentPath, archive, reporter, options, file.name || "archive");
  return importDindbArchiveAtomic(os, currentPath, archive, reporter, options, file.name || "archive");
}

async function importDindbArchiveDirect(os, currentPath, archive, reporter = null, options = {}, archiveName = "archive") {
  const imported = [];
  if (!reporter?.started) reporter?.start(archive.entries.length, archiveName);
  for (const entry of archive.entries) {
    const relative = sanitizeRelativePath(entry.path || entry.name || "file.bin");
    const conflict = await planImportPath(os, currentPath, relative, { ...options, reporter });
    if (!conflict) {
      reporter?.step(relative);
      await scheduleFilesOperation(reporter, relative);
      continue;
    }
    const target = conflict.path;
    const bytes = base64ToBytes(entry.data || "");
    if (!os.localMounts?.isMountedPath(target)) reserveImportStorage(os, bytes.byteLength, {
      scope: "files-import",
      source: "archive-entry",
      path: target,
      archive: archiveName,
    });
    await ensureImportParent(os, os.fs.dirname(target));
    await replaceExistingPath(os, target, conflict, reporter);
    if (os.localMounts?.isMountedPath(target)) await os.localMounts.writeFileBytes(target, bytes, "/", { mime: entry.mime || mimeFromName(target) });
    else os.fs.writeOrCreateFileBytes(target, bytes, "/", {
      mime: entry.mime || mimeFromName(target),
      owner: entry.owner || "guest",
      group: entry.group || "users",
      permissions: entry.permissions || "-rw-r--r--",
    });
    imported.push(target);
    reporter?.step(target);
    await scheduleFilesOperation(reporter, target);
  }
  return imported;
}

async function importDindbArchiveAtomic(os, currentPath, archive, reporter = null, options = {}, archiveName = "archive") {
  const beforeRoot = os.fs.snapshot();
  const stagingParent = "/tmp/dindbos/archive-import-staging";
  const imported = [];
  const plan = [];
  if (!reporter?.started) reporter?.start(archive.entries.length, archiveName);
  try {
    reserveImportStorage(os, archiveImportBytes(archive), {
      scope: "files-import",
      source: "archive",
      path: currentPath,
      archive: archiveName,
      entries: archive.entries.length,
    });
    ensureVirtualDirectory(os, stagingParent);
    const stagingRoot = uniquePath(os, stagingParent, `archive-${Date.now().toString(36)}`);
    ensureVirtualDirectory(os, stagingRoot);
    for (const entry of archive.entries) {
      const relative = sanitizeRelativePath(entry.path || entry.name || "file.bin");
      const conflict = await planImportPath(os, currentPath, relative, { ...options, reporter });
      if (!conflict) {
        reporter?.step(relative);
        await scheduleFilesOperation(reporter, relative);
        continue;
      }
      const stageDirectory = os.fs.join(stagingRoot, `entry-${plan.length + 1}`);
      const stagePath = os.fs.join(stageDirectory, os.fs.basename(conflict.path));
      ensureVirtualDirectory(os, stageDirectory);
      os.fs.atomicWriteOrCreateFileBytes(stagePath, base64ToBytes(entry.data || ""), "/", {
        mime: entry.mime || mimeFromName(conflict.path),
        owner: entry.owner || "guest",
        group: entry.group || "users",
        permissions: entry.permissions || "-rw-r--r--",
      });
      plan.push({ conflict, stagePath });
      imported.push(conflict.path);
      reporter?.step(conflict.path);
      await scheduleFilesOperation(reporter, conflict.path);
    }
    if (typeof options.beforeArchiveCommit === "function") {
      await options.beforeArchiveCommit({
        imported: [...imported],
        stagingRoot,
        entries: plan.map((item) => ({ path: item.conflict.path, stagePath: item.stagePath })),
      });
    }
    for (let index = 0; index < plan.length; index += 1) {
      const item = plan[index];
      await ensureImportParent(os, os.fs.dirname(item.conflict.path));
      await replaceExistingPath(os, item.conflict.path, item.conflict, reporter);
      os.fs.move(item.stagePath, item.conflict.path);
      if (typeof options.afterArchiveCommitStep === "function") {
        await options.afterArchiveCommitStep({
          index,
          path: item.conflict.path,
          stagePath: item.stagePath,
          imported: [...imported],
        });
      }
    }
    if (os.fs.exists(stagingRoot)) os.fs.remove(stagingRoot, "/", { recursive: true });
    return imported;
  } catch (error) {
    os.fs.root = beforeRoot;
    throw error;
  }
}

async function allocateImportPath(os, directory, relativePath, options = {}) {
  const conflict = await planImportPath(os, directory, relativePath, options);
  if (!conflict) return null;
  await ensureImportParent(os, os.fs.dirname(conflict.path));
  await replaceExistingPath(os, conflict.path, conflict, options.reporter || null);
  return conflict.path;
}

async function planImportPath(os, directory, relativePath, options = {}) {
  const relative = sanitizeRelativePath(relativePath);
  const target = os.fs.normalize(relative, directory);
  const conflict = await resolveFilesConflict(os, target, options);
  return conflict.action === "skip" ? null : conflict;
}

async function ensureImportParent(os, directory) {
  const normalized = os.fs.normalize(directory);
  const parts = normalized.split("/").filter(Boolean);
  let cursor = "/";
  for (const part of parts) {
    cursor = os.fs.join(cursor, part);
    if (os.localMounts?.isMountedPath(cursor)) {
      if (!await os.localMounts.exists(cursor)) await os.localMounts.createDirectory(cursor, "/", { parents: true });
    } else if (!os.fs.exists(cursor)) {
      os.fs.createDirectory(cursor);
    }
  }
}

async function importPathExists(os, path) {
  if (os.localMounts?.isMountedPath(path)) return os.localMounts.exists(path);
  return os.fs.exists(path);
}

function actionTarget(currentPath, selectedPath) {
  if (!selectedPath || selectedPath === "/") throw new Error("Select an item first");
  return selectedPath;
}

export async function copyPathIntoDirectory(os, sourcePath, directoryPath, reporter = null, options = {}) {
  const normalizedSource = os.fs.normalize(sourcePath);
  const destination = os.fs.join(directoryPath, os.fs.basename(sourcePath));
  const conflict = await resolveFilesConflict(os, destination, options);
  if (conflict.action === "skip") return null;
  if (conflict.action === "replace" && normalizedSource === conflict.path) throw new Error("Cannot replace a file with itself");
  await replaceExistingPath(os, conflict.path, conflict, reporter);
  await copyPath(os, normalizedSource, conflict.path, reporter);
  return conflict.path;
}

export async function movePathIntoDirectory(os, sourcePath, directoryPath, reporter = null, options = {}) {
  const normalizedSource = os.fs.normalize(sourcePath);
  const normalizedDirectory = os.fs.normalize(directoryPath);
  if (normalizedSource === normalizedDirectory || normalizedDirectory.startsWith(`${normalizedSource}/`)) {
    throw new Error("Cannot move a folder into itself");
  }
  const destination = os.fs.join(normalizedDirectory, os.fs.basename(normalizedSource));
  const conflict = await resolveFilesConflict(os, destination, options);
  if (conflict.action === "skip") return null;
  if (conflict.action === "replace" && normalizedSource === conflict.path) throw new Error("Cannot replace a file with itself");
  await replaceExistingPath(os, conflict.path, conflict, reporter);
  await movePath(os, normalizedSource, conflict.path, reporter);
  return conflict.path;
}

async function copyPath(os, sourcePath, destinationPath, reporter = null) {
  assertFilesOperationActive(reporter?.signal);
  const sourceLocal = os.localMounts?.isMountedPath(sourcePath);
  const destinationLocal = os.localMounts?.isMountedPath(destinationPath);
  if (sourceLocal && destinationLocal) {
    await os.localMounts.copy(sourcePath, destinationPath, "/", {
      recursive: true,
      onProgress: (operation) => reporter?.progress(operation),
    });
    return;
  }
  if (!sourceLocal && !destinationLocal) {
    reporter?.start(countVirtualEntries(os, sourcePath), sourcePath);
    await copyVirtualToVirtual(os, sourcePath, destinationPath, reporter);
    reporter?.complete(destinationPath);
    return;
  }
  if (sourceLocal) {
    reporter?.start(await countLocalEntries(os, sourcePath), sourcePath);
    await copyLocalToVirtual(os, sourcePath, destinationPath, reporter);
    return;
  }
  reporter?.start(countVirtualEntries(os, sourcePath), sourcePath);
  await copyVirtualToLocal(os, sourcePath, destinationPath, reporter);
}

function maintainFilesTags(update, status) {
  try { update(); } catch (error) { if (status) status.warning = `File operation succeeded, but tags could not be updated: ${error.message}`; }
}

async function movePath(os, sourcePath, destinationPath, reporter = null, tagStatus = reporter) {
  assertFilesOperationActive(reporter?.signal);
  const sourceLocal = os.localMounts?.isMountedPath(sourcePath);
  const destinationLocal = os.localMounts?.isMountedPath(destinationPath);
  if (sourceLocal && destinationLocal) {
    await os.localMounts.move(sourcePath, destinationPath, "/", {
      recursive: true,
      onProgress: (operation) => reporter?.progress(operation),
    });
    maintainFilesTags(() => remapFilesTags(os, sourcePath, destinationPath), tagStatus);
    return;
  }
  if (!sourceLocal && !destinationLocal) {
    reporter?.start(countVirtualEntries(os, sourcePath), sourcePath);
    await copyVirtualToVirtual(os, sourcePath, destinationPath, reporter);
    os.fs.remove(sourcePath, "/", { recursive: true });
    reporter?.complete(destinationPath);
    maintainFilesTags(() => remapFilesTags(os, sourcePath, destinationPath), tagStatus);
    return;
  }
  await copyPath(os, sourcePath, destinationPath, reporter);
  await removePath(os, sourcePath, reporter, true);
  maintainFilesTags(() => remapFilesTags(os, sourcePath, destinationPath), tagStatus);
}

async function copyLocalToVirtual(os, sourcePath, destinationPath, reporter = null) {
  assertFilesOperationActive(reporter?.signal);
  const stat = await os.localMounts.stat(sourcePath);
  if (stat.type === "directory" || stat.type === "mount") {
    os.fs.createDirectory(destinationPath, "/", {
      owner: stat.owner || "guest",
      group: stat.group || "users",
      permissions: stat.permissions || "drwxr-xr-x",
    });
    reporter?.step(sourcePath);
    await scheduleFilesOperation(reporter, sourcePath);
    const entries = await os.localMounts.list(sourcePath);
    for (const entry of entries) {
      assertFilesOperationActive(reporter?.signal);
      await copyLocalToVirtual(os, entry.path, os.fs.join(destinationPath, entry.name), reporter);
    }
    return;
  }
  os.fs.writeOrCreateFileBytes(destinationPath, await os.localMounts.readFileBytes(sourcePath), "/", {
    mime: stat.mime || mimeFromName(destinationPath),
    owner: stat.owner || "guest",
    group: stat.group || "users",
    permissions: stat.permissions || "-rw-r--r--",
  });
  reporter?.step(sourcePath);
  await scheduleFilesOperation(reporter, sourcePath);
}

async function copyVirtualToLocal(os, sourcePath, destinationPath, reporter = null) {
  assertFilesOperationActive(reporter?.signal);
  const stat = os.fs.stat(sourcePath);
  if (!stat) throw new Error(`copy: ${sourcePath}: no such file or directory`);
  if (stat.type === "directory" || stat.type === "mount") {
    await os.localMounts.createDirectory(destinationPath, "/", { parents: true });
    reporter?.step(sourcePath);
    await scheduleFilesOperation(reporter, sourcePath);
    for (const entry of os.fs.list(sourcePath)) {
      assertFilesOperationActive(reporter?.signal);
      await copyVirtualToLocal(os, entry.path, os.fs.join(destinationPath, entry.name), reporter);
    }
    return;
  }
  await os.localMounts.writeFileBytes(destinationPath, os.fs.readFileBytes(sourcePath), "/", { mime: stat.mime || mimeFromName(destinationPath) });
  reporter?.step(sourcePath);
  await scheduleFilesOperation(reporter, sourcePath);
}

async function copyVirtualToVirtual(os, sourcePath, destinationPath, reporter = null) {
  assertFilesOperationActive(reporter?.signal);
  const stat = os.fs.stat(sourcePath);
  if (!stat) throw new Error(`copy: ${sourcePath}: no such file or directory`);
  if (stat.type === "directory" || stat.type === "mount") {
    if (!os.fs.exists(destinationPath)) {
      os.fs.createDirectory(destinationPath, "/", {
        owner: stat.owner || "guest",
        group: stat.group || "users",
        permissions: stat.permissions || "drwxr-xr-x",
      });
    }
    reporter?.step(sourcePath);
    await scheduleFilesOperation(reporter, sourcePath);
    for (const entry of os.fs.list(sourcePath)) {
      assertFilesOperationActive(reporter?.signal);
      await copyVirtualToVirtual(os, entry.path, os.fs.join(destinationPath, entry.name), reporter);
    }
    return;
  }
  os.fs.writeOrCreateFileBytes(destinationPath, os.fs.readFileBytes(sourcePath), "/", {
    mime: stat.mime || mimeFromName(destinationPath),
    owner: stat.owner || "guest",
    group: stat.group || "users",
    permissions: stat.permissions || "-rw-r--r--",
  });
  reporter?.step(sourcePath);
  await scheduleFilesOperation(reporter, sourcePath);
}

function countVirtualEntries(os, path) {
  const stat = os.fs.stat(path);
  if (!stat) return 0;
  if (stat.type !== "directory" && stat.type !== "mount") return 1;
  return 1 + os.fs.list(path).reduce((total, entry) => total + countVirtualEntries(os, entry.path), 0);
}

async function countLocalEntries(os, path) {
  const stat = await os.localMounts.stat(path);
  if (!stat || (stat.type !== "directory" && stat.type !== "mount")) return 1;
  const entries = await os.localMounts.list(path);
  let total = 1;
  for (const entry of entries) total += await countLocalEntries(os, entry.path);
  return total;
}

async function removePath(os, path, reporter = null, preserveTags = false) {
  assertFilesOperationActive(reporter?.signal);
  const ownsProgress = reporter && !reporter.started;
  if (ownsProgress) reporter.start(1, path);
  if (os.localMounts?.isMountedPath(path)) {
    await os.localMounts.remove(path, "/", { recursive: true });
    if (!preserveTags) maintainFilesTags(() => forgetFilesTags(os, path), reporter);
    if (ownsProgress) reporter.step(path);
    return;
  }
  os.fs.remove(path, "/", { recursive: true });
  if (!preserveTags) maintainFilesTags(() => forgetFilesTags(os, path), reporter);
  if (ownsProgress) reporter.step(path);
}

async function movePathToTrash(os, path, reporter = null) {
  const trashRoot = os.fs.join(os.session.home || "/home/guest", ".Trash");
  if (path === trashRoot || path.startsWith(`${trashRoot}/`)) throw new Error("Already in Trash");
  ensureVirtualDirectory(os, trashRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = await uniqueDestinationPath(os, trashRoot, `${stamp}-${os.fs.basename(path)}`);
  await movePath(os, path, destination, reporter);
  return destination;
}

export async function resolveFilesConflict(os, destinationPath, options = {}) {
  const path = os.fs.normalize(destinationPath);
  if (!await importPathExists(os, path)) return { action: "write", conflict: false, path };
  const requested = await filesConflictDecision({
    action: options.conflictPolicy || options.policy || "rename",
    name: os.fs.basename(path),
    path,
    resolveConflict: options.resolveConflict,
  });
  if (requested.action === "skip") return { action: "skip", conflict: true, path };
  if (requested.action === "replace") return { action: "replace", conflict: true, path };
  if (requested.action === "cancel") {
    const error = new Error("Files operation cancelled");
    error.name = "AbortError";
    throw error;
  }
  const renamedPath = requested.name
    ? os.fs.join(os.fs.dirname(path), sanitizeFileName(requested.name))
    : await uniqueDestinationPath(os, os.fs.dirname(path), os.fs.basename(path));
  if (await importPathExists(os, renamedPath)) return resolveFilesConflict(os, renamedPath, { ...options, conflictPolicy: "rename" });
  return { action: "rename", conflict: true, path: renamedPath };
}

async function filesConflictDecision(conflict) {
  const action = String(conflict.action || "rename").trim().toLowerCase();
  if (action === "prompt") {
    return normalizeFilesConflictDecision(await defaultFilesConflictDialog(conflict));
  }
  return normalizeFilesConflictDecision(action);
}

async function defaultFilesConflictDialog(conflict) {
  if (typeof conflict.resolveConflict === "function") return conflict.resolveConflict(conflict);
  if (typeof prompt !== "function") return "rename";
  return prompt(
    `${conflict.name} already exists at ${conflict.path}. Type replace, rename, or skip.`,
    "rename",
  );
}

function normalizeFilesConflictDecision(decision) {
  if (decision && typeof decision === "object") {
    return {
      action: normalizeFilesConflictAction(decision.action || decision.policy || "rename"),
      name: decision.name || "",
    };
  }
  const value = String(decision || "rename").trim();
  const [action, ...nameParts] = value.split(":");
  return {
    action: normalizeFilesConflictAction(action),
    name: nameParts.join(":").trim(),
  };
}

function normalizeFilesConflictAction(action) {
  const normalized = String(action || "rename").trim().toLowerCase();
  if (normalized === "overwrite") return "replace";
  if (["replace", "rename", "skip", "cancel"].includes(normalized)) return normalized;
  return "rename";
}

async function replaceExistingPath(os, path, conflict, reporter = null) {
  if (conflict.action !== "replace") return;
  if (!await importPathExists(os, path)) return;
  await removePath(os, path, reporter);
}

function ensureVirtualDirectory(os, path) {
  const parts = os.fs.normalize(path).split("/").filter(Boolean);
  let cursor = "/";
  parts.forEach((part) => {
    cursor = os.fs.join(cursor, part);
    if (!os.fs.exists(cursor)) os.fs.createDirectory(cursor);
  });
}

async function uniqueDestinationPath(os, directory, name) {
  let candidate = os.fs.join(directory, sanitizeFileName(name));
  if (!await importPathExists(os, candidate)) return candidate;
  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  for (let index = 2; index < 1000; index += 1) {
    candidate = os.fs.join(directory, `${sanitizeFileName(base)}-${index}${extension}`);
    if (!await importPathExists(os, candidate)) return candidate;
  }
  throw new Error(`Cannot allocate a filename in ${directory}`);
}

function duplicateName(name) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) return `${name} copy`;
  return `${name.slice(0, dotIndex)} copy${name.slice(dotIndex)}`;
}

function sanitizeFileName(name) {
  const cleaned = String(name || "").trim().replaceAll("/", "-");
  if (!cleaned || cleaned === "." || cleaned === "..") throw new Error("Invalid filename");
  return cleaned;
}

async function exportPath(os, path, reporter = null, options = {}) {
  assertFilesOperationActive(reporter?.signal);
  const normalized = os.fs.normalize(path);
  const node = os.fs.resolve(normalized) || os.fs.lstat(normalized);
  if (!node) throw new Error(`export: no such path: ${path}`);
  const exportTotal = node.type === "directory" || node.type === "mount"
    ? (os.localMounts?.isMountedPath(normalized) ? await countLocalEntries(os, normalized) : countVirtualEntries(os, normalized))
    : 1;
  reporter?.start(exportTotal, normalized);
  if (node.type === "directory" || node.type === "mount") {
    const entries = await collectExportEntries(os, normalized, reporter);
    const filename = resolveFilesExportName(`${os.fs.basename(normalized)}.dindbos-export.json`, options);
    if (!filename) throw new Error("Files operation cancelled");
    downloadBytes(filename, new TextEncoder().encode(JSON.stringify({
      kind: "dindbos-export-v1",
      exportedAt: new Date().toISOString(),
      root: normalized,
      entries,
    }, null, 2)), "application/json");
    return;
  }
  const stat = os.fs.stat(normalized);
  const bytes = os.localMounts?.isMountedPath(normalized)
    ? await os.localMounts.readFileBytes(normalized)
    : os.fs.readFileBytes(normalized);
  const filename = resolveFilesExportName(node.name || os.fs.basename(normalized), options);
  if (!filename) throw new Error("Files operation cancelled");
  downloadBytes(filename, bytes, stat?.mime || "application/octet-stream");
  reporter?.step(normalized);
}

export function resolveFilesExportName(defaultName, options = {}) {
  const fallback = sanitizeFileName(defaultName);
  if ((options.exportNamePolicy || options.conflictPolicy) !== "prompt") return fallback;
  if (typeof options.resolveExportName === "function") {
    const resolved = options.resolveExportName({ name: fallback });
    return resolved ? sanitizeFileName(resolved) : "";
  }
  if (typeof prompt !== "function") return fallback;
  const resolved = prompt("Export as", fallback);
  return resolved ? sanitizeFileName(resolved) : "";
}

export async function collectExportEntries(os, rootPath, reporter = null) {
  const root = os.fs.normalize(rootPath);
  const entries = [];
  const walk = async (path) => {
    assertFilesOperationActive(reporter?.signal);
    if (os.localMounts?.isMountedPath(path)) await os.localMounts.syncDirectory(path);
    const node = os.fs.resolve(path);
    if (!node || node.type === "mount") {
      reporter?.step(path);
      await scheduleFilesOperation(reporter, path);
      const localEntries = await os.localMounts.list(path);
      for (const entry of localEntries) {
        assertFilesOperationActive(reporter?.signal);
        await walk(entry.path);
      }
      return;
    }
    if (node.type === "directory") {
      reporter?.step(path);
      await scheduleFilesOperation(reporter, path);
      for (const entry of os.fs.list(path)) {
        assertFilesOperationActive(reporter?.signal);
        await walk(entry.path);
      }
      return;
    }
    if (node.type !== "file") return;
    const stat = os.fs.stat(path);
    const bytes = os.localMounts?.isMountedPath(path)
      ? await os.localMounts.readFileBytes(path)
      : os.fs.readFileBytes(path);
    entries.push({
      path: relativeArchivePath(root, path),
      name: node.name,
      mime: stat?.mime || node.mime || "application/octet-stream",
      permissions: stat?.permissions || node.permissions || "-rw-r--r--",
      owner: stat?.owner || node.owner || "guest",
      group: stat?.group || node.group || "users",
      data: bytesToBase64(bytes),
    });
    reporter?.step(path);
    await scheduleFilesOperation(reporter, path);
  };
  await walk(root);
  return entries;
}

function downloadBytes(filename, bytes, mime) {
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function relativeArchivePath(root, path) {
  const base = root.replace(/\/$/, "");
  return path === base ? "" : path.slice(base.length + 1);
}

function sanitizeRelativePath(path) {
  return String(path || "").split("/").filter((part) => part && part !== "." && part !== "..").join("/") || "file.bin";
}

function reserveImportStorage(os, bytes, details = {}) {
  if (typeof os.storage?.reserveStorageBytes !== "function") return;
  os.storage.reserveStorageBytes(bytes, details);
}

function archiveImportBytes(archive = {}) {
  return (archive.entries || []).reduce((total, entry) => total + base64DecodedLength(entry.data || ""), 0);
}

function base64DecodedLength(value = "") {
  const text = String(value || "").replace(/\s/g, "");
  if (!text) return 0;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
}

function fileByteLength(file = {}) {
  if (typeof file.size === "number") return Math.max(0, Number(file.size || 0));
  return 0;
}

function uniquePath(os, directory, name) {
  let candidate = os.fs.join(directory, name);
  if (!os.fs.exists(candidate)) return candidate;
  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  for (let index = 2; index < 100; index += 1) {
    candidate = os.fs.join(directory, `${base}-${index}${extension}`);
    if (!os.fs.exists(candidate)) return candidate;
  }
  throw new Error(`Cannot allocate a filename in ${directory}`);
}

function renderText(os, content, node, windowApi) {
  return renderDocumentEditor(os, content, node, windowApi, saveTextDocument);
}

export async function saveTextDocument(os, node, content, options = {}) {
  if (!node?.path) throw new Error("TextEdit save requires a file path");
  if (options.local || os.localMounts?.isMountedPath?.(node.path)) {
    await os.localMounts.writeFile(node.path, content);
    node.content = content;
    return node;
  }
  os.fs.atomicWriteFile(node.path, content, "/", options.atomic || {});
  node.content = os.fs.readFile(node.path);
  await syncAppStorage(os);
  return node;
}

async function syncAppStorage(os) {
  if (typeof os.storage?.sync === "function") return os.storage.sync();
  return os.storage?.flush?.();
}

function renderBrowser(os, content, context = {}, windowApi) {
  const providerUrl = browserProviderUrl(os, context);
  const client = new BrowserCompanionClient(providerUrl);
  let disposed = false;
  const restoredState = windowApi?.getState?.("browser");
  const state = createBrowserSessionState({ ...context, companionUrl: providerUrl }, restoredState);
  content.innerHTML = `
    <section class="browser-app">
      <form class="browser-toolbar" data-window-drag aria-label="Browser navigation">
        <div class="browser-navigation-controls">
          <button type="button" data-browser-action="back" aria-label="Back" title="Back">${browserChromeIcon("back")}</button>
          <button type="button" data-browser-action="forward" aria-label="Forward" title="Forward">${browserChromeIcon("forward")}</button>
        </div>
        <div class="browser-address-field">
          <span class="browser-address-symbol" aria-hidden="true">${browserChromeIcon("globe")}</span>
          <input name="address" aria-label="Address" placeholder="Enter a website or local file path" autocomplete="off" spellcheck="false" value="${escapeAttr(state.address)}" />
          <button type="button" data-browser-action="reload" aria-label="Reload" title="Reload">${browserChromeIcon("reload")}</button>
          <button class="browser-go" type="submit" aria-label="Go" title="Go">${browserChromeIcon("forward")}</button>
        </div>
        <details class="browser-connection">
          <summary data-no-drag aria-label="Connection settings" title="Connection settings">${browserChromeIcon("connection")}</summary>
          <div class="browser-connection-panel" role="group" aria-label="External browsing connection">
            <h3>External Browsing</h3>
            <p>Local HTML documents open directly. To visit websites, connect to your browser companion.</p>
            <p data-browser-error role="alert" hidden></p>
            <button type="button" data-browser-action="connect">Connect</button>
            <div class="browser-status"><span data-browser-status>${escapeHtml(state.status)}</span></div>
            <details class="browser-advanced"><summary>Advanced</summary>
              <code class="browser-provider-address">${escapeHtml(state.companionUrl)}</code>
              <div data-browser-diagnostics>${browserDiagnosticsMarkup(buildBrowserDiagnostics(state, { connected: client.connected }))}</div>
            </details>
          </div>
        </details>
      </form>
      <div class="browser-tabs" data-browser-tabs>${browserTabsMarkup(state)}</div>
      <div class="browser-viewport" tabindex="0" data-browser-viewport>
        <div class="browser-placeholder">
          <span class="browser-start-icon" aria-hidden="true">${browserChromeIcon("globe")}</span>
          <h2>Start Page</h2>
          <p>Open an HTML document from Files, or enter a website above.</p>
          <button type="button" data-browser-open-connection>Set Up External Browsing</button>
        </div>
        <img data-browser-frame alt="Remote browser frame" decoding="async" hidden />
        <iframe data-browser-local title="DindbOS HTML document" sandbox="${escapeAttr(BROWSER_LOCAL_HTML_SANDBOX)}" hidden></iframe>
      </div>
    </section>
  `;
  const refs = {
    tabs: content.querySelector("[data-browser-tabs]"),
    form: content.querySelector(".browser-toolbar"),
    address: content.querySelector("[name='address']"),
    status: content.querySelector("[data-browser-status]"),
    error: content.querySelector("[data-browser-error]"),
    diagnostics: content.querySelector("[data-browser-diagnostics]"),
    viewport: content.querySelector("[data-browser-viewport]"),
    frame: content.querySelector("[data-browser-frame]"),
    local: content.querySelector("[data-browser-local]"),
    placeholder: content.querySelector(".browser-placeholder"),
    connect: content.querySelector("[data-browser-action='connect']"),
    connection: content.querySelector(".browser-connection"),
  };
  let resizeTimer = null;
  let frameRaf = 0;
  let pendingFrameSrc = "";
  let wheelTimer = null;
  let wheelDeltaX = 0;
  let wheelDeltaY = 0;
  let wheelPoint = { x: 0, y: 0 };
  let remoteFrameObjectUrl = state.frame.startsWith("blob:") ? state.frame : "";
  const lastResize = { width: 0, height: 0, scale: 0, mobile: false };
  const persistState = () => { if (!disposed) windowApi?.setState?.("browser", browserSessionSnapshot(state)); };
  const renderTabs = () => {
    refs.tabs.innerHTML = browserTabsMarkup(state);
    refs.tabs.dataset.singleTab = String(state.tabs.length === 1);
    refs.tabs.querySelectorAll("[data-browser-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTabId = button.dataset.browserTab;
        syncBrowserStateFromActiveTab(state);
        restoreBrowserView();
        renderTabs();
        persistState();
      });
    });
    refs.tabs.querySelectorAll("[data-browser-close-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tabId = button.dataset.browserCloseTab;
        const closingActiveTab = state.activeTabId === tabId;
        closeBrowserTab(state, tabId);
        if (closingActiveTab) restoreBrowserView();
        renderTabs();
        persistState();
      });
    });
    const tab = activeBrowserTab(state);
    refs.form.querySelector('[data-browser-action="back"]').disabled = state.mode === "local" ? tab.historyIndex <= 0 : !client.connected;
    refs.form.querySelector('[data-browser-action="forward"]').disabled = state.mode === "local" ? tab.historyIndex >= tab.history.length - 1 : !client.connected;
    refs.form.querySelector('[data-browser-action="reload"]').disabled = !state.address;
    refs.tabs.querySelectorAll("[data-browser-tab-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.browserTabAction;
        if (action === "new") createBrowserNewTab(state);
        if (action === "close") closeBrowserTab(state);
        if (action === "reopen") reopenBrowserTab(state);
        syncBrowserStateFromActiveTab(state);
        restoreBrowserView();
        renderTabs();
        persistState();
      });
    });
  };
  const setStatus = (status) => {
    if (disposed) return;
    refs.error.hidden = true;
    const nextStatus = String(status || "");
    if (state.status === nextStatus) return;
    state.status = nextStatus;
    updateActiveBrowserTab(state, { status: nextStatus });
    refs.status.textContent = nextStatus;
    updateDiagnostics();
    persistState();
    os.processes.logSelf?.(`browser ${nextStatus}`);
  };
  const reportError = (error) => {
    if (disposed) return;
    const message = String(error?.message || error || "The page could not be opened.");
    setStatus(message);
    refs.error.textContent = isDindbPath(state.address)
      ? `Could not open this document. ${message}`
      : `Could not connect to external browsing. Check that your browser companion is running, then choose Connect. ${message}`;
    const localDocument = isDindbPath(state.address);
    if (localDocument) {
      refs.viewport.appendChild(refs.error);
      refs.placeholder.hidden = true;
      refs.local.hidden = true;
      refs.frame.hidden = true;
    } else {
      refs.connect.parentElement.insertBefore(refs.error, refs.connect);
    }
    refs.error.classList.toggle("browser-document-error", localDocument);
    refs.error.hidden = false;
    refs.connection.open = !localDocument;
  };
  const updateDiagnostics = () => {
    refs.diagnostics.innerHTML = browserDiagnosticsMarkup(buildBrowserDiagnostics(state, { connected: client.connected }));
  };
  const showFrame = (src) => {
    if (disposed) return;
    if (remoteFrameObjectUrl && remoteFrameObjectUrl !== src) URL.revokeObjectURL(remoteFrameObjectUrl);
    remoteFrameObjectUrl = src.startsWith("blob:") ? src : "";
    state.mode = "companion";
    state.frame = src;
    updateActiveBrowserTab(state, { mode: "companion", frame: src });
    refs.placeholder.hidden = true;
    refs.local.hidden = true;
    refs.frame.hidden = false;
    refs.frame.src = src;
    updateDiagnostics();
    persistState();
  };
  const queueFrame = (src) => {
    pendingFrameSrc = src;
    if (frameRaf) return;
    frameRaf = requestAnimationFrame(() => {
      frameRaf = 0;
      showFrame(pendingFrameSrc);
      pendingFrameSrc = "";
    });
  };
  const resizeRemote = () => {
    if (!client.connected) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const rect = refs.viewport.getBoundingClientRect();
      const { width, height, scale, mobile } = browserViewportMetrics(rect, globalThis.devicePixelRatio || 1, globalThis.navigator);
      const unchanged = Math.abs(width - lastResize.width) < 2
        && Math.abs(height - lastResize.height) < 2
        && Math.abs(scale - lastResize.scale) < 0.01
        && mobile === lastResize.mobile;
      if (unchanged) return;
      lastResize.width = width;
      lastResize.height = height;
      lastResize.scale = scale;
      lastResize.mobile = mobile;
      client.resize(width, height, scale, mobile).catch(reportError);
    }, 120);
  };
  client.on("status", (message) => {
    if (message.url) {
      state.address = message.url;
      updateActiveBrowserTab(state, { address: message.url });
      refs.address.value = message.url;
    }
    if (message.title) {
      state.title = message.title;
      updateActiveBrowserTab(state, { title: message.title });
      windowApi.setTitle(`${message.title} - Browser`);
      renderTabs();
    }
    if (message.reconnect) refs.connect.textContent = "Reconnect";
    else if (message.status === "connected") refs.connect.textContent = "Connect";
    const status = [message.status, message.url].filter(Boolean).join(" ");
    if (message.status === "disconnected") reportError(message.message || "The browser companion disconnected.");
    else setStatus(message.message || status || "browserd connected");
    persistState();
  });
  client.on("frame", (message) => {
    if (!isBrowserFrameSource(message.data)) {
      reportError("The browser companion returned an unreadable page frame.");
      return;
    }
    if (message.url) {
      state.address = message.url;
      updateActiveBrowserTab(state, { address: message.url });
      refs.address.value = message.url;
    }
    if (message.title) {
      state.title = message.title;
      updateActiveBrowserTab(state, { title: message.title });
      windowApi.setTitle(`${message.title} - Browser`);
      renderTabs();
    }
    setStatus(message.url ? `ready ${message.url}` : "ready");
    queueFrame(message.data);
  });
  client.on("error", reportError);
  refs.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await openAddress(refs.address.value);
    } catch (error) {
      reportError(error);
    }
  });
  content.querySelector("[data-browser-open-connection]").addEventListener("click", () => {
    refs.connection.open = true;
    refs.connect.focus();
  });
  content.addEventListener("click", (event) => {
    if (!refs.connection.contains(event.target) && !event.target.closest("[data-browser-open-connection]")) refs.connection.open = false;
  });
  refs.connection.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      refs.connection.open = false;
      refs.connection.querySelector("summary").focus();
    }
  });
  renderTabs();
  refs.form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      refs.viewport.focus();
    }
  });
  content.addEventListener("keydown", (event) => {
    const action = browserChromeShortcut(event);
    if (action === "focus-address") {
      event.preventDefault();
      refs.address.focus();
      refs.address.select();
    }
  });
  refs.form.querySelectorAll("[data-browser-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.browserAction;
      try {
        if (action === "connect") await connectCompanion();
        if (action === "back" || action === "forward") {
          if (state.mode === "local") {
            const tab = activeBrowserTab(state);
            const index = tab.historyIndex + (action === "back" ? -1 : 1);
            if (index >= 0 && index < tab.history.length) {
              tab.historyIndex = index;
              await openAddress(tab.history[index]);
            }
          } else if (action === "back") await client.back();
          else await client.forward();
        }
        if (action === "reload") {
          if (state.mode === "local") await openLocalPath(refs.address.value);
          else await client.reload();
        }
      } catch (error) {
        reportError(error);
      }
    });
  });
  refs.viewport.addEventListener("click", (event) => {
    if (!client.connected || refs.frame.hidden) return;
    const point = browserViewportPoint(refs.frame, event);
    client.click(point.x, point.y).catch(reportError);
    refs.viewport.focus();
  });
  refs.viewport.addEventListener("wheel", (event) => {
    if (!client.connected || refs.frame.hidden) return;
    event.preventDefault();
    wheelPoint = browserViewportPoint(refs.frame, event);
    wheelDeltaX += event.deltaX;
    wheelDeltaY += event.deltaY;
    if (wheelTimer) return;
    wheelTimer = setTimeout(() => {
      const deltaX = wheelDeltaX;
      const deltaY = wheelDeltaY;
      const point = wheelPoint;
      wheelDeltaX = 0;
      wheelDeltaY = 0;
      wheelTimer = null;
      client.scroll(deltaX, deltaY, point.x, point.y).catch(reportError);
    }, 33);
  }, { passive: false });
  refs.viewport.addEventListener("keydown", async (event) => {
    if (!client.connected || refs.frame.hidden) return;
    const chromeAction = browserChromeShortcut(event);
    if (chromeAction === "focus-address") {
      event.preventDefault();
      refs.address.focus();
      refs.address.select();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      try {
        const result = await pasteClipboardText(
          () => globalThis.navigator?.clipboard?.readText?.(),
          (text) => client.paste(text),
        );
        setStatus(result.pasted ? `pasted ${result.bytes} clipboard bytes` : "clipboard empty");
      } catch (error) {
        reportError(new Error(`Paste was blocked: ${error.message}`));
      }
      return;
    }
    const payload = browserKeyEventPayload(event);
    if (!payload) return;
    event.preventDefault();
    client.key(payload).catch(reportError);
  });
  const resizeObserver = new ResizeObserver(resizeRemote);
  resizeObserver.observe(refs.viewport);

  async function connectCompanion() {
    if (!client.connected) {
      setStatus("connecting browserd");
      await client.reconnect();
      refs.connect.textContent = "Connect";
      resizeRemote();
      updateDiagnostics();
    }
    return client;
  }

  async function openAddress(value) {
    const address = String(value || "").trim();
    if (!address) return;
    state.address = address;
    browserTabNavigate(state, address);
    refs.address.value = address;
    renderTabs();
    persistState();
    if (isDindbPath(address)) {
      await openLocalPath(address);
      return;
    }
    await connectCompanion();
    setStatus(`navigating ${address}`);
    await client.navigate(normalizeBrowserAddress(address));
  }

  async function openLocalPath(path) {
    const normalized = os.fs.normalize(path);
    const node = os.fs.resolve(normalized) || os.fs.lstat(normalized);
    if (!node) throw new Error(`Document not found: ${path}`);
    if (node.mime !== "text/html") throw new Error(`Browser can only open HTML files: ${path}`);
    const html = os.localMounts?.isMountedPath(normalized)
      ? await os.localMounts.readFile(normalized)
      : os.fs.readFile(normalized);
    refs.placeholder.hidden = true;
    refs.frame.hidden = true;
    refs.local.hidden = false;
    refs.local.srcdoc = html;
    if (remoteFrameObjectUrl) URL.revokeObjectURL(remoteFrameObjectUrl);
    remoteFrameObjectUrl = "";
    state.mode = "local";
    state.address = normalized;
    state.localHtml = html;
    state.title = node.name;
    browserTabNavigate(state, normalized, { mode: "local", localHtml: html, title: node.name, status: `local document ${normalized}` });
    refs.address.value = normalized;
    setStatus(`local document ${normalized}`);
    updateDiagnostics();
    windowApi.setTitle(`${node.name} - Browser`);
    renderTabs();
    persistState();
  }

  restoreBrowserView();

  if (restoredState?.address) {
    persistState();
  } else if (context.node?.path && context.node.mime === "text/html") {
    openLocalPath(context.node.path).catch(reportError);
  } else if (state.address) {
    openAddress(state.address).catch(reportError);
  }

  function restoreBrowserView() {
    if (disposed) return;
    syncBrowserStateFromActiveTab(state);
    refs.status.textContent = state.status;
    refs.address.value = state.address;
    updateDiagnostics();
    if (state.title && state.title !== "Browser") windowApi.setTitle(`${state.title} - Browser`);
    if (state.mode === "local" && state.localHtml) {
      refs.placeholder.hidden = true;
      refs.frame.hidden = true;
      refs.local.hidden = false;
      refs.local.srcdoc = state.localHtml;
      return;
    }
    if (state.mode === "companion" && state.frame) showFrame(state.frame);
    if (state.mode === "idle") {
      refs.placeholder.hidden = false;
      refs.frame.hidden = true;
      refs.local.hidden = true;
    }
  }
  return () => {
    disposed = true;
    resizeObserver.disconnect();
    clearTimeout(resizeTimer);
    clearTimeout(wheelTimer);
    if (frameRaf) cancelAnimationFrame(frameRaf);
    if (remoteFrameObjectUrl) URL.revokeObjectURL(remoteFrameObjectUrl);
    client.close();
  };
}

function browserTabsMarkup(state = {}) {
  const tabs = Array.isArray(state.tabs) && state.tabs.length ? state.tabs : [activeBrowserTab(state)];
  return `
    <div class="browser-tab-list" role="tablist" aria-label="Browser tabs">
      ${tabs.map((tab) => `
        <div class="browser-tab-item ${tab.id === state.activeTabId ? "is-active" : ""}">
          <button type="button" role="tab" data-browser-tab="${escapeAttr(tab.id)}" aria-selected="${tab.id === state.activeTabId ? "true" : "false"}" title="${escapeAttr(browserTabLabel(tab))}">
            <span class="browser-tab-symbol" aria-hidden="true">${browserChromeIcon(tab.mode === "local" ? "document" : "globe")}</span>
            <span>${escapeHtml(browserTabLabel(tab))}</span>
          </button>
          <button class="browser-tab-close" type="button" data-browser-close-tab="${escapeAttr(tab.id)}" aria-label="Close ${escapeAttr(browserTabLabel(tab))}" title="Close tab">${browserChromeIcon("close")}</button>
        </div>
      `).join("")}
    </div>
    <div class="browser-tab-actions">
      <button type="button" data-browser-tab-action="new" aria-label="New tab" title="New tab">${browserChromeIcon("plus")}</button>
      <button type="button" data-browser-tab-action="reopen" aria-label="Reopen closed tab" title="Reopen closed tab" ${state.closedTabs?.length ? "" : "disabled"}>${browserChromeIcon("reopen")}</button>
    </div>
  `;
}

function browserChromeIcon(name) {
  const paths = {
    back: '<path d="m14 5-7 7 7 7"/>',
    forward: '<path d="m10 5 7 7-7 7"/>',
    reload: '<path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c5 5 5 12 0 17-5-5-5-12 0-17Z"/>',
    document: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
    connection: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6v4m0-4a6 6 0 0 1-6-6"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    reopen: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6M12 8v5l3 2"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.globe}</svg>`;
}

function browserTabLabel(tab = {}) {
  return String(tab.title && tab.title !== "Browser" ? tab.title : tab.address || "New Tab").slice(0, 48);
}

function isBrowserFrameSource(value) {
  const src = String(value || "");
  return src.startsWith("data:image/") || src.startsWith("blob:");
}

function initialBrowserAddress(context = {}) {
  if (context.url) return context.url;
  if (context.node?.path) return context.node.path;
  return "";
}

function browserProviderUrl(os, context = {}) {
  const value = String(context.browserProviderUrl || context.companionUrl || os?.browserProvider?.url || "ws://127.0.0.1:8787/browser").trim();
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return "ws://127.0.0.1:8787/browser";
    if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/browser";
    return parsed.toString();
  } catch {
    return "ws://127.0.0.1:8787/browser";
  }
}

export function buildBrowserDiagnostics(state = {}, runtime = {}) {
  const synced = syncBrowserStateFromActiveTab({ ...state, tabs: [...(state.tabs || [])] });
  const providerUrl = browserProviderUrl(null, { companionUrl: synced.companionUrl });
  const mode = sanitizeBrowserMode(synced.mode) || "idle";
  const tabs = Array.isArray(synced.tabs) && synced.tabs.length ? synced.tabs : [activeBrowserTab(synced)];
  const connected = Boolean(runtime.connected);
  const providerKind = browserProviderKind(providerUrl);
  const diagnostics = {
    mode,
    provider: providerKind,
    providerUrl,
    healthUrl: browserProviderHealthUrl(providerUrl),
    connected,
    stream: `${BROWSERD_FRAME_TRANSPORT}/${BROWSERD_FRAME_ENCODING}`,
    tabs: tabs.length,
    activeTab: synced.activeTabId || activeBrowserTab(synced).id,
    address: synced.address || "",
    status: synced.status || "browserd not connected",
    advice: "",
  };
  diagnostics.advice = browserDiagnosticsAdvice(diagnostics);
  return diagnostics;
}

function browserProviderKind(providerUrl = "") {
  try {
    const hostname = new URL(providerUrl).hostname;
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname) ? "local browserd" : "remote provider";
  } catch {
    return "local browserd";
  }
}

function browserDiagnosticsAdvice(diagnostics = {}) {
  const status = String(diagnostics.status || "").toLowerCase();
  if (diagnostics.mode === "local") return "Local HTML is sandboxed; use Connect only for external URLs.";
  if (status.includes("stream mismatch") || status.includes("protocol mismatch") || status.includes("missing capabilities")) {
    return "Provider health metadata does not match the Browser.app protocol contract.";
  }
  if (diagnostics.connected) return "Remote browsing is active through the explicit Browser.app provider boundary.";
  if (diagnostics.provider === "remote provider") return "Remote provider selected; verify the WSS endpoint and provider trust boundary.";
  return "Start browserd or configure a browser provider before opening external URLs.";
}

export function browserDiagnosticsMarkup(diagnostics = {}) {
  return `
    <section class="browser-diagnostics" data-browser-diagnostics-panel>
      <dl>
        <div><dt>Provider</dt><dd>${escapeHtml(`${diagnostics.provider} · ${diagnostics.connected ? "connected" : "offline"}`)}</dd></div>
        <div><dt>Health</dt><dd>${escapeHtml(diagnostics.healthUrl || "")}</dd></div>
        <div><dt>Stream</dt><dd>${escapeHtml(diagnostics.stream || "")}</dd></div>
        <div><dt>Tabs</dt><dd>${escapeHtml(`${diagnostics.tabs || 0} tabs · ${diagnostics.mode || "idle"}`)}</dd></div>
      </dl>
      <p>${escapeHtml(diagnostics.advice || "")}</p>
    </section>
  `;
}

export function createBrowserSessionState(context = {}, restored = null) {
  const state = {
    mode: "idle",
    status: "browserd not connected",
    address: initialBrowserAddress(context),
    title: "Browser",
    frame: "",
    localHtml: "",
    companionUrl: browserProviderUrl(null, context),
    tabs: [],
    activeTabId: "",
    closedTabs: [],
  };
  if (!restored || typeof restored !== "object") {
    state.tabs = [createBrowserTabState({ ...state, id: "tab-1" })];
    state.activeTabId = state.tabs[0].id;
    return syncBrowserStateFromActiveTab(state);
  }
  const restoredTabs = Array.isArray(restored.tabs)
    ? restored.tabs.map((tab, index) => createBrowserTabState(tab, `tab-${index + 1}`)).filter(Boolean)
    : [];
  const next = {
    ...state,
    mode: sanitizeBrowserMode(restored.mode) || state.mode,
    status: String(restored.status || state.status),
    address: String(restored.address || state.address),
    title: String(restored.title || state.title),
    frame: String(restored.frame || ""),
    localHtml: String(restored.localHtml || ""),
    companionUrl: browserProviderUrl(null, { companionUrl: restored.companionUrl || state.companionUrl }),
    tabs: restoredTabs.length ? restoredTabs : [createBrowserTabState(restored, "tab-1")],
    activeTabId: String(restored.activeTabId || restoredTabs[0]?.id || "tab-1"),
    closedTabs: Array.isArray(restored.closedTabs)
      ? restored.closedTabs.slice(0, BROWSER_CLOSED_TAB_LIMIT).map((tab, index) => createBrowserTabState(tab, `closed-${index + 1}`))
      : [],
  };
  if (!next.tabs.some((tab) => tab.id === next.activeTabId)) next.activeTabId = next.tabs[0].id;
  return syncBrowserStateFromActiveTab(next);
}

export function browserSessionSnapshot(state = {}) {
  const synced = syncBrowserStateFromActiveTab({ ...state, tabs: [...(state.tabs || [])] });
  return {
    mode: sanitizeBrowserMode(synced.mode) || "idle",
    status: String(synced.status || ""),
    address: String(synced.address || ""),
    title: String(synced.title || "Browser"),
    frame: String(synced.frame || ""),
    localHtml: String(synced.localHtml || ""),
    companionUrl: browserProviderUrl(null, { companionUrl: synced.companionUrl }),
    activeTabId: String(synced.activeTabId || ""),
    tabs: (synced.tabs || []).map(browserTabSnapshot),
    closedTabs: (synced.closedTabs || []).slice(0, BROWSER_CLOSED_TAB_LIMIT).map(browserTabSnapshot),
  };
}

export function createBrowserTabState(input = {}, fallbackId = "tab-1") {
  const address = String(input.address || initialBrowserAddress(input) || "");
  const history = Array.isArray(input.history)
    ? input.history.map((entry) => String(entry || "")).filter(Boolean)
    : (address ? [address] : []);
  const historyIndex = Number.isInteger(input.historyIndex)
    ? Math.min(Math.max(input.historyIndex, 0), Math.max(history.length - 1, 0))
    : Math.max(history.length - 1, 0);
  return {
    id: sanitizeBrowserTabId(input.id || fallbackId),
    mode: sanitizeBrowserMode(input.mode) || "idle",
    status: String(input.status || "browserd not connected"),
    address,
    title: String(input.title || "Browser"),
    frame: isBrowserFrameSource(input.frame) ? String(input.frame) : "",
    localHtml: String(input.localHtml || ""),
    history,
    historyIndex,
  };
}

export function activeBrowserTab(state = {}) {
  const tabs = Array.isArray(state.tabs) && state.tabs.length ? state.tabs : [createBrowserTabState(state, "tab-1")];
  return tabs.find((tab) => tab.id === state.activeTabId) || tabs[0];
}

export function syncBrowserStateFromActiveTab(state = {}) {
  if (!Array.isArray(state.tabs) || !state.tabs.length) state.tabs = [createBrowserTabState(state, "tab-1")];
  if (!state.activeTabId || !state.tabs.some((tab) => tab.id === state.activeTabId)) state.activeTabId = state.tabs[0].id;
  const tab = activeBrowserTab(state);
  Object.assign(state, {
    mode: tab.mode,
    status: tab.status,
    address: tab.address,
    title: tab.title,
    frame: tab.frame,
    localHtml: tab.localHtml,
  });
  return state;
}

export function updateActiveBrowserTab(state = {}, changes = {}) {
  const tab = activeBrowserTab(state);
  Object.assign(tab, sanitizeBrowserTabChanges(changes));
  return syncBrowserStateFromActiveTab(state);
}

export function browserTabNavigate(state = {}, address = "", changes = {}) {
  const tab = activeBrowserTab(state);
  const nextAddress = String(address || "");
  if (nextAddress && tab.history[tab.historyIndex] !== nextAddress) {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(nextAddress);
    tab.historyIndex = tab.history.length - 1;
  }
  Object.assign(tab, sanitizeBrowserTabChanges({ ...changes, address: nextAddress || tab.address }));
  return syncBrowserStateFromActiveTab(state);
}

export function createBrowserNewTab(state = {}, input = {}) {
  if (!Array.isArray(state.tabs)) state.tabs = [];
  const tab = createBrowserTabState(input, nextBrowserTabId(state));
  state.tabs.push(tab);
  state.activeTabId = tab.id;
  return syncBrowserStateFromActiveTab(state);
}

export function closeBrowserTab(state = {}, tabId = state.activeTabId) {
  if (!Array.isArray(state.tabs) || !state.tabs.length) state.tabs = [createBrowserTabState({}, "tab-1")];
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return syncBrowserStateFromActiveTab(state);
  const [closed] = state.tabs.splice(index, 1);
  state.closedTabs = [closed, ...(state.closedTabs || [])].slice(0, BROWSER_CLOSED_TAB_LIMIT);
  if (!state.tabs.length) state.tabs.push(createBrowserTabState({}, nextBrowserTabId(state)));
  if (state.activeTabId === tabId || !state.tabs.some((tab) => tab.id === state.activeTabId)) {
    state.activeTabId = state.tabs[Math.min(index, state.tabs.length - 1)].id;
  }
  return syncBrowserStateFromActiveTab(state);
}

export function reopenBrowserTab(state = {}) {
  const [tab, ...rest] = state.closedTabs || [];
  if (!tab) return syncBrowserStateFromActiveTab(state);
  state.closedTabs = rest;
  if (!Array.isArray(state.tabs)) state.tabs = [];
  const reopened = createBrowserTabState(tab, nextBrowserTabId(state));
  if (state.tabs.some((candidate) => candidate.id === reopened.id)) reopened.id = nextBrowserTabId(state);
  state.tabs.push(reopened);
  state.activeTabId = reopened.id;
  return syncBrowserStateFromActiveTab(state);
}

function browserTabSnapshot(tab = {}) {
  return {
    id: sanitizeBrowserTabId(tab.id),
    mode: sanitizeBrowserMode(tab.mode) || "idle",
    status: String(tab.status || ""),
    address: String(tab.address || ""),
    title: String(tab.title || "Browser"),
    frame: isBrowserFrameSource(tab.frame) ? String(tab.frame) : "",
    localHtml: String(tab.localHtml || ""),
    history: Array.isArray(tab.history) ? tab.history.map((entry) => String(entry || "")).filter(Boolean) : [],
    historyIndex: Number.isInteger(tab.historyIndex) ? tab.historyIndex : 0,
  };
}

function sanitizeBrowserTabChanges(changes = {}) {
  const next = { ...changes };
  if ("mode" in next) next.mode = sanitizeBrowserMode(next.mode) || "idle";
  if ("frame" in next) next.frame = isBrowserFrameSource(next.frame) ? String(next.frame) : "";
  ["status", "address", "title", "localHtml"].forEach((key) => {
    if (key in next) next[key] = String(next[key] || "");
  });
  return next;
}

function nextBrowserTabId(state = {}) {
  const ids = [...(state.tabs || []), ...(state.closedTabs || [])]
    .map((tab) => Number(String(tab.id || "").match(/^tab-(\d+)$/)?.[1] || 0));
  return `tab-${Math.max(0, ...ids) + 1}`;
}

function sanitizeBrowserTabId(value = "") {
  const id = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return id || "tab-1";
}

function sanitizeBrowserMode(mode) {
  return ["idle", "local", "companion"].includes(mode) ? mode : "";
}

function isDindbPath(value) {
  return String(value || "").startsWith("/") || String(value || "").startsWith("~");
}

export function normalizeBrowserAddress(value) {
  const address = String(value || "").trim();
  if (!address) return "about:blank";
  if (/^https?:\/\//i.test(address)) return address;
  if (/^about:blank$/i.test(address)) return "about:blank";
  if (/^data:text\/html[,;]/i.test(address)) return address;
  if (isLocalhostAddress(address)) return `http://${address}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(address)) throw new Error(`Browser does not support this URL scheme: ${address.split(":")[0]}:`);
  if (address.includes(".")) return `https://${address}`;
  return `https://www.google.com/search?q=${encodeURIComponent(address)}`;
}

function isLocalhostAddress(address) {
  return address === "localhost"
    || address.startsWith("localhost:")
    || address.startsWith("127.0.0.1")
    || address.startsWith("[::1]");
}

function browserViewportPoint(element, event) {
  const rect = element.getBoundingClientRect();
  const naturalWidth = element.naturalWidth || rect.width;
  const naturalHeight = element.naturalHeight || rect.height;
  return {
    x: ((event.clientX - rect.left) / rect.width) * naturalWidth,
    y: ((event.clientY - rect.top) / rect.height) * naturalHeight,
  };
}

export function browserChromeShortcut(event) {
  const key = String(event?.key || "").toLowerCase();
  if ((event?.metaKey || event?.ctrlKey) && key === "l") return "focus-address";
  return "";
}

export function browserKeyEventPayload(event) {
  const key = String(event.key || "");
  if (!key || key === "Unidentified") return null;
  const modifiers = (event.altKey ? 1 : 0)
    | (event.ctrlKey ? 2 : 0)
    | (event.metaKey ? 4 : 0)
    | (event.shiftKey ? 8 : 0);
  return {
    key,
    code: event.code || undefined,
    modifiers,
    text: key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey ? key : undefined,
  };
}

export function browserViewportMetrics(rect = {}, deviceScaleFactor = 1, navigatorLike = {}) {
  const width = Math.max(320, Math.round(Number(rect.width || 0)));
  const height = Math.max(240, Math.round(Number(rect.height || 0)));
  const scale = Math.max(1, Number(deviceScaleFactor || 1));
  const touchPoints = Number(navigatorLike?.maxTouchPoints || 0);
  return {
    width,
    height,
    scale,
    mobile: width <= 720 || touchPoints > 0,
  };
}

function renderViewer(os, content, node) {
  if (!node) {
    const controller = new AbortController();
    const filesAvailable = os.apps.list().some((app) => app.id === "files");
    content.innerHTML = `<section class="viewer-app viewer-empty">${filesMiniIcon("document")}<h2>Open a document</h2><p>Choose a document or image from Files to view it here.</p>${filesAvailable ? '<button type="button" data-viewer-open-files>Browse Files</button>' : ""}<p role="alert" data-viewer-empty-error hidden></p></section>`;
    content.querySelector("[data-viewer-open-files]")?.addEventListener("click", () => {
      try { os.launch("files"); }
      catch (error) { const alert = content.querySelector("[data-viewer-empty-error]"); alert.textContent = error.message; alert.hidden = false; }
    }, { signal: controller.signal });
    return () => controller.abort();
  }
  let disposed = false;
  content.innerHTML = `
    <section class="viewer-app">
      <p class="dos-kicker">${escapeHtml(node?.mime || "document")}</p>
      <h2>${escapeHtml(node?.name || "Document")}</h2>
      <pre>Loading preview...</pre>
    </section>
  `;
  renderViewerBytes(os, content, node, () => disposed).catch((error) => {
    if (disposed) return;
    content.innerHTML = `
      <section class="viewer-app">
        <p class="dos-kicker">Preview error</p>
        <h2>${escapeHtml(node?.name || "Document")}</h2>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
  });
  return () => { disposed = true; cleanupViewerObjectUrl(content); };
}

const VIEWER_TEXT_PREVIEW_LIMIT = 256 * 1024;

async function renderViewerBytes(os, content, node, isDisposed = () => false) {
  const mime = node?.mime || "application/octet-stream";
  const bytes = node?.path ? await readViewerPreviewBytes(os, node, mime) : null;
  if (isDisposed()) return;
  cleanupViewerObjectUrl(content);
  const usesObjectUrl = bytes && (mime.startsWith("image/") || mime === "application/pdf");
  const url = usesObjectUrl ? URL.createObjectURL(new Blob([bytes], { type: mime })) : "";
  if (url && content.dataset) content.dataset.viewerObjectUrl = url;
  const previewState = bytes
    ? viewerPreviewForBytes(bytes, mime)
    : { preview: node?.content ? fileContentPreview(node.content) : "This document has no preview content.", status: "" };
  const status = mime === "application/pdf" ? viewerPdfAdapterStatus() : previewState.status;
  const diagnostics = buildViewerDiagnostics({
    node,
    mime,
    bytes,
    previewState,
    status,
    cacheStatus: os.cache?.status?.(),
  });
  content.innerHTML = viewerMarkup({
    mime,
    name: node?.name || "Document",
    path: node?.path || "",
    preview: previewState.preview,
    url,
    status,
    diagnostics,
  });
  wireViewerToolbar(os, content, node, bytes || new Uint8Array(), mime);
  if (mime === "application/pdf" && bytes?.byteLength) {
    wirePdfJsViewer(content, bytes, node?.name || "PDF").catch(() => {
      setViewerStatus(content, viewerPdfAdapterStatus(null, { failed: true }));
    });
  }
  const object = content.querySelector("[data-viewer-object]");
  if (object && url) {
    const release = () => {
      if (content.dataset?.viewerObjectUrl === url) delete content.dataset.viewerObjectUrl;
      URL.revokeObjectURL(url);
    };
    object.addEventListener("load", release, { once: true });
    object.addEventListener("error", release, { once: true });
  }
}

export function viewerMarkup({ mime, name, path = "", preview, url, status = "", diagnostics = null }) {
  const browserDisabled = mime === "text/html" && path ? "" : "disabled";
  const editDisabled = viewerEditTargetApp(mime, path) ? "" : "disabled";
  const statusText = status || (path ? path : "No file path");
  return `
    <section class="viewer-app">
      <header class="viewer-header" data-window-drag>
        <div>
          <h2>${escapeHtml(name || "Document")}</h2>
          <p class="viewer-status" data-viewer-status>${escapeHtml(statusText)}</p>
        </div>
        <div class="viewer-toolbar" role="toolbar" aria-label="Viewer controls">
          <button type="button" data-viewer-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" data-viewer-action="zoom-reset">100%</button>
          <button type="button" data-viewer-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
          <button type="button" data-viewer-action="page-prev" disabled>Prev</button>
          <button type="button" data-viewer-action="page-next" disabled>Next</button>
          <details class="viewer-actions"><summary data-no-drag aria-label="Document actions" title="Document actions">•••</summary><div role="group" aria-label="Document actions"><button type="button" data-viewer-action="open-browser" ${browserDisabled}>Open in Browser</button>
          <button type="button" data-viewer-action="open-editor" ${editDisabled}>Edit</button>
          <button type="button" data-viewer-action="export">Export</button>
          <button type="button" data-viewer-action="copy-path" ${path ? "" : "disabled"}>Copy path</button>${diagnostics ? `<details class="viewer-info"><summary>Document information</summary>${renderViewerDiagnostics(diagnostics)}</details>` : ""}</div></details>
        </div>
      </header>
      <div class="viewer-preview" data-viewer-preview style="--viewer-zoom: 1">
        ${mime.startsWith("image/") && url ? `<img data-viewer-object src="${escapeAttr(url)}" alt="${escapeAttr(name || "Image")}" />` : ""}
        ${mime === "application/pdf" && url ? `<canvas class="viewer-pdf-canvas" data-viewer-pdf-canvas hidden></canvas><iframe data-viewer-object src="${escapeAttr(url)}" title="${escapeAttr(name || "PDF")}"></iframe>` : ""}
        ${mime === "application/x-dindbos-deck" ? `<iframe class="viewer-deck" sandbox="" srcdoc="${escapeAttr(preview)}" title="${escapeAttr(name || "Deck")}"></iframe>` : ""}
        ${mime === "text/markdown" ? `<article class="viewer-markdown">${renderMarkdownPreview(preview)}</article>` : ""}
        ${!mime.startsWith("image/") && mime !== "application/pdf" && mime !== "application/x-dindbos-deck" && mime !== "text/markdown" ? `<pre>${escapeHtml(preview)}</pre>` : ""}
      </div>
    </section>
  `;
}

export function viewerEditTargetApp(mime = "", path = "") {
  if (!path) return "";
  return ["text/plain", "text/markdown", "application/json", "application/x-dindbos-command"].includes(String(mime || "")) ? "text" : "";
}

export function buildViewerDiagnostics({ node = null, mime = "application/octet-stream", bytes = null, previewState = {}, status = "", cacheStatus = null } = {}) {
  const byteLength = Number(bytes?.byteLength ?? node?.size ?? 0);
  const cacheable = isViewerPreviewCacheable(mime);
  const pdfAdapter = mime === "application/pdf"
    ? (status.includes("PDF.js adapter available") ? "pdfjs" : status.includes("adapter failed") ? "failed" : "native")
    : "n/a";
  const truncated = String(previewState?.status || "").includes("Large text preview");
  const binary = String(previewState?.status || "").includes("Binary preview");
  const advice = viewerDiagnosticsAdvice({ mime, cacheable, pdfAdapter, truncated, binary, byteLength });
  return {
    path: node?.path || "",
    mime,
    size: byteLength,
    cacheable,
    cacheWrites: Number(cacheStatus?.writes || 0),
    cacheHits: Number(cacheStatus?.hits || 0),
    pdfAdapter,
    truncated,
    binary,
    advice,
  };
}

function renderViewerDiagnostics(diagnostics) {
  return `
    <section class="viewer-diagnostics" data-viewer-diagnostics>
      <dl>
        <div><dt>File</dt><dd>${escapeHtml(`${diagnostics.mime} · ${formatBytes(diagnostics.size)}`)}</dd></div>
        <div><dt>Cache</dt><dd>${escapeHtml(`${diagnostics.cacheable ? "eligible" : "bypass"} · hits ${diagnostics.cacheHits} · writes ${diagnostics.cacheWrites}`)}</dd></div>
        <div><dt>PDF</dt><dd>${escapeHtml(diagnostics.pdfAdapter)}</dd></div>
      </dl>
      <p>${escapeHtml(diagnostics.advice)}</p>
    </section>
  `;
}

function viewerDiagnosticsAdvice({ mime, cacheable, pdfAdapter, truncated, binary, byteLength }) {
  if (pdfAdapter === "native") return "PDF.js adapter is not bundled; using native PDF preview fallback.";
  if (pdfAdapter === "failed") return "PDF.js adapter failed; native PDF preview remains available.";
  if (truncated) return "Large text is bounded in Viewer; export or open in TextEdit for full editing.";
  if (binary) return "No text renderer for this binary type; export or open with a package viewer.";
  if (!byteLength) return "Empty document; no preview bytes to inspect.";
  if (mime === "application/x-dindbos-deck") return "Deck preview is sandboxed and cannot mutate the source file.";
  if (cacheable) return "Preview bytes are cacheable and keyed by path, MIME, size, and modified time.";
  return "Preview bypasses cache for this MIME type.";
}

function wireViewerToolbar(os, content, node, bytes, mime) {
  let zoom = 1;
  const preview = content.querySelector("[data-viewer-preview]");
  const status = content.querySelector("[data-viewer-status]");
  const setStatus = (message) => {
    if (status) status.textContent = message;
  };
  const setZoom = (action) => {
    zoom = viewerZoomValue(zoom, action);
    preview?.style.setProperty("--viewer-zoom", String(zoom));
    setStatus(`Zoom ${Math.round(zoom * 100)}%`);
  };
  content.querySelectorAll("[data-viewer-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.viewerAction;
      if (action?.startsWith("zoom")) {
        setZoom(action);
        return;
      }
      if (action === "copy-path") {
        await copyText(node?.path || "");
        setStatus(`Copied ${node?.path || ""}`);
      }
      if (action === "open-browser" && node?.path && mime === "text/html") {
        os.launch?.("browser", { url: node.path });
        setStatus(`Opened ${node.path} in Browser.app`);
      }
      if (action === "open-editor" && node?.path) {
        const appId = viewerEditTargetApp(mime, node.path);
        if (appId) {
          os.launch?.(appId, { node });
          setStatus(`Opened ${node.path} in TextEdit`);
        }
      }
      if (action === "export") {
        exportViewerBytes(node?.name || "document", bytes, mime);
        setStatus(`Exported ${node?.name || "document"}`);
      }
    });
  });
}

export function viewerPdfAdapterStatus(pdfjsLib = globalThis.pdfjsLib, { failed = false } = {}) {
  if (failed) return "Native PDF preview · PDF.js adapter failed";
  if (pdfjsLib?.getDocument) return "PDF.js adapter available · canvas preview";
  return "Native PDF preview · PDF.js adapter is deployment-provided, not bundled";
}

function setViewerStatus(content, message) {
  const status = content.querySelector?.("[data-viewer-status]");
  if (status) status.textContent = message;
}

export async function wirePdfJsViewer(content, bytes, name = "PDF", pdfjsLib = globalThis.pdfjsLib) {
  if (!pdfjsLib?.getDocument || !bytes?.byteLength) return null;
  const canvas = content.querySelector?.("[data-viewer-pdf-canvas]");
  const nativeFrame = content.querySelector?.("[data-viewer-object]");
  const status = content.querySelector?.("[data-viewer-status]");
  const previous = content.querySelector?.("[data-viewer-action='page-prev']");
  const next = content.querySelector?.("[data-viewer-action='page-next']");
  if (!canvas?.getContext) return null;
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
  const documentProxy = await loadingTask.promise;
  const state = {
    page: 1,
    pageCount: Math.max(1, Number(documentProxy.numPages || 1)),
    rendering: false,
  };
  const setStatus = (message) => {
    if (status) status.textContent = message;
  };
  const render = async (pageNumber) => {
    if (state.rendering) return;
    state.rendering = true;
    try {
      state.page = clampPdfPage(pageNumber, state.pageCount);
      setStatus(`Rendering ${name} page ${state.page} of ${state.pageCount}`);
      const page = await documentProxy.getPage(state.page);
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      canvas.hidden = false;
      if (nativeFrame) nativeFrame.hidden = true;
      if (previous) previous.disabled = state.page <= 1;
      if (next) next.disabled = state.page >= state.pageCount;
      setStatus(`Page ${state.page} of ${state.pageCount} · PDF.js`);
    } finally {
      state.rendering = false;
    }
  };
  previous?.addEventListener?.("click", () => render(state.page - 1));
  next?.addEventListener?.("click", () => render(state.page + 1));
  if (previous) previous.disabled = true;
  if (next) next.disabled = state.pageCount <= 1;
  await render(1);
  return state;
}

function clampPdfPage(page, pageCount) {
  return Math.min(Math.max(1, Number(page || 1)), Math.max(1, Number(pageCount || 1)));
}

export function viewerZoomValue(current, action) {
  if (action === "zoom-reset") return 1;
  const delta = action === "zoom-in" ? 0.1 : action === "zoom-out" ? -0.1 : 0;
  return Math.min(3, Math.max(0.5, Math.round((Number(current || 1) + delta) * 10) / 10));
}

async function copyText(value) {
  if (!value) return;
  if (globalThis.navigator?.clipboard?.writeText) await globalThis.navigator.clipboard.writeText(value);
}

function exportViewerBytes(name, bytes, mime) {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return;
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name || "document";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function cleanupViewerObjectUrl(content) {
  const previous = content.dataset?.viewerObjectUrl;
  if (!previous) return;
  delete content.dataset.viewerObjectUrl;
  URL.revokeObjectURL(previous);
}

async function readNodeBytes(os, path) {
  if (os.localMounts?.isMountedPath(path)) return os.localMounts.readFileBytes(path);
  return os.fs.readFileBytes(path);
}

export async function readViewerPreviewBytes(os, node, mime = node?.mime || "application/octet-stream") {
  if (!node?.path) return null;
  const key = viewerPreviewCacheKey(node, mime);
  if (!isViewerPreviewCacheable(mime) || !os.cache?.readBytes || !os.cache?.rememberBytes) {
    return readNodeBytes(os, node.path);
  }
  const cached = await os.cache.readBytes(key);
  if (cached) return cached;
  return os.cache.rememberBytes(key, await readNodeBytes(os, node.path));
}

export function viewerPreviewCacheKey(node, mime = node?.mime || "application/octet-stream") {
  const params = new URLSearchParams({
    path: String(node?.path || ""),
    mime: String(mime || ""),
    size: String(node?.size || 0),
    modified: String(node?.modified || ""),
  });
  return `https://dindbos.cache/viewer-preview?${params.toString()}`;
}

function isViewerPreviewCacheable(mime = "") {
  return mime === "application/pdf"
    || mime === "application/x-dindbos-deck"
    || mime === "text/markdown"
    || mime === "text/plain"
    || mime.startsWith("image/");
}

export function viewerPreviewForBytes(bytes, mime) {
  const size = bytes?.byteLength || 0;
  if (!isTextMime(mime)) {
    return {
      preview: `Binary file · ${formatBytes(size)}`,
      status: size ? `Binary preview · ${formatBytes(size)}` : "Empty binary file",
    };
  }
  if (size > VIEWER_TEXT_PREVIEW_LIMIT) {
    const slice = bytes.slice(0, VIEWER_TEXT_PREVIEW_LIMIT);
    return {
      preview: `${new TextDecoder().decode(slice)}\n\n[Preview truncated at ${formatBytes(VIEWER_TEXT_PREVIEW_LIMIT)} of ${formatBytes(size)}]`,
      status: `Large text preview · showing ${formatBytes(VIEWER_TEXT_PREVIEW_LIMIT)} of ${formatBytes(size)}`,
    };
  }
  return {
    preview: new TextDecoder().decode(bytes),
    status: size ? `Text preview · ${formatBytes(size)}` : "Empty text file",
  };
}

function isTextMime(mime) {
  return mime.startsWith("text/") || ["application/json", "application/javascript", "application/x-dindbos-deck", "text/javascript"].includes(mime);
}

export function renderMarkdownPreview(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let inList = false;
  let inCode = false;
  let codeLines = [];
  const closeList = () => {
    if (!inList) return;
    html.push("</ul>");
    inList = false;
  };
  const closeCode = () => {
    if (!inCode) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
    inCode = false;
  };
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) closeCode();
      else {
        closeList();
        inCode = true;
        codeLines = [];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length + 2;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(listItem[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeCode();
  closeList();
  return html.join("");
}

function renderTerminal(os, content) {
  const pty = os.pty?.createSession?.({ name: "Terminal.app", columns: 80, rows: 24 });
  const shell = new ShellSession(os, { ptySessionId: pty?.id || "" });
  content.innerHTML = `
    <section class="terminal-app">
      <pre aria-live="polite" aria-label="Terminal output"></pre>
      <form>
        <span data-prompt>$</span>
        <input aria-label="Terminal command" autocomplete="off" spellcheck="false" autofocus />
      </form>
    </section>
  `;
  const output = content.querySelector("pre");
  const input = content.querySelector("input");
  const prompt = content.querySelector("[data-prompt]");
  const updatePrompt = () => {
    prompt.textContent = shell.prompt();
  };
  const print = (line = "") => {
    if (!line) return;
    output.textContent += `${String(line).replace(/\n+$/, "")}\n`;
    content.querySelector(".terminal-app").scrollTop = content.querySelector(".terminal-app").scrollHeight;
  };
  const run = async (commandLine) => {
    print(`${shell.prompt()} ${commandLine}`);
    input.disabled = true;
    try {
      const result = await shell.executeAsync(commandLine);
      if (result.clear) output.textContent = "";
      print(result.output);
    } catch (error) {
      print(error.message);
    } finally {
      input.disabled = false;
      input.focus();
    }
    updatePrompt();
  };
  print(os.fs.readFile("/etc/motd"));
  updatePrompt();
  content.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    run(input.value);
    input.value = "";
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      input.value = shell.previousHistory();
      event.preventDefault();
    }
    if (event.key === "ArrowDown") {
      input.value = shell.nextHistory();
      event.preventDefault();
    }
  });
  input.focus();
}

function renderActivityMonitor(os, content) {
  let selectedPid = os.processes.current()?.pid || null;
  let refreshTimer = null;
  let inspectorOpen = false;
  const view = {
    query: "",
    state: "all",
    sort: "pid",
    direction: "asc",
  };
  const draw = () => {
    if (!content.isConnected) {
      window.clearInterval(refreshTimer);
      return;
    }
    const focused = content.contains(document.activeElement) ? document.activeElement : null;
    const focusedSelector = focused?.matches("[data-activity-filter]") ? "[data-activity-filter]" : null;
    const selection = focusedSelector ? [focused.selectionStart, focused.selectionEnd] : null;
    const allProcesses = safeRead(() => os.processes.list(), []);
    const processes = filterAndSortActivityProcesses(allProcesses, view);
    if (!processes.some((process) => process.pid === selectedPid)) selectedPid = processes[0]?.pid || null;
    const selected = selectedPid ? processes.find((process) => process.pid === selectedPid) : null;
    const processLog = selected ? safeRead(() => os.processes.log(selected.pid), "") : "";
    const selectedServiceId = serviceIdForProcess(selected);
    const selectedService = selectedServiceId ? safeRead(() => os.services?.get?.(selectedServiceId), null) : null;
    const selectedServiceLog = selectedServiceId ? safeRead(() => os.services?.log?.(selectedServiceId), []) : [];
    const selectedServiceManifest = selectedServiceId ? safeRead(() => os.services?.manifest?.(selectedServiceId), null) : null;
    content.innerHTML = `
      <section class="activity-app">
        <div class="activity-controls">
          <button type="button" data-activity-inspect aria-label="Inspect selected process" aria-pressed="${inspectorOpen}" title="Inspect selected process" ${selected ? "" : "disabled"}><svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v6m0-10v1"/></svg></button>
          <div class="activity-metric-tabs" role="group" aria-label="Sort by runtime metric"><button type="button" data-activity-metric="activity" aria-pressed="${view.sort === "activity"}">Activity</button><button type="button" data-activity-metric="runtime" aria-pressed="${view.sort === "runtime"}">Memory</button></div>
          <input data-activity-filter autocomplete="off" spellcheck="false" placeholder="Filter app or state" value="${escapeAttr(view.query)}" />
          <select data-activity-state aria-label="State filter">
            ${activityStateOptions(allProcesses, view.state)}
          </select>
          <select data-activity-sort aria-label="Sort processes">
            ${activitySortOptions(view.sort)}
          </select>
          <button type="button" data-activity-direction="${escapeAttr(view.direction)}">${view.direction === "asc" ? "Asc" : "Desc"}</button>
        </div>
        <div class="activity-grid ${inspectorOpen ? "has-inspector" : ""}">
          <div class="activity-table" role="table" aria-label="Processes">
            <div class="activity-row activity-row-head" role="row">
              <span>PID</span>
              <span>App</span>
              <span>State</span>
              <span>Backend</span>
              <span>Isolation</span>
              <span>Uptime</span>
              <span>Activity</span>
              <span>Runtime</span>
            </div>
            ${processes.map((process) => `
              <button type="button" class="activity-row ${process.pid === selectedPid ? "is-selected" : ""}" data-pid="${process.pid}" role="row">
                <span>${process.pid}</span>
                <span>${escapeHtml(process.appId)}</span>
                <span>${escapeHtml(process.state)}</span>
                <span>${escapeHtml(process.executionBackend || "main-thread")}</span>
                <span>${escapeHtml(process.container?.isolation || process.container?.mode || "trusted")}</span>
                <span>${escapeHtml(formatDuration(process.uptimeMs))}</span>
                <span>${escapeHtml(formatActivityScore(process.activityScore))}</span>
                <span>${escapeHtml(formatBytes(process.runtimeBytes))}</span>
              </button>
            `).join("") || `<p class="activity-empty">${allProcesses.length ? "No matching processes." : "No running processes."}</p>`}
          </div>
          <aside class="activity-detail" ${inspectorOpen ? "" : "hidden"} aria-label="Process inspector">
            <button type="button" data-activity-close aria-label="Close process inspector">Done</button>
            ${selected ? renderActivityDetail(selected, processLog, selectedService, selectedServiceLog, selectedServiceManifest) : "<p>No process selected.</p>"}
          </aside>
        </div>
        <footer class="activity-bottom-summary" aria-label="Runtime summary">
          <dl><div><dt>Processes</dt><dd>${allProcesses.length}</dd></div><div><dt>Shown</dt><dd>${processes.length}</dd></div></dl>
          <dl><div><dt>Runtime memory</dt><dd>${formatBytes(allProcesses.reduce((total, process) => total + Number(process.runtimeBytes || 0), 0))}</dd></div><div><dt>Activity events</dt><dd>${formatActivityScore(allProcesses.reduce((total, process) => total + Number(process.activityScore || 0), 0))}</dd></div></dl>
          <p>Application runtime<br><span>Local session</span></p>
        </footer>
      </section>
    `;
    if (focusedSelector) {
      const replacement = content.querySelector(focusedSelector);
      replacement?.focus({ preventScroll: true });
      if (selection) replacement?.setSelectionRange(...selection);
    }
    content.querySelector("[data-activity-inspect]")?.addEventListener("click", () => { inspectorOpen = !inspectorOpen; draw(); });
    content.querySelector("[data-activity-close]")?.addEventListener("click", () => { inspectorOpen = false; draw(); content.querySelector("[data-activity-inspect]")?.focus(); });
    content.querySelectorAll("[data-activity-metric]").forEach((button) => button.addEventListener("click", () => { view.sort = button.dataset.activityMetric; view.direction = "desc"; draw(); }));
    content.querySelectorAll("[data-pid]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedPid = Number(button.dataset.pid);
        draw();
      });
    });
    content.querySelector("[data-activity-filter]")?.addEventListener("input", (event) => {
      view.query = event.target.value;
      draw();
    });
    content.querySelector("[data-activity-state]")?.addEventListener("change", (event) => {
      view.state = event.target.value;
      draw();
    });
    content.querySelector("[data-activity-sort]")?.addEventListener("change", (event) => {
      view.sort = event.target.value;
      draw();
    });
    content.querySelector("[data-activity-direction]")?.addEventListener("click", () => {
      view.direction = view.direction === "asc" ? "desc" : "asc";
      draw();
    });
    content.querySelectorAll("[data-process-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const pid = Number(button.dataset.pid);
        const process = safeRead(() => os.processes.get(pid), null);
        try {
          if (button.dataset.processAction === "open-proc") os.openPath(`/proc/${pid}`);
          if (button.dataset.processAction === "kill") os.processes.kill(pid);
          if (button.dataset.processAction === "restart" && process?.appId) os.processes.restart(pid);
        } finally {
          selectedPid = selectedPid === pid && button.dataset.processAction !== "open-proc"
            ? os.processes.current()?.pid || null
            : selectedPid;
          draw();
        }
      });
    });
    content.querySelectorAll("[data-service-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const serviceId = button.dataset.serviceId;
        try {
          if (button.dataset.serviceAction === "restart") await os.services.restart(serviceId);
          if (button.dataset.serviceAction === "disable") await os.services.disable(serviceId);
        } finally {
          selectedPid = os.processes.current()?.pid || null;
          draw();
        }
      });
    });
  };
  draw();
  refreshTimer = window.setInterval(draw, 1000);
  return () => window.clearInterval(refreshTimer);
}

export function filterAndSortActivityProcesses(processes = [], options = {}) {
  const query = String(options.query || "").trim().toLowerCase();
  const state = String(options.state || "all");
  const sort = String(options.sort || "pid");
  const direction = options.direction === "desc" ? -1 : 1;
  return [...processes]
    .filter((process) => {
      const stateMatch = state === "all" || process.state === state || process.windowState === state;
      const queryMatch = !query || [
        process.appId,
        process.name,
        process.state,
        process.windowState,
        process.executionBackend,
        process.executorState,
        process.executorKind,
        process.user,
        process.windowId,
        process.container?.mode,
        process.container?.isolation,
        process.container?.trust,
        process.container?.status,
        process.container?.health,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      return stateMatch && queryMatch;
    })
    .sort((left, right) => compareActivityProcess(left, right, sort) * direction || Number(left.pid || 0) - Number(right.pid || 0));
}

function compareActivityProcess(left, right, sort) {
  if (sort === "app") return String(left.appId || "").localeCompare(String(right.appId || ""));
  if (sort === "state") return String(left.state || "").localeCompare(String(right.state || ""));
  if (sort === "uptime") return Number(left.uptimeMs || 0) - Number(right.uptimeMs || 0);
  if (sort === "activity") return Number(left.activityScore || 0) - Number(right.activityScore || 0);
  if (sort === "runtime") return Number(left.runtimeBytes || 0) - Number(right.runtimeBytes || 0);
  return Number(left.pid || 0) - Number(right.pid || 0);
}

function activityStateOptions(processes, selected) {
  const states = ["all", ...new Set(processes.flatMap((process) => [process.state, process.windowState]).filter(Boolean))];
  return states.map((state) => `
    <option value="${escapeAttr(state)}" ${state === selected ? "selected" : ""}>${escapeHtml(state === "all" ? "All states" : state)}</option>
  `).join("");
}

function activitySortOptions(selected) {
  return [
    ["pid", "PID"],
    ["app", "App"],
    ["state", "State"],
    ["uptime", "Uptime"],
    ["activity", "Activity"],
    ["runtime", "Runtime"],
  ].map(([value, label]) => `
    <option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>
  `).join("");
}

export function renderActivityDetail(process, processLog, service = null, serviceLog = [], serviceManifest = null) {
  return `
    <div class="activity-detail-header">
      <div>
        <p class="dos-kicker">PID ${process.pid}</p>
        <h3>${escapeHtml(process.name)}</h3>
      </div>
      <div>
        <button type="button" data-process-action="open-proc" data-pid="${process.pid}">Open /proc</button>
        <button type="button" data-process-action="restart" data-pid="${process.pid}">Restart</button>
        <button type="button" data-process-action="kill" data-pid="${process.pid}">Kill</button>
      </div>
    </div>
    <dl>
      <div><dt>App</dt><dd>${escapeHtml(process.appId)}</dd></div>
      <div><dt>Parent</dt><dd>${process.parentPid ? `${process.parentPid} · ${escapeHtml(process.parentAppId || "-")}` : "-"}</dd></div>
      <div><dt>Children</dt><dd>${escapeHtml(process.childPids?.join(", ") || "-")}</dd></div>
      <div><dt>User</dt><dd>${escapeHtml(process.user)}</dd></div>
      <div><dt>State</dt><dd>${escapeHtml(process.state)} · ${escapeHtml(process.windowState || "-")}</dd></div>
      <div><dt>Executor</dt><dd>${escapeHtml(process.executionBackend || "main-thread")} · ${escapeHtml(process.executorState || "-")}</dd></div>
      <div><dt>Executor Detail</dt><dd>${escapeHtml(process.executorDetail || process.executorKind || "-")}</dd></div>
      <div><dt>Container</dt><dd>${renderContainerBadge(process)} ${escapeHtml(containerSummary(process.container))}</dd></div>
      <div><dt>Health</dt><dd>${escapeHtml(containerHealthSummary(process.container))}</dd></div>
      <div><dt>Window</dt><dd>${escapeHtml(process.windowId || "-")}</dd></div>
      <div><dt>Started</dt><dd>${escapeHtml(shortTime(process.startedAt))}</dd></div>
      <div><dt>Active</dt><dd>${escapeHtml(shortTime(process.lastActiveAt))}</dd></div>
      <div><dt>Uptime</dt><dd>${escapeHtml(formatDuration(process.uptimeMs))}</dd></div>
      <div><dt>Activity</dt><dd>${escapeHtml(formatActivityScore(process.activityScore))} · ${process.activitySamples || 0} samples</dd></div>
      <div><dt>Runtime</dt><dd>${escapeHtml(formatBytes(process.runtimeBytes))} · ${process.logLines || 0} logs</dd></div>
    </dl>
    ${service ? renderActivityServiceDetail(service, serviceLog, serviceManifest) : ""}
    <pre>${escapeHtml(processLog || "No process log yet.")}</pre>
  `;
}

function renderContainerBadge(process = {}) {
  const container = process.container || {};
  const label = containerBadgeLabel(container);
  const tone = containerBadgeTone(container);
  return `<span class="container-badge ${tone}" data-container-mode="${escapeAttr(container.mode || "unknown")}">${escapeHtml(label)}</span>`;
}

function containerBadgeLabel(container = {}) {
  if (container.health === "failed" || container.status === "crashed") return "Failed";
  if (container.mode === "sandboxed-iframe") return "Iframe";
  if (container.mode === "worker") return "Worker";
  if (container.trust === "trusted-system") return "Trusted";
  if (container.trust === "package-sandbox") return "Sandbox";
  return container.mode || "Unknown";
}

function containerBadgeTone(container = {}) {
  if (container.health === "failed" || container.status === "crashed") return "is-failed";
  if (container.mode === "sandboxed-iframe" || container.mode === "worker") return "is-isolated";
  if (container.trust === "trusted-system") return "is-trusted";
  return "is-shared";
}

function containerSummary(container = {}) {
  return [
    container.mode || "-",
    container.isolation || "",
    container.trust || "",
    container.syscallBridge || "",
  ].filter(Boolean).join(" · ");
}

function containerHealthSummary(container = {}) {
  return [
    container.status || "unreported",
    container.health || "",
    container.lastHeartbeatAt ? `heartbeat=${shortTime(container.lastHeartbeatAt)}` : "",
    container.lastError?.code ? `error=${container.lastError.code}` : "",
  ].filter(Boolean).join(" · ");
}

function renderActivityServiceDetail(service, serviceLog = [], serviceManifest = null) {
  return `
    <section class="activity-service-detail">
      <header>
        <div>
          <p class="dos-kicker">Service</p>
          <h4>${escapeHtml(service.name || service.id)}</h4>
        </div>
        <div>
          <button type="button" data-service-action="restart" data-service-id="${escapeAttr(service.id)}">Restart service</button>
          <button type="button" data-service-action="disable" data-service-id="${escapeAttr(service.id)}">Disable service</button>
        </div>
      </header>
      <dl>
        <div><dt>Service ID</dt><dd>${escapeHtml(service.id)}</dd></div>
        <div><dt>Service State</dt><dd>${escapeHtml(service.state || "unknown")}</dd></div>
        <div><dt>Runs</dt><dd>${Number(service.runCount || 0)}</dd></div>
        <div><dt>Last Run</dt><dd>${escapeHtml(shortTime(service.lastRunAt))}</dd></div>
        <div><dt>Last Error</dt><dd>${escapeHtml(service.lastError || "-")}</dd></div>
      </dl>
      ${renderActivityServicePermissionReview(serviceManifest)}
      <pre>${escapeHtml(formatServiceLog(serviceLog))}</pre>
    </section>
  `;
}

function renderActivityServicePermissionReview(manifest) {
  if (!manifest) return "";
  return `
    <section class="activity-service-permissions">
      <h5>Permission Review</h5>
      <dl>
        <div><dt>Capabilities</dt><dd>${escapeHtml(formatManifestList(manifest.capabilities))}</dd></div>
        <div><dt>FS Read</dt><dd>${escapeHtml(formatManifestList(manifest.fileSystem?.read))}</dd></div>
        <div><dt>FS Write</dt><dd>${escapeHtml(formatManifestList(manifest.fileSystem?.write))}</dd></div>
        <div><dt>Lifecycle Policy</dt><dd>${escapeHtml(manifest.lifecyclePolicy || "resumable")}</dd></div>
        <div><dt>Schedule</dt><dd>${escapeHtml(formatServiceSchedule(manifest.schedule))}</dd></div>
      </dl>
    </section>
  `;
}

function formatServiceLog(entries = []) {
  if (!entries.length) return "No service log yet.";
  return entries.map((entry) => `${entry.at || ""} ${String(entry.level || "info").toUpperCase()} ${entry.message || ""}`.trim()).join("\n");
}

function formatManifestList(values = []) {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  return list.length ? list.join(", ") : "-";
}

function formatServiceSchedule(schedule) {
  if (!schedule) return "-";
  if (schedule.everyMs) return `every ${Number(schedule.everyMs)}ms`;
  return JSON.stringify(schedule);
}

function serviceIdForProcess(process) {
  const appId = String(process?.appId || "");
  return appId.startsWith("service:") ? appId.slice("service:".length) : "";
}

function formatActivityScore(value) {
  const score = Number(value || 0);
  return `${score.toFixed(score % 1 ? 1 : 0)}/min`;
}

function renderCalculator(content) {
  const keys = [["backspace", "⌫"], ["clear", "AC"], ["percent", "%"], ["/", "÷"], ["7", "7"], ["8", "8"], ["9", "9"], ["*", "×"], ["4", "4"], ["5", "5"], ["6", "6"], ["-", "−"], ["1", "1"], ["2", "2"], ["3", "3"], ["+", "+"], ["sign", "⁺/₋"], ["0", "0"], [".", "."], ["=", "="]];
  content.innerHTML = `
    <section class="calculator-app" tabindex="0" aria-label="Calculator">
      <header class="calculator-toolbar" data-window-drag><button type="button" data-calculator-history aria-label="Calculation history" aria-expanded="false" title="History"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M5 8h2m-2 4h2m-2 4h2"/></svg></button><details class="calculator-mode"><summary aria-label="Calculator mode" title="Calculator mode"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M8 6h8M8 11h1m3 0h1m3 0h.1M8 15h1m3 0h1m3 0h.1M8 19h1m3 0h1m3 0h.1"/></svg></summary><div role="menu" aria-label="Calculator mode"><button type="button" role="menuitemradio" aria-checked="true" data-basic-calculator>✓ Basic</button></div></details></header>
      <div class="calculator-display"><span data-expression aria-hidden="true"></span><output aria-label="Result">0</output></div>
      <div class="calculator-keys">
        ${keys.map(([key, label]) => `<button type="button" data-key="${key}" ${key === "clear" ? "data-clear" : ""} class="${["/", "*", "-", "+", "="].includes(key) ? "is-operator" : ["clear", "backspace", "sign", "percent"].includes(key) ? "is-function" : ""}" aria-label="${({backspace: "Delete", clear: "Clear", sign: "Change sign", percent: "Percent", "/": "Divide", "*": "Multiply", "-": "Subtract", "+": "Add", "=": "Equals"})[key] || label}">${label}</button>`).join("")}
      </div>
      <aside class="calculator-history" aria-label="Calculation history" hidden><h2>History</h2><div data-calculator-history-list><p>No calculations yet.</p></div></aside>
    </section>`;
  let expression = "";
  let completed = false;
  const calculations = [];
  const output = content.querySelector("output");
  const history = content.querySelector("[data-expression]");
  const enter = (key) => {
    if (key === "clear") { expression = ""; history.textContent = ""; completed = false; }
    else if (key === "backspace") { expression = expression === "Error" ? "" : expression.slice(0, -1); completed = false; }
    else if (key === "=") {
      if (!expression || expression === "Error") return;
      history.textContent = expression.replaceAll("*", "×").replaceAll("/", "÷") + " =";
      const original = expression;
      expression = safeCalculate(expression);
      calculations.unshift({ expression: original, result: expression });
      calculations.splice(30);
      content.querySelector("[data-calculator-history-list]").innerHTML = calculations.map((item, index) => `<button type="button" data-calculator-result="${index}"><span>${escapeHtml(item.expression.replaceAll("*", "×").replaceAll("/", "÷"))}</span><strong>${escapeHtml(item.result)}</strong></button>`).join("");
      completed = true;
    } else if (key === "sign" || key === "percent") {
      const value = safeCalculate(expression || "0");
      expression = value === "Error" ? "Error" : safeCalculate(key === "sign" ? `-(${value})` : `(${value})/100`);
      completed = true;
    } else if (/[+*/-]/.test(key)) {
      if (expression === "Error") expression = "";
      if (!expression && key !== "-") expression = "0";
      expression = expression.replace(/[+*/-]$/, "") + key;
      completed = false;
    } else {
      if (completed || expression === "Error") { expression = ""; history.textContent = ""; }
      completed = false;
      const currentNumber = expression.split(/[+*/-]/).at(-1);
      if (key === "." && currentNumber.includes(".")) return;
      if (key === "." && !currentNumber) expression += "0";
      if (expression.length < 80) expression += key;
    }
    output.textContent = expression.replaceAll("*", "×").replaceAll("/", "÷") || "0";
    output.dataset.length = String(output.textContent.length);
  };
  content.querySelectorAll("[data-key]").forEach((button) => button.addEventListener("click", () => enter(button.dataset.key)));
  const root = content.querySelector(".calculator-app");
  const historyPanel = content.querySelector(".calculator-history");
  const historyToggle = content.querySelector("[data-calculator-history]");
  historyToggle.addEventListener("click", () => { historyPanel.hidden = !historyPanel.hidden; historyToggle.setAttribute("aria-expanded", String(!historyPanel.hidden)); });
  content.querySelector("[data-basic-calculator]").addEventListener("click", () => { content.querySelector(".calculator-mode").open = false; });
  historyPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-calculator-result]");
    if (!button) return;
    expression = calculations[Number(button.dataset.calculatorResult)].result;
    completed = true; output.textContent = expression; historyPanel.hidden = true; historyToggle.setAttribute("aria-expanded", "false");
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (!historyPanel.hidden || content.querySelector(".calculator-mode").open)) {
      event.preventDefault(); event.stopPropagation(); historyPanel.hidden = true; historyToggle.setAttribute("aria-expanded", "false"); content.querySelector(".calculator-mode").open = false; root.focus(); return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key === "Enter" || event.key === "=" ? "=" : event.key === "Escape" || event.key.toLowerCase() === "c" ? "clear" : event.key === "Backspace" ? "backspace" : event.key === "%" ? "percent" : event.key;
    if (/^[0-9.+*/-]$/.test(key) || ["=", "clear", "backspace", "percent"].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      enter(key);
    }
  });
  root.focus({ preventScroll: true });
}

function settingsIcon(name) {
  const paths = {
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    back: '<path d="m15 5-7 7 7 7"/>', forward: '<path d="m9 5 7 7-7 7"/>',
    appearance: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
    wallpaper: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
    desktop: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    general: '<circle cx="12" cy="12" r="8"/><path d="M12 7v6m0 3h.01"/>',
    storage: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 14h18m-5 2.5h1"/>',
    services: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    sync: '<path d="M19 9a7 7 0 0 0-12-4L4 8m0-5v5h5m-4 7a7 7 0 0 0 12 4l3-3m0 5v-5h-5"/>',
    security: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    browser: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5Z"/>',
    folders: '<path d="M3 6h7l2 2h9v11H3Z"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.general}</svg>`;
}

const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance", detail: "Light, dark, and accent colors", icon: "appearance" },
  { id: "wallpaper", label: "Wallpaper", detail: "Choose your desktop background", icon: "wallpaper" },
  { id: "desktop", label: "Desktop & Dock", detail: "Dock size and arrangement", icon: "desktop" },
  { id: "overview", label: "Advanced", detail: "Runtime and diagnostics", icon: "general" },
  { id: "storage", label: "Storage", detail: "Save engine and recovery", icon: "storage" },
  { id: "services", label: "Services", detail: "Runtime daemons", icon: "services" },
  { id: "sync", label: "Sync", detail: "Remote checkpoints", icon: "sync" },
  { id: "security", label: "Privacy & Security", detail: "Keychain and containers", icon: "security" },
  { id: "browser", label: "Browser", detail: "Broker permissions", icon: "browser" },
  { id: "folders", label: "Local Folders", detail: "Mounted directories", icon: "folders" },
];

const settingsCleanups = new WeakMap();

function renderSettings(os, content, appearance = null, requestedSection) {
  let initialSection = requestedSection || content.querySelector(".settings-app")?.dataset.settingsActive || "appearance";
  let navigate = null;
  const onNavigate = (event) => {
    if (typeof event.detail?.section !== "string") return;
    initialSection = event.detail.section;
    navigate?.(initialSection, { focus: true });
  };
  settingsCleanups.get(content)?.();
  let disposed = false;
  let unsubscribe = () => {};
  content.addEventListener("dindbos:settings-navigate", onNavigate);
  settingsCleanups.set(content, () => { disposed = true; unsubscribe(); content.removeEventListener("dindbos:settings-navigate", onNavigate); });
  content.innerHTML = `
    <section class="settings-app">
      <p class="settings-muted" role="status">Loading Settings…</p>
    </section>
  `;
  renderSettingsContent(os, content, appearance, () => disposed, () => initialSection).then((rendered) => {
    if (disposed) { rendered?.cleanup(); return; }
    navigate = rendered.select;
    const appearanceCleanup = appearance ? wireAppearanceControls(content, appearance) : () => {};
    unsubscribe = () => { appearanceCleanup(); rendered.cleanup(); };
  }).catch((error) => {
    if (disposed) return;
    content.innerHTML = `
      <section class="settings-app">
        <h2>Settings</h2>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
  });
  return () => { settingsCleanups.get(content)?.(); settingsCleanups.delete(content); };
}

async function renderSettingsContent(os, content, appearance, isDisposed = () => false, initialSection = "appearance") {
  const snapshot = await settingsRuntimeSnapshot(os);
  if (isDisposed()) return;
  const sectionPrefix = content.dataset.settingsPrefix ||= `settings-${Math.random().toString(36).slice(2, 9)}`;
  content.innerHTML = settingsRuntimeMarkup(snapshot, appearance?.get(), sectionPrefix);
  const settingsApp = content.querySelector(".settings-app");
  const sectionButtons = [...content.querySelectorAll("[data-settings-section-button]")];
  const sections = [...content.querySelectorAll("[data-settings-section]")];
  const history = [];
  let historyIndex = -1;
  const back = content.querySelector("[data-settings-back]");
  const forward = content.querySelector("[data-settings-forward]");
  const selectSettingsSection = (sectionId, { focus = false, record = true } = {}) => {
    const nextSection = sections.find((section) => section.dataset.settingsSection === sectionId) || sections[0];
    if (!nextSection) return;
    const nextId = nextSection.dataset.settingsSection;
    if (record && history[historyIndex] !== nextId) {
      history.splice(historyIndex + 1); history.push(nextId); historyIndex = history.length - 1;
    }
    back.disabled = historyIndex <= 0;
    forward.disabled = historyIndex >= history.length - 1;
    settingsApp.dataset.settingsActive = nextId;
    const definition = SETTINGS_SECTIONS.find((section) => section.id === nextId);
    const heading = content.querySelector(".settings-detail-header h2");
    const description = content.querySelector(".settings-detail-header p");
    if (heading) heading.textContent = definition?.label || "Settings";
    if (description) description.textContent = definition?.detail || "";
    sections.forEach((section) => {
      const active = section === nextSection;
      section.classList.toggle("is-active", active);
      section.hidden = !active;
    });
    sectionButtons.forEach((button) => {
      const active = button.dataset.settingsSectionButton === nextId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    if (focus) content.querySelector(".settings-detail-header h2")?.focus({ preventScroll: true });
    content.querySelector(".settings-detail").scrollTop = 0;
  };
  sectionButtons.forEach((button) => {
    button.addEventListener("click", () => selectSettingsSection(button.dataset.settingsSectionButton));
  });
  content.querySelector(".settings-nav")?.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const visible = sectionButtons.filter(button => !button.hidden);
    const current = visible.indexOf(event.target.closest("[data-settings-section-button]"));
    const index = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
    if (!visible[index]) return;
    selectSettingsSection(visible[index].dataset.settingsSectionButton);
    visible[index].focus();
  });
  back.addEventListener("click", () => { if (historyIndex > 0) selectSettingsSection(history[--historyIndex], { record: false }); });
  forward.addEventListener("click", () => { if (historyIndex < history.length - 1) selectSettingsSection(history[++historyIndex], { record: false }); });
  const search = content.querySelector("[data-settings-search]");
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    let matches = 0;
    for (const button of sectionButtons) {
      button.hidden = !button.textContent.toLocaleLowerCase().includes(query);
      if (!button.hidden) matches++;
    }
    content.querySelector("[data-settings-search-empty]").hidden = matches !== 0;
  });
  search.addEventListener("keydown", event => {
    if (event.key === "Escape") { search.value = ""; search.dispatchEvent(new Event("input")); event.stopPropagation(); }
    if (event.key === "Enter") sectionButtons.find(button => !button.hidden)?.click();
  });
  wireWallpaperPreviews(content);
  const iconCleanups = [...content.querySelectorAll("[data-settings-dock-icon]")].map(icon => mountAppIcon(icon, icon.dataset.settingsDockIcon));
  selectSettingsSection(typeof initialSection === "function" ? initialSection() : initialSection);
  content.querySelectorAll("[data-settings-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (button.dataset.settingsAction === "flush-storage") await os.storage.flush();
        if (button.dataset.settingsAction === "storage-fsck-dry-run") await os.runStorageFsck?.({ repair: true, dryRun: true });
        if (button.dataset.settingsAction === "storage-fsck-repair") await os.runStorageFsck?.({ repair: true, dryRun: false });
        if (button.dataset.settingsAction === "storage-fsck-salvage") await os.runStorageFsck?.({ repair: true, dryRun: true, salvage: true });
        if (button.dataset.settingsAction === "restore-mounts") await os.localMounts.restorePersistedMounts({ request: true });
        if (button.dataset.settingsAction === "remount") await os.localMounts.requestAccess(button.dataset.mountPath);
        if (button.dataset.settingsAction === "forget") await os.localMounts.forgetMount(button.dataset.mountPath);
        if (button.dataset.settingsAction === "service-restart") await os.services.restart(button.dataset.serviceId);
        if (button.dataset.settingsAction === "service-disable") await os.services.disable(button.dataset.serviceId);
        if (button.dataset.settingsAction === "sync-resolve") {
          await os.resolveRemoteSyncConflict(button.dataset.conflictPath, { action: button.dataset.syncAction });
        }
      } finally {
        renderSettings(os, content, appearance);
      }
    });
  });
  return { select: selectSettingsSection, cleanup: () => { for (const cleanup of iconCleanups.splice(0)) cleanup(); } };
}

export async function settingsRuntimeSnapshot(os) {
  const user = safeRead(() => os.session.user, "guest");
  const home = safeRead(() => os.session.home, "/home/guest");
  const processes = safeRead(() => os.processes.list(), []);
  const storageStatus = safeRead(() => os.storage.status(), { enabled: false, persisted: false, bytes: 0 });
  const storage = await safeReadAsync(() => os.storage.estimate(), storageStatus);
  const storageKernel = safeRead(() => os.storageKernelStatus?.("settings"), null);
  const packages = safeRead(() => os.packages.list(), []);
  const services = safeRead(() => os.services?.list?.(), []);
  const mounts = await safeReadAsync(() => os.localMounts.status(), []);
  const lifecycle = safeRead(() => os.lifecycleStatus?.(), null);
  const recovery = safeRead(() => os.recoveryStatus?.(), null);
  const coordination = safeRead(() => os.sessionCoordinationStatus?.(), safeRead(() => os.sessionStatus?.().coordination, null));
  const sync = safeRead(() => os.remoteSyncStatus?.(), null);
  const syncMerge = safeRead(() => os.remoteSyncMergePolicy?.(), null);
  const syncConflicts = safeRead(() => os.listRemoteSyncConflicts?.(), []);
  const keychain = safeRead(() => os.keychain?.settingsStatus?.({ appId: "settings", principal: os.permissions?.principal?.(os.session) }), null);
  const browser = safeRead(() => os.browserBrokerStatus?.(), null);
  const containerEvents = readPackageContainerSecurityEvents(os);
  return {
    user,
    home,
    apps: safeRead(() => os.apps.list(), []),
    packages,
    processes,
    services,
    storage: { ...storageStatus, ...storage },
    storageKernel,
    desktop: safeRead(() => os.fs.join(home, "Desktop"), `${home}/Desktop`),
    mounts,
    lifecycle,
    recovery,
    coordination,
    sync,
    syncMerge,
    syncConflicts,
    keychain,
    browser,
    containerEvents,
  };
}

export function settingsRuntimeMarkup(snapshot, appearance = {}, prefix = "settings") {
  return `
    <section class="settings-app" data-settings-active="appearance">
      <aside class="settings-sidebar" aria-label="Settings categories">
        <div class="settings-profile">
          <span class="settings-profile-avatar" aria-hidden="true">${escapeHtml((snapshot.user || "guest").slice(0, 1).toUpperCase())}</span>
          <div>
            <strong>${escapeHtml(snapshot.user || "guest")}</strong>
            <span>${escapeHtml(snapshot.home || "/home/guest")}</span>
          </div>
        </div>
        <label class="settings-search"><span aria-hidden="true">${settingsIcon("search")}</span><input type="search" data-settings-search placeholder="Search" aria-label="Search Settings" autocomplete="off"></label>
        <nav class="settings-nav" role="tablist" aria-orientation="vertical" aria-label="System settings">
          ${SETTINGS_SECTIONS.map((section) => `
            <button
              type="button"
              class="settings-nav-item${section.id === "appearance" ? " is-active" : ""}"
              role="tab"
              id="${escapeAttr(prefix)}-tab-${escapeAttr(section.id)}"
              tabindex="${section.id === "appearance" ? "0" : "-1"}"
              aria-controls="${escapeAttr(prefix)}-section-${escapeAttr(section.id)}"
              aria-selected="${section.id === "appearance"}"
              data-settings-section-button="${escapeAttr(section.id)}"
            >
              <span class="settings-nav-icon" data-settings-icon="${escapeAttr(section.icon)}" aria-hidden="true">${settingsIcon(section.icon)}</span>
              <span>
                <strong>${escapeHtml(section.label)}</strong>
                <small>${escapeHtml(section.detail)}</small>
              </span>
            </button>
          `).join("")}
        </nav>
        <p class="settings-search-empty" data-settings-search-empty hidden>No matching settings</p>
      </aside>
      <main class="settings-detail">
        <header class="settings-detail-header" data-window-drag>
          <div class="settings-history"><button type="button" data-settings-back aria-label="Back in Settings" disabled>${settingsIcon("back")}</button><button type="button" data-settings-forward aria-label="Forward in Settings" disabled>${settingsIcon("forward")}</button></div>
          <div><h2 tabindex="-1">System Settings</h2><p>Personalize your desktop and manage your environment.</p></div>
        </header>
        <section class="settings-section is-active" id="${escapeAttr(prefix)}-section-appearance" data-settings-section="appearance" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-appearance">
          ${appearanceMarkup(appearance, { wallpaper: false, dock: false })}
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-wallpaper" data-settings-section="wallpaper" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-wallpaper" hidden>
          ${wallpaperSettingsMarkup(appearance)}
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-desktop" data-settings-section="desktop" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-desktop" hidden>
          ${desktopSettingsMarkup(appearance)}
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-overview" data-settings-section="overview" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-overview" hidden>
          <section class="settings-panel settings-overview-panel">
            <header>
              <h3>Overview</h3>
            </header>
            <dl class="settings-summary-grid">
              <div><dt>User</dt><dd>${escapeHtml(snapshot.user || "guest")}</dd></div>
              <div><dt>Home</dt><dd>${escapeHtml(snapshot.home || "/home/guest")}</dd></div>
              <div><dt>Apps</dt><dd>${snapshot.apps.length}</dd></div>
              <div><dt>Packages</dt><dd>${snapshot.packages.length}</dd></div>
              <div><dt>Processes</dt><dd>${snapshot.processes.length}</dd></div>
              <div><dt>Services</dt><dd>${snapshot.services.length}</dd></div>
              <div><dt>Lifecycle</dt><dd>${escapeHtml(snapshot.lifecycle?.state || "unknown")}</dd></div>
              <div><dt>Session Role</dt><dd>${escapeHtml(snapshot.coordination?.role || "unknown")}</dd></div>
              <div><dt>Recovery</dt><dd>${escapeHtml(formatRecoverySummary(snapshot.recovery))}</dd></div>
              <div><dt>Sync</dt><dd>${escapeHtml(formatSyncSummary(snapshot.sync))}</dd></div>
              <div><dt>Storage</dt><dd>${renderSettingsStorageStatus(snapshot.storage)}</dd></div>
              <div><dt>Desktop</dt><dd>${escapeHtml(snapshot.desktop)}</dd></div>
              <div><dt>Local Mounts</dt><dd>${snapshot.mounts.length ? `${snapshot.mounts.length} folder${snapshot.mounts.length === 1 ? "" : "s"}` : "none"}</dd></div>
            </dl>
          </section>
          <section class="settings-panel">
            <header>
              <h3>Lifecycle</h3>
            </header>
            ${renderSettingsLifecycle(snapshot.lifecycle, snapshot.recovery)}
          </section>
          <section class="settings-panel">
            <header>
              <h3>Session Coordination</h3>
            </header>
            ${renderSettingsSessionCoordination(snapshot.coordination)}
          </section>
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-storage" data-settings-section="storage" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-storage" hidden>
          <section class="settings-panel">
            <header>
              <h3>Save Engine</h3>
              <button type="button" data-settings-action="flush-storage">Flush now</button>
            </header>
            <p>${escapeHtml(formatStorageState(snapshot.storage))}</p>
          </section>
          <section class="settings-panel">
            <header>
              <h3>Storage Recovery</h3>
              <button type="button" data-settings-action="storage-fsck-dry-run">Dry run</button>
              <button type="button" data-settings-action="storage-fsck-repair">Repair</button>
              <button type="button" data-settings-action="storage-fsck-salvage">Salvage</button>
            </header>
            ${renderSettingsStorageKernel(snapshot.storageKernel)}
          </section>
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-services" data-settings-section="services" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-services" hidden>
          <section class="settings-panel">
            <header>
              <h3>Services</h3>
            </header>
            ${renderSettingsServices(snapshot.services)}
          </section>
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-sync" data-settings-section="sync" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-sync" hidden>
          <section class="settings-panel">
            <header>
              <h3>Remote Sync</h3>
            </header>
            ${renderSettingsRemoteSync(snapshot.sync, snapshot.syncConflicts)}
          </section>
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-security" data-settings-section="security" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-security" hidden>
          <section class="settings-panel">
            <header>
              <h3>Keychain</h3>
            </header>
            ${renderSettingsKeychain(snapshot.keychain)}
          </section>
          <section class="settings-panel">
            <header>
              <h3>Container Security</h3>
            </header>
            ${renderSettingsContainerSecurity(snapshot.containerEvents)}
          </section>
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-browser" data-settings-section="browser" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-browser" hidden>
          <section class="settings-panel">
            <header>
              <h3>Browser Permissions</h3>
            </header>
            ${renderSettingsBrowserPermissions(snapshot.browser)}
          </section>
        </section>
        <section class="settings-section" id="${escapeAttr(prefix)}-section-folders" data-settings-section="folders" role="tabpanel" aria-labelledby="${escapeAttr(prefix)}-tab-folders" hidden>
          <section class="settings-panel">
            <header>
              <h3>Local Folders</h3>
              <button type="button" data-settings-action="restore-mounts">Restore saved mounts</button>
            </header>
            ${renderSettingsMounts(snapshot.mounts)}
          </section>
        </section>
      </main>
    </section>
  `;
}

function formatSettingsHeadline(snapshot) {
  const parts = [
    `${Number(snapshot.apps?.length || 0)} apps`,
    `${Number(snapshot.processes?.length || 0)} processes`,
    `${snapshot.storage?.backend || "memory"} storage`,
    `${snapshot.coordination?.role || "single"} session`,
  ];
  return parts.join(" · ");
}

function renderSettingsBrowserPermissions(browser) {
  if (!browser) return `<p class="settings-muted">Browser broker diagnostics are unavailable.</p>`;
  const capabilities = browser.capabilities || [];
  const ledger = browser.ledgerEntries || [];
  const available = capabilities.filter((entry) => entry.available).length;
  return `
    <dl>
      <div><dt>Capabilities</dt><dd>${available}/${capabilities.length} available</dd></div>
      <div><dt>Ledger</dt><dd>${ledger.length}</dd></div>
      <div><dt>Revoked</dt><dd>${(browser.revokedGrants || []).length}</dd></div>
    </dl>
    <div class="settings-mount-list">
      ${capabilities.map((entry) => `
        <article class="settings-mount-card" data-browser-capability="${escapeAttr(entry.id)}">
          <div>
            <strong>${escapeHtml(entry.id)}</strong>
            <span>${escapeHtml(entry.broker)} · ${escapeHtml(entry.device)}</span>
            <small>${entry.available ? "available" : "unavailable"} · access=${Number(entry.accessCount || 0)} · revoked=${Number(entry.revoked || 0)}</small>
          </div>
        </article>
      `).join("")}
    </div>
    ${renderSettingsPrivacyLedger(ledger)}
  `;
}

function renderSettingsPrivacyLedger(entries = []) {
  if (!entries.length) return `<p class="settings-muted">No browser privacy ledger entries recorded.</p>`;
  return `
    <div class="settings-mount-list">
      ${entries.slice(0, 8).map((entry) => `
        <article class="settings-mount-card" data-privacy-ledger="${escapeAttr(entry.capability)}">
          <div>
            <strong>${escapeHtml(entry.capability)}</strong>
            <span>${escapeHtml(entry.operation)} · ${escapeHtml(entry.result || "ok")} · pid=${Number(entry.pid || 0)}</span>
            <small>${escapeHtml(entry.broker)} · ${escapeHtml(entry.device)} · ${escapeHtml(entry.at || "")}</small>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSettingsContainerSecurity(events = []) {
  if (!events.length) return `<p class="settings-muted">No package container security events recorded.</p>`;
  return `
    <div class="settings-mount-list">
      ${events.slice(-8).reverse().map((event) => `
        <article class="settings-mount-card" data-container-event="${escapeAttr(event.type || "event")}" data-container-status="${escapeAttr(event.status || "")}">
          <div>
            <strong>${escapeHtml(event.type || "container")}${event.syscall ? ` · ${escapeHtml(event.syscall)}` : ""}</strong>
            <span>pid=${Number(event.pid || 0)} · app=${escapeHtml(event.appId || "-")} · package=${escapeHtml(event.packageId || "-")} · ${escapeHtml(event.status || "unknown")}</span>
            <small>${escapeHtml(shortTime(event.at))}${event.code ? ` · ${escapeHtml(event.code)}` : ""}${event.message ? ` · ${escapeHtml(event.message)}` : ""}</small>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function readPackageContainerSecurityEvents(os) {
  const path = "/var/log/dindbos/package-container.log";
  if (!safeRead(() => os.fs?.exists?.(path), false)) return [];
  return safeRead(() => os.fs.readFile(path), "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeRead(() => JSON.parse(line), null))
    .filter(Boolean);
}

function renderSettingsKeychain(keychain) {
  if (!keychain) return `<p class="settings-muted">Keychain service is unavailable.</p>`;
  return `
    <dl>
      <div><dt>Vault</dt><dd>${keychain.locked ? "locked" : "unlocked"} · records=${Number(keychain.records || 0)}</dd></div>
      <div><dt>Active Grants</dt><dd>${Number(keychain.activeGrants?.length || 0)}</dd></div>
      <div><dt>Denied Requests</dt><dd>${Number(keychain.deniedRequests?.length || 0)}</dd></div>
      <div><dt>Stale Credentials</dt><dd>${Number(keychain.staleCredentials?.length || 0)}</dd></div>
      <div><dt>Export Warning</dt><dd>${escapeHtml((keychain.exportWarnings || [])[0] || "none")}</dd></div>
      <div><dt>Recovery Warning</dt><dd>${escapeHtml((keychain.recoveryWarnings || [])[0] || "none")}</dd></div>
    </dl>
    ${renderSettingsKeychainGrants(keychain.activeGrants || [])}
    ${renderSettingsKeychainDenied(keychain.deniedRequests || [])}
  `;
}

function renderSettingsKeychainGrants(grants = []) {
  if (!grants.length) return `<p class="settings-muted">No active keychain grants.</p>`;
  return `
    <div class="settings-mount-list">
      ${grants.map((grant) => `
        <article class="settings-mount-card" data-keychain-grant="${escapeAttr(grant.name)}">
          <div>
            <strong>${escapeHtml(grant.name)}</strong>
            <small>${escapeHtml(grant.kind || "generic")} · app=${escapeHtml(grant.appId || "-")} · expires=${escapeHtml(shortTime(grant.expiresAt))}</small>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSettingsKeychainDenied(requests = []) {
  if (!requests.length) return `<p class="settings-muted">No denied keychain requests.</p>`;
  return `
    <div class="settings-mount-list">
      ${requests.slice(-5).map((entry) => `
        <article class="settings-mount-card" data-keychain-denied="${escapeAttr(entry.name)}">
          <div>
            <strong>${escapeHtml(entry.name || "-")}</strong>
            <small>${escapeHtml(entry.action || "request")} · requester=${escapeHtml(entry.requester || "-")} · ${escapeHtml(shortTime(entry.at))}</small>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSettingsRemoteSync(sync, conflicts = []) {
  const snapshot = sync?.lastSuccessfulSnapshot;
  const applied = sync?.lastAppliedSnapshot;
  const repair = sync?.lastRepair;
  const applyRun = sync?.lastApplyRun;
  const retry = sync?.lastRetry;
  const refusedRecords = Array.isArray(applied?.refusedRecords) ? applied.refusedRecords : [];
  return `
    <dl>
      <div><dt>Backend</dt><dd>${escapeHtml(sync?.backend || "unavailable")}</dd></div>
      <div><dt>Encrypted</dt><dd>${Boolean(sync?.encrypted)}</dd></div>
      <div><dt>Last Snapshot</dt><dd>${snapshot ? `${escapeHtml(shortTime(snapshot.createdAt))} · files=${Number(snapshot.fileCount || 0)} · cache=${Number(snapshot.cacheRecords || 0)} · settings=${Number(snapshot.settingsRecords || 0)}` : "none"}</dd></div>
      <div><dt>Last Applied</dt><dd>${applied ? `${escapeHtml(shortTime(applied.appliedAt))} · conflicts=${Number(applied.conflicts || 0)} · refused=${Number(applied.refused || 0)}` : "none"}</dd></div>
      <div><dt>Refused Records</dt><dd>${refusedRecords.length}</dd></div>
      <div><dt>Apply Run</dt><dd>${applyRun ? `${escapeHtml(applyRun.status || "unknown")} · next=${Number(applyRun.nextIndex || 0)}/${Number(applyRun.totalFiles || 0)}` : "none"}</dd></div>
      <div><dt>Last Retry</dt><dd>${retry ? `${escapeHtml(shortTime(retry.retriedAt))} · applied=${Number(retry.applied || 0)} · refused=${Number(retry.refused || 0)}` : "none"}</dd></div>
      <div><dt>Last Repair</dt><dd>${repair ? `${escapeHtml(shortTime(repair.resolvedAt))} · remaining=${Number(repair.remainingConflicts || 0)}` : "none"}</dd></div>
      <div><dt>Merge Rules</dt><dd>${Number(sync?.mergeRuleCount || 0)}</dd></div>
      <div><dt>Last Error</dt><dd>${escapeHtml(sync?.lastError || "-")}</dd></div>
    </dl>
    ${renderSettingsSyncConflicts(conflicts)}
  `;
}

function renderSettingsSyncConflicts(conflicts = []) {
  if (!conflicts.length) return `<p class="settings-muted">No remote sync conflicts are pending.</p>`;
  return `
    <div class="settings-mount-list">
      ${conflicts.map((conflict) => `
        <article class="settings-mount-card" data-sync-conflict="${escapeAttr(conflict.path)}">
          <div>
            <strong>${escapeHtml(conflict.targetPath || conflict.path)}</strong>
            <small>${escapeHtml(conflict.path)} · bytes=${Number(conflict.bytes || 0)}</small>
          </div>
          <div>
            <button type="button" data-settings-action="sync-resolve" data-sync-action="use-conflict" data-conflict-path="${escapeAttr(conflict.path)}">Use remote</button>
            <button type="button" data-settings-action="sync-resolve" data-sync-action="keep-local" data-conflict-path="${escapeAttr(conflict.path)}">Keep local</button>
            <button type="button" data-settings-action="sync-resolve" data-sync-action="delete-conflict" data-conflict-path="${escapeAttr(conflict.path)}">Delete copy</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSettingsSessionCoordination(coordination) {
  return `
    <dl>
      <div><dt>Instance</dt><dd>${escapeHtml(coordination?.instanceId || "-")}</dd></div>
      <div><dt>Role</dt><dd>${escapeHtml(coordination?.role || "unknown")}</dd></div>
      <div><dt>Lock Owner</dt><dd>${escapeHtml(coordination?.lockOwner || "-")}</dd></div>
      <div><dt>Readonly</dt><dd>${Boolean(coordination?.readonly)}</dd></div>
      <div><dt>Stale Recovery</dt><dd>${Boolean(coordination?.staleRecovered)}</dd></div>
      <div><dt>Channel</dt><dd>${coordination?.channel?.connected ? `connected · received=${Number(coordination.channel.received || 0)}` : "unavailable"}</dd></div>
      <div><dt>Conflicts</dt><dd>${Number(coordination?.conflicts?.pending || 0)} pending · total=${Number(coordination?.conflicts?.total || 0)}</dd></div>
      <div><dt>Peer Flush</dt><dd>${coordination?.storageFlush?.lastPeerSource ? `${escapeHtml(coordination.storageFlush.lastPeerSource)} · ${escapeHtml(coordination.storageFlush.lastPeerPhase || "unknown")}` : "none"}</dd></div>
      <div><dt>Peer App State</dt><dd>${coordination?.appState?.lastPeerAppId ? `${escapeHtml(coordination.appState.lastPeerAppId)} · ${escapeHtml(coordination.appState.lastPeerAction || "change")}` : "none"}</dd></div>
      <div><dt>Peer Package</dt><dd>${coordination?.packageOperation?.lastPeerPackageId ? `${escapeHtml(coordination.packageOperation.lastPeerPackageId)} · ${escapeHtml(coordination.packageOperation.lastPeerOperation || "package")} · ${escapeHtml(coordination.packageOperation.lastPeerPhase || "unknown")}` : "none"}</dd></div>
      <div><dt>Session Handoff</dt><dd>${formatSessionHandoff(coordination?.handoff)}</dd></div>
      <div><dt>Handoff Relay</dt><dd>${formatSessionHandoffRelay(coordination?.handoff?.relay)}</dd></div>
      <div><dt>Session Recovery</dt><dd>${coordination?.recovery?.recovered ? `recovered · conflicts=${Number(coordination.recovery.pendingConflicts || 0)}` : "none"}</dd></div>
    </dl>
  `;
}

function formatSessionHandoff(handoff) {
  if (!handoff) return "none";
  if (handoff.activeOfferId) {
    return `active · ${escapeHtml(handoff.activeMode || "view")} · peer=${escapeHtml(handoff.activePeerInstanceId || "-")}`;
  }
  if (handoff.lastPeerOfferId) {
    return `${escapeHtml(handoff.lastPeerAction || "offer")} · ${escapeHtml(handoff.lastPeerMode || "view")} · peer=${escapeHtml(handoff.lastPeerSource || "-")}`;
  }
  if (handoff.lastLocalOfferId) {
    return `${escapeHtml(handoff.lastLocalAction || "offer")} · ${escapeHtml(handoff.lastLocalMode || "view")} · local`;
  }
  return "none";
}

function formatSessionHandoffRelay(relay) {
  if (!relay) return "none";
  const frames = Number(relay.framesSent || 0) + Number(relay.framesReceived || 0);
  const inputs = Number(relay.inputsSent || 0) + Number(relay.inputsReceived || 0);
  if (!frames && !inputs) return "idle";
  return `frames=${frames} · inputs=${inputs} · transport=${escapeHtml(relay.lastTransport || "-")}`;
}

function formatSyncSummary(sync) {
  const snapshot = sync?.lastSuccessfulSnapshot;
  if (!snapshot) return `${sync?.backend || "unavailable"} no-snapshot`;
  return `${sync?.backend || "sync"} encrypted=${Boolean(sync?.encrypted)} last=${shortTime(snapshot.createdAt)} files=${Number(snapshot.fileCount || 0)} cache=${Number(snapshot.cacheRecords || 0)} settings=${Number(snapshot.settingsRecords || 0)}`;
}

function renderSettingsLifecycle(lifecycle, recovery) {
  const unsupported = recovery?.unsupportedAfterClose || [];
  const supported = recovery?.supportedWhileHidden || [];
  return `
    <dl>
      <div><dt>State</dt><dd>${escapeHtml(lifecycle?.state || "unknown")}</dd></div>
      <div><dt>Reason</dt><dd>${escapeHtml(lifecycle?.reason || "-")}</dd></div>
      <div><dt>Updated</dt><dd>${escapeHtml(shortTime(lifecycle?.updatedAt))}</dd></div>
      <div><dt>Last Recovery</dt><dd>${escapeHtml(shortTime(recovery?.lastRecovery?.recoveredAt))}</dd></div>
      <div><dt>Closed Page</dt><dd>${recovery?.closedPagePersistence ? "persistent" : "not persistent"}</dd></div>
    </dl>
    <p>${escapeHtml(formatClosedPageDiagnostics(unsupported, supported))}</p>
  `;
}

function formatRecoverySummary(recovery) {
  if (!recovery) return "unknown";
  if (recovery.lastRecovery?.recoveredAt) return `recovered ${shortTime(recovery.lastRecovery.recoveredAt)}`;
  if (recovery.lastShutdown?.recordedAt) return `last shutdown ${shortTime(recovery.lastShutdown.recordedAt)}`;
  return "no recovery records";
}

function formatClosedPageDiagnostics(unsupported = [], supported = []) {
  const unsupportedText = unsupported.length ? `unsupported-after-close=${unsupported.join(",")}` : "unsupported-after-close=-";
  const supportedText = supported.length ? `hidden-tab-support=${supported.join(",")}` : "hidden-tab-support=-";
  return `${unsupportedText} · ${supportedText}`;
}

function renderSettingsStorageStatus(storage) {
  return [
    escapeHtml(storage.backend || "memory"),
    storage.writePending || storage.persistPending || storage.persistInFlight ? "pending" : "idle",
    storage.persisted || storage.persistLastFlushedAt ? `${formatBytes(storage.bytes || storage.usage)} saved` : "not saved",
    storage.quota ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}` : "",
  ].filter(Boolean).join(" · ");
}

function formatStorageState(storage) {
  return [
    `backend=${storage.backend || "memory"}`,
    `format=${storage.storageFormat || "unknown"}`,
    `pending=${Boolean(storage.writePending || storage.persistPending || storage.persistInFlight)}`,
    `flushes=${storage.persistFlushes || 0}`,
    storage.lastWriteCompletedAt ? `lastWrite=${shortTime(storage.lastWriteCompletedAt)}` : "",
    storage.persistLastFlushedAt ? `lastFlush=${shortTime(storage.persistLastFlushedAt)} (${storage.persistLastFlushDurationMs || 0}ms)` : "",
    storage.lastWriteError || storage.persistLastFlushError ? `error=${storage.lastWriteError || storage.persistLastFlushError}` : "",
  ].filter(Boolean).join(" · ");
}

function renderSettingsStorageKernel(kernel) {
  if (!kernel) return `<p class="settings-muted">Storage kernel diagnostics are unavailable.</p>`;
  const cache = kernel.pageCache || {};
  const writeback = kernel.writeback || {};
  const repair = kernel.recovery?.lastRepair || null;
  const localConflicts = kernel.conflicts?.localMounts || [];
  const remoteConflicts = kernel.conflicts?.remoteSync || [];
  return `
    <dl>
      <div><dt>State</dt><dd>${escapeHtml(kernel.state || "unknown")}</dd></div>
      <div><dt>Page Cache</dt><dd>${Number(cache.dirtyInodes || 0)} dirty inodes · ${Number(cache.dirtyFiles || 0)} dirty files · ${formatBytes(cache.contentBytes || cache.bytes || 0)}</dd></div>
      <div><dt>Writeback</dt><dd>${writeback.pending ? "pending" : "idle"} · flushes=${Number(writeback.flushes || 0)} · coalesced=${Number(writeback.coalesced || 0)}</dd></div>
      <div><dt>Transactions</dt><dd>${Number(kernel.transactions?.length || 0)} records · ${Number(kernel.transactionGroups?.length || 0)} groups</dd></div>
      <div><dt>Conflicts</dt><dd>local=${localConflicts.length} · remote=${remoteConflicts.length}</dd></div>
      <div><dt>Last Repair</dt><dd>${repair ? `${escapeHtml(shortTime(repair.checkedAt))} · ok=${Boolean(repair.ok)} · problems=${Number(repair.problems || 0)} · repairs=${Number(repair.repairs || 0)}` : "none"}</dd></div>
      <div><dt>Last Error</dt><dd>${escapeHtml(writeback.lastError || "-")}</dd></div>
    </dl>
    ${renderSettingsStorageTransactions(kernel.transactionGroups || [])}
  `;
}

function renderSettingsStorageTransactions(groups = []) {
  if (!groups.length) return `<p class="settings-muted">No storage transaction groups recorded.</p>`;
  return `
    <div class="settings-mount-list">
      ${groups.slice(-6).reverse().map((group) => `
        <article class="settings-mount-card" data-storage-group="${escapeAttr(group.id)}">
          <div>
            <strong>${escapeHtml(group.kind || group.id)}</strong>
            <span>${escapeHtml(group.status || "unknown")} · transactions=${Number(group.transactionIds?.length || 0)}</span>
            <small>${escapeHtml(shortTime(group.startedAt))}${group.reason ? ` · ${escapeHtml(group.reason)}` : ""}</small>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSettingsServices(services) {
  if (!services.length) return `<p class="settings-muted">No runtime services are registered.</p>`;
  return `
    <div class="settings-mount-list">
      ${services.map((service) => `
        <article class="settings-mount-card" data-service-state="${escapeAttr(service.state || "")}">
          <div>
            <strong>${escapeHtml(service.name || service.id)}</strong>
            <span>${escapeHtml(service.id)} · ${escapeHtml(service.state || "unknown")} · runs=${Number(service.runCount || 0)}</span>
            ${service.lastError ? `<small>${escapeHtml(service.lastError)}</small>` : ""}
          </div>
          <div>
            <button type="button" data-settings-action="service-restart" data-service-id="${escapeAttr(service.id)}">Restart</button>
            <button type="button" data-settings-action="service-disable" data-service-id="${escapeAttr(service.id)}">Disable</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSettingsMounts(mounts) {
  if (!mounts.length) return `<p class="settings-muted">No local folders are saved yet.</p>`;
  return `
    <div class="settings-mount-list">
      ${mounts.map((mount) => `
        <article class="settings-mount-card" data-mount-status="${escapeAttr(mount.status || "")}">
          <div>
            <strong>${escapeHtml(mount.handleName || mount.name || mount.path)}</strong>
            <span>${escapeHtml(mount.path)} · ${escapeHtml(mount.access || mount.mode || "local folder")} · ${escapeHtml(mount.status || "unknown")}</span>
            ${mount.error ? `<small>${escapeHtml(mount.error)}</small>` : ""}
          </div>
          <div>
            <button type="button" data-settings-action="remount" data-mount-path="${escapeAttr(mount.path)}">Allow</button>
            <button type="button" data-settings-action="forget" data-mount-path="${escapeAttr(mount.path)}">Forget</button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function safeRead(reader, fallback) {
  try {
    return reader();
  } catch {
    return fallback;
  }
}

async function safeReadAsync(reader, fallback) {
  try {
    return await reader();
  } catch {
    return fallback;
  }
}

export function safeCalculate(expression) {
  const source = String(expression).replace(/\s+/g, "");
  if (!source || source.length > 200 || !/^[\deE+\-*/.()]+$/.test(source)) return "Error";
  let index = 0;
  const number = () => {
    if (source[index] === "+") { index += 1; return number(); }
    if (source[index] === "-") { index += 1; return -number(); }
    if (source[index] === "(") {
      index += 1;
      const value = sum();
      if (source[index++] !== ")") throw new Error("Unclosed expression");
      return value;
    }
    const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error("Expected number");
    index += match[0].length;
    return Number(match[0]);
  };
  const product = () => {
    let value = number();
    while (source[index] === "*" || source[index] === "/") {
      const operator = source[index++];
      const right = number();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = () => {
    let value = product();
    while (source[index] === "+" || source[index] === "-") {
      const operator = source[index++];
      const right = product();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const value = sum();
    if (index !== source.length || !Number.isFinite(value)) return "Error";
    return String(Number(value.toPrecision(15)));
  } catch { return "Error"; }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function fileTileMeta(os, node) {
  if (os.fs.isLink(node)) return `${node.type} -> ${node.target}`;
  const stat = os.fs.lstat(node.path);
  return `${stat?.type || node.type} · ${stat?.permissions || ""}`;
}

function tokenizeCommand(line) {
  return line.match(/"([^"]*)"|'([^']*)'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) || [];
}

function runMkdir(os, cwd, args) {
  const parents = args.includes("-p");
  const paths = args.filter((arg) => !arg.startsWith("-"));
  if (!paths.length) throw new Error("mkdir: missing operand");
  paths.forEach((path) => {
    if (parents) {
      createParents(os, cwd, path);
      return;
    }
    os.fs.createDirectory(path, cwd);
  });
}

function createParents(os, cwd, path) {
  const normalized = os.fs.normalize(path, cwd);
  const parts = normalized.split("/").filter(Boolean);
  let cursor = "/";
  parts.forEach((part) => {
    cursor = os.fs.join(cursor, part);
    if (!os.fs.exists(cursor)) os.fs.createDirectory(cursor);
  });
}

function runTouch(os, cwd, args) {
  const paths = args.filter((arg) => !arg.startsWith("-"));
  if (!paths.length) throw new Error("touch: missing file operand");
  paths.forEach((path) => {
    const existing = os.fs.resolve(path, cwd);
    if (existing?.type === "directory") throw new Error(`touch: ${path}: is a directory`);
    os.fs.writeOrCreateFile(path, existing ? os.fs.readFile(path, cwd) : "", cwd);
  });
}

function runRm(os, cwd, args) {
  const recursive = args.includes("-r") || args.includes("-rf") || args.includes("-fr");
  const force = args.includes("-f") || args.includes("-rf") || args.includes("-fr");
  const paths = args.filter((arg) => !arg.startsWith("-"));
  if (!paths.length) throw new Error("rm: missing operand");
  paths.forEach((path) => {
    try {
      os.fs.remove(path, cwd, { recursive });
    } catch (error) {
      if (!force) throw error;
    }
  });
}

function runCp(os, cwd, args) {
  const recursive = args.includes("-r") || args.includes("-R");
  const operands = args.filter((arg) => !arg.startsWith("-"));
  if (operands.length < 2) throw new Error("cp: missing source or destination");
  os.fs.copy(operands[0], operands[1], cwd, { recursive });
}

function runMv(os, cwd, args) {
  const operands = args.filter((arg) => !arg.startsWith("-"));
  if (operands.length < 2) throw new Error("mv: missing source or destination");
  os.fs.move(operands[0], operands[1], cwd);
}

function runEcho(os, cwd, args, print) {
  const appendIndex = args.indexOf(">>");
  const writeIndex = args.indexOf(">");
  const redirectIndex = appendIndex >= 0 ? appendIndex : writeIndex;
  if (redirectIndex < 0) {
    print(args.join(" "));
    return;
  }
  const target = args[redirectIndex + 1];
  if (!target) throw new Error("echo: missing redirect target");
  const value = `${args.slice(0, redirectIndex).join(" ")}\n`;
  if (appendIndex >= 0) os.fs.appendFile(target, value, cwd);
  else os.fs.writeOrCreateFile(target, value, cwd);
}

function runFind(os, cwd, args) {
  const path = args[0] || cwd;
  const query = args[1] || "";
  const root = os.fs.resolve(path, cwd);
  if (!root) return `find: ${path}: no such file or directory`;
  const lines = [];
  walkNodes(os, root.path, (node) => {
    if (!query || node.name.toLowerCase().includes(query.toLowerCase())) lines.push(node.path);
  });
  return lines.join("\n");
}

function runGrep(os, cwd, args) {
  if (args.length < 2) return "grep: usage: grep <text> <file>";
  const needle = args[0].toLowerCase();
  const filePath = args[1];
  const content = os.fs.readFile(filePath, cwd);
  return content
    .split("\n")
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => line.toLowerCase().includes(needle))
    .map(({ line, index }) => `${filePath}:${index}: ${line}`)
    .join("\n");
}

function runKill(os, args) {
  const pid = Number(args[0]);
  if (!Number.isFinite(pid)) return "kill: usage: kill <pid>";
  const killed = os.processes.kill(pid);
  return `killed ${killed.pid} ${killed.appId}`;
}

function formatManifest(os, appId) {
  if (!appId) {
    return os.apps.manifests()
      .map((manifest) => `${manifest.id} ${manifest.version} capabilities=${manifest.capabilities.join(",") || "-"}`)
      .join("\n");
  }
  const manifest = os.apps.getManifest(appId);
  if (!manifest) return `manifest: ${appId}: no such app`;
  return [
    `id=${manifest.id}`,
    `name=${manifest.name}`,
    `version=${manifest.version}`,
    `entry=${manifest.entry}`,
    `singleton=${manifest.singleton}`,
    `accepts=${manifest.accepts.join(",") || "-"}`,
    `capabilities=${manifest.capabilities.join(",") || "-"}`,
    `fs.read=${manifest.fileSystem.read.join(",") || "-"}`,
    `fs.write=${manifest.fileSystem.write.join(",") || "-"}`,
  ].join("\n");
}

function formatStorage(status) {
  return [
    `key=${status.key}`,
    `enabled=${status.enabled}`,
    `persisted=${status.persisted}`,
    `bytes=${status.bytes}`,
  ].join("\n");
}

function walkNodes(os, path, visit) {
  const node = os.fs.resolve(path);
  if (!node) return;
  visit(node);
  if (node.type !== "directory") return;
  os.fs.list(node.path).forEach((entry) => walkNodes(os, entry.path, visit));
}

function runLs(os, cwd, args, print) {
  const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
  const showAll = args.includes("-a") || args.includes("-la") || args.includes("-al");
  const path = args.find((arg) => !arg.startsWith("-")) || cwd;
  const entries = os.fs.list(path, cwd).filter((entry) => showAll || !entry.name.startsWith("."));
  if (!long) {
    print(entries.map((entry) => entry.name).join("  "));
    return;
  }
  entries.forEach((entry) => print(formatLsEntry(os, entry)));
}

function formatLsEntry(os, node) {
  const stat = os.fs.lstat(node.path);
  const target = node.target ? ` -> ${node.target}` : "";
  return `${stat.permissions} ${stat.owner.padEnd(5)} ${stat.group.padEnd(5)} ${String(stat.size).padStart(6)} ${node.name}${target}`;
}

function renderTree(os, path, cwd, prefix = "", depth = 0) {
  const node = os.fs.resolve(path, cwd);
  if (!node) return `tree: no such path: ${path}`;
  const lines = depth === 0 ? [node.path] : [];
  if (node.type !== "directory" || depth > 4) return lines.join("\n");
  const entries = os.fs.list(node.path);
  entries.forEach((entry, index) => {
    const branch = index === entries.length - 1 ? "`-- " : "|-- ";
    const nextPrefix = index === entries.length - 1 ? "    " : "|   ";
    lines.push(`${prefix}${branch}${entry.name}${entry.target ? ` -> ${entry.target}` : ""}`);
    if (entry.type === "directory") {
      lines.push(renderTree(os, entry.path, "/", `${prefix}${nextPrefix}`, depth + 1));
    }
  });
  return lines.filter(Boolean).join("\n");
}

function resolveTerminalPath(os, path, cwd) {
  return os.fs.normalize(path, cwd);
}

function readTerminalFile(os, path, cwd) {
  try {
    return os.fs.readFile(path, cwd);
  } catch (error) {
    return error.message;
  }
}

function formatStat(stat) {
  if (!stat) return "stat: no such file or directory";
  return [
    `Path: ${stat.path}`,
    `Type: ${stat.type}${stat.target ? ` -> ${stat.target}` : ""}`,
    `MIME: ${stat.mime}`,
    `Mode: ${stat.permissions}`,
    `Owner: ${stat.owner}:${stat.group}`,
    `Size: ${stat.size}`,
    `Modified: ${stat.modified}`,
  ].join("\n");
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms) {
  const seconds = Math.floor(Number(ms || 0) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return `${hours}h ${minutes % 60}m`;
  if (minutes) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function mimeFromName(name) {
  if (/\.md$/i.test(name)) return "text/markdown";
  if (/\.txt$/i.test(name)) return "text/plain";
  if (/\.json$/i.test(name)) return "application/json";
  if (/\.deck\.html?$/i.test(name)) return "application/x-dindbos-deck";
  if (/\.html?$/i.test(name)) return "text/html";
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  return "application/octet-stream";
}

function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString();
}
