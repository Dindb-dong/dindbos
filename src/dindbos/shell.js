const BUILTIN_MANUALS = {
  cat: "cat <file> - print file contents",
  cd: "cd [path] - change current directory",
  chmod: "chmod <mode> <path> - change mode bits, for example chmod 644 note.txt",
  clear: "clear - clear terminal output",
  cp: "cp [-r] <source> <destination> - copy files or directories",
  df: "df - show mounted filesystem storage status",
  echo: "echo <text> [> file|>> file] - print or redirect text",
  env: "env - list shell environment",
  export: "export KEY=value - set shell environment variable",
  find: "find [path] [name] - search files by name",
  grep: "grep <text> <file> - search lines in a text file",
  kill: "kill <pid> - terminate a process",
  ls: "ls [-la] [path] - list directory contents",
  man: "man <command> - show command help",
  manifest: "manifest [app] - show app manifests",
  mkdir: "mkdir [-p] <path> - create directories",
  mount: "mount - print mounted virtual filesystems",
  mv: "mv <source> <destination> - move or rename files",
  npm: "npm install <package...> - install pure JavaScript npm packages into node_modules",
  open: "open [path] - open a path with its associated app",
  pkg: "pkg list|info|install|remove|search|registry|update|deps|npm - manage DindbOS packages",
  ps: "ps - list running DindbOS processes",
  pwd: "pwd - print current directory",
  resetfs: "resetfs - clear persisted filesystem and reload",
  rm: "rm [-r] <path> - remove files or directories",
  shell: "shell syntax - use command chaining with &&, ||, ; plus pipes and redirection",
  stat: "stat [path] - show file metadata",
  storage: "storage - show persistence backend status",
  touch: "touch <path> - create or update a file",
  tree: "tree [path] - render a directory tree",
  which: "which <command> - locate a command through PATH",
};

export class ShellSession {
  constructor(os) {
    this.os = os;
    this.cwd = os.session.home || "/";
    this.history = [];
    this.historyIndex = 0;
    this.env = {
      HOME: os.session.home || "/home/guest",
      USER: os.session.user || "guest",
      SHELL: "/bin/dindbsh",
      PATH: "/bin:/usr/bin",
      PWD: this.cwd,
    };
  }

  prompt() {
    return `${this.cwd} $`;
  }

  previousHistory() {
    if (!this.history.length) return "";
    this.historyIndex = Math.max(0, this.historyIndex - 1);
    return this.history[this.historyIndex] || "";
  }

  nextHistory() {
    if (!this.history.length) return "";
    this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
    return this.history[this.historyIndex] || "";
  }

  execute(commandLine) {
    const line = commandLine.trim();
    if (!line) return { output: "", clear: false, reload: false };
    this.history.push(line);
    this.historyIndex = this.history.length;
    const expanded = expandVariables(line, this.env);
    const commands = splitCommandList(expanded);
    const output = [];
    let previousStatus = 0;
    for (const item of commands) {
      if (!shouldExecute(item.operator, previousStatus)) continue;
      let result;
      try {
        result = this.executePipeline(item.command);
        previousStatus = result.status;
      } catch (error) {
        result = { output: error.message, clear: false, reload: false, status: 1 };
        previousStatus = 1;
      }
      if (result.clear) return { output: "", clear: true, reload: false, status: previousStatus };
      if (result.output) output.push(result.output);
      if (result.reload) return { ...result, output: output.join("\n") };
    }
    return { output: output.join("\n"), clear: false, reload: false, status: previousStatus };
  }

  async executeAsync(commandLine) {
    const line = commandLine.trim();
    if (!line) return { output: "", clear: false, reload: false };
    this.history.push(line);
    this.historyIndex = this.history.length;
    const expanded = expandVariables(line, this.env);
    const commands = splitCommandList(expanded);
    const output = [];
    let previousStatus = 0;
    for (const item of commands) {
      if (!shouldExecute(item.operator, previousStatus)) continue;
      let result;
      try {
        result = await this.executePipelineAsync(item.command);
        previousStatus = result.status;
      } catch (error) {
        result = { output: error.message, clear: false, reload: false, status: 1 };
        previousStatus = 1;
      }
      if (result.clear) return { output: "", clear: true, reload: false, status: previousStatus };
      if (result.output) output.push(result.output);
      if (result.reload) return { ...result, output: output.join("\n") };
    }
    return { output: output.join("\n"), clear: false, reload: false, status: previousStatus };
  }

  executePipeline(commandLine) {
    const pipeline = splitPipeline(commandLine);
    let stdin = "";
    let result = { output: "", clear: false, reload: false, status: 0 };
    for (const segment of pipeline) {
      result = this.executeSegment(segment, stdin);
      stdin = result.output;
      if (result.clear || result.reload) return result;
    }
    return result;
  }

  async executePipelineAsync(commandLine) {
    const pipeline = splitPipeline(commandLine);
    let stdin = "";
    let result = { output: "", clear: false, reload: false, status: 0 };
    for (const segment of pipeline) {
      result = await this.executeSegmentAsync(segment, stdin);
      stdin = result.output;
      if (result.clear || result.reload) return result;
    }
    return result;
  }

  executeSegment(segment, stdin = "") {
    const redirect = extractRedirect(segment);
    const tokens = tokenizeCommand(redirect.command);
    const [command, ...args] = tokens;
    if (!command) return { output: stdin, clear: false, reload: false, status: 0 };
    let output = this.dispatch(command, args, stdin);
    if (isPromise(output)) throw new Error(`${command}: async command requires executeAsync`);
    if (redirect.target) {
      const value = output.endsWith("\n") ? output : `${output}\n`;
      if (redirect.append) this.os.fs.appendFile(redirect.target, value, this.cwd);
      else this.os.fs.writeOrCreateFile(redirect.target, value, this.cwd);
      output = "";
    }
    return { output, clear: command === "clear", reload: command === "resetfs", status: 0 };
  }

  async executeSegmentAsync(segment, stdin = "") {
    const redirect = extractRedirect(segment);
    const tokens = tokenizeCommand(redirect.command);
    const [command, ...args] = tokens;
    if (!command) return { output: stdin, clear: false, reload: false, status: 0 };
    let output = await this.dispatchAsync(command, args, stdin);
    if (redirect.target) {
      const value = output.endsWith("\n") ? output : `${output}\n`;
      if (redirect.append) this.os.fs.appendFile(redirect.target, value, this.cwd);
      else this.os.fs.writeOrCreateFile(redirect.target, value, this.cwd);
      output = "";
    }
    return { output, clear: command === "clear", reload: command === "resetfs", status: 0 };
  }

  async dispatchAsync(command, args, stdin = "") {
    return this.dispatch(command, args, stdin);
  }

  dispatch(command, args, stdin = "") {
    if (command === "help") return Object.values(BUILTIN_MANUALS).join("\n");
    if (command === "clear") return "";
    if (command === "pwd") return this.cwd;
    if (command === "cd") return this.cd(args[0] || this.env.HOME);
    if (command === "ls") return this.ls(args);
    if (command === "tree") return this.tree(args[0] || this.cwd);
    if (command === "cat") return args.length ? this.os.fs.readFile(args[0], this.cwd) : stdin;
    if (command === "grep") return this.grep(args, stdin);
    if (command === "echo") return args.join(" ");
    if (command === "mkdir") return this.mkdir(args);
    if (command === "touch") return this.touch(args);
    if (command === "rm") return this.rm(args);
    if (command === "cp") return this.cp(args);
    if (command === "mv") return this.mv(args);
    if (command === "chmod") return this.chmod(args);
    if (command === "stat") return formatStat(this.os.fs.stat(args[0] || this.cwd, this.cwd));
    if (command === "readlink") return this.os.fs.lstat(args[0] || this.cwd, this.cwd)?.target || "";
    if (command === "find") return this.find(args);
    if (command === "open") {
      this.os.openPath(this.os.fs.normalize(args[0] || this.cwd, this.cwd));
      return "";
    }
    if (command === "apps") return this.os.apps.list().map((app) => `${app.id} - ${app.name}`).join("\n");
    if (command === "manifest") return this.manifest(args[0]);
    if (command === "pkg") return this.pkg(args);
    if (command === "ps") return this.os.processes.table();
    if (command === "kill") return this.kill(args);
    if (command === "storage") return formatStorage(this.os.storage.status());
    if (command === "resetfs") return this.resetFileSystem();
    if (command === "whoami") return this.env.USER;
    if (command === "id") return `uid=${this.env.USER} gid=${(this.os.session.groups || ["users"]).join(",")}`;
    if (command === "uname") return "DindbOS.js browser-runtime 0.2.0";
    if (command === "date") return new Date().toString();
    if (command === "history") return this.history.map((entry, index) => `${String(index + 1).padStart(4)}  ${entry}`).join("\n");
    if (command === "env") return Object.entries(this.env).map(([key, value]) => `${key}=${value}`).join("\n");
    if (command === "export") return this.export(args);
    if (command === "which") return this.which(args[0]);
    if (command === "man") return BUILTIN_MANUALS[args[0]] || `man: ${args[0] || ""}: no manual entry`;
    if (command === "npm") return this.npm(args);
    if (command === "df") return this.df();
    if (command === "mount") return this.mount();
    throw new Error(`command not found: ${command}`);
  }

  cd(path) {
    const next = this.os.fs.resolve(path, this.cwd);
    if (next?.type !== "directory") throw new Error(`cd: no such directory: ${path}`);
    this.cwd = next.path;
    this.env.PWD = this.cwd;
    return "";
  }

  ls(args) {
    const long = args.includes("-l") || args.includes("-la") || args.includes("-al");
    const showAll = args.includes("-a") || args.includes("-la") || args.includes("-al");
    const path = args.find((arg) => !arg.startsWith("-")) || this.cwd;
    const entries = this.os.fs.list(path, this.cwd).filter((entry) => showAll || !entry.name.startsWith("."));
    if (!long) return entries.map((entry) => entry.name).join("  ");
    return entries.map((entry) => formatLsEntry(this.os, entry)).join("\n");
  }

  tree(path, prefix = "", depth = 0) {
    const node = this.os.fs.resolve(path, this.cwd);
    if (!node) return `tree: no such path: ${path}`;
    const lines = depth === 0 ? [node.path] : [];
    if (node.type !== "directory" || depth > 4) return lines.join("\n");
    const entries = this.os.fs.list(node.path);
    entries.forEach((entry, index) => {
      const branch = index === entries.length - 1 ? "`-- " : "|-- ";
      const nextPrefix = index === entries.length - 1 ? "    " : "|   ";
      lines.push(`${prefix}${branch}${entry.name}${entry.target ? ` -> ${entry.target}` : ""}`);
      if (entry.type === "directory") lines.push(this.tree(entry.path, `${prefix}${nextPrefix}`, depth + 1));
    });
    return lines.filter(Boolean).join("\n");
  }

  grep(args, stdin) {
    const [needle, filePath] = args;
    if (!needle) return "grep: usage: grep <text> [file]";
    const content = filePath ? this.os.fs.readFile(filePath, this.cwd) : stdin;
    return content.split("\n").filter((line) => line.toLowerCase().includes(needle.toLowerCase())).join("\n");
  }

  mkdir(args) {
    const parents = args.includes("-p");
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (!paths.length) throw new Error("mkdir: missing operand");
    paths.forEach((path) => parents ? this.createParents(path) : this.os.fs.createDirectory(path, this.cwd));
    return "";
  }

  createParents(path) {
    const normalized = this.os.fs.normalize(path, this.cwd);
    let cursor = "/";
    normalized.split("/").filter(Boolean).forEach((part) => {
      cursor = this.os.fs.join(cursor, part);
      if (!this.os.fs.exists(cursor)) this.os.fs.createDirectory(cursor);
    });
  }

  touch(args) {
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (!paths.length) throw new Error("touch: missing file operand");
    paths.forEach((path) => {
      const existing = this.os.fs.resolve(path, this.cwd);
      if (existing?.type === "directory") throw new Error(`touch: ${path}: is a directory`);
      this.os.fs.writeOrCreateFile(path, existing ? this.os.fs.readFile(path, this.cwd) : "", this.cwd);
    });
    return "";
  }

  rm(args) {
    const recursive = args.includes("-r") || args.includes("-rf") || args.includes("-fr");
    const force = args.includes("-f") || args.includes("-rf") || args.includes("-fr");
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (!paths.length) throw new Error("rm: missing operand");
    paths.forEach((path) => {
      try {
        this.os.fs.remove(path, this.cwd, { recursive });
      } catch (error) {
        if (!force) throw error;
      }
    });
    return "";
  }

  cp(args) {
    const recursive = args.includes("-r") || args.includes("-R");
    const operands = args.filter((arg) => !arg.startsWith("-"));
    if (operands.length < 2) throw new Error("cp: missing source or destination");
    this.os.fs.copy(operands[0], operands[1], this.cwd, { recursive });
    return "";
  }

  mv(args) {
    const operands = args.filter((arg) => !arg.startsWith("-"));
    if (operands.length < 2) throw new Error("mv: missing source or destination");
    this.os.fs.move(operands[0], operands[1], this.cwd);
    return "";
  }

  chmod(args) {
    if (args.length < 2) throw new Error("chmod: usage: chmod <mode> <path>");
    this.os.fs.chmod(args[1], args[0], this.cwd);
    return "";
  }

  find(args) {
    const path = args[0] || this.cwd;
    const query = args[1] || "";
    const root = this.os.fs.resolve(path, this.cwd);
    if (!root) return `find: ${path}: no such file or directory`;
    const lines = [];
    walkNodes(this.os, root.path, (node) => {
      if (!query || node.name.toLowerCase().includes(query.toLowerCase())) lines.push(node.path);
    });
    return lines.join("\n");
  }

  manifest(appId) {
    if (!appId) {
      return this.os.apps.manifests()
        .map((manifest) => `${manifest.id} ${manifest.version} capabilities=${manifest.capabilities.join(",") || "-"}`)
        .join("\n");
    }
    const manifest = this.os.apps.getManifest(appId);
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

  pkg(args) {
    const [action, operand, ...rest] = args;
    if (!action || action === "list") {
      const packages = this.os.packages.list();
      if (!packages.length) return "pkg: no packages installed";
      return packages.map((record) => `${record.id} ${record.version} ${record.name}`).join("\n");
    }
    if (action === "info") {
      if (!operand) return "pkg: usage: pkg info <package>";
      const record = this.os.packages.info(operand);
      if (!record) return `pkg: ${operand}: package not installed`;
      return formatPackage(record);
    }
    if (action === "install") {
      if (!operand) return "pkg: usage: pkg install <manifest-path>";
      if (isHttpUrl(operand)) {
        const installer = this.os.packages.installFromUrl || this.os.packages.installFromManifestUrl;
        if (!installer) throw new Error("pkg: remote installs are not available in this runtime");
        return installer.call(this.os.packages, operand)
          .then((record) => `installed ${record.id} ${record.version} -> ${record.installPath}`);
      }
      if (!operand.includes("/") && !operand.endsWith(".json")) {
        return this.os.packages.installFromRegistry(operand)
          .then((record) => `installed ${record.id} ${record.version} -> ${record.installPath}`);
      }
      const record = this.os.packages.installFromManifestPath(operand, this.cwd);
      return `installed ${record.id} ${record.version} -> ${record.installPath}`;
    }
    if (action === "search") {
      return this.os.packages.search(operand || "")
        .then((results) => formatPackageSearch(results));
    }
    if (action === "registry" || action === "registries") {
      return this.pkgRegistry(operand, rest);
    }
    if (action === "update") {
      if (!operand) return "pkg: usage: pkg update <package>";
      return this.os.packages.update(operand)
        .then((record) => `updated ${record.id} ${record.version} -> ${record.installPath}`);
    }
    if (action === "deps") {
      if (!operand) return "pkg: usage: pkg deps <package>";
      return formatDependencies(this.os.packages.dependencies(operand));
    }
    if (action === "npm") {
      return this.pkgNpm(operand, rest);
    }
    if (action === "remove" || action === "uninstall") {
      if (!operand) return `pkg: usage: pkg ${action} <package>`;
      const record = this.os.packages.remove(operand);
      return `removed ${record.id}`;
    }
    return "pkg: usage: pkg list | info | install | search | registry | update | deps | npm | remove";
  }

  pkgRegistry(action, args) {
    if (!action || action === "list") {
      return this.os.packages.registries().map((registry) => `${registry.name} ${registry.url}`).join("\n");
    }
    if (action === "add") {
      const [name, url] = args;
      if (!name || !url) return "pkg: usage: pkg registry add <name> <index-url>";
      const registry = this.os.packages.addRegistry(name, url);
      return `registry added ${registry.name} ${registry.url}`;
    }
    if (action === "remove") {
      const [name] = args;
      if (!name) return "pkg: usage: pkg registry remove <name>";
      return `registry removed ${this.os.packages.removeRegistry(name)}`;
    }
    return "pkg: usage: pkg registry list | add <name> <index-url> | remove <name>";
  }

  pkgNpm(action, args) {
    if (action === "add") {
      const [packageId, specifier] = args;
      if (!packageId || !specifier) return "pkg: usage: pkg npm add <package> <npm-package[@version]>";
      const dependency = this.os.packages.installNpmDependency(packageId, specifier);
      return `npm dependency added ${packageId} ${dependency.name}@${dependency.version}`;
    }
    return "pkg: usage: pkg npm add <package> <npm-package[@version]>";
  }

  npm(args) {
    const [action, ...packages] = args;
    if (action === "install" || action === "i" || (!action && !packages.length)) {
      if (!action || !packages.length) return "npm: usage: npm install <package...>";
      return this.os.npm.install(packages, this.cwd)
        .then((records) => records.map((record) => `+ ${record.name}@${record.version} (${record.fileCount} files)`).join("\n"));
    }
    if (action === "root") return this.os.fs.join(this.cwd, "node_modules");
    return "npm: usage: npm install <package...> | npm root";
  }

  kill(args) {
    const pid = Number(args[0]);
    if (!Number.isFinite(pid)) return "kill: usage: kill <pid>";
    const killed = this.os.processes.kill(pid);
    return `killed ${killed.pid} ${killed.appId}`;
  }

  resetFileSystem() {
    this.os.storage.resetFileSystem();
    window.setTimeout(() => window.location.reload(), 250);
    return "persistent filesystem cleared; reloading";
  }

  export(args) {
    if (!args.length) return this.dispatch("env", []);
    args.forEach((entry) => {
      const [key, ...rest] = entry.split("=");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !rest.length) throw new Error(`export: invalid assignment: ${entry}`);
      this.env[key] = rest.join("=");
    });
    return "";
  }

  which(command) {
    if (!command) return "which: usage: which <command>";
    if (BUILTIN_MANUALS[command]) return `shell builtin: ${command}`;
    const found = this.env.PATH.split(":")
      .map((directory) => this.os.fs.join(directory, command))
      .find((path) => this.os.fs.exists(path));
    return found || "";
  }

  df() {
    const status = this.os.storage.status();
    return [
      "Filesystem     Type       Used",
      `dindbos-vfs    ${status.backend || "memory"} ${formatBytes(status.bytes)}`,
    ].join("\n");
  }

  mount() {
    try {
      return this.os.fs.readFile("/proc/mounts");
    } catch {
      return "rootfs / virtualfs rw 0 0";
    }
  }
}

export function tokenizeCommand(line) {
  return line.match(/"([^"]*)"|'([^']*)'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) || [];
}

function extractRedirect(segment) {
  const tokens = tokenizeCommand(segment);
  const appendIndex = tokens.indexOf(">>");
  const writeIndex = tokens.indexOf(">");
  const index = appendIndex >= 0 ? appendIndex : writeIndex;
  if (index < 0) return { command: segment, target: "", append: false };
  return {
    command: tokens.slice(0, index).join(" "),
    target: tokens[index + 1] || "",
    append: appendIndex >= 0,
  };
}

function splitCommandList(line) {
  const commands = [];
  let current = "";
  let quote = "";
  let operator = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
    } else if (char === quote) {
      quote = "";
    }
    if (!quote && char === "&" && next === "&") {
      pushCommand(commands, operator, current);
      operator = "&&";
      current = "";
      index += 1;
      continue;
    }
    if (!quote && char === "|" && next === "|") {
      pushCommand(commands, operator, current);
      operator = "||";
      current = "";
      index += 1;
      continue;
    }
    if (!quote && char === ";") {
      pushCommand(commands, operator, current);
      operator = ";";
      current = "";
      continue;
    }
    current += char;
  }
  pushCommand(commands, operator, current);
  return commands;
}

function pushCommand(commands, operator, command) {
  const trimmed = command.trim();
  if (trimmed) commands.push({ operator, command: trimmed });
}

function shouldExecute(operator, previousStatus) {
  if (operator === "&&") return previousStatus === 0;
  if (operator === "||") return previousStatus !== 0;
  return true;
}

function splitPipeline(line) {
  const parts = [];
  let current = "";
  let quote = "";
  for (const char of line) {
    if ((char === "\"" || char === "'") && !quote) quote = char;
    else if (char === quote) quote = "";
    if (char === "|" && !quote) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function expandVariables(line, env) {
  return line.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, key) => env[key] ?? "");
}

function formatLsEntry(os, node) {
  const stat = os.fs.lstat(node.path);
  const target = node.target ? ` -> ${node.target}` : "";
  return `${stat.permissions} ${stat.owner.padEnd(5)} ${stat.group.padEnd(5)} ${String(stat.size).padStart(6)} ${node.name}${target}`;
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

function formatStorage(status) {
  return [
    `key=${status.key}`,
    `backend=${status.backend || "memory"}`,
    `enabled=${status.enabled}`,
    `persisted=${status.persisted}`,
    `bytes=${status.bytes}`,
  ].join("\n");
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatPackage(record) {
  return [
    `id=${record.id}`,
    `name=${record.name}`,
    `version=${record.version}`,
    `description=${record.description || "-"}`,
    `installPath=${record.installPath}`,
    `sourcePath=${record.sourcePath || "-"}`,
    `app.id=${record.app.id}`,
    `app.title=${record.app.title}`,
    `app.entry=${record.app.entryPath || "-"}`,
    `capabilities=${record.permissions?.capabilities?.join(",") || record.app.capabilities?.join(",") || "-"}`,
    `fs.read=${record.permissions?.fileSystem?.read?.join(",") || record.app.fileSystem?.read?.join(",") || "-"}`,
    `fs.write=${record.permissions?.fileSystem?.write?.join(",") || record.app.fileSystem?.write?.join(",") || "-"}`,
    `deps.packages=${Object.keys(record.dependencies?.packages || {}).join(",") || "-"}`,
    `deps.npm=${Object.entries(record.dependencies?.npm || {}).map(([name, dep]) => `${name}@${dep.version}`).join(",") || "-"}`,
  ].join("\n");
}

function formatPackageSearch(results) {
  if (!results.length) return "pkg: no registry results";
  return results
    .map((entry) => `${entry.id} ${entry.version} ${entry.registry} ${entry.manifestUrl}`)
    .join("\n");
}

function formatDependencies(dependencies) {
  const packageDeps = Object.entries(dependencies.packages || {})
    .map(([name, dependency]) => `package ${name}@${dependency.version || "latest"} ${dependency.manifestUrl || ""}`);
  const npmDeps = Object.entries(dependencies.npm || {})
    .map(([name, dependency]) => `npm ${name}@${dependency.version || "latest"} ${dependency.url || ""}`);
  return [...packageDeps, ...npmDeps].join("\n") || "pkg: no dependencies";
}

function walkNodes(os, path, visit) {
  const node = os.fs.resolve(path);
  if (!node) return;
  visit(node);
  if (node.type !== "directory") return;
  os.fs.list(node.path).forEach((entry) => walkNodes(os, entry.path, visit));
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
