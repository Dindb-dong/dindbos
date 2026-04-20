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
    render: ({ os: runtime, content, context, window }) => renderFiles(runtime, content, context.path || "/", window),
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
    accepts: ["text/plain", "text/markdown"],
    width: 720,
    height: 520,
    render: ({ os: runtime, content, context, window }) => renderText(runtime, content, context.node, window),
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
    const entries = os.fs.list(nextPath);
    windowApi.setTitle(`Files - ${nextPath}`);
    content.innerHTML = `
      <section class="files-app">
        <div class="pathbar">${escapeHtml(nextPath)}</div>
        <div class="file-grid">
          ${entries.map((entry) => `
            <button type="button" data-path="${escapeAttr(entry.path)}" class="file-tile" data-icon="${escapeAttr(entry.icon || entry.type)}">
              <span class="dos-icon-art"></span>
              <strong>${escapeHtml(entry.name)}</strong>
              <small>${escapeHtml(entry.type)}</small>
            </button>
          `).join("")}
        </div>
      </section>
    `;
    content.querySelectorAll("[data-path]").forEach((button) => {
      button.addEventListener("click", () => os.openPath(button.dataset.path));
    });
  };
  draw(path);
}

function renderText(os, content, node, windowApi) {
  content.innerHTML = `
    <section class="text-app">
      <textarea spellcheck="false">${escapeHtml(node?.content || "")}</textarea>
      <footer>
        <span>${escapeHtml(node?.path || "")}</span>
        <button type="button">Save</button>
      </footer>
    </section>
  `;
  content.querySelector("button").addEventListener("click", () => {
    os.fs.writeFile(node.path, content.querySelector("textarea").value);
    windowApi.setTitle(`${node.name} - saved`);
  });
}

function renderTerminal(os, content) {
  let cwd = "/";
  content.innerHTML = `
    <section class="terminal-app">
      <pre></pre>
      <form>
        <span>$</span>
        <input autocomplete="off" spellcheck="false" autofocus />
      </form>
    </section>
  `;
  const output = content.querySelector("pre");
  const input = content.querySelector("input");
  const print = (line = "") => {
    output.textContent += `${line}\n`;
    output.scrollTop = output.scrollHeight;
  };
  const run = (commandLine) => {
    const [command, ...args] = commandLine.trim().split(/\s+/).filter(Boolean);
    print(`$ ${commandLine}`);
    if (!command) return;
    if (command === "help") print("help, ls, cd, pwd, open, cat, apps, clear");
    else if (command === "pwd") print(cwd);
    else if (command === "ls") os.fs.list(args[0] || cwd).forEach((node) => print(node.name));
    else if (command === "cd") cwd = os.fs.resolve(args[0] || "/")?.path || cwd;
    else if (command === "open") os.openPath(args[0] || cwd);
    else if (command === "cat") print(os.fs.readFile(args[0] || cwd));
    else if (command === "apps") os.apps.list().forEach((app) => print(`${app.id} - ${app.name}`));
    else if (command === "clear") output.textContent = "";
    else print(`command not found: ${command}`);
  };
  print("DindbOS.js terminal. Type help.");
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
        <div><dt>Apps</dt><dd>${os.apps.list().length}</dd></div>
        <div><dt>Desktop</dt><dd>/Desktop</dd></div>
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
