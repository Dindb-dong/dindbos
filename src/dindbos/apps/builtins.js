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
  const draw = (nextPath) => {
    const currentPath = os.fs.normalize(nextPath);
    const entries = os.fs.list(currentPath);
    const currentStat = os.fs.stat(currentPath);
    windowApi.setTitle(`Files - ${currentPath}`);
    content.innerHTML = `
      <section class="files-app">
        <div class="pathbar">
          <button type="button" data-nav="${escapeAttr(os.fs.dirname(currentPath))}">Up</button>
          <code>${escapeHtml(currentPath)}</code>
          <span>${escapeHtml(currentStat?.permissions || "")}</span>
        </div>
        <div class="file-grid">
          ${entries.map((entry) => `
            <button type="button" data-path="${escapeAttr(entry.path)}" class="file-tile" data-icon="${escapeAttr(entry.icon || entry.type)}">
              <span class="dos-icon-art"></span>
              <strong>${escapeHtml(entry.name)}</strong>
              <small>${escapeHtml(fileTileMeta(os, entry))}</small>
            </button>
          `).join("")}
        </div>
      </section>
    `;
    content.querySelectorAll("[data-nav]").forEach((button) => {
      button.addEventListener("click", () => draw(button.dataset.nav));
    });
    content.querySelectorAll("[data-path]").forEach((button) => {
      button.addEventListener("click", () => os.openPath(button.dataset.path));
    });
  };
  draw(path);
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
    const [command, ...args] = commandLine.trim().split(/\s+/).filter(Boolean);
    print(`${cwd} $ ${commandLine}`);
    if (!command) return;
    if (command === "help") print("help, ls [-l] [path], tree [path], cd [path], pwd, open [path], cat [path], stat [path], readlink [path], apps, whoami, uname, neofetch, clear");
    else if (command === "whoami") print(os.session.user || "guest");
    else if (command === "uname") print("DindbOS.js browser-runtime 0.1.0");
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
    else if (command === "stat") print(formatStat(os.fs.stat(args[0] || cwd, cwd)));
    else if (command === "readlink") print(os.fs.lstat(args[0] || cwd, cwd)?.target || "");
    else if (command === "apps") os.apps.list().forEach((app) => print(`${app.id} - ${app.name}`));
    else if (command === "clear") output.textContent = "";
    else print(`command not found: ${command}`);
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
  content.innerHTML = `
    <section class="settings-app">
      <p class="dos-kicker">System</p>
      <h2>DindbOS.js Runtime</h2>
      <dl>
        <div><dt>User</dt><dd>${escapeHtml(os.session.user || "guest")}</dd></div>
        <div><dt>Home</dt><dd>${escapeHtml(os.session.home || "/home/guest")}</dd></div>
        <div><dt>Apps</dt><dd>${os.apps.list().length}</dd></div>
        <div><dt>Desktop</dt><dd>${escapeHtml(os.fs.join(os.session.home || "/home/guest", "Desktop"))}</dd></div>
        <div><dt>Mounts</dt><dd>/, /mnt/portfolio</dd></div>
      </dl>
    </section>
  `;
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
