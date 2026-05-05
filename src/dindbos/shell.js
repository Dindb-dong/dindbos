import { compatibilitySnapshot } from "./compat.js?v=20260422-browserd";

const BUILTIN_MANUALS = {
  cat: "cat <file> - print file contents",
  cd: "cd [path] - change current directory",
  chmod: "chmod <mode> <path> - change mode bits, for example chmod 644 note.txt",
  clear: "clear - clear terminal output",
  cp: "cp [-r] <source> <destination> - copy files or directories",
  doctor: "doctor [compat] - print runtime diagnostics or compatibility tiers for troubleshooting",
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
  "mount-local": "mount-local [name|--list|--restore|--forget path|--helper] - manage local folder mounts",
  mv: "mv <source> <destination> - move or rename files",
  node: "node [--input-type=module] [-e code] <file> - run JavaScript in the DindbOS runtime",
  npm: "npm install <package...> - install pure JavaScript npm packages into node_modules",
  open: "open [path] - open a path with its associated app",
  pkg: "pkg list|info|install|remove|search|registry|trust|update|deps|npm - manage DindbOS packages",
  ps: "ps - list running DindbOS processes",
  pwd: "pwd - print current directory",
  resetfs: "resetfs - clear persisted filesystem and reload",
  rm: "rm [-r] <path> - remove files or directories",
  shell: "shell syntax - use command chaining with &&, ||, ; plus pipes and redirection",
  stat: "stat [path] - show file metadata",
  storage: "storage [persist|flush] - show quota status, request persistence, or flush pending writes",
  su: "su [user] - unsupported browser-native privilege boundary placeholder",
  sudo: "sudo <command> - unsupported browser-native privilege boundary placeholder",
  syscall: "syscall <name> [json] - call the DindbOS syscall ABI and print structured JSON",
  touch: "touch <path> - create or update a file",
  tree: "tree [path] - render a directory tree",
  umount: "umount [--forget] <path> - unmount a local folder",
  which: "which <command> - locate a command through PATH",
};

const MAX_SCRIPT_DEPTH = 8;
const STATUS_PREFIX_COMMANDS = new Set([
  "find",
  "kill",
  "man",
  "manifest",
  "mount-local",
  "node",
  "npm",
  "pkg",
  "stat",
  "su",
  "sudo",
  "syscall",
  "tree",
  "umount",
  "which",
]);

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
    this.principal = os.permissions?.principal?.({ user: this.env.USER, groups: os.session.groups }) || os.permissions?.systemPrincipal?.() || null;
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
    const locked = this.lockedSessionResult();
    if (locked) return locked;
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
    const locked = this.lockedSessionResult();
    if (locked) return locked;
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

  lockedSessionResult() {
    try {
      this.os.assertSessionUnlocked?.("shell");
      return null;
    } catch (error) {
      return { output: error.message, clear: false, reload: false, status: 1 };
    }
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
    const tokens = redirect.tokens;
    const [command, ...args] = tokens;
    if (!command) return { output: stdin, clear: false, reload: false, status: 0 };
    const input = redirect.input ? this.readFile(redirect.input) : stdin;
    if (isPromise(input)) throw new Error(`${command}: async input redirection requires executeAsync`);
    let output = this.dispatch(command, args, input);
    if (isPromise(output)) throw new Error(`${command}: async command requires executeAsync`);
    const status = shellStatus(command, output);
    if (redirect.target) {
      const value = output.endsWith("\n") ? output : `${output}\n`;
      if (redirect.append) this.os.fs.appendFile(redirect.target, value, this.cwd, this.principal);
      else this.os.fs.writeOrCreateFile(redirect.target, value, this.cwd, {}, this.principal);
      output = "";
    }
    return { output, clear: command === "clear", reload: command === "resetfs", status };
  }

  async executeSegmentAsync(segment, stdin = "") {
    const redirect = extractRedirect(segment);
    const tokens = redirect.tokens;
    const [command, ...args] = tokens;
    if (!command) return { output: stdin, clear: false, reload: false, status: 0 };
    const input = redirect.input ? await this.readFile(redirect.input) : stdin;
    let output = await this.dispatchAsync(command, args, input);
    const status = shellStatus(command, output);
    if (redirect.target) {
      const value = output.endsWith("\n") ? output : `${output}\n`;
      if (this.isLocalPath(redirect.target)) {
        if (redirect.append) await this.os.localMounts.appendFile(redirect.target, value, this.cwd);
        else await this.os.localMounts.writeFile(redirect.target, value, this.cwd);
      } else if (redirect.append) this.os.fs.appendFile(redirect.target, value, this.cwd, this.principal);
      else this.os.fs.writeOrCreateFile(redirect.target, value, this.cwd, {}, this.principal);
      output = "";
    }
    return { output, clear: command === "clear", reload: command === "resetfs", status };
  }

  async dispatchAsync(command, args, stdin = "", options = {}) {
    const output = this.dispatch(command, args, stdin, options);
    if (isPromise(output)) return output;
    return output;
  }

  dispatch(command, args, stdin = "", options = {}) {
    if (command === "help") return Object.values(BUILTIN_MANUALS).join("\n");
    if (command === "clear") return "";
    if (command === "pwd") return this.cwd;
    if (command === "cd") return this.cd(args[0] || this.env.HOME);
    if (command === "ls") return this.ls(args);
    if (command === "tree") return this.tree(args[0] || this.cwd);
    if (command === "cat") return args.length ? this.readFile(args[0]) : stdin;
    if (command === "grep") return this.grep(args, stdin);
    if (command === "echo") return args.join(" ");
    if (command === "mkdir") return this.mkdir(args);
    if (command === "touch") return this.touch(args);
    if (command === "rm") return this.rm(args);
    if (command === "cp") return this.cp(args);
    if (command === "mv") return this.mv(args);
    if (command === "chmod") return this.chmod(args);
    if (command === "stat") return this.stat(args[0] || this.cwd);
    if (command === "readlink") return this.os.fs.lstat(args[0] || this.cwd, this.cwd, this.principal)?.target || "";
    if (command === "find") return this.find(args);
    if (command === "open") {
      this.os.openPath(this.os.fs.normalize(args[0] || this.cwd, this.cwd));
      return "";
    }
    if (command === "apps") return this.os.apps.list().map((app) => `${app.id} - ${app.name}`).join("\n");
    if (command === "manifest") return this.manifest(args[0]);
    if (command === "mount-local") return this.mountLocal(args);
    if (command === "umount") return this.umount(args);
    if (command === "pkg") return this.pkg(args);
    if (command === "ps") return this.os.processes.table();
    if (command === "kill") return this.kill(args);
    if (command === "storage") return this.storage(args);
    if (command === "syscall") return this.syscall(args);
    if (command === "resetfs") return this.resetFileSystem();
    if (command === "su" || command === "sudo") return this.privilegeEscalation(command);
    if (command === "whoami") return this.env.USER;
    if (command === "id") return `uid=${this.env.USER} gid=${(this.os.session.groups || ["users"]).join(",")}`;
    if (command === "uname") return "DindbOS.js browser-runtime 0.2.0";
    if (command === "date") return new Date().toString();
    if (command === "doctor") return this.doctor(args);
    if (command === "history") return this.history.map((entry, index) => `${String(index + 1).padStart(4)}  ${entry}`).join("\n");
    if (command === "env") return Object.entries(this.env).map(([key, value]) => `${key}=${value}`).join("\n");
    if (command === "export") return this.export(args);
    if (command === "which") return this.which(args[0]);
    if (command === "man") return BUILTIN_MANUALS[args[0]] || `man: ${args[0] || ""}: no manual entry`;
    if (command === "node") return this.node(args);
    if (command === "npm") return this.npm(args);
    if (command === "df") return this.df();
    if (command === "mount") return this.mount();
    const script = this.resolveExecutable(command);
    if (script) return this.executeScript(script.path, args, stdin, options.scriptDepth || 0);
    throw new Error(this.commandNotFound(command));
  }

  commandNotFound(command) {
    const suggestions = commandSuggestions(this.os, command);
    const suffix = suggestions.length ? `\nDid you mean: ${suggestions.slice(0, 3).join(", ")}?` : "";
    return `command not found: ${command}${suffix}`;
  }

  privilegeEscalation(command) {
    return `${command}: unsupported in DindbOS browser runtime; session user is fixed to ${this.env.USER}`;
  }

  cd(path) {
    if (this.isLocalPath(path)) {
      return this.os.localMounts.stat(path, this.cwd).then((stat) => {
        if (!stat || (stat.resolvedType !== "directory" && stat.type !== "mount")) throw new Error(`cd: no such directory: ${path}`);
        this.cwd = this.os.fs.normalize(path, this.cwd);
        this.env.PWD = this.cwd;
        return "";
      });
    }
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
    if (this.isLocalPath(path)) {
      return this.os.localMounts.list(path, this.cwd)
        .then((entries) => {
          const visible = entries.filter((entry) => showAll || !entry.name.startsWith("."));
          return long ? visible.map((entry) => formatLocalLsEntry(entry)).join("\n") : visible.map((entry) => entry.name).join("  ");
        });
    }
    const entries = this.os.fs.list(path, this.cwd, this.principal).filter((entry) => showAll || !entry.name.startsWith("."));
    if (!long) return entries.map((entry) => entry.name).join("  ");
    return entries.map((entry) => formatLsEntry(this.os, entry)).join("\n");
  }

  tree(path, prefix = "", depth = 0) {
    const node = this.os.fs.resolve(path, this.cwd);
    if (!node) return `tree: no such path: ${path}`;
    const lines = depth === 0 ? [node.path] : [];
    if (node.type !== "directory" || depth > 4) return lines.join("\n");
    const entries = this.os.fs.list(node.path, "/", this.principal);
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
    if (filePath && this.isLocalPath(filePath)) {
      return this.os.localMounts.readFile(filePath, this.cwd)
        .then((content) => filterGrep(content, needle));
    }
    const content = filePath ? this.os.fs.readFile(filePath, this.cwd, this.principal) : stdin;
    return filterGrep(content, needle);
  }

  mkdir(args) {
    const parents = args.includes("-p");
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (!paths.length) throw new Error("mkdir: missing operand");
    if (paths.some((path) => this.isLocalPath(path))) {
      return Promise.all(paths.map((path) => this.isLocalPath(path)
        ? this.os.localMounts.createDirectory(path, this.cwd, { parents })
        : parents ? this.createParents(path) : this.os.fs.createDirectory(path, this.cwd, {}, this.principal))).then(() => "");
    }
    paths.forEach((path) => parents ? this.createParents(path) : this.os.fs.createDirectory(path, this.cwd, {}, this.principal));
    return "";
  }

  createParents(path) {
    const normalized = this.os.fs.normalize(path, this.cwd);
    let cursor = "/";
    normalized.split("/").filter(Boolean).forEach((part) => {
      cursor = this.os.fs.join(cursor, part);
      if (!this.os.fs.exists(cursor)) this.os.fs.createDirectory(cursor, "/", {}, this.principal);
    });
  }

  touch(args) {
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (!paths.length) throw new Error("touch: missing file operand");
    if (paths.some((path) => this.isLocalPath(path))) {
      return Promise.all(paths.map((path) => this.touchOne(path))).then(() => "");
    }
    paths.forEach((path) => {
      const existing = this.os.fs.resolve(path, this.cwd);
      if (existing?.type === "directory") throw new Error(`touch: ${path}: is a directory`);
      this.os.fs.writeOrCreateFile(path, existing ? this.os.fs.readFile(path, this.cwd, this.principal) : "", this.cwd, {}, this.principal);
    });
    return "";
  }

  rm(args) {
    const recursive = args.includes("-r") || args.includes("-rf") || args.includes("-fr");
    const force = args.includes("-f") || args.includes("-rf") || args.includes("-fr");
    const paths = args.filter((arg) => !arg.startsWith("-"));
    if (!paths.length) throw new Error("rm: missing operand");
    if (paths.some((path) => this.isLocalPath(path))) {
      return Promise.all(paths.map((path) => {
        if (this.isLocalPath(path)) {
          return this.os.localMounts.remove(path, this.cwd, { recursive }).catch((error) => {
            if (!force) throw error;
          });
        }
        try {
          this.os.fs.remove(path, this.cwd, { recursive }, this.principal);
          return Promise.resolve();
        } catch (error) {
          if (!force) throw error;
          return Promise.resolve();
        }
      })).then(() => "");
    }
    paths.forEach((path) => {
      try {
        this.os.fs.remove(path, this.cwd, { recursive }, this.principal);
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
    if (this.isLocalPath(operands[0]) || this.isLocalPath(operands[1])) return this.copyWithLocal(operands[0], operands[1], { recursive });
    this.os.fs.copy(operands[0], operands[1], this.cwd, { recursive }, this.principal);
    return "";
  }

  mv(args) {
    const operands = args.filter((arg) => !arg.startsWith("-"));
    if (operands.length < 2) throw new Error("mv: missing source or destination");
    const sourceLocal = this.isLocalPath(operands[0]);
    const destinationLocal = this.isLocalPath(operands[1]);
    if (sourceLocal && destinationLocal) return this.os.localMounts.move(operands[0], operands[1], this.cwd, { recursive: true }).then(() => "");
    if (sourceLocal || destinationLocal) {
      return this.copyWithLocal(operands[0], operands[1], { recursive: true })
        .then(() => sourceLocal
          ? this.os.localMounts.remove(operands[0], this.cwd, { recursive: true })
          : this.os.fs.remove(operands[0], this.cwd, { recursive: true }, this.principal))
        .then(() => "");
    }
    this.os.fs.move(operands[0], operands[1], this.cwd, this.principal);
    return "";
  }

  chmod(args) {
    if (args.length < 2) throw new Error("chmod: usage: chmod <mode> <path>");
    this.os.fs.chmod(args[1], args[0], this.cwd, this.principal);
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
    if (action === "trust") {
      return this.pkgTrust(operand, rest);
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
    return "pkg: usage: pkg list | info | install | search | registry | trust | update | deps | npm | remove";
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

  pkgTrust(action, args) {
    if (!action || action === "list") {
      const publishers = this.os.packages.trustedPublishers();
      return publishers.length
        ? publishers.map((publisher) => `${publisher.id} ${publisher.publicKey} ${publisher.name}`).join("\n")
        : "pkg: no trusted publishers";
    }
    if (action === "add") {
      const [id, publicKey, ...nameParts] = args;
      if (!id || !publicKey) return "pkg: usage: pkg trust add <publisher-id> <public-key> [name]";
      const publisher = this.os.packages.addTrustedPublisher({ id, publicKey, name: nameParts.join(" ") || id });
      return `trusted publisher added ${publisher.id}`;
    }
    if (action === "remove") {
      const [idOrKey] = args;
      if (!idOrKey) return "pkg: usage: pkg trust remove <publisher-id|public-key>";
      return `trusted publisher removed ${this.os.packages.removeTrustedPublisher(idOrKey)}`;
    }
    return "pkg: usage: pkg trust list | add <publisher-id> <public-key> [name] | remove <publisher-id|public-key>";
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

  storage(args) {
    if (args[0] === "flush") {
      return this.os.flushPersistentFileSystem().then(() => formatStorage(this.withPersistenceStatus(this.os.storage.status())));
    }
    if (args[0] === "persist") return this.os.storage.persist().then((status) => formatStorage(this.withPersistenceStatus(status)));
    return this.os.storage.estimate().then((status) => formatStorage(this.withPersistenceStatus(status)));
  }

  async doctor(args = []) {
    if (args[0] === "compat") return this.doctorCompat();
    const sessionStatus = safeRead(() => this.os.sessionStatus?.(), null);
    const storage = await safeAsync(() => this.os.storage?.estimate?.(), safeRead(() => this.os.storage?.status?.(), {}));
    const mounts = await safeAsync(() => this.os.localMounts?.status?.(), []);
    const packages = safeRead(() => this.os.packages?.list?.(), []);
    const processes = safeRead(() => this.os.processes?.list?.(), []);
    const groups = this.os.session.groups || ["users"];
    const localMountSupported = Boolean(safeRead(() => this.os.localMounts?.supported?.(), false));
    const mounted = Array.isArray(mounts) ? mounts.filter((mount) => mount.status !== "forgotten").length : 0;
    const persistedMounts = Array.isArray(mounts) ? mounts.filter((mount) => mount.persisted).length : 0;
    const mountErrors = Array.isArray(mounts) ? mounts.filter((mount) => mount.error).length : 0;
    const helper = safeRead(() => this.os.localMounts?.nativeHelperStatus?.(), {});
    return [
      "DindbOS doctor",
      `session user=${this.env.USER} groups=${groups.join(",")} home=${this.env.HOME} cwd=${this.cwd} locked=${sessionStatus?.locked || false}`,
      `storage backend=${storage?.backend || "memory"} persisted=${storage?.persisted || false} bytes=${storage?.bytes || 0} dirtyInodes=${storage?.dirtyInodes || 0} dirtyFiles=${storage?.dirtyFiles || 0} pending=${storage?.persistPending || false}`,
      `localMounts supported=${localMountSupported} mounted=${mounted} persisted=${persistedMounts} errors=${mountErrors} helper=${helper?.status || "unavailable"} rename=${helper?.renameSupported || false}`,
      `packages installed=${Array.isArray(packages) ? packages.length : 0}`,
      `processes running=${Array.isArray(processes) ? processes.length : 0}`,
      "troubleshooting docs=docs/support.md command=storage|mount-local --list|ps|pkg list",
    ].join("\n");
  }

  doctorCompat() {
    const snapshot = safeRead(() => this.os.compatibilitySnapshot?.(), compatibilitySnapshot(this.os));
    const tierLines = (snapshot.tiers || []).map((tier) => (
      `tier ${tier.id} ${tier.status} ${tier.key} - ${tier.name}`
    ));
    const browser = snapshot.browser || {};
    const storage = snapshot.storage || {};
    const companions = snapshot.companions || {};
    return [
      "DindbOS compatibility",
      `runtime=${snapshot.runtime || "DindbOS.js"} version=${snapshot.version || "0.2.0"} mode=${snapshot.mode || "browser-native"}`,
      ...tierLines,
      `browser workers=${Boolean(browser.workers)} wasm=${Boolean(browser.webAssembly)} opfs=${Boolean(browser.opfs)} indexedDB=${Boolean(browser.indexedDB)} cacheApi=${Boolean(browser.cacheApi)} fileSystemAccess=${Boolean(browser.fileSystemAccess)}`,
      `storage backend=${storage.backend || "memory"} structured=${storage.structuredBackend || "memory"} persisted=${Boolean(storage.persisted)} buckets=${storage.buckets || "unknown"}`,
      `companions browserProvider=${companions.browserProviderUrl || "ws://127.0.0.1:8787/browser"} localMounts=${companions.localMounts || 0}`,
      `unsupported native=${(snapshot.unsupportedNative || []).join("; ")}`,
    ].join("\n");
  }

  syscall(args) {
    const [name, ...jsonParts] = args;
    if (!name) return "syscall: usage: syscall <name> [json]";
    const payload = jsonParts.length ? parseJsonArgument(jsonParts.join(" "), "syscall") : {};
    const result = this.os.syscall(name, payload, { principal: this.principal, env: this.env });
    return JSON.stringify(result, null, 2);
  }

  node(args) {
    const { inputType, rest } = parseNodeOptions(args);
    if (rest[0] === "-e" || rest[0] === "--eval") {
      const source = rest.slice(1).join(" ");
      if (!source) return "node: usage: node [--input-type=module] -e <code>";
      return Promise.resolve(this.os.node.evaluate(source, this.cwd, { inputType })).then(formatNodeResult);
    }
    const [file, ...argv] = rest;
    if (!file) return "node: usage: node [--input-type=module] [-e code] <file>";
    return Promise.resolve(this.os.node.runFile(file, this.cwd, { argv, inputType })).then(formatNodeResult);
  }

  readFile(path) {
    if (this.isLocalPath(path)) return this.os.localMounts.readFile(path, this.cwd);
    return this.os.fs.readFile(path, this.cwd, this.principal);
  }

  stat(path) {
    if (this.isLocalPath(path)) return this.os.localMounts.stat(path, this.cwd).then(formatStat);
    return formatStat(this.os.fs.stat(path, this.cwd, this.principal));
  }

  async touchOne(path) {
    if (this.isLocalPath(path)) {
      const existing = await this.os.localMounts.exists(path, this.cwd);
      if (!existing) {
        await this.os.localMounts.writeFile(path, "", this.cwd);
        return;
      }
      const stat = await this.os.localMounts.stat(path, this.cwd);
      if (stat?.resolvedType === "directory") throw new Error(`touch: ${path}: is a directory`);
      await this.os.localMounts.writeFile(path, await this.os.localMounts.readFile(path, this.cwd), this.cwd);
      return;
    }
    const existing = this.os.fs.resolve(path, this.cwd);
    if (existing?.type === "directory") throw new Error(`touch: ${path}: is a directory`);
    this.os.fs.writeOrCreateFile(path, existing ? this.os.fs.readFile(path, this.cwd, this.principal) : "", this.cwd, {}, this.principal);
  }

  async copyWithLocal(sourcePath, destinationPath, options = {}) {
    const sourceLocal = this.isLocalPath(sourcePath);
    const destinationLocal = this.isLocalPath(destinationPath);
    if (sourceLocal) {
      const stat = await this.os.localMounts.stat(sourcePath, this.cwd);
      if (stat?.resolvedType === "directory") throw new Error(`cp: ${sourcePath}: local directory copy is pending`);
    } else {
      const source = this.os.fs.resolve(sourcePath, this.cwd);
      if (!source) throw new Error(`cp: ${sourcePath}: no such file or directory`);
      if (source.type === "directory" && !options.recursive) throw new Error(`cp: ${sourcePath}: is a directory`);
      if (source.type === "directory") throw new Error(`cp: ${sourcePath}: local directory copy is pending`);
    }
    const content = sourceLocal
      ? await this.os.localMounts.readFileBytes(sourcePath, this.cwd)
      : this.os.fs.readFileBytes(sourcePath, this.cwd, this.principal);
    const sourceName = this.os.fs.basename(this.os.fs.normalize(sourcePath, this.cwd));
    if (destinationLocal) {
      const target = await this.localDestinationPath(destinationPath, sourceName);
      await this.os.localMounts.writeFileBytes(target, content, this.cwd);
      return "";
    }
    const destination = this.os.fs.resolve(destinationPath, this.cwd);
    const target = destination?.type === "directory"
      ? this.os.fs.join(destination.path, sourceName)
      : this.os.fs.normalize(destinationPath, this.cwd);
    this.os.fs.writeOrCreateFileBytes(target, content, "/", {}, this.principal);
    return "";
  }

  async localDestinationPath(destinationPath, sourceName) {
    const normalized = this.os.fs.normalize(destinationPath, this.cwd);
    if (await this.os.localMounts.exists(normalized)) {
      const stat = await this.os.localMounts.stat(normalized);
      if (stat?.resolvedType === "directory" || stat?.type === "mount") return this.os.fs.join(normalized, sourceName);
    }
    return normalized;
  }

  mountLocal(args) {
    const [first, second] = args;
    if (first === "--list") return this.os.localMounts.status().then(formatMountStatus);
    if (first === "--restore") return this.os.localMounts.restorePersistedMounts({ request: true }).then(formatMountRestore);
    if (first === "--helper") return formatMountHelperStatus(this.os.localMounts.nativeHelperStatus?.());
    if (first === "--forget") {
      const path = second;
      if (!path) return "mount-local: usage: mount-local --forget <path>";
      return this.os.localMounts.forgetMount(this.os.fs.normalize(path, this.cwd)).then((result) => `forgot ${result.path}`);
    }
    const name = first || "";
    if (!this.os.localMounts?.supported()) return "mount-local: File System Access API is not available in this browser";
    return this.os.localMounts.mountLocal(name)
      .then((mount) => `mounted ${mount.handleName} at ${mount.path}`);
  }

  umount(args) {
    const forget = args[0] === "--forget";
    const path = forget ? args[1] : args[0];
    if (!path) return "umount: usage: umount [--forget] <path>";
    return this.os.localMounts.unmount(this.os.fs.normalize(path, this.cwd), { forget })
      .then((mount) => `unmounted ${mount.path}${forget ? " and forgot persisted handle" : ""}`);
  }

  kill(args) {
    const pid = Number(args[0]);
    if (!Number.isFinite(pid)) return "kill: usage: kill <pid>";
    const killed = this.os.processes.kill(pid);
    return `killed ${killed.pid} ${killed.appId}`;
  }

  resetFileSystem() {
    if (typeof this.os.resetPersistentFileSystem === "function") this.os.resetPersistentFileSystem();
    else this.os.storage.resetFileSystem();
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
    return this.resolveExecutable(command)?.path || "";
  }

  df() {
    const status = this.os.storage.status();
    if (typeof this.os.diskPolicyAreas === "function") {
      return [
        "Filesystem     Type       Durability   Used       Policy",
        ...this.os.diskPolicyAreas().map((area) => [
          area.root.padEnd(14),
          area.type.padEnd(10),
          area.durability.padEnd(12),
          formatBytes(area.usedBytes).padEnd(10),
          area.policy,
        ].join(" ")),
      ].join("\n");
    }
    return [
      "Filesystem     Type       Used",
      `dindbos-vfs    ${status.backend || "memory"} ${formatBytes(status.bytes)}`,
    ].join("\n");
  }

  mount() {
    try {
      const base = this.os.fs.readFile("/proc/mounts").trim().split("\n").filter(Boolean);
      const localLines = this.os.localMounts?.mountLines?.() || [];
      return [...base, ...localLines].join("\n");
    } catch {
      return "rootfs / virtualfs rw 0 0";
    }
  }

  isLocalPath(path) {
    return Boolean(this.os.localMounts?.isMountedPath(path, this.cwd));
  }

  withPersistenceStatus(status) {
    return {
      ...status,
      ...(this.os.persistenceStatus?.() || {}),
    };
  }

  resolveExecutable(command) {
    const paths = command.includes("/") || command.startsWith("~")
      ? [this.os.fs.normalize(command, this.cwd)]
      : this.env.PATH.split(":").filter(Boolean).map((directory) => this.os.fs.join(directory, command));
    for (const path of paths) {
      const node = this.os.fs.resolve(path, "/");
      if (!node) continue;
      if (node.type !== "file") throw new Error(`${command}: ${path}: not an executable file`);
      this.os.fs.assertAccess(node, "execute", this.principal, path);
      return { path, node };
    }
    return null;
  }

  async executeScript(path, args = [], stdin = "", depth = 0) {
    if (depth >= MAX_SCRIPT_DEPTH) throw new Error(`${path}: maximum script recursion depth exceeded`);
    const source = this.os.fs.readFile(path, "/", this.principal);
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const shebang = lines[0]?.startsWith("#!") ? lines.shift().slice(2).trim() : "";
    if (shebang && !isSupportedShellShebang(shebang)) {
      throw new Error(`${path}: unsupported interpreter: ${shebang}`);
    }
    const previousEnv = { ...this.env };
    this.env["0"] = path;
    this.env["#"] = String(args.length);
    this.env["@"] = args.join(" ");
    args.forEach((arg, index) => {
      this.env[String(index + 1)] = arg;
    });
    const output = [];
    let status = 0;
    try {
      for (const line of lines) {
        const command = line.trim();
        if (!command || command.startsWith("#")) continue;
        const result = await this.executeScriptLine(command, stdin, depth + 1);
        status = result.status || 0;
        if (result.output) output.push(result.output);
        if (result.clear || result.reload) return result;
      }
    } finally {
      const nextPwd = this.cwd;
      this.env = previousEnv;
      this.env.PWD = nextPwd;
    }
    if (status) throw new Error(`${path}: script exited with status ${status}`);
    return output.join("\n");
  }

  async executeScriptLine(commandLine, stdin, depth) {
    const expanded = expandVariables(commandLine, this.env);
    const commands = splitCommandList(expanded);
    const output = [];
    let previousStatus = 0;
    for (const item of commands) {
      if (!shouldExecute(item.operator, previousStatus)) continue;
      let result;
      try {
        result = await this.executePipelineAsyncWithDepth(item.command, stdin, depth);
        previousStatus = result.status;
      } catch (error) {
        result = { output: error.message, clear: false, reload: false, status: 1 };
        previousStatus = 1;
      }
      if (result.clear || result.reload) return { ...result, output: output.concat(result.output || []).join("\n") };
      if (result.output) output.push(result.output);
    }
    return { output: output.join("\n"), clear: false, reload: false, status: previousStatus };
  }

  async executePipelineAsyncWithDepth(commandLine, stdin = "", depth = 0) {
    const pipeline = splitPipeline(commandLine);
    let nextStdin = stdin;
    let result = { output: "", clear: false, reload: false, status: 0 };
    for (const segment of pipeline) {
      result = await this.executeSegmentAsyncWithDepth(segment, nextStdin, depth);
      nextStdin = result.output;
      if (result.clear || result.reload) return result;
    }
    return result;
  }

  async executeSegmentAsyncWithDepth(segment, stdin = "", depth = 0) {
    const redirect = extractRedirect(segment);
    const tokens = redirect.tokens;
    const [command, ...args] = tokens;
    if (!command) return { output: stdin, clear: false, reload: false, status: 0 };
    const input = redirect.input ? await this.readFile(redirect.input) : stdin;
    let output = await this.dispatchAsync(command, args, input, { scriptDepth: depth });
    const status = shellStatus(command, output);
    if (redirect.target) {
      const value = output.endsWith("\n") ? output : `${output}\n`;
      if (this.isLocalPath(redirect.target)) {
        if (redirect.append) await this.os.localMounts.appendFile(redirect.target, value, this.cwd);
        else await this.os.localMounts.writeFile(redirect.target, value, this.cwd);
      } else if (redirect.append) this.os.fs.appendFile(redirect.target, value, this.cwd, this.principal);
      else this.os.fs.writeOrCreateFile(redirect.target, value, this.cwd, {}, this.principal);
      output = "";
    }
    return { output, clear: command === "clear", reload: command === "resetfs", status };
  }
}

export function tokenizeCommand(line) {
  const tokens = [];
  let current = "";
  let quote = "";
  let tokenStarted = false;
  const push = () => {
    if (tokenStarted || current) tokens.push(current);
    current = "";
    tokenStarted = false;
  };
  for (let index = 0; index < String(line || "").length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\\" && next !== undefined) {
      current += next;
      tokenStarted = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      tokenStarted = true;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    if (char === ">" || char === "<") {
      push();
      if (char === ">" && next === ">") {
        tokens.push(">>");
        index += 1;
      } else {
        tokens.push(char);
      }
      continue;
    }
    current += char;
    tokenStarted = true;
  }
  push();
  return tokens;
}

function extractRedirect(segment) {
  const tokens = tokenizeCommand(segment);
  const commandTokens = [];
  let target = "";
  let input = "";
  let append = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === ">" || token === ">>") {
      target = tokens[index + 1] || "";
      append = token === ">>";
      index += 1;
      continue;
    }
    if (token === "<") {
      input = tokens[index + 1] || "";
      index += 1;
      continue;
    }
    commandTokens.push(token);
  }
  return {
    command: commandTokens.join(" "),
    tokens: commandTokens,
    target,
    input,
    append,
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
    if (char === "\\" && next !== undefined) {
      current += char + next;
      index += 1;
      continue;
    }
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
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\\" && next !== undefined) {
      current += char + next;
      index += 1;
      continue;
    }
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
  return line.replace(/\$([A-Za-z_][A-Za-z0-9_]*|[0-9#@])/g, (_, key) => env[key] ?? "");
}

function isSupportedShellShebang(value) {
  return [
    "dindbsh",
    "/bin/dindbsh",
    "/usr/bin/dindbsh",
    "/usr/bin/env dindbsh",
  ].includes(value);
}

function formatLsEntry(os, node) {
  const stat = os.fs.lstat(node.path);
  const target = node.target ? ` -> ${node.target}` : "";
  return `${stat.permissions} ${stat.owner.padEnd(5)} ${stat.group.padEnd(5)} ${String(stat.size).padStart(6)} ${node.name}${target}`;
}

function formatLocalLsEntry(node) {
  const permissions = node.permissions || (node.type === "directory" ? "drwxrwxrwx" : "-rw-rw-rw-");
  const owner = node.owner || "guest";
  const group = node.group || "users";
  return `${permissions} ${owner.padEnd(5)} ${group.padEnd(5)} ${String(node.size || 0).padStart(6)} ${node.name}`;
}

function filterGrep(content, needle) {
  return String(content).split("\n").filter((line) => line.toLowerCase().includes(needle.toLowerCase())).join("\n");
}

function shellStatus(command, output) {
  const text = String(output ?? "");
  if (command === "grep" && text === "") return 1;
  if (command === "which" && text === "") return 1;
  if (command === "syscall") {
    try {
      const result = JSON.parse(text);
      if (result?.ok === false) return result.error?.code === "EINVAL" ? 2 : 1;
    } catch {
      return text.startsWith("syscall: usage") ? 2 : 1;
    }
  }
  if (!STATUS_PREFIX_COMMANDS.has(command)) return 0;
  if (text.startsWith(`${command}: usage`)) return 2;
  if (new RegExp(`^${escapeRegExp(command)}: missing(\\s|$)`).test(text)) return 2;
  if (text.startsWith(`${command}: invalid`)) return 2;
  if ((command === "su" || command === "sudo") && text.startsWith(`${command}: unsupported`)) return 1;
  if (text.startsWith(`${command}: unsupported`)) return 2;
  if (text.startsWith(`${command}:`) && text.includes("no such")) return 1;
  if (text.startsWith(`${command}:`) && text.includes("package not installed")) return 1;
  if (text.startsWith(`${command}:`) && text.includes("registry not found")) return 1;
  if (command === "man" && text.includes(": no manual entry")) return 1;
  if (command === "stat" && text.startsWith("stat: no such")) return 1;
  if (command === "manifest" && text.startsWith("manifest:") && text.includes("no such app")) return 1;
  if (command === "mount-local" && text.includes("not available in this browser")) return 1;
  return 0;
}

function parseJsonArgument(text, command) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected object");
    return parsed;
  } catch (error) {
    throw new Error(`${command}: invalid JSON argument: ${error.message}`);
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

function formatStorage(status) {
  return [
    `key=${status.key}`,
    `backend=${status.backend || "memory"}`,
    `structuredBackend=${status.structuredBackend || "memory"}`,
    `format=${status.storageFormat || "snapshot"}`,
    `enabled=${status.enabled}`,
    `persisted=${status.persisted}`,
    `persistentPermission=${status.persistentPermission || false}`,
    `bytes=${status.bytes}`,
    `inodeRecords=${status.inodeRecords || 0}`,
    `fileRecords=${status.fileRecords || 0}`,
    `contentBytes=${status.contentBytes || 0}`,
    `dirtyInodes=${status.dirtyInodes || 0}`,
    `dirtyFiles=${status.dirtyFiles || 0}`,
    `persistPending=${status.persistPending || false}`,
    `persistScheduled=${status.persistScheduled || 0}`,
    `persistCoalesced=${status.persistCoalesced || 0}`,
    `persistFlushes=${status.persistFlushes || 0}`,
    `usage=${status.usage ?? status.bytes}`,
    `quota=${status.quota || 0}`,
  ].join("\n");
}

function formatMountStatus(mounts) {
  if (!mounts.length) return "no local mounts";
  return mounts.map((mount) => {
    const suffix = mount.error ? ` (${mount.error})` : "";
    const helper = mount.nativeHelper?.configured
      ? ` helper=${mount.nativeHelper.renameSupported ? "rename" : "configured"}`
      : " helper=unavailable";
    return [
      mount.path,
      mount.type,
      mount.status || "unknown",
      mount.persisted ? "persisted" : "runtime",
      mount.handleName || mount.name,
    ].join(" ") + helper + suffix;
  }).join("\n");
}

function formatMountRestore(mounts) {
  if (!mounts.length) return "no persisted local mounts";
  return mounts.map((mount) => {
    const suffix = mount.error ? ` (${mount.error})` : "";
    return `${mount.status || "unknown"} ${mount.path}${suffix}`;
  }).join("\n");
}

function formatMountHelperStatus(helper = {}) {
  return [
    `status=${helper.status || "unavailable"}`,
    `protocol=${helper.protocol || "dindbos-file-helper-v1"}`,
    `name=${helper.name || "-"}`,
    `rename=${Boolean(helper.renameSupported)}`,
    `capabilities=${Array.isArray(helper.capabilities) && helper.capabilities.length ? helper.capabilities.join(",") : "-"}`,
  ].join("\n");
}

function commandSuggestions(os, command) {
  const query = String(command || "").toLowerCase();
  const candidates = new Map();
  Object.keys(BUILTIN_MANUALS).forEach((name) => candidates.set(name, name));
  safeRead(() => os.fs.list("/bin"), [])
    .concat(safeRead(() => os.fs.list("/usr/bin"), []))
    .filter((entry) => entry.type === "file" || entry.type === "app")
    .forEach((entry) => candidates.set(entry.name, entry.name));
  safeRead(() => os.apps.list(), []).forEach((app) => {
    if (app.id) candidates.set(app.id, `open ${app.id}`);
    if (app.name) candidates.set(String(app.name).toLowerCase(), `open ${app.name}`);
  });
  safeRead(() => os.packages.list(), []).forEach((record) => {
    if (record.id) candidates.set(record.id, `pkg info ${record.id}`);
    if (record.name) candidates.set(String(record.name).toLowerCase(), `pkg info ${record.id || record.name}`);
  });
  return [...candidates.entries()]
    .map(([key, label]) => ({ label, score: suggestionScore(query, key.toLowerCase()) }))
    .filter((entry) => entry.score <= Math.max(2, Math.ceil(query.length / 3)))
    .sort((left, right) => left.score - right.score || left.label.length - right.label.length || left.label.localeCompare(right.label))
    .map((entry) => entry.label)
    .filter((label, index, values) => values.indexOf(label) === index);
}

function suggestionScore(left, right) {
  if (!left || !right) return 99;
  if (left === right) return 0;
  if (right.includes(left) || left.includes(right)) return Math.abs(left.length - right.length);
  return editDistance(left, right);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function safeRead(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

async function safeAsync(read, fallback) {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

function formatNodeResult(result) {
  if (result.status) throw new Error(`node: process exited with status ${result.status}`);
  return result.output || "";
}

function parseNodeOptions(args) {
  const rest = [...args];
  let inputType = "";
  for (let index = 0; index < rest.length;) {
    const current = rest[index];
    if (current?.startsWith("--input-type=")) {
      inputType = current.split("=").slice(1).join("=");
      rest.splice(index, 1);
      continue;
    }
    if (current === "--input-type") {
      inputType = rest[index + 1] || "";
      rest.splice(index, 2);
      continue;
    }
    index += 1;
  }
  if (inputType && inputType !== "module" && inputType !== "commonjs") throw new Error(`node: unsupported input type: ${inputType}`);
  return { inputType, rest };
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
    `compatibility.tier=${record.compatibility?.tier || "A"}`,
    `compatibility.status=${record.compatibility?.status || "supported"}`,
    `trust.source=${record.trust?.source || "local"}`,
    `trust.trusted=${record.trust?.trusted ?? true}`,
    `trust.signature=${record.trust?.signature?.status || "local"}`,
    `trust.publisher=${record.trust?.signature?.publisherId || "-"}`,
    `trust.warnings=${record.trust?.warnings?.join("; ") || "-"}`,
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
