export const portfolioData = {
  name: "Kim Dong Wook Portfolio",
  summary: "A portfolio mounted as apps, files, and documents inside DindbOS.js.",
  projects: [
    {
      name: "Remote Browser",
      type: "System App",
      description: "A browser engine bridge for opening real URLs from inside the desktop runtime.",
    },
    {
      name: "AI Presentations",
      type: "Documents",
      description: "Research decks and project writeups opened through file associations.",
    },
    {
      name: "Portfolio Runtime",
      type: "DindbOS Demo",
      description: "A portfolio experience that demonstrates the OS instead of only imitating one.",
    },
  ],
};

export const demoFileSystem = directory("", [
  directory("bin", [
    command("cat", "Print file contents"),
    command("cd", "Change current directory"),
    command("clear", "Clear terminal output"),
    command("cp", "Copy files and directories"),
    command("date", "Print current date"),
    command("echo", "Print text or redirect it into files"),
    command("find", "Search the virtual filesystem by name"),
    command("grep", "Search inside text files"),
    command("help", "Show shell commands"),
    command("history", "Show shell command history"),
    command("kill", "Terminate a running DindbOS process"),
    command("ls", "List directory contents"),
    command("mkdir", "Create directories"),
    command("mount-local", "Mount a user-selected local folder"),
    command("mv", "Move or rename files"),
    command("node", "Run CommonJS JavaScript files"),
    command("npm", "Install pure JavaScript npm packages into node_modules"),
    command("open", "Open a file, folder, or app"),
    command("pkg", "Install, remove, and inspect DindbOS packages"),
    command("ps", "List running DindbOS processes"),
    command("pwd", "Print working directory"),
    command("rm", "Remove files or directories"),
    command("stat", "Show file metadata"),
    command("touch", "Create files or update timestamps"),
    command("tree", "Render a directory tree"),
    command("umount", "Unmount a local folder"),
  ]),
  directory("boot", [
    file("dindbos-kernel.md", "text/markdown", [
      "# dindbos-kernel",
      "",
      "DindbOS.js boots a browser-native desktop runtime.",
      "The kernel coordinates sessions, apps, windows, and virtual mounts.",
    ].join("\n")),
  ]),
  directory("dev", [
    device("null", "Null device"),
    device("tty0", "Primary browser terminal"),
    device("fb0", "Desktop compositor framebuffer"),
  ]),
  directory("etc", [
    file("hostname", "text/plain", "dindbos\n"),
    file("motd", "text/plain", "Welcome to DindbOS.js. Type help to explore.\n"),
    file("os-release", "text/plain", [
      'NAME="DindbOS.js"',
      'ID=dindbos',
      'PRETTY_NAME="DindbOS.js Web Desktop"',
      'VERSION_ID="0.1.0"',
      'HOME_URL="https://github.com/Dindb-dong/dindbos"',
      "",
    ].join("\n")),
    file("dindbos.conf", "text/plain", [
      "[shell]",
      "home=/home/guest",
      "desktop=/home/guest/Desktop",
      "",
      "[mounts]",
      "portfolio=/mnt/portfolio",
      "",
    ].join("\n")),
  ]),
  directory("home", [
    directory("guest", [
      directory("Desktop", [
        symlink("Portfolio.app", "/usr/share/applications/Portfolio.app", "portfolio"),
        symlink("Files.app", "/usr/share/applications/Files.app", "folder"),
        symlink("Browser.app", "/usr/share/applications/Browser.app", "browser"),
        symlink("Terminal.app", "/usr/share/applications/Terminal.app", "terminal"),
        symlink("Activity Monitor.app", "/usr/share/applications/Activity Monitor.app", "activity"),
        symlink("Calculator.app", "/usr/share/applications/Calculator.app", "calculator"),
        symlink("Settings.app", "/usr/share/applications/Settings.app", "settings"),
        symlink("Projects", "/mnt/portfolio/projects", "folder"),
        symlink("Presentations", "/mnt/portfolio/presentations", "folder"),
        symlink("README.md", "/home/guest/README.md", "text"),
      ], { owner: "guest", group: "users" }),
      directory("Documents", [
        file("todo.md", "text/markdown", [
          "# DindbOS roadmap",
          "",
          "- Mount legacy portfolio data",
          "- Add Browser.app adapter",
          "- Add PDF Viewer.app",
          "- Publish docs for app authors",
        ].join("\n")),
      ], { owner: "guest", group: "users" }),
      directory("Downloads", [], { owner: "guest", group: "users" }),
      directory(".Trash", [], { owner: "guest", group: "users" }),
      file("README.md", "text/markdown", [
        "# guest home",
        "",
        "This home directory contains the demo workspace.",
        "Desktop entries are symlinks into `/usr/share/applications` and `/mnt/portfolio`.",
      ].join("\n")),
      file(".profile", "text/plain", [
        "export USER=guest",
        "export HOME=/home/guest",
        "export SHELL=/bin/dindbsh",
        "",
      ].join("\n")),
    ], { owner: "guest", group: "users" }),
  ]),
  directory("lib", [
    directory("dindbos", [
      file("app-registry.md", "text/markdown", "# App Registry\n\nMaps app ids and MIME handlers to runtime launchers."),
      file("window-manager.md", "text/markdown", "# Window Manager\n\nOwns focus, z-index, resizing, minimize, and maximize behavior."),
      file("vfs.md", "text/markdown", "# Virtual File System\n\nNormalizes paths, follows symlinks, and exposes file metadata."),
    ]),
  ]),
  directory("mnt", [
    directory("portfolio", [
      directory("projects", [
        file("remote-browser.md", "text/markdown", "# Remote Browser\n\nA browser engine adapter for opening real websites inside DindbOS.js."),
        file("portfolio-runtime.md", "text/markdown", "# Portfolio Runtime\n\nThe demo portfolio is a mounted workspace inside DindbOS.js."),
        file("ai-presentations.md", "text/markdown", "# AI Presentations\n\nResearch decks and project writeups are mounted as files."),
      ], { owner: "guest", group: "users" }),
      directory("presentations", [
        file("clip-blip2-retrieval.html", "text/html", "<h1>CLIP + BLIP2 Retrieval</h1>\n<p>HTML deck mounting will be wired into Browser.app.</p>\n"),
        file("dueling-ddqn-yakemon-agent.pdf", "application/pdf", "PDF mount placeholder: Dueling DDQN Yakemon Agent"),
        file("qcnn.pdf", "application/pdf", "PDF mount placeholder: QCNN Quantum Convolution"),
      ], { owner: "guest", group: "users" }),
      file("portfolio.json", "application/json", JSON.stringify(portfolioData, null, 2)),
    ], { owner: "guest", group: "users" }),
  ]),
  directory("opt", [
    directory("dindbos", [
      file("README.md", "text/markdown", "# /opt/dindbos\n\nOptional runtime assets and demos live here."),
      directory("packages", [
        directory("hello-notes", [
          file("dindbos.app.json", "application/json", `${JSON.stringify({
            id: "hello-notes",
            name: "Hello Notes",
            version: "0.1.0",
            description: "A small packaged app installed from dindbos.app.json.",
            app: {
              id: "hello-notes",
              name: "Hello Notes",
              title: "Hello Notes.app",
              icon: "text",
              width: 560,
              height: 380,
              entry: "app.js",
              content: "# Hello Notes\n\nThis app was installed through the DindbOS package manager.",
            },
            dependencies: {
              npm: {
                "lodash-es": "^4.17.21",
              },
            },
            files: [
              {
                path: "app.js",
                mime: "text/javascript",
                content: [
                  "export function mount({ content, pkg }) {",
                  "  content.innerHTML = `<section class=\"package-app\"><p class=\"dos-kicker\">Package ${pkg.id}</p><h2>${pkg.name}</h2><p>Rendered from app.js.</p></section>`;",
                  "}",
                ].join("\n"),
              },
            ],
            permissions: {
              capabilities: [],
              fileSystem: {
                read: ["/opt/hello-notes"],
                write: [],
              },
            },
          }, null, 2)}\n`),
          file("app.js", "text/javascript", [
            "export function mount({ content, pkg }) {",
            "  content.innerHTML = `<section class=\"package-app\"><p class=\"dos-kicker\">Package ${pkg.id}</p><h2>${pkg.name}</h2><p>Rendered from app.js.</p></section>`;",
            "}",
          ].join("\n")),
          file("README.md", "text/markdown", "# Hello Notes package\n\nInstall with `pkg install /opt/dindbos/packages/hello-notes/dindbos.app.json`.\n"),
        ]),
        directory("api-lab", [
          file("dindbos.app.json", "application/json", `${JSON.stringify({
            id: "api-lab",
            name: "API Lab",
            version: "0.1.0",
            description: "A sample third-party app that exercises sandboxed runtime APIs.",
            app: {
              id: "api-lab",
              name: "API Lab",
              title: "API Lab.app",
              icon: "app",
              width: 620,
              height: 420,
              entry: "app.js",
            },
            files: [
              {
                path: "app.js",
                mime: "text/javascript",
                content: [
                  "export function mount({ content, os, pkg }) {",
                  "  const workspace = '/home/guest/DindbOS API Lab';",
                  "  if (!os.fs.exists(workspace)) os.fs.createDirectory(workspace);",
                  "  const reportPath = os.fs.join(workspace, 'report.txt');",
                  "  const launches = Number(os.state.get('launches', 0)) + 1;",
                  "  os.state.set('launches', launches);",
                  "  const process = os.processes.current();",
                  "  const info = os.syscall('package.info', { packageId: pkg.id });",
                  "  if (!info.ok) throw new Error(info.error.message);",
                  "  const report = 'package=' + pkg.id + '\\nprocess=' + process.pid + '\\nversion=' + info.value.version + '\\nlaunches=' + launches + '\\n';",
                  "  const write = os.syscall('fs.writeText', { path: reportPath, content: report });",
                  "  if (!write.ok) throw new Error(write.error.message);",
                  "  os.syscall('process.log', { message: `api-lab wrote ${reportPath}` });",
                  "  const read = os.syscall('fs.readText', { path: reportPath });",
                  "  if (!read.ok) throw new Error(read.error.message);",
                  "  content.innerHTML = '<main data-api-lab><h2>' + pkg.name + '</h2><p>' + read.value + '</p></main>';",
                  "}",
                ].join("\n"),
              },
            ],
            permissions: {
              capabilities: ["package.read"],
              fileSystem: {
                read: ["/opt/api-lab", "/home/guest/DindbOS API Lab"],
                write: ["/home/guest/DindbOS API Lab"],
              },
            },
          }, null, 2)}\n`),
          file("app.js", "text/javascript", [
            "export function mount({ content, os, pkg }) {",
            "  const workspace = '/home/guest/DindbOS API Lab';",
            "  if (!os.fs.exists(workspace)) os.fs.createDirectory(workspace);",
            "  const reportPath = os.fs.join(workspace, 'report.txt');",
            "  const launches = Number(os.state.get('launches', 0)) + 1;",
            "  os.state.set('launches', launches);",
            "  const process = os.processes.current();",
            "  const info = os.syscall('package.info', { packageId: pkg.id });",
            "  if (!info.ok) throw new Error(info.error.message);",
            "  const report = 'package=' + pkg.id + '\\nprocess=' + process.pid + '\\nversion=' + info.value.version + '\\nlaunches=' + launches + '\\n';",
            "  const write = os.syscall('fs.writeText', { path: reportPath, content: report });",
            "  if (!write.ok) throw new Error(write.error.message);",
            "  os.syscall('process.log', { message: `api-lab wrote ${reportPath}` });",
            "  const read = os.syscall('fs.readText', { path: reportPath });",
            "  if (!read.ok) throw new Error(read.error.message);",
            "  content.innerHTML = '<main data-api-lab><h2>' + pkg.name + '</h2><p>' + read.value + '</p></main>';",
            "}",
          ].join("\n")),
          file("README.md", "text/markdown", "# API Lab package\n\nInstall with `pkg install /opt/dindbos/packages/api-lab/dindbos.app.json`.\n"),
        ]),
        directory("paint-sample", [
          file("dindbos.app.json", "application/json", `${JSON.stringify({
            id: "paint-sample",
            name: "Paint Sample",
            version: "0.1.0",
            description: "A sample canvas app proving packaged visual tools can render inside DindbOS.",
            app: {
              id: "paint-sample",
              name: "Paint Sample",
              title: "Paint Sample.app",
              icon: "app",
              width: 640,
              height: 460,
              entry: "app.js",
            },
            files: [
              {
                path: "app.js",
                mime: "text/javascript",
                content: [
                  "export function mount({ content, pkg }) {",
                  "  content.innerHTML = '<main class=\"package-app\" data-sample-paint><p class=\"dos-kicker\">Package ' + pkg.id + '</p><h2>' + pkg.name + '</h2><canvas width=\"480\" height=\"260\" aria-label=\"Paint sample canvas\"></canvas><p>Canvas sample app rendered from /opt/paint-sample/app.js.</p></main>';",
                  "}",
                ].join("\n"),
              },
            ],
            permissions: {
              capabilities: [],
              fileSystem: {
                read: ["/opt/paint-sample"],
                write: [],
              },
            },
          }, null, 2)}\n`),
          file("app.js", "text/javascript", [
            "export function mount({ content, pkg }) {",
            "  content.innerHTML = '<main class=\"package-app\" data-sample-paint><p class=\"dos-kicker\">Package ' + pkg.id + '</p><h2>' + pkg.name + '</h2><canvas width=\"480\" height=\"260\" aria-label=\"Paint sample canvas\"></canvas><p>Canvas sample app rendered from /opt/paint-sample/app.js.</p></main>';",
            "}",
          ].join("\n")),
          file("README.md", "text/markdown", "# Paint Sample package\n\nInstall with `pkg install /opt/dindbos/packages/paint-sample/dindbos.app.json`.\n"),
        ]),
        directory("pdf-viewer-sample", [
          file("dindbos.app.json", "application/json", `${JSON.stringify({
            id: "pdf-viewer-sample",
            name: "PDF Viewer Sample",
            version: "0.1.0",
            description: "A sample file-viewer package that declares PDF association through the app manifest.",
            app: {
              id: "pdf-viewer-sample",
              name: "PDF Viewer Sample",
              title: "PDF Viewer Sample.app",
              icon: "pdf",
              width: 720,
              height: 520,
              accepts: ["application/pdf"],
              entry: "app.js",
            },
            files: [
              {
                path: "app.js",
                mime: "text/javascript",
                content: [
                  "export function mount({ content, pkg }) {",
                  "  content.innerHTML = '<main class=\"package-app\" data-sample-pdf-viewer><p class=\"dos-kicker\">Package ' + pkg.id + '</p><h2>' + pkg.name + '</h2><p>This sample declares application/pdf in dindbos.app.json so it can be used as a packaged file viewer.</p></main>';",
                  "}",
                ].join("\n"),
              },
            ],
            permissions: {
              capabilities: [],
              fileSystem: {
                read: ["/opt/pdf-viewer-sample"],
                write: [],
              },
            },
          }, null, 2)}\n`),
          file("app.js", "text/javascript", [
            "export function mount({ content, pkg }) {",
            "  content.innerHTML = '<main class=\"package-app\" data-sample-pdf-viewer><p class=\"dos-kicker\">Package ' + pkg.id + '</p><h2>' + pkg.name + '</h2><p>This sample declares application/pdf in dindbos.app.json so it can be used as a packaged file viewer.</p></main>';",
            "}",
          ].join("\n")),
          file("README.md", "text/markdown", "# PDF Viewer Sample package\n\nInstall with `pkg install /opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json`.\n"),
        ]),
      ]),
      directory("registry", [
        file("index.json", "application/json", `${JSON.stringify({
          name: "DindbOS Local Registry",
          packages: [
            {
              id: "hello-notes",
              name: "Hello Notes",
              version: "0.1.0",
              description: "Sample executable DindbOS package.",
              manifestUrl: "/opt/dindbos/packages/hello-notes/dindbos.app.json",
            },
            {
              id: "api-lab",
              name: "API Lab",
              version: "0.1.0",
              description: "Sample app proving sandboxed runtime APIs.",
              manifestUrl: "/opt/dindbos/packages/api-lab/dindbos.app.json",
            },
            {
              id: "paint-sample",
              name: "Paint Sample",
              version: "0.1.0",
              description: "Sample canvas app for packaged visual tools.",
              manifestUrl: "/opt/dindbos/packages/paint-sample/dindbos.app.json",
            },
            {
              id: "pdf-viewer-sample",
              name: "PDF Viewer Sample",
              version: "0.1.0",
              description: "Sample packaged PDF file viewer manifest.",
              manifestUrl: "/opt/dindbos/packages/pdf-viewer-sample/dindbos.app.json",
            },
          ],
        }, null, 2)}\n`),
      ]),
    ]),
  ]),
  directory("proc", [
    file("version", "text/plain", "DindbOS.js 0.1.0 browser-runtime\n"),
    file("mounts", "text/plain", [
      "rootfs / virtualfs rw 0 0",
      "portfolio /mnt/portfolio virtualfs rw 0 0",
      "",
    ].join("\n")),
  ]),
  directory("tmp", [], { permissions: "drwxrwxrwx", owner: "root", group: "root" }),
  directory("usr", [
    directory("bin", [
      symlink("cat", "/bin/cat", "terminal"),
      symlink("ls", "/bin/ls", "terminal"),
      symlink("mount-local", "/bin/mount-local", "terminal"),
      symlink("node", "/bin/node", "terminal"),
      symlink("npm", "/bin/npm", "terminal"),
      symlink("open", "/bin/open", "terminal"),
      symlink("pkg", "/bin/pkg", "terminal"),
      symlink("tree", "/bin/tree", "terminal"),
      symlink("umount", "/bin/umount", "terminal"),
    ]),
    directory("share", [
      directory("applications", [
        app("Portfolio.app", "portfolio", "portfolio"),
        app("Files.app", "files", "folder"),
        app("Browser.app", "browser", "browser"),
        app("Terminal.app", "terminal", "terminal"),
        app("Activity Monitor.app", "activity-monitor", "activity"),
        app("Calculator.app", "calculator", "calculator"),
        app("Settings.app", "settings", "settings"),
      ]),
      directory("doc", [
        symlink("dindbos", "/lib/dindbos", "folder"),
      ]),
    ]),
  ]),
  directory("var", [
    directory("lib", [
      directory("dindbos", [
        directory("packages", []),
      ]),
    ]),
    directory("log", [
      file("boot.log", "text/plain", [
        "[ok] mounted rootfs",
        "[ok] mounted /mnt/portfolio",
        "[ok] registered built-in apps",
        "[ok] started desktop shell",
        "",
      ].join("\n")),
      file("window-manager.log", "text/plain", "[ok] window manager ready\n"),
    ]),
  ]),
]);

function directory(name, children, options = {}) {
  return {
    name,
    type: "directory",
    icon: "folder",
    children,
    permissions: options.permissions || "drwxr-xr-x",
    owner: options.owner || "root",
    group: options.group || "root",
  };
}

function file(name, mime, content) {
  return {
    name,
    type: "file",
    mime,
    icon: iconForMime(mime),
    content,
    permissions: "-rw-r--r--",
    owner: "guest",
    group: "users",
  };
}

function app(name, appId, icon) {
  return {
    name,
    type: "app",
    appId,
    icon,
    permissions: "-rwxr-xr-x",
    owner: "root",
    group: "root",
  };
}

function symlink(name, target, icon = "link") {
  return {
    name,
    type: "symlink",
    target,
    icon,
    permissions: "lrwxrwxrwx",
    owner: "guest",
    group: "users",
  };
}

function command(name, description) {
  return file(name, "application/x-dindbos-command", `#!/bin/dindbsh\n# ${description}\n`);
}

function device(name, description) {
  return {
    name,
    type: "device",
    icon: "device",
    description,
    permissions: "crw-rw-rw-",
    owner: "root",
    group: "root",
  };
}

function iconForMime(mime) {
  if (mime === "text/html") return "browser";
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/json") return "text";
  return "text";
}

// Retire only launchers left by this showcase's removed onboarding app.
export function removeLegacyWelcomeLaunchers(os) {
  for (const path of ["/usr/share/applications/Welcome.app", `${os.session.home}/Desktop/Welcome.app`]) {
    const node = os.fs.lstat(path);
    if (node?.type === "app" && os.fs.resolve(path)?.appId === "welcome") os.fs.remove(path, "/", {}, os.permissions.systemPrincipal());
  }
}
