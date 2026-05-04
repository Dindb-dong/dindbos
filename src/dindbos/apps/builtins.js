import { base64ToBytes, bytesToBase64, fileContentPreview } from "../file-data.js?v=20260422-browserd";
import { BrowserCompanionClient, pasteClipboardText } from "../browser-client.js?v=20260422-browserd";
import { ShellSession } from "../shell.js?v=20260422-browserd";

const FILES_OPERATION_HISTORY_LIMIT = 12;
export const BROWSER_LOCAL_HTML_SANDBOX = "allow-scripts allow-forms allow-popups";

export function installBuiltinApps(os, { portfolioData }) {
  os.registerApp({
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
      fileSystem: { read: ["/mnt/portfolio", "/home/guest"], write: [] },
    },
    render: ({ content }) => renderPortfolio(content, portfolioData),
  });

  os.registerApp({
    id: "files",
    name: "Files",
    title: ({ path = "/" }) => `Files - ${path}`,
    icon: "folder",
    pinned: true,
    width: 760,
    height: 520,
    accepts: ["inode/directory"],
    manifest: {
      capabilities: ["app.launch", "storage.manage", "localMount.read", "localMount.manage"],
      fileSystem: { read: ["/"], write: ["/home/guest", "/mnt/portfolio", "/tmp"] },
    },
    render: ({ os: runtime, content, context, window }) => (
      renderFiles(runtime, content, context.path || runtime.session.home || "/", window)
    ),
  });

  os.registerApp({
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
      fileSystem: { read: ["/"], write: ["/home/guest", "/mnt/portfolio", "/tmp", "/opt", "/usr/share/applications", "/var/lib/dindbos/packages"] },
    },
    render: ({ os: runtime, content }) => renderTerminal(runtime, content),
  });

  os.registerApp({
    id: "activity-monitor",
    name: "Activity Monitor",
    title: "Activity Monitor.app",
    icon: "activity",
    pinned: true,
    singleton: true,
    width: 780,
    height: 520,
    manifest: {
      capabilities: ["app.launch", "process.read", "process.manage"],
      fileSystem: { read: ["/proc"], write: [] },
    },
    render: ({ os: runtime, content }) => renderActivityMonitor(runtime, content),
  });

  os.registerApp({
    id: "text",
    name: "TextEdit",
    title: ({ node }) => node?.name || "TextEdit",
    icon: "text",
    accepts: ["text/plain", "text/markdown", "application/json", "application/x-dindbos-command"],
    width: 720,
    height: 520,
    manifest: {
      capabilities: ["storage.manage", "localMount.read", "localMount.manage"],
      fileSystem: { read: ["/"], write: ["/home/guest", "/mnt/portfolio", "/tmp"] },
    },
    render: ({ os: runtime, content, context, window }) => renderText(runtime, content, context.node, window),
  });

  os.registerApp({
    id: "browser",
    name: "Browser",
    title: ({ node, url }) => node?.name || url || "Browser.app",
    icon: "browser",
    pinned: true,
    width: 940,
    height: 640,
    associationPriority: 20,
    accepts: ["text/html"],
    manifest: {
      capabilities: ["process.read", "localMount.read"],
      fileSystem: { read: ["/"], write: [] },
    },
    render: ({ os: runtime, content, context, window }) => renderBrowser(runtime, content, context, window),
  });

  os.registerApp({
    id: "viewer",
    name: "Viewer",
    title: ({ node }) => node?.name || "Viewer",
    icon: "pdf",
    accepts: ["application/pdf", "image/*", "text/markdown", "application/x-dindbos-deck"],
    associationPriority: 10,
    width: 820,
    height: 560,
    manifest: {
      capabilities: ["localMount.read"],
      fileSystem: { read: ["/"], write: [] },
    },
    render: ({ os: runtime, content, context }) => renderViewer(runtime, content, context.node),
  });

  os.registerApp({
    id: "calculator",
    name: "Calculator",
    title: "Calculator.app",
    icon: "calculator",
    pinned: true,
    singleton: true,
    width: 360,
    height: 430,
    manifest: {
      fileSystem: { read: [], write: [] },
    },
    render: ({ content }) => renderCalculator(content),
  });

  os.registerApp({
    id: "settings",
    name: "Settings",
    title: "Settings.app",
    icon: "settings",
    pinned: true,
    singleton: true,
    width: 520,
    height: 380,
    manifest: {
      capabilities: ["process.read", "storage.read", "storage.manage", "package.read", "localMount.read", "localMount.manage"],
      fileSystem: { read: ["/etc", "/proc", "/home/guest"], write: [] },
    },
    render: ({ content, os: runtime }) => renderSettings(runtime, content),
  });
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

function renderFiles(os, content, path, windowApi) {
  const sidebar = [
    { section: "Favorites", items: [
      { label: "Home", path: os.session.home || "/home/guest", icon: "home" },
      { label: "Desktop", path: os.fs.join(os.session.home || "/home/guest", "Desktop"), icon: "folder" },
      { label: "Documents", path: os.fs.join(os.session.home || "/home/guest", "Documents"), icon: "folder" },
      { label: "Downloads", path: os.fs.join(os.session.home || "/home/guest", "Downloads"), icon: "folder" },
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
  let currentPath = os.fs.normalize(path);
  let selectedPath = currentPath;
  let clipboard = null;
  let clickTimer = null;
  let searchQuery = "";
  let searchTimer = null;
  let fileOperation = null;
  let operationHistory = [];
  let selectedPaths = new Set([selectedPath]);
  let selectionAnchorPath = selectedPath;

  const draw = async (nextPath, nextSelectedPath = null, options = {}) => {
    currentPath = os.fs.normalize(nextPath);
    if (!os.fs.resolve(currentPath)) currentPath = os.session.home || "/";
    if (os.localMounts?.isMountedPath(currentPath)) await os.localMounts.syncDirectory(currentPath);
    selectedPath = nextSelectedPath ? os.fs.normalize(nextSelectedPath) : currentPath;
    if (!options.preserveSelection) {
      selectedPaths = new Set([selectedPath]);
      selectionAnchorPath = selectedPath;
    }
    const currentStat = os.fs.stat(currentPath);
    windowApi.setTitle(`Files - ${currentPath}`);
    const query = searchQuery.trim();
    const columns = query ? buildSearchColumns(os, currentPath, selectedPath, query) : buildFileColumns(os, currentPath, selectedPath);
    const visibleCount = columns.reduce((total, column) => total + column.entries.length, 0);
    const selected = os.fs.lstat(selectedPath) || os.fs.stat(selectedPath);
    const mountStatus = await mountStatusForPath(os, currentPath);
    const latestMountOperation = safeRead(() => os.localMounts.operations()[0], null);
    const visibleOperation = latestMountOperation?.status === "running"
      ? latestMountOperation
      : fileOperation || latestMountOperation;
    content.innerHTML = `
      <section class="files-app" tabindex="0">
        <aside class="files-sidebar">
          ${sidebar.map((group) => `
            <section>
              <h3>${escapeHtml(group.section)}</h3>
              ${group.items.map((item) => `
                <button type="button" data-nav="${escapeAttr(item.path)}" data-icon="${escapeAttr(item.icon)}" class="${isWithinPath(currentPath, item.path) ? "is-active" : ""}">
                  <span class="dos-mini-icon"></span>
                  ${escapeHtml(item.label)}
                </button>
              `).join("")}
            </section>
          `).join("")}
        </aside>
        <div class="files-main">
          <div class="pathbar">
            <button type="button" data-nav="${escapeAttr(os.fs.dirname(currentPath))}">Back</button>
            <nav class="files-breadcrumb" aria-label="Current folder">
              ${renderBreadcrumb(os, currentPath)}
            </nav>
            <span>${escapeHtml(currentStat?.permissions || "")}</span>
          </div>
          <div class="files-toolbar">
            <button type="button" data-action="new-folder">New Folder</button>
            <button type="button" data-action="new-file">New File</button>
            <button type="button" data-action="rename">Rename</button>
            <button type="button" data-action="duplicate">Duplicate</button>
            <button type="button" data-action="copy">Copy</button>
            <button type="button" data-action="paste">Paste</button>
            <button type="button" data-action="trash">Trash</button>
            <button type="button" data-action="import">Import</button>
            <button type="button" data-action="export">Export</button>
            <button type="button" data-action="mount-local">Mount Local</button>
            <button type="button" data-action="delete">Delete</button>
            <input type="search" data-files-search placeholder="Search" value="${escapeAttr(searchQuery)}" />
          </div>
          <div class="files-dropzone">
            Drop files here to import into ${escapeHtml(currentPath)}. Drag rows to move them.
          </div>
          ${mountStatus ? renderMountStatusBanner(mountStatus) : ""}
          ${renderFilesOperation(visibleOperation)}
          <div class="files-column-view" role="tree" data-drop-target="true" data-drop-path="${escapeAttr(currentPath)}">
            ${columns.map((column) => `
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
                      <span class="dos-mini-icon"></span>
                      <span>${escapeHtml(entry.name)}</span>
                      <small>${escapeHtml(rowKind(os, entry, stat))}</small>
                    </button>
                  `;
                }).join("")}
              </div>
            `).join("")}
          </div>
          <div class="files-status">
            <span>${query ? `${visibleCount} matches` : `${os.fs.list(currentPath).length} items`} · ${selectedPaths.size} selected</span>
            <span>${clipboard ? `Clipboard: ${escapeHtml(os.fs.basename(clipboard.path))}` : selectedPaths.size > 1 ? `${selectedPaths.size} selected` : escapeHtml(currentPath)}</span>
          </div>
        </div>
        <aside class="files-inspector">
          ${selected ? renderInspector(selected) : "<p>No selection</p>"}
          ${renderFilesOperationHistory(operationHistory)}
        </aside>
      </section>
    `;
    const appRoot = content.querySelector(".files-app");
    content.querySelectorAll("[data-nav]").forEach((button) => {
      button.addEventListener("click", () => draw(button.dataset.nav));
    });
    const searchInput = content.querySelector("[data-files-search]");
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => draw(currentPath, selectedPath, { focusSearch: true }), 120);
    });
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
        clickTimer = window.setTimeout(() => {
          const node = os.fs.resolve(button.dataset.path) || os.fs.lstat(button.dataset.path);
          const resolved = os.fs.resolveNode(node);
          if (resolved.type === "directory" || resolved.type === "mount") {
            draw(button.dataset.path, button.dataset.path);
            return;
          }
          draw(currentPath, button.dataset.path, { preserveSelection: true });
        }, 180);
      });
      button.addEventListener("dblclick", () => {
        clearTimeout(clickTimer);
        os.openPath(button.dataset.path);
      });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (!selectedPaths.has(button.dataset.path)) {
          selectedPaths = new Set([button.dataset.path]);
          selectionAnchorPath = button.dataset.path;
        }
        draw(currentPath, button.dataset.path, { preserveSelection: true }).then(() => {
          showFilesContextMenu(content, event, button.dataset.path, clipboard, runAction);
        });
      });
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("application/x-dindbos-path", button.dataset.path);
        event.dataTransfer.effectAllowed = "move";
      });
      if (button.dataset.dropPath) {
        button.addEventListener("dragover", (event) => {
          event.preventDefault();
          button.classList.add("is-drop-target");
        });
        button.addEventListener("dragleave", () => button.classList.remove("is-drop-target"));
        button.addEventListener("drop", async (event) => {
          event.preventDefault();
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
      if (event.target.closest("input, textarea, select, [contenteditable='true']")) return;
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
      if (event.target.closest("[data-path]")) return;
      event.preventDefault();
      showFilesContextMenu(content, event, currentPath, clipboard, runAction);
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
  const runAction = async (action, actionPath = selectedPath) => {
    const reporter = createFilesOperationReporter(content, operationLabel(action));
    try {
      const result = await handleFileAction(os, currentPath, actionPath, action, { clipboard, reporter, selectedPaths: [...selectedPaths] });
      if (Object.hasOwn(result, "clipboard")) clipboard = result.clipboard;
      await os.storage?.flush?.();
      if (reporter.started) {
        fileOperation = reporter.complete("Complete");
        operationHistory = recordFilesOperationHistory(operationHistory, fileOperation);
      }
      selectedPaths = new Set([result.selectedPath || result.path || currentPath]);
      await draw(result.path || currentPath, result.selectedPath || result.path || currentPath);
    } catch (error) {
      if (reporter.started) {
        fileOperation = reporter.fail(error);
        operationHistory = recordFilesOperationHistory(operationHistory, fileOperation);
      }
      windowApi.setTitle(`Files - ${error.message}`);
      updateFilesOperation(content, fileOperation);
    }
  };
  draw(path);
}

function buildFileColumns(os, currentPath, selectedPath) {
  const normalizedCurrent = os.fs.normalize(currentPath);
  const chain = [];
  let cursor = normalizedCurrent;
  while (cursor !== "/") {
    chain.unshift(cursor);
    cursor = os.fs.dirname(cursor);
  }
  chain.unshift("/");
  return chain.map((columnPath, index) => ({
    path: columnPath,
    selectedPath: chain[index + 1] || selectedPath,
    entries: os.fs.list(columnPath),
  }));
}

function buildSearchColumns(os, currentPath, selectedPath, query) {
  return [{
    path: currentPath,
    selectedPath,
    entries: searchFileEntries(os, currentPath, query).slice(0, 200),
  }];
}

export function searchFileEntries(os, rootPath, query) {
  const filters = parseFilesSearchQuery(query);
  const results = [];
  const visit = (directory, depth = 0) => {
    if (depth > 8) return;
    const entries = safeRead(() => os.fs.list(directory), []);
    entries.forEach((entry) => {
      const stat = os.fs.stat(entry.path) || os.fs.lstat(entry.path) || entry;
      const resolved = os.fs.resolveNode(entry);
      if (matchesFilesSearch(entry, resolved, stat, filters)) {
        results.push(entry);
      }
      if (resolved.type === "directory" || resolved.type === "mount") visit(entry.path, depth + 1);
    });
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
  const crumbs = [{ label: "/", path: "/" }];
  let cursor = "/";
  parts.forEach((part) => {
    cursor = os.fs.join(cursor, part);
    crumbs.push({ label: part, path: cursor });
  });
  return crumbs.map((crumb, index) => `
    <button type="button" data-nav="${escapeAttr(crumb.path)}">
      ${escapeHtml(crumb.label)}
    </button>
    ${index < crumbs.length - 1 ? "<span>/</span>" : ""}
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
  return `
    <div class="files-operation" data-operation-status="${escapeAttr(status)}">
      <div>
        <strong>${escapeHtml(label)}</strong>
        <span>${total > 0 ? `${done}/${total}` : status} · ${escapeHtml(detail)}</span>
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

function createFilesOperationReporter(content, label) {
  const reporter = {
    label,
    started: false,
    state: null,
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
        finishedAt: new Date().toISOString(),
      };
      updateFilesOperation(content, this.state);
      return this.state;
    },
  };
  return reporter;
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

function showFilesContextMenu(content, event, targetPath, clipboard, runAction) {
  content.querySelector(".files-context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "files-context-menu";
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.innerHTML = [
    ["open", "Open"],
    ["rename", "Rename"],
    ["duplicate", "Duplicate"],
    ["copy", "Copy"],
    ["paste", clipboard ? `Paste ${escapeHtml(clipboard.name)}` : "Paste"],
    ["trash", "Move to Trash"],
    ["export", "Export"],
    ["delete", "Delete Permanently"],
  ].map(([action, label]) => `
    <button type="button" data-context-action="${escapeAttr(action)}" ${action === "paste" && !clipboard ? "disabled" : ""}>
      ${label}
    </button>
  `).join("");
  content.appendChild(menu);
  menu.querySelectorAll("[data-context-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      menu.remove();
      await runAction(button.dataset.contextAction, targetPath);
    });
  });
  window.setTimeout(() => {
    const close = () => {
      menu.remove();
      document.removeEventListener("click", close);
    };
    document.addEventListener("click", close);
  }, 0);
}

async function handleFilesDrop(os, event, destinationPath, draw, windowApi, content, onHistory = null) {
  const reporter = createFilesOperationReporter(content, "Drop");
  try {
    const sourcePath = event.dataTransfer?.getData("application/x-dindbos-path");
    if (sourcePath) {
      const moved = await movePathIntoDirectory(os, sourcePath, destinationPath, reporter);
      onHistory?.(reporter.complete("Complete"));
      await draw(destinationPath, moved);
      return;
    }
    const imported = await importDroppedFiles(os, destinationPath, event.dataTransfer?.files || [], reporter);
    onHistory?.(reporter.complete("Complete"));
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
    const target = uniquePath(os, currentPath, "untitled-folder");
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
    const nextName = prompt("Rename", currentName);
    if (!nextName || nextName === currentName) return { path: currentPath, selectedPath: target };
    const destination = os.fs.join(os.fs.dirname(target), sanitizeFileName(nextName));
    await movePath(os, target, destination, reporter);
    return { path: os.fs.dirname(destination), selectedPath: destination };
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
    const pasted = await copyPathIntoDirectory(os, state.clipboard.path, currentPath, reporter);
    return { path: currentPath, selectedPath: pasted, clipboard: state.clipboard };
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
    const imported = await importFilesWithPicker(os, currentPath, reporter);
    return { path: currentPath, selectedPath: imported[0] || currentPath };
  }
  if (action === "export") {
    if (selectedPath === currentPath) await exportPath(os, currentPath, reporter);
    else await exportPath(os, selectedPath, reporter);
    return { path: currentPath, selectedPath };
  }
  if (action === "delete") {
    const targets = filesActionTargets(currentPath, selectedPath, state.selectedPaths);
    if (!targets.length) throw new Error("Select an item first");
    reporter?.start(targets.length, `Deleting ${targets.length} item${targets.length === 1 ? "" : "s"}`);
    for (const target of targets) {
      await removePath(os, target);
      reporter?.step(target);
    }
    return { path: currentPath, selectedPath: currentPath };
  }
  return { path: currentPath, selectedPath };
}

async function importFilesWithPicker(os, currentPath, reporter = null) {
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
    return importDroppedFiles(os, currentPath, files, reporter);
  } finally {
    input.remove();
  }
}

export async function importDroppedFiles(os, currentPath, fileList, reporter = null) {
  const files = [...fileList];
  const imported = [];
  if (files.length) reporter?.start(files.length, `Importing ${files.length} file${files.length === 1 ? "" : "s"}`);
  for (const file of files) {
    if (file.name.endsWith(".dindbos-export.json")) {
      imported.push(...await importDindbArchive(os, currentPath, file));
      reporter?.step(file.name);
      continue;
    }
    const target = await allocateImportPath(os, currentPath, file.name || "upload.bin");
    if (os.localMounts?.isMountedPath(currentPath)) await os.localMounts.writeFileBlob(target, file, "/", { mime: file.type || mimeFromName(target) });
    else await os.fs.writeOrCreateFileBlob(target, file, "/", { mime: file.type || mimeFromName(target), owner: "guest", group: "users", permissions: "-rw-r--r--" });
    imported.push(target);
    reporter?.step(target);
  }
  return imported;
}

export async function importDindbArchive(os, currentPath, file, reporter = null) {
  const archive = JSON.parse(await file.text());
  if (archive?.kind !== "dindbos-export-v1" || !Array.isArray(archive.entries)) throw new Error("Invalid DindbOS export");
  const imported = [];
  if (!reporter?.started) reporter?.start(archive.entries.length, file.name || "archive");
  for (const entry of archive.entries) {
    const relative = sanitizeRelativePath(entry.path || entry.name || "file.bin");
    const target = await allocateImportPath(os, currentPath, relative);
    const bytes = base64ToBytes(entry.data || "");
    if (os.localMounts?.isMountedPath(target)) await os.localMounts.writeFileBytes(target, bytes, "/", { mime: entry.mime || mimeFromName(target) });
    else os.fs.writeOrCreateFileBytes(target, bytes, "/", {
      mime: entry.mime || mimeFromName(target),
      owner: entry.owner || "guest",
      group: entry.group || "users",
      permissions: entry.permissions || "-rw-r--r--",
    });
    imported.push(target);
    reporter?.step(target);
  }
  return imported;
}

async function allocateImportPath(os, directory, relativePath) {
  const relative = sanitizeRelativePath(relativePath);
  const target = os.fs.normalize(relative, directory);
  await ensureImportParent(os, os.fs.dirname(target));
  if (!await importPathExists(os, target)) return target;
  const parent = os.fs.dirname(target);
  const name = os.fs.basename(target);
  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = os.fs.join(parent, `${base}-${index}${extension}`);
    if (!await importPathExists(os, candidate)) return candidate;
  }
  throw new Error(`Cannot allocate a filename for ${relative}`);
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

async function copyPathIntoDirectory(os, sourcePath, directoryPath, reporter = null) {
  const destination = await uniqueDestinationPath(os, directoryPath, os.fs.basename(sourcePath));
  await copyPath(os, sourcePath, destination, reporter);
  return destination;
}

async function movePathIntoDirectory(os, sourcePath, directoryPath, reporter = null) {
  const normalizedSource = os.fs.normalize(sourcePath);
  const normalizedDirectory = os.fs.normalize(directoryPath);
  if (normalizedSource === normalizedDirectory || normalizedDirectory.startsWith(`${normalizedSource}/`)) {
    throw new Error("Cannot move a folder into itself");
  }
  const destination = await uniqueDestinationPath(os, normalizedDirectory, os.fs.basename(normalizedSource));
  await movePath(os, normalizedSource, destination, reporter);
  return destination;
}

async function copyPath(os, sourcePath, destinationPath, reporter = null) {
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
    os.fs.copy(sourcePath, destinationPath, "/", { recursive: true });
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

async function movePath(os, sourcePath, destinationPath, reporter = null) {
  const sourceLocal = os.localMounts?.isMountedPath(sourcePath);
  const destinationLocal = os.localMounts?.isMountedPath(destinationPath);
  if (sourceLocal && destinationLocal) {
    await os.localMounts.move(sourcePath, destinationPath, "/", {
      recursive: true,
      onProgress: (operation) => reporter?.progress(operation),
    });
    return;
  }
  if (!sourceLocal && !destinationLocal) {
    reporter?.start(countVirtualEntries(os, sourcePath), sourcePath);
    os.fs.move(sourcePath, destinationPath, "/");
    reporter?.complete(destinationPath);
    return;
  }
  await copyPath(os, sourcePath, destinationPath, reporter);
  await removePath(os, sourcePath, reporter);
}

async function copyLocalToVirtual(os, sourcePath, destinationPath, reporter = null) {
  const stat = await os.localMounts.stat(sourcePath);
  if (stat.type === "directory" || stat.type === "mount") {
    os.fs.createDirectory(destinationPath, "/", {
      owner: stat.owner || "guest",
      group: stat.group || "users",
      permissions: stat.permissions || "drwxr-xr-x",
    });
    reporter?.step(sourcePath);
    const entries = await os.localMounts.list(sourcePath);
    for (const entry of entries) {
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
}

async function copyVirtualToLocal(os, sourcePath, destinationPath, reporter = null) {
  const stat = os.fs.stat(sourcePath);
  if (!stat) throw new Error(`copy: ${sourcePath}: no such file or directory`);
  if (stat.type === "directory" || stat.type === "mount") {
    await os.localMounts.createDirectory(destinationPath, "/", { parents: true });
    reporter?.step(sourcePath);
    for (const entry of os.fs.list(sourcePath)) {
      await copyVirtualToLocal(os, entry.path, os.fs.join(destinationPath, entry.name), reporter);
    }
    return;
  }
  await os.localMounts.writeFileBytes(destinationPath, os.fs.readFileBytes(sourcePath), "/", { mime: stat.mime || mimeFromName(destinationPath) });
  reporter?.step(sourcePath);
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

async function removePath(os, path, reporter = null) {
  const ownsProgress = reporter && !reporter.started;
  if (ownsProgress) reporter.start(1, path);
  if (os.localMounts?.isMountedPath(path)) {
    await os.localMounts.remove(path, "/", { recursive: true });
    if (ownsProgress) reporter.step(path);
    return;
  }
  os.fs.remove(path, "/", { recursive: true });
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

async function exportPath(os, path, reporter = null) {
  const normalized = os.fs.normalize(path);
  const node = os.fs.resolve(normalized) || os.fs.lstat(normalized);
  if (!node) throw new Error(`export: no such path: ${path}`);
  const exportTotal = node.type === "directory" || node.type === "mount"
    ? (os.localMounts?.isMountedPath(normalized) ? await countLocalEntries(os, normalized) : countVirtualEntries(os, normalized))
    : 1;
  reporter?.start(exportTotal, normalized);
  if (node.type === "directory" || node.type === "mount") {
    const entries = await collectExportEntries(os, normalized, reporter);
    downloadBytes(`${os.fs.basename(normalized)}.dindbos-export.json`, new TextEncoder().encode(JSON.stringify({
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
  downloadBytes(node.name || os.fs.basename(normalized), bytes, stat?.mime || "application/octet-stream");
  reporter?.step(normalized);
}

export async function collectExportEntries(os, rootPath, reporter = null) {
  const root = os.fs.normalize(rootPath);
  const entries = [];
  const walk = async (path) => {
    if (os.localMounts?.isMountedPath(path)) await os.localMounts.syncDirectory(path);
    const node = os.fs.resolve(path);
    if (!node || node.type === "mount") {
      reporter?.step(path);
      const localEntries = await os.localMounts.list(path);
      for (const entry of localEntries) await walk(entry.path);
      return;
    }
    if (node.type === "directory") {
      reporter?.step(path);
      for (const entry of os.fs.list(path)) await walk(entry.path);
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
  content.innerHTML = `
    <section class="text-app">
      <textarea spellcheck="false" disabled>Loading...</textarea>
      <footer>
        <span>${escapeHtml(node?.path || "")}</span>
        <button type="button" disabled>Save</button>
      </footer>
    </section>
  `;
  renderTextEditor(os, content, node, windowApi).catch((error) => {
    content.innerHTML = `
      <section class="text-app">
        <textarea spellcheck="false" disabled>${escapeHtml(error.message)}</textarea>
        <footer><span>${escapeHtml(error.message)}</span></footer>
      </section>
    `;
    windowApi.setTitle(`${node?.name || "TextEdit"} - load failed`);
  });
}

async function renderTextEditor(os, content, node, windowApi) {
  const isLocal = Boolean(node?.path && os.localMounts?.isMountedPath(node.path));
  const stat = isLocal ? await os.localMounts.stat(node.path) : os.fs.stat(node.path);
  const initialContent = node?.path
    ? (isLocal ? await os.localMounts.readFile(node.path) : os.fs.readFile(node.path))
    : node?.content || "";
  content.innerHTML = `
    <section class="text-app">
      <textarea spellcheck="false">${escapeHtml(initialContent)}</textarea>
      <footer>
        <span>${escapeHtml(node?.path || "")} · ${escapeHtml(stat?.permissions || "")}</span>
        <button type="button">Save</button>
      </footer>
    </section>
  `;
  const textarea = content.querySelector("textarea");
  const footer = content.querySelector("footer span");
  const save = async () => {
    try {
      if (isLocal) {
        await os.localMounts.writeFile(node.path, textarea.value);
        node.content = textarea.value;
      } else {
        os.fs.writeFile(node.path, textarea.value);
        node.content = os.fs.readFile(node.path);
        await os.storage?.flush?.();
      }
      const nextStat = isLocal ? await os.localMounts.stat(node.path) : os.fs.stat(node.path);
      footer.textContent = `${node.path} · ${nextStat?.permissions || ""} · saved ${shortTime(nextStat?.modified)}`;
      windowApi.setTitle(`${node.name} - saved`);
    } catch (error) {
      footer.textContent = error.message;
      windowApi.setTitle(`${node.name} - save failed`);
    }
  };
  content.querySelector("button").addEventListener("click", save);
  textarea.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
    }
  });
}

function renderBrowser(os, content, context = {}, windowApi) {
  const client = new BrowserCompanionClient();
  const restoredState = windowApi?.getState?.("browser");
  const state = createBrowserSessionState(context, restoredState);
  content.innerHTML = `
    <section class="browser-app">
      <form class="browser-toolbar">
        <button type="button" data-browser-action="back">Back</button>
        <button type="button" data-browser-action="forward">Forward</button>
        <button type="button" data-browser-action="reload">Reload</button>
        <input name="address" autocomplete="off" spellcheck="false" value="${escapeAttr(state.address)}" />
        <button type="submit">Go</button>
        <button type="button" data-browser-action="connect">Connect</button>
      </form>
      <div class="browser-status">
        <span data-browser-status>${escapeHtml(state.status)}</span>
        <code>${escapeHtml(state.companionUrl)}</code>
      </div>
      <div class="browser-viewport" tabindex="0" data-browser-viewport>
        <div class="browser-placeholder">
          <p class="dos-kicker">Local companion</p>
          <h2>Start browserd to open real URLs.</h2>
          <pre>npm run browserd</pre>
        </div>
        <img data-browser-frame alt="Remote browser frame" decoding="async" hidden />
        <iframe data-browser-local title="DindbOS HTML document" sandbox="${escapeAttr(BROWSER_LOCAL_HTML_SANDBOX)}" hidden></iframe>
      </div>
    </section>
  `;
  const refs = {
    form: content.querySelector(".browser-toolbar"),
    address: content.querySelector("[name='address']"),
    status: content.querySelector("[data-browser-status]"),
    viewport: content.querySelector("[data-browser-viewport]"),
    frame: content.querySelector("[data-browser-frame]"),
    local: content.querySelector("[data-browser-local]"),
    placeholder: content.querySelector(".browser-placeholder"),
    connect: content.querySelector("[data-browser-action='connect']"),
  };
  let resizeTimer = null;
  let frameRaf = 0;
  let pendingFrameSrc = "";
  let wheelTimer = null;
  let wheelDeltaX = 0;
  let wheelDeltaY = 0;
  let wheelPoint = { x: 0, y: 0 };
  const lastResize = { width: 0, height: 0, scale: 0 };
  const persistState = () => windowApi?.setState?.("browser", browserSessionSnapshot(state));
  const setStatus = (status) => {
    const nextStatus = String(status || "");
    if (state.status === nextStatus) return;
    state.status = nextStatus;
    refs.status.textContent = nextStatus;
    persistState();
    os.processes.logSelf?.(`browser ${nextStatus}`);
  };
  const showFrame = (src) => {
    state.mode = "companion";
    state.frame = src;
    refs.placeholder.hidden = true;
    refs.local.hidden = true;
    refs.frame.hidden = false;
    refs.frame.src = src;
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
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const scale = globalThis.devicePixelRatio || 1;
      const unchanged = Math.abs(width - lastResize.width) < 2
        && Math.abs(height - lastResize.height) < 2
        && Math.abs(scale - lastResize.scale) < 0.01;
      if (unchanged) return;
      lastResize.width = width;
      lastResize.height = height;
      lastResize.scale = scale;
      client.resize(width, height, scale).catch((error) => setStatus(error.message));
    }, 120);
  };
  client.on("status", (message) => {
    if (message.url) {
      state.address = message.url;
      refs.address.value = message.url;
    }
    if (message.title) {
      state.title = message.title;
      windowApi.setTitle(`${message.title} - Browser`);
    }
    if (message.reconnect) refs.connect.textContent = "Reconnect";
    else if (message.status === "connected") refs.connect.textContent = "Connect";
    const status = [message.status, message.url].filter(Boolean).join(" ");
    setStatus(message.message || status || "browserd connected");
    persistState();
  });
  client.on("frame", (message) => {
    if (!message.data?.startsWith("data:image/")) {
      setStatus("browserd frame missing image data");
      return;
    }
    if (message.url) {
      state.address = message.url;
      refs.address.value = message.url;
    }
    if (message.title) {
      state.title = message.title;
      windowApi.setTitle(`${message.title} - Browser`);
    }
    setStatus(message.url ? `ready ${message.url}` : "ready");
    queueFrame(message.data);
  });
  client.on("error", (error) => setStatus(error.message));
  refs.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await openAddress(refs.address.value);
  });
  refs.form.querySelectorAll("[data-browser-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.browserAction;
      try {
        if (action === "connect") await connectCompanion();
        if (action === "back") await client.back();
        if (action === "forward") await client.forward();
        if (action === "reload") {
          if (state.mode === "local") await openLocalPath(refs.address.value);
          else await client.reload();
        }
      } catch (error) {
        setStatus(error.message);
      }
    });
  });
  refs.viewport.addEventListener("click", (event) => {
    if (!client.connected || refs.frame.hidden) return;
    const point = browserViewportPoint(refs.frame, event);
    client.click(point.x, point.y).catch((error) => setStatus(error.message));
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
      client.scroll(deltaX, deltaY, point.x, point.y).catch((error) => setStatus(error.message));
    }, 33);
  }, { passive: false });
  refs.viewport.addEventListener("keydown", async (event) => {
    if (!client.connected || refs.frame.hidden) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
      event.preventDefault();
      try {
        const result = await pasteClipboardText(
          () => globalThis.navigator?.clipboard?.readText?.(),
          (text) => client.paste(text),
        );
        setStatus(result.pasted ? `pasted ${result.bytes} clipboard bytes` : "clipboard empty");
      } catch (error) {
        setStatus(`paste blocked: ${error.message}`);
      }
      return;
    }
    const payload = browserKeyEventPayload(event);
    if (!payload) return;
    event.preventDefault();
    client.key(payload).catch((error) => setStatus(error.message));
  });
  new ResizeObserver(resizeRemote).observe(refs.viewport);

  async function connectCompanion() {
    if (!client.connected) {
      setStatus("connecting browserd");
      await client.reconnect();
      refs.connect.textContent = "Connect";
      resizeRemote();
    }
    return client;
  }

  async function openAddress(value) {
    const address = String(value || "").trim();
    if (!address) return;
    state.address = address;
    refs.address.value = address;
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
    if (!node || node.mime !== "text/html") throw new Error(`Browser can only open HTML files: ${path}`);
    const html = os.localMounts?.isMountedPath(normalized)
      ? await os.localMounts.readFile(normalized)
      : os.fs.readFile(normalized);
    refs.placeholder.hidden = true;
    refs.frame.hidden = true;
    refs.local.hidden = false;
    refs.local.srcdoc = html;
    state.mode = "local";
    state.address = normalized;
    state.localHtml = html;
    state.title = node.name;
    refs.address.value = normalized;
    setStatus(`local document ${normalized}`);
    windowApi.setTitle(`${node.name} - Browser`);
    persistState();
  }

  restoreBrowserView();

  if (restoredState?.address) {
    persistState();
  } else if (context.node?.path && context.node.mime === "text/html") {
    openLocalPath(context.node.path).catch((error) => setStatus(error.message));
  } else if (state.address) {
    openAddress(state.address).catch((error) => setStatus(error.message));
  }

  function restoreBrowserView() {
    refs.status.textContent = state.status;
    refs.address.value = state.address;
    if (state.title && state.title !== "Browser") windowApi.setTitle(`${state.title} - Browser`);
    if (state.mode === "local" && state.localHtml) {
      refs.placeholder.hidden = true;
      refs.frame.hidden = true;
      refs.local.hidden = false;
      refs.local.srcdoc = state.localHtml;
      return;
    }
    if (state.mode === "companion" && state.frame) showFrame(state.frame);
  }
}

function initialBrowserAddress(context = {}) {
  if (context.url) return context.url;
  if (context.node?.path) return context.node.path;
  return "";
}

export function createBrowserSessionState(context = {}, restored = null) {
  const state = {
    mode: "idle",
    status: "browserd not connected",
    address: initialBrowserAddress(context),
    title: "Browser",
    frame: "",
    localHtml: "",
    companionUrl: "ws://127.0.0.1:8787/browser",
  };
  if (!restored || typeof restored !== "object") return state;
  return {
    ...state,
    mode: sanitizeBrowserMode(restored.mode) || state.mode,
    status: String(restored.status || state.status),
    address: String(restored.address || state.address),
    title: String(restored.title || state.title),
    frame: String(restored.frame || ""),
    localHtml: String(restored.localHtml || ""),
  };
}

export function browserSessionSnapshot(state = {}) {
  return {
    mode: sanitizeBrowserMode(state.mode) || "idle",
    status: String(state.status || ""),
    address: String(state.address || ""),
    title: String(state.title || "Browser"),
    frame: String(state.frame || ""),
    localHtml: String(state.localHtml || ""),
  };
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

function browserKeyEventPayload(event) {
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

function renderViewer(os, content, node) {
  content.innerHTML = `
    <section class="viewer-app">
      <p class="dos-kicker">${escapeHtml(node?.mime || "document")}</p>
      <h2>${escapeHtml(node?.name || "Document")}</h2>
      <pre>Loading preview...</pre>
    </section>
  `;
  renderViewerBytes(os, content, node).catch((error) => {
    content.innerHTML = `
      <section class="viewer-app">
        <p class="dos-kicker">Preview error</p>
        <h2>${escapeHtml(node?.name || "Document")}</h2>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
  });
}

const VIEWER_TEXT_PREVIEW_LIMIT = 256 * 1024;

async function renderViewerBytes(os, content, node) {
  const mime = node?.mime || "application/octet-stream";
  const bytes = node?.path
    ? await readNodeBytes(os, node.path)
    : null;
  cleanupViewerObjectUrl(content);
  const usesObjectUrl = bytes && (mime.startsWith("image/") || mime === "application/pdf");
  const url = usesObjectUrl ? URL.createObjectURL(new Blob([bytes], { type: mime })) : "";
  if (url && content.dataset) content.dataset.viewerObjectUrl = url;
  const previewState = bytes
    ? viewerPreviewForBytes(bytes, mime)
    : { preview: node?.content ? fileContentPreview(node.content) : "Preview adapter pending.", status: "" };
  content.innerHTML = viewerMarkup({
    mime,
    name: node?.name || "Document",
    path: node?.path || "",
    preview: previewState.preview,
    url,
    status: previewState.status,
  });
  wireViewerToolbar(os, content, node, bytes || new Uint8Array(), mime);
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

export function viewerMarkup({ mime, name, path = "", preview, url, status = "" }) {
  const browserDisabled = mime === "text/html" && path ? "" : "disabled";
  const statusText = status || (path ? path : "No file path");
  return `
    <section class="viewer-app">
      <header class="viewer-header">
        <div>
          <p class="dos-kicker">${escapeHtml(mime)}</p>
          <h2>${escapeHtml(name || "Document")}</h2>
        </div>
        <div class="viewer-toolbar" role="toolbar" aria-label="Viewer controls">
          <button type="button" data-viewer-action="zoom-out">-</button>
          <button type="button" data-viewer-action="zoom-reset">100%</button>
          <button type="button" data-viewer-action="zoom-in">+</button>
          <button type="button" data-viewer-action="page-prev" disabled>Prev</button>
          <button type="button" data-viewer-action="page-next" disabled>Next</button>
          <button type="button" data-viewer-action="open-browser" ${browserDisabled}>Browser</button>
          <button type="button" data-viewer-action="export">Export</button>
          <button type="button" data-viewer-action="copy-path" ${path ? "" : "disabled"}>Copy path</button>
        </div>
      </header>
      <p class="viewer-status" data-viewer-status>${escapeHtml(statusText)}</p>
      <div class="viewer-preview" data-viewer-preview style="--viewer-zoom: 1">
        ${mime.startsWith("image/") && url ? `<img data-viewer-object src="${escapeAttr(url)}" alt="${escapeAttr(name || "Image")}" />` : ""}
        ${mime === "application/pdf" && url ? `<iframe data-viewer-object src="${escapeAttr(url)}" title="${escapeAttr(name || "PDF")}"></iframe>` : ""}
        ${mime === "application/x-dindbos-deck" ? `<iframe class="viewer-deck" sandbox="" srcdoc="${escapeAttr(preview)}" title="${escapeAttr(name || "Deck")}"></iframe>` : ""}
        ${mime === "text/markdown" ? `<article class="viewer-markdown">${renderMarkdownPreview(preview)}</article>` : ""}
        ${!mime.startsWith("image/") && mime !== "application/pdf" && mime !== "application/x-dindbos-deck" && mime !== "text/markdown" ? `<pre>${escapeHtml(preview)}</pre>` : ""}
      </div>
    </section>
  `;
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
      if (action === "export") {
        exportViewerBytes(node?.name || "document", bytes, mime);
        setStatus(`Exported ${node?.name || "document"}`);
      }
    });
  });
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
  const shell = new ShellSession(os);
  content.innerHTML = `
    <section class="terminal-app">
      <pre></pre>
      <form>
        <span data-prompt>$</span>
        <input autocomplete="off" spellcheck="false" autofocus />
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
    output.textContent += `${line}\n`;
    output.scrollTop = output.scrollHeight;
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
    const allProcesses = safeRead(() => os.processes.list(), []);
    const processes = filterAndSortActivityProcesses(allProcesses, view);
    if (!processes.some((process) => process.pid === selectedPid)) selectedPid = processes[0]?.pid || null;
    const selected = selectedPid ? processes.find((process) => process.pid === selectedPid) : null;
    const processLog = selected ? safeRead(() => os.processes.log(selected.pid), "") : "";
    content.innerHTML = `
      <section class="activity-app">
        <header>
          <div>
            <p class="dos-kicker">Runtime processes</p>
            <h2>Activity Monitor</h2>
          </div>
          <div class="activity-summary">
            <span>${allProcesses.length} running</span>
            <span>${processes.length} visible</span>
            <span>${formatBytes(allProcesses.reduce((total, process) => total + Number(process.runtimeBytes || 0), 0))} runtime</span>
            <span>${formatActivityScore(allProcesses.reduce((total, process) => total + Number(process.activityScore || 0), 0))} activity</span>
          </div>
        </header>
        <div class="activity-controls">
          <input data-activity-filter autocomplete="off" spellcheck="false" placeholder="Filter app or state" value="${escapeAttr(view.query)}" />
          <select data-activity-state aria-label="State filter">
            ${activityStateOptions(allProcesses, view.state)}
          </select>
          <select data-activity-sort aria-label="Sort processes">
            ${activitySortOptions(view.sort)}
          </select>
          <button type="button" data-activity-direction="${escapeAttr(view.direction)}">${view.direction === "asc" ? "Asc" : "Desc"}</button>
        </div>
        <div class="activity-grid">
          <div class="activity-table" role="table" aria-label="Processes">
            <div class="activity-row activity-row-head" role="row">
              <span>PID</span>
              <span>App</span>
              <span>State</span>
              <span>Uptime</span>
              <span>Activity</span>
              <span>Runtime</span>
            </div>
            ${processes.map((process) => `
              <button type="button" class="activity-row ${process.pid === selectedPid ? "is-selected" : ""}" data-pid="${process.pid}" role="row">
                <span>${process.pid}</span>
                <span>${escapeHtml(process.appId)}</span>
                <span>${escapeHtml(process.state)}</span>
                <span>${escapeHtml(formatDuration(process.uptimeMs))}</span>
                <span>${escapeHtml(formatActivityScore(process.activityScore))}</span>
                <span>${escapeHtml(formatBytes(process.runtimeBytes))}</span>
              </button>
            `).join("") || `<p class="activity-empty">No running processes.</p>`}
          </div>
          <aside class="activity-detail">
            ${selected ? renderActivityDetail(selected, processLog) : "<p>No process selected.</p>"}
          </aside>
        </div>
      </section>
    `;
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
  };
  draw();
  refreshTimer = window.setInterval(draw, 1000);
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
        process.user,
        process.windowId,
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

function renderActivityDetail(process, processLog) {
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
      <div><dt>Window</dt><dd>${escapeHtml(process.windowId || "-")}</dd></div>
      <div><dt>Started</dt><dd>${escapeHtml(shortTime(process.startedAt))}</dd></div>
      <div><dt>Active</dt><dd>${escapeHtml(shortTime(process.lastActiveAt))}</dd></div>
      <div><dt>Uptime</dt><dd>${escapeHtml(formatDuration(process.uptimeMs))}</dd></div>
      <div><dt>Activity</dt><dd>${escapeHtml(formatActivityScore(process.activityScore))} · ${process.activitySamples || 0} samples</dd></div>
      <div><dt>Runtime</dt><dd>${escapeHtml(formatBytes(process.runtimeBytes))} · ${process.logLines || 0} logs</dd></div>
    </dl>
    <pre>${escapeHtml(processLog || "No process log yet.")}</pre>
  `;
}

function formatActivityScore(value) {
  const score = Number(value || 0);
  return `${score.toFixed(score % 1 ? 1 : 0)}/min`;
}

function renderCalculator(content) {
  content.innerHTML = `
    <section class="calculator-app">
      <output>0</output>
      <div>
        ${["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "=", "+"].map((key) => `
          <button type="button" data-key="${key}">${key}</button>
        `).join("")}
      </div>
      <button type="button" data-clear>Clear</button>
    </section>
  `;
  let expression = "";
  const output = content.querySelector("output");
  content.querySelectorAll("[data-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.key;
      if (key === "=") {
        expression = safeCalculate(expression);
      } else {
        expression += key;
      }
      output.textContent = expression || "0";
    });
  });
  content.querySelector("[data-clear]").addEventListener("click", () => {
    expression = "";
    output.textContent = "0";
  });
}

function renderSettings(os, content) {
  content.innerHTML = `
    <section class="settings-app">
      <p class="dos-kicker">System</p>
      <h2>DindbOS.js Runtime</h2>
      <p class="settings-muted">Loading runtime status...</p>
    </section>
  `;
  renderSettingsContent(os, content).catch((error) => {
    content.innerHTML = `
      <section class="settings-app">
        <p class="dos-kicker">System</p>
        <h2>DindbOS.js Runtime</h2>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
  });
}

async function renderSettingsContent(os, content) {
  const processes = safeRead(() => os.processes.list(), []);
  const storageStatus = safeRead(() => os.storage.status(), { enabled: false, persisted: false, bytes: 0 });
  const storage = await safeReadAsync(() => os.storage.estimate(), storageStatus);
  const packages = safeRead(() => os.packages.list(), []);
  const mounts = await safeReadAsync(() => os.localMounts.status(), []);
  content.innerHTML = `
    <section class="settings-app">
      <p class="dos-kicker">System</p>
      <h2>DindbOS.js Runtime</h2>
      <dl>
        <div><dt>User</dt><dd>${escapeHtml(os.session.user || "guest")}</dd></div>
        <div><dt>Home</dt><dd>${escapeHtml(os.session.home || "/home/guest")}</dd></div>
        <div><dt>Apps</dt><dd>${os.apps.list().length}</dd></div>
        <div><dt>Packages</dt><dd>${packages.length}</dd></div>
        <div><dt>Processes</dt><dd>${processes.length}</dd></div>
        <div><dt>Storage</dt><dd>${renderSettingsStorageStatus(storage)}</dd></div>
        <div><dt>Desktop</dt><dd>${escapeHtml(os.fs.join(os.session.home || "/home/guest", "Desktop"))}</dd></div>
        <div><dt>Local Mounts</dt><dd>${mounts.length ? `${mounts.length} folder${mounts.length === 1 ? "" : "s"}` : "none"}</dd></div>
      </dl>
      <section class="settings-panel">
        <header>
          <h3>Save Engine</h3>
          <button type="button" data-settings-action="flush-storage">Flush now</button>
        </header>
        <p>${escapeHtml(formatStorageState(storage))}</p>
      </section>
      <section class="settings-panel">
        <header>
          <h3>Local Folders</h3>
          <button type="button" data-settings-action="restore-mounts">Restore saved mounts</button>
        </header>
        ${renderSettingsMounts(mounts)}
      </section>
    </section>
  `;
  content.querySelectorAll("[data-settings-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (button.dataset.settingsAction === "flush-storage") await os.storage.flush();
        if (button.dataset.settingsAction === "restore-mounts") await os.localMounts.restorePersistedMounts({ request: true });
        if (button.dataset.settingsAction === "remount") await os.localMounts.requestAccess(button.dataset.mountPath);
        if (button.dataset.settingsAction === "forget") await os.localMounts.forgetMount(button.dataset.mountPath);
      } finally {
        renderSettings(os, content);
      }
    });
  });
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

function safeCalculate(expression) {
  if (!/^[\d+\-*/. ()]+$/.test(expression)) return "Error";
  try {
    return String(Function(`"use strict"; return (${expression})`)());
  } catch {
    return "Error";
  }
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
