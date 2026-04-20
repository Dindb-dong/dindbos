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
      capabilities: ["app.launch"],
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
      capabilities: ["app.launch", "process.read", "process.manage", "storage.read", "storage.manage"],
      fileSystem: { read: ["/"], write: ["/home/guest", "/mnt/portfolio", "/tmp"] },
    },
    render: ({ os: runtime, content }) => renderTerminal(runtime, content),
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
      fileSystem: { read: ["/"], write: ["/home/guest", "/mnt/portfolio", "/tmp"] },
    },
    render: ({ os: runtime, content, context, window }) => renderText(runtime, content, context.node, window),
  });

  os.registerApp({
    id: "viewer",
    name: "Viewer",
    title: ({ node }) => node?.name || "Viewer",
    icon: "pdf",
    accepts: ["application/pdf", "text/html"],
    width: 820,
    height: 560,
    manifest: {
      fileSystem: { read: ["/"], write: [] },
    },
    render: ({ content, context }) => renderViewer(content, context.node),
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
      capabilities: ["process.read", "storage.read"],
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
  let clickTimer = null;

  const draw = (nextPath, nextSelectedPath = null) => {
    currentPath = os.fs.normalize(nextPath);
    if (!os.fs.resolve(currentPath)) currentPath = os.session.home || "/";
    selectedPath = nextSelectedPath ? os.fs.normalize(nextSelectedPath) : currentPath;
    const currentStat = os.fs.stat(currentPath);
    windowApi.setTitle(`Files - ${currentPath}`);
    const columns = buildFileColumns(os, currentPath, selectedPath);
    const selected = os.fs.lstat(selectedPath) || os.fs.stat(selectedPath);
    content.innerHTML = `
      <section class="files-app">
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
            <code>${escapeHtml(currentPath)}</code>
            <span>${escapeHtml(currentStat?.permissions || "")}</span>
          </div>
          <div class="files-toolbar">
            <button type="button" data-action="new-folder">New Folder</button>
            <button type="button" data-action="new-file">New File</button>
            <button type="button" data-action="delete">Delete</button>
          </div>
          <div class="files-column-view" role="tree">
            ${columns.map((column) => `
              <div class="files-column" data-column="${escapeAttr(column.path)}">
                ${column.entries.map((entry) => {
                  const stat = os.fs.lstat(entry.path) || os.fs.stat(entry.path);
                  const resolved = os.fs.resolveNode(entry);
                  const isSelected = entry.path === column.selectedPath;
                  return `
                    <button
                      type="button"
                      class="files-row ${isSelected ? "is-selected" : ""}"
                      data-path="${escapeAttr(entry.path)}"
                      data-openable="${resolved.type === "directory" ? "false" : "true"}"
                      data-icon="${escapeAttr(entry.icon || resolved.icon || resolved.type)}"
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
            <span>${os.fs.list(currentPath).length} items</span>
            <span>${escapeHtml(currentPath)}</span>
          </div>
        </div>
        <aside class="files-inspector">
          ${selected ? renderInspector(selected) : "<p>No selection</p>"}
        </aside>
      </section>
    `;
    content.querySelectorAll("[data-nav]").forEach((button) => {
      button.addEventListener("click", () => draw(button.dataset.nav));
    });
    content.querySelectorAll("[data-path]").forEach((button) => {
      button.addEventListener("click", () => {
        clearTimeout(clickTimer);
        clickTimer = window.setTimeout(() => {
          const node = os.fs.resolve(button.dataset.path) || os.fs.lstat(button.dataset.path);
          const resolved = os.fs.resolveNode(node);
          if (resolved.type === "directory") {
            draw(button.dataset.path, button.dataset.path);
            return;
          }
          draw(currentPath, button.dataset.path);
        }, 180);
      });
      button.addEventListener("dblclick", () => {
        clearTimeout(clickTimer);
        os.openPath(button.dataset.path);
      });
    });
    content.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        try {
          handleFileAction(os, currentPath, selectedPath, button.dataset.action);
          draw(currentPath, currentPath);
        } catch (error) {
          windowApi.setTitle(`Files - ${error.message}`);
        }
      });
    });
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

function isWithinPath(path, rootPath) {
  const normalizedPath = rootPath === "/" ? path : path.replace(/\/$/, "");
  const normalizedRoot = rootPath.replace(/\/$/, "") || "/";
  if (normalizedRoot === "/") return normalizedPath === "/";
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function rowKind(os, entry, stat) {
  if (os.fs.isLink(entry)) return `alias -> ${entry.target}`;
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
      <div><dt>Owner</dt><dd>${escapeHtml(`${stat.owner}:${stat.group}`)}</dd></div>
      <div><dt>Size</dt><dd>${escapeHtml(formatBytes(stat.size))}</dd></div>
      <div><dt>Modified</dt><dd>${escapeHtml(shortTime(stat.modified))}</dd></div>
    </dl>
  `;
}

function handleFileAction(os, currentPath, selectedPath, action) {
  if (action === "new-folder") {
    os.fs.createDirectory(uniquePath(os, currentPath, "untitled-folder"));
    return;
  }
  if (action === "new-file") {
    os.fs.createFile(uniquePath(os, currentPath, "untitled.txt"), "/", { content: "" });
    return;
  }
  if (action === "delete") {
    if (selectedPath === "/" || selectedPath === currentPath) throw new Error("Select an item to delete");
    os.fs.remove(selectedPath, "/", { recursive: true });
  }
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
  const stat = os.fs.stat(node.path);
  content.innerHTML = `
    <section class="text-app">
      <textarea spellcheck="false">${escapeHtml(node?.content || "")}</textarea>
      <footer>
        <span>${escapeHtml(node?.path || "")} · ${escapeHtml(stat?.permissions || "")}</span>
        <button type="button">Save</button>
      </footer>
    </section>
  `;
  content.querySelector("button").addEventListener("click", () => {
    os.fs.writeFile(node.path, content.querySelector("textarea").value);
    windowApi.setTitle(`${node.name} - saved`);
  });
}

function renderViewer(content, node) {
  content.innerHTML = `
    <section class="viewer-app">
      <p class="dos-kicker">${escapeHtml(node?.mime || "document")}</p>
      <h2>${escapeHtml(node?.name || "Document")}</h2>
      <pre>${escapeHtml(node?.content || "Preview adapter pending.")}</pre>
    </section>
  `;
}

function renderTerminal(os, content) {
  let cwd = os.session.home || "/";
  const history = [];
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
    prompt.textContent = `${cwd} $`;
  };
  const print = (line = "") => {
    output.textContent += `${line}\n`;
    output.scrollTop = output.scrollHeight;
  };
  const run = (commandLine) => {
    const tokens = tokenizeCommand(commandLine);
    const [command, ...args] = tokens;
    print(`${cwd} $ ${commandLine}`);
    if (!command) return;
    history.push(commandLine.trim());
    try {
      if (command === "help") print([
        "help, history, clear",
        "pwd, cd [path], ls [-la] [path], tree [path], find [path] [name]",
        "cat [path], grep <text> <file>, stat [path], readlink [path]",
        "mkdir [-p] <path>, touch <path>, rm [-r] <path>, cp [-r] <src> <dest>, mv <src> <dest>",
        "echo <text>, echo <text> > <file>, echo <text> >> <file>",
        "open [path], apps, manifest [app], ps, kill <pid>, storage, resetfs",
        "whoami, id, uname, neofetch, date",
      ].join("\n"));
      else if (command === "whoami") print(os.session.user || "guest");
      else if (command === "id") print(`uid=${os.session.user || "guest"} gid=${(os.session.groups || ["users"]).join(",")}`);
      else if (command === "uname") print("DindbOS.js browser-runtime 0.1.0");
      else if (command === "date") print(new Date().toString());
      else if (command === "history") history.forEach((entry, index) => print(`${String(index + 1).padStart(4)}  ${entry}`));
      else if (command === "neofetch") print([
        "DindbOS.js",
        `User: ${os.session.user || "guest"}`,
        `Home: ${os.session.home || "/home/guest"}`,
        `Apps: ${os.apps.list().length}`,
        "Shell: /bin/dindbsh",
      ].join("\n"));
      else if (command === "pwd") print(cwd);
      else if (command === "ls") runLs(os, cwd, args, print);
      else if (command === "tree") print(renderTree(os, args[0] || cwd, cwd));
      else if (command === "cd") {
        const next = os.fs.resolve(args[0] || os.session.home || "/", cwd);
        if (next?.type === "directory") cwd = next.path;
        else print(`cd: no such directory: ${args[0] || ""}`);
      }
      else if (command === "open") os.openPath(resolveTerminalPath(os, args[0] || cwd, cwd));
      else if (command === "cat") print(readTerminalFile(os, args[0] || cwd, cwd));
      else if (command === "grep") print(runGrep(os, cwd, args));
      else if (command === "stat") print(formatStat(os.fs.stat(args[0] || cwd, cwd)));
      else if (command === "readlink") print(os.fs.lstat(args[0] || cwd, cwd)?.target || "");
      else if (command === "mkdir") runMkdir(os, cwd, args);
      else if (command === "touch") runTouch(os, cwd, args);
      else if (command === "rm") runRm(os, cwd, args);
      else if (command === "cp") runCp(os, cwd, args);
      else if (command === "mv") runMv(os, cwd, args);
      else if (command === "echo") runEcho(os, cwd, args, print);
      else if (command === "find") print(runFind(os, cwd, args));
      else if (command === "apps") os.apps.list().forEach((app) => print(`${app.id} - ${app.name}`));
      else if (command === "manifest") print(formatManifest(os, args[0]));
      else if (command === "ps") print(os.processes.table());
      else if (command === "kill") print(runKill(os, args));
      else if (command === "storage") print(formatStorage(os.storage.status()));
      else if (command === "resetfs") {
        os.storage.resetFileSystem();
        print("persistent filesystem cleared; reloading");
        window.setTimeout(() => window.location.reload(), 250);
      }
      else if (command === "clear") output.textContent = "";
      else print(`command not found: ${command}`);
    } catch (error) {
      print(error.message);
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
  input.focus();
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
  const processes = safeRead(() => os.processes.list(), []);
  const storage = safeRead(() => os.storage.status(), { enabled: false, persisted: false, bytes: 0 });
  content.innerHTML = `
    <section class="settings-app">
      <p class="dos-kicker">System</p>
      <h2>DindbOS.js Runtime</h2>
      <dl>
        <div><dt>User</dt><dd>${escapeHtml(os.session.user || "guest")}</dd></div>
        <div><dt>Home</dt><dd>${escapeHtml(os.session.home || "/home/guest")}</dd></div>
        <div><dt>Apps</dt><dd>${os.apps.list().length}</dd></div>
        <div><dt>Processes</dt><dd>${processes.length}</dd></div>
        <div><dt>Storage</dt><dd>${storage.enabled ? "localStorage" : "memory"} · ${storage.persisted ? `${formatBytes(storage.bytes)} saved` : "not saved"}</dd></div>
        <div><dt>Desktop</dt><dd>${escapeHtml(os.fs.join(os.session.home || "/home/guest", "Desktop"))}</dd></div>
        <div><dt>Mounts</dt><dd>/, /mnt/portfolio</dd></div>
      </dl>
    </section>
  `;
}

function safeRead(reader, fallback) {
  try {
    return reader();
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

function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "";
  return date.toLocaleString();
}
