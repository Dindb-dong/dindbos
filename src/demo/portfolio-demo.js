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
    command("ls", "List directory contents"),
    command("mkdir", "Create directories"),
    command("mv", "Move or rename files"),
    command("open", "Open a file, folder, or app"),
    command("pwd", "Print working directory"),
    command("rm", "Remove files or directories"),
    command("stat", "Show file metadata"),
    command("touch", "Create files or update timestamps"),
    command("tree", "Render a directory tree"),
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
        symlink("Terminal.app", "/usr/share/applications/Terminal.app", "terminal"),
        symlink("Calculator.app", "/usr/share/applications/Calculator.app", "calculator"),
        symlink("Settings.app", "/usr/share/applications/Settings.app", "settings"),
        symlink("Projects", "/mnt/portfolio/projects", "folder"),
        symlink("Presentations", "/mnt/portfolio/presentations", "folder"),
        symlink("README.md", "/home/guest/README.md", "text"),
      ]),
      directory("Documents", [
        file("todo.md", "text/markdown", [
          "# DindbOS roadmap",
          "",
          "- Mount legacy portfolio data",
          "- Add Browser.app adapter",
          "- Add PDF Viewer.app",
          "- Publish docs for app authors",
        ].join("\n")),
      ]),
      directory("Downloads", []),
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
    ]),
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
      ]),
      directory("presentations", [
        file("clip-blip2-retrieval.html", "text/html", "<h1>CLIP + BLIP2 Retrieval</h1>\n<p>HTML deck mounting will be wired into Browser.app.</p>\n"),
        file("dueling-ddqn-yakemon-agent.pdf", "application/pdf", "PDF mount placeholder: Dueling DDQN Yakemon Agent"),
        file("qcnn.pdf", "application/pdf", "PDF mount placeholder: QCNN Quantum Convolution"),
      ]),
      file("portfolio.json", "application/json", JSON.stringify(portfolioData, null, 2)),
    ]),
  ]),
  directory("opt", [
    directory("dindbos", [
      file("README.md", "text/markdown", "# /opt/dindbos\n\nOptional runtime assets and demos live here."),
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
  directory("tmp", []),
  directory("usr", [
    directory("bin", [
      symlink("cat", "/bin/cat", "terminal"),
      symlink("ls", "/bin/ls", "terminal"),
      symlink("open", "/bin/open", "terminal"),
      symlink("tree", "/bin/tree", "terminal"),
    ]),
    directory("share", [
      directory("applications", [
        app("Portfolio.app", "portfolio", "portfolio"),
        app("Files.app", "files", "folder"),
        app("Terminal.app", "terminal", "terminal"),
        app("Calculator.app", "calculator", "calculator"),
        app("Settings.app", "settings", "settings"),
      ]),
      directory("doc", [
        symlink("dindbos", "/lib/dindbos", "folder"),
      ]),
    ]),
  ]),
  directory("var", [
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

function directory(name, children) {
  return {
    name,
    type: "directory",
    icon: "folder",
    children,
    permissions: "drwxr-xr-x",
    owner: "root",
    group: "root",
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
