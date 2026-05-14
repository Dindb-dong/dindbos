import { compatibilitySnapshot } from "./compat.js?v=20260422-browserd";

const SHELL_HISTORY_DIR = "/var/lib/dindbos/shell-history";
const MAX_SHELL_HISTORY = 200;

const RECOVERY_ROOT = "/var/recovery/fsck";

const BUILTIN_MANUALS = {
  cat: "cat <file> - print file contents",
  cd: "cd [path] - change current directory",
  chgrp: "chgrp <group> <path> - change file group metadata where supported",
  chmod: "chmod <mode> <path> - change mode bits, for example chmod 644 note.txt",
  chown: "chown <owner[:group]> <path> - change file owner/group metadata as an administrator",
  clear: "clear - clear terminal output",
  companion: "companion list|grant|revoke - inspect or administer companion permissions",
  cp: "cp [-r] <source> <destination> - copy files or directories",
  curl: "curl <url> - fetch a URL through the DindbOS network broker",
  doctor: "doctor [compat] - print runtime diagnostics or compatibility tiers for troubleshooting",
  dig: "dig <host> - probe DNS policy through the DindbOS network broker",
  df: "df - show mounted filesystem storage status",
  echo: "echo <text> [> file|>> file] - print or redirect text",
  env: "env - list shell environment",
  export: "export KEY=value - set shell environment variable",
  find: "find [path] [name] - search files by name",
  bg: "bg <pid> - continue a stopped process in the background",
  fg: "fg <pid> - continue a stopped process in the foreground",
  fsck: "fsck [--dry-run|--repair|--salvage] - check VFS integrity, repair safe metadata, or export readable recovery data",
  grep: "grep <text> <file> - search lines in a text file",
  handlectl: "handlectl list [pid] [--all]|stat <handle>|revoke <handle> [reason] - inspect or revoke kernel handles",
  kill: "kill <pid> - terminate a process",
  jobs: "jobs - list process jobs and process groups",
  keychain: "keychain list|get|set|delete|lock|unlock|grant|revoke|audit|export|passkey|signing - manage DindbOS secrets",
  loginctl: "loginctl status|users|login|logout|switch|lock|unlock|policy|reset-guest - inspect or change DindbOS session state",
  ls: "ls [-la] [path] - list directory contents",
  lsof: "lsof [pid] [--all] - list open kernel handles by process",
  man: "man <command> - show command help",
  manifest: "manifest [app] - show app manifests",
  mkdir: "mkdir [-p] <path> - create directories",
  mount: "mount - print mounted virtual filesystems",
  "mount-local": "mount-local [name|--list|--restore|--forget path|--helper] - manage local folder mounts",
  mv: "mv <source> <destination> - move or rename files",
  node: "node [--input-type=module] [-e code] <file> - run JavaScript in the DindbOS runtime",
  netstat: "netstat - show DindbOS network broker diagnostics",
  npm: "npm install <package...> - install pure JavaScript npm packages into node_modules",
  open: "open [path] - open a path with its associated app",
  ping: "ping <host> - probe network policy; raw ICMP is unsupported in browser-only mode",
  pkg: "pkg list|info|install|run|strict|audit|cache|prefs|remove|search|registry|trust|update|deps|npm - manage DindbOS packages",
  policyctl: "policyctl list|show|audit [package] - inspect compiled package policies",
  ps: "ps - list running DindbOS processes",
  pwd: "pwd - print current directory",
  resetfs: "resetfs - clear persisted filesystem and reload",
  rm: "rm [-r] <path> - remove files or directories",
  shell: "shell syntax - use command chaining with &&, ||, ; plus pipes and redirection",
  stat: "stat [path] - show file metadata",
  storage: "storage [persist|flush] - show quota status, request persistence, or flush pending writes",
  su: "su [user] - unsupported browser-native privilege boundary placeholder",
  sudo: "sudo <command> - unsupported browser-native privilege boundary placeholder",
  sync: "sync [status|conflicts|resolve] - inspect and repair remote sync conflicts",
  syscall: "syscall <name> [json] - call the DindbOS syscall ABI and print structured JSON",
  timerctl: "timerctl list|stat|cancel - inspect or cancel kernel timers",
  touch: "touch <path> - create or update a file",
  tree: "tree [path] - render a directory tree",
  umount: "umount [--forget] <path> - unmount a local folder",
  wasm: "wasm <file> [args...] - run a WebAssembly module as a DindbOS process",
  wait: "wait <pid> - wait for a process exit record",
  which: "which <command> - locate a command through PATH",
};

const MAX_SCRIPT_DEPTH = 8;
const STATUS_PREFIX_COMMANDS = new Set([
  "find",
  "curl",
  "dig",
  "bg",
  "fg",
  "jobs",
  "keychain",
  "loginctl",
  "kill",
  "lsof",
  "man",
  "manifest",
  "mount-local",
  "node",
  "netstat",
  "npm",
  "ping",
  "companion",
  "pkg",
  "policyctl",
  "stat",
  "su",
  "sudo",
  "sync",
  "syscall",
  "timerctl",
  "fsck",
  "handlectl",
  "tree",
  "umount",
  "wasm",
  "wait",
  "which",
]);

export class ShellSession {
  constructor(os, options = {}) {
    this.os = os;
    this.ptySessionId = options.ptySessionId || "";
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
    this.loadHistory();
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
    const locked = this.lockedSessionResult(line);
    if (locked) return locked;
    this.recordHistory(line);
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
    const locked = this.lockedSessionResult(line);
    if (locked) return locked;
    this.recordHistory(line);
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

  lockedSessionResult(line = "") {
    if (/^loginctl\s+(status|unlock|login|policy|reset-guest)\b/.test(line)) return null;
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
    const pipeProcess = pipeline.length > 1 ? this.spawnPipelineProcess() : null;
    try {
      for (const segment of pipeline) {
        result = this.executeSegment(segment, stdin);
        stdin = this.pipeThroughDescriptor(pipeProcess, result.output);
        if (result.clear || result.reload) return result;
      }
      return result;
    } finally {
      this.closePipelineProcess(pipeProcess);
    }
  }

  async executePipelineAsync(commandLine) {
    const pipeline = splitPipeline(commandLine);
    let stdin = "";
    let result = { output: "", clear: false, reload: false, status: 0 };
    const pipeProcess = pipeline.length > 1 ? this.spawnPipelineProcess() : null;
    try {
      for (const segment of pipeline) {
        result = await this.executeSegmentAsync(segment, stdin);
        stdin = this.pipeThroughDescriptor(pipeProcess, result.output);
        if (result.clear || result.reload) return result;
      }
      return result;
    } finally {
      this.closePipelineProcess(pipeProcess);
    }
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
      reserveShellStorage(this.os, value, redirect.target, this.cwd, redirect.append ? "redirect-append" : "redirect-write");
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
      } else {
        reserveShellStorage(this.os, value, redirect.target, this.cwd, redirect.append ? "redirect-append" : "redirect-write");
        if (redirect.append) this.os.fs.appendFile(redirect.target, value, this.cwd, this.principal);
        else this.os.fs.writeOrCreateFile(redirect.target, value, this.cwd, {}, this.principal);
      }
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
    if (command === "chown") return this.chown(args);
    if (command === "chgrp") return this.chgrp(args);
    if (command === "stat") return this.stat(args[0] || this.cwd);
    if (command === "readlink") return this.os.fs.lstat(args[0] || this.cwd, this.cwd, this.principal)?.target || "";
    if (command === "find") return this.find(args);
    if (command === "fsck") return this.fsck(args);
    if (command === "handlectl") return this.handlectl(args);
    if (command === "open") {
      this.os.openPath(this.os.fs.normalize(args[0] || this.cwd, this.cwd));
      return "";
    }
    if (command === "apps") return this.os.apps.list().map((app) => `${app.id} - ${app.name}`).join("\n");
    if (command === "manifest") return this.manifest(args[0]);
    if (command === "mount-local") return this.mountLocal(args);
    if (command === "umount") return this.umount(args);
    if (command === "pkg") return this.pkg(args);
    if (command === "policyctl") return this.policyctl(args);
    if (command === "companion") return this.companion(args);
    if (command === "ps") return this.os.processes.table();
    if (command === "jobs") return this.jobs();
    if (command === "fg") return this.fg(args);
    if (command === "bg") return this.bg(args);
    if (command === "wait") return this.wait(args);
    if (command === "lsof") return this.lsof(args);
    if (command === "kill") return this.kill(args);
    if (command === "keychain") return this.keychain(args);
    if (command === "loginctl") return this.loginctl(args);
    if (command === "curl") return this.curl(args);
    if (command === "netstat") return this.netstat();
    if (command === "ping") return this.ping(args);
    if (command === "dig") return this.dig(args);
    if (command === "storage") return this.storage(args);
    if (command === "sync") return this.sync(args);
    if (command === "syscall") return this.syscall(args);
    if (command === "timerctl") return this.timerctl(args);
    if (command === "resetfs") return this.resetFileSystem();
    if (command === "su" || command === "sudo") return this.privilegeEscalation(command);
    if (command === "whoami") return this.env.USER;
    if (command === "id") return this.id();
    if (command === "uname") return "DindbOS.js browser-runtime 0.2.0";
    if (command === "date") return new Date().toString();
    if (command === "doctor") return this.doctor(args);
    if (command === "history") return this.history.map((entry, index) => `${String(index + 1).padStart(4)}  ${entry}`).join("\n");
    if (command === "env") return Object.entries(this.env).map(([key, value]) => `${key}=${value}`).join("\n");
    if (command === "export") return this.export(args);
    if (command === "which") return this.which(args[0]);
    if (command === "man") return BUILTIN_MANUALS[args[0]] || `man: ${args[0] || ""}: no manual entry`;
    if (command === "node") return this.node(args);
    if (command === "wasm") return this.wasm(args, stdin);
    if (command === "npm") return this.npm(args);
    if (command === "df") return this.df();
    if (command === "mount") return this.mount(args);
    const script = this.resolveExecutable(command);
    if (script?.path.endsWith(".wasm")) return this.executeWasm(script.path, args, stdin);
    if (script) return this.executeScript(script.path, args, stdin, options.scriptDepth || 0);
    throw new Error(this.commandNotFound(command));
  }

  spawnPipelineProcess() {
    if (!this.os.processes?.spawn || !this.os.descriptors?.pipe) return null;
    return this.os.processes.spawn({
      id: "shell:pipeline",
      name: "Shell Pipeline",
      manifest: {
        version: "0.1.0",
        entry: "shell:pipeline",
        capabilities: [],
        fileSystem: {
          read: [this.cwd],
          write: [this.cwd],
        },
      },
    }, {
      cwd: this.cwd,
      runtime: "shell",
    });
  }

  closePipelineProcess(process) {
    if (!process?.pid || !this.os.processes?.get?.(process.pid)) return;
    this.os.processes.kill(process.pid, "pipeline-exit");
  }

  pipeThroughDescriptor(process, output = "") {
    if (!process?.pid || !this.os.descriptors?.pipe) return output;
    const text = String(output ?? "");
    const pipe = this.os.descriptors.pipe(process);
    this.os.descriptors.write(process, { fd: pipe.writeFd, data: text }, { principal: this.principal });
    this.os.descriptors.close(process, { fd: pipe.writeFd });
    const result = this.os.descriptors.read(process, { fd: pipe.readFd, length: text.length });
    this.os.descriptors.close(process, { fd: pipe.readFd });
    return result.data;
  }

  commandNotFound(command) {
    const suggestions = commandSuggestions(this.os, command);
    const suffix = suggestions.length ? `\nDid you mean: ${suggestions.slice(0, 3).join(", ")}?` : "";
    return `command not found: ${command}${suffix}`;
  }

  privilegeEscalation(command) {
    this.os.auditSecurity?.(`permission-escalation:${command}`, "denied", {
      principal: this.principal,
      target: command,
      reason: "unsupported-browser-runtime",
    });
    return `${command}: unsupported in DindbOS browser runtime; session user is fixed to ${this.env.USER}`;
  }

  id() {
    const credentials = this.os.credentialsForUser?.(this.env.USER, this.os.session.groups) || {
      user: this.env.USER,
      uid: this.env.USER,
      gid: (this.os.session.groups || ["users"])[0],
      groups: this.os.session.groups || ["users"],
      supplementaryGids: [],
    };
    const groups = (credentials.groups || []).map((group, index) => {
      const gid = credentials.supplementaryGids?.[index] ?? credentials.gid;
      return `${gid}(${group})`;
    });
    return `uid=${credentials.uid}(${credentials.user}) gid=${credentials.gid}(${credentials.groups?.[0] || "users"}) groups=${groups.join(",")}`;
  }

  loginctl(args) {
    const subcommand = args[0] || "status";
    if (subcommand === "status") {
      const status = this.os.sessionStatus?.() || {};
      const credentials = this.os.credentialsForUser?.(status.user, status.groups) || {};
      return [
        `user=${status.user || this.env.USER}`,
        `uid=${credentials.uid ?? "-"}`,
        `gid=${credentials.gid ?? "-"}`,
        `groups=${(status.groups || []).join(",")}`,
        `home=${status.home || this.env.HOME}`,
        `state=${status.state || "unknown"}`,
        `locked=${Boolean(status.locked)}`,
        `auth=${status.authMethod || "-"}`,
        `sessionId=${status.sessionId || "-"}`,
      ].join(" ");
    }
    if (subcommand === "policy") {
      const policy = this.os.authenticationPolicy?.() || {};
      return [
        `mode=${policy.mode || "unknown"}`,
        `methods=${(policy.loginMethods || []).join(",") || "-"}`,
        `password=${policy.password?.status || "unknown"}`,
        `passkey=${policy.passkey?.status || "unknown"}`,
        `guestReset=${Boolean(policy.guestReset?.supported)}`,
      ].join(" ");
    }
    if (subcommand === "users") {
      return (this.os.listUsers?.() || [])
        .map((user) => `${String(user.uid ?? "-").padEnd(5)} ${user.user.padEnd(16)} ${(user.groups || []).join(",").padEnd(20)} ${user.home}`)
        .join("\n");
    }
    if (subcommand === "login") {
      const user = args[1];
      const method = args[2] || "session-placeholder";
      if (!user) return "loginctl: usage: loginctl login <user> [session-placeholder|password|passkey]";
      const status = this.os.loginSessionUser?.(user, { method });
      this.applySessionStatus(status);
      return `logged in ${status.user} method=${status.authMethod || method} home=${status.home}`;
    }
    if (subcommand === "logout") {
      const status = this.os.logoutSession?.(args.slice(1).join(" ") || "shell") || {};
      return `loggedOut=${status.state === "logged-out"} user=${status.user || this.env.USER}`;
    }
    if (subcommand === "switch") {
      const user = args[1];
      if (!user) return "loginctl: usage: loginctl switch <user>";
      const status = this.os.switchSessionUser(user);
      this.applySessionStatus(status);
      return `switched to ${status.user} home=${status.home}`;
    }
    if (subcommand === "lock") {
      const status = this.os.lockSession?.(args.slice(1).join(" ") || "shell") || {};
      return `locked=${Boolean(status.locked)} user=${status.user || this.env.USER}`;
    }
    if (subcommand === "unlock") {
      const status = this.os.unlockSession?.() || {};
      this.applySessionStatus(status);
      return `locked=${Boolean(status.locked)} user=${status.user || this.env.USER}`;
    }
    if (subcommand === "reset-guest") {
      const result = this.os.resetGuestSession?.({ principal: this.principal }) || {};
      return `guest reset=${Boolean(result.reset)} home=${result.home || "/home/guest"}`;
    }
    return `loginctl: unsupported subcommand: ${subcommand}`;
  }

  applySessionStatus(status = {}) {
    if (!status.user) return;
    this.env.USER = status.user;
    this.env.HOME = status.home || `/home/${status.user}`;
    this.cwd = this.env.HOME;
    this.env.PWD = this.cwd;
    this.principal = this.os.permissions?.principal?.({ user: this.env.USER, groups: status.groups || ["users"] }) || this.principal;
    this.loadHistory();
  }

  recordHistory(line) {
    this.history.push(line);
    this.history = this.history.slice(-MAX_SHELL_HISTORY);
    this.historyIndex = this.history.length;
    this.writeHistory();
  }

  loadHistory() {
    const path = this.historyPath();
    const system = this.os.permissions?.systemPrincipal?.();
    if (!system || !this.os.fs?.exists?.(path)) {
      this.history = [];
      this.historyIndex = 0;
      return;
    }
    try {
      const parsed = JSON.parse(this.os.fs.readFile(path, "/", system));
      this.history = Array.isArray(parsed.entries) ? parsed.entries.map(String).slice(-MAX_SHELL_HISTORY) : [];
    } catch {
      this.history = [];
    }
    this.historyIndex = this.history.length;
  }

  writeHistory() {
    const system = this.os.permissions?.systemPrincipal?.();
    if (!system || !this.os.fs) return;
    ensureShellHistoryDirectory(this.os, this.env.USER);
    const payload = {
      version: 1,
      user: this.env.USER,
      updatedAt: new Date().toISOString(),
      entries: this.history.slice(-MAX_SHELL_HISTORY),
    };
    this.os.fs.writeOrCreateFile(this.historyPath(), `${JSON.stringify(payload, null, 2)}\n`, "/", {
      owner: this.env.USER,
      group: "users",
      permissions: "-rw-------",
      mime: "application/json",
    }, system);
  }

  historyPath(user = this.env.USER) {
    const safeUser = encodeURIComponent(String(user || "guest"));
    return `${SHELL_HISTORY_DIR}/${safeUser && safeUser !== "." && safeUser !== ".." ? safeUser : "guest"}.json`;
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
      const content = existing ? this.os.fs.readFile(path, this.cwd, this.principal) : "";
      reserveShellStorage(this.os, content, path, this.cwd, "touch");
      this.os.fs.writeOrCreateFile(path, content, this.cwd, {}, this.principal);
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

  chown(args) {
    if (args.length < 2) throw new Error("chown: usage: chown <owner[:group]> <path>");
    const [owner, group = ""] = args[0].split(":");
    this.os.fs.chown(args[1], owner, group, this.cwd, this.principal);
    return "";
  }

  chgrp(args) {
    if (args.length < 2) throw new Error("chgrp: usage: chgrp <group> <path>");
    this.os.fs.chgrp(args[1], args[0], this.cwd, this.principal);
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
    if (action === "run") {
      if (!operand) return "pkg: usage: pkg run <package> [args...]";
      return this.os.packages.runCli(operand, rest, { cwd: this.cwd })
        .then((result) => result.status
          ? [`pkg: ${result.packageId}: exit ${result.status}`, result.output].filter(Boolean).join("\n")
          : result.output);
    }
    if (action === "strict") {
      if (!operand) return "pkg: usage: pkg strict <manifest-path|package>";
      const report = this.os.packages.strictNamespaceCheck(operand, this.cwd);
      const output = formatStrictNamespaceReport(report);
      return report.strict ? output : `pkg: strict failed\n${output}`;
    }
    if (action === "audit") {
      return formatPackageAudit(this.os.packages.audit(operand || ""));
    }
    if (action === "cache") {
      return this.pkgCache(operand, rest);
    }
    if (action === "prefs" || action === "preferences") {
      return this.pkgPrefs(operand, rest);
    }
    if (action === "npm") {
      return this.pkgNpm(operand, rest);
    }
    if (action === "remove" || action === "uninstall") {
      if (!operand) return `pkg: usage: pkg ${action} <package>`;
      const record = this.os.packages.remove(operand);
      return `removed ${record.id}`;
    }
    return "pkg: usage: pkg list | info | install | run | strict | audit | cache | prefs | search | registry | trust | update | deps | npm | remove";
  }

  policyctl(args) {
    const [action = "list", packageId] = args;
    if (action === "list" || action === "status") {
      return formatPolicyStatus(this.os.packages.policyStatus(packageId || ""));
    }
    if (action === "show" || action === "cat") {
      if (!packageId) return `policyctl: usage: policyctl ${action} <package>`;
      return formatPackagePolicy(this.os.packages.policy(packageId));
    }
    if (action === "audit") {
      return formatPackageAudit(this.os.packages.audit(packageId || ""));
    }
    return "policyctl: usage: policyctl list [package] | show <package> | audit [package]";
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
      this.os.assertAdminOperation?.("package-trust:add", { principal: this.principal, target: id });
      const publisher = this.os.packages.addTrustedPublisher({ id, publicKey, name: nameParts.join(" ") || id });
      return `trusted publisher added ${publisher.id}`;
    }
    if (action === "remove") {
      const [idOrKey] = args;
      if (!idOrKey) return "pkg: usage: pkg trust remove <publisher-id|public-key>";
      this.os.assertAdminOperation?.("package-trust:remove", { principal: this.principal, target: idOrKey });
      return `trusted publisher removed ${this.os.packages.removeTrustedPublisher(idOrKey)}`;
    }
    return "pkg: usage: pkg trust list | add <publisher-id> <public-key> [name] | remove <publisher-id|public-key>";
  }

  companion(args) {
    const [action, identity, protocolVersion, ...capabilities] = args;
    if (!action || action === "list") {
      const records = this.os.listCompanionPermissions?.() || [];
      return records.length
        ? records.map((record) => formatCompanionPermission(record)).join("\n")
        : "companion: no companion permissions";
    }
    if (action === "grant" || action === "approve") {
      if (!identity || !protocolVersion) return "companion: usage: companion grant <identity> <protocol-version> [capability...]";
      const record = this.os.grantCompanionPermission(identity, protocolVersion, capabilities, { principal: this.principal });
      return `companion granted ${record.identity} ${record.protocolVersion} capabilities=${record.capabilities.join(",") || "-"}`;
    }
    if (action === "revoke" || action === "remove") {
      if (!identity) return "companion: usage: companion revoke <identity>";
      const record = this.os.revokeCompanionPermission(identity, { principal: this.principal });
      return `companion revoked ${record.identity}`;
    }
    return "companion: usage: companion list | grant <identity> <protocol-version> [capability...] | revoke <identity>";
  }

  keychain(args) {
    const [action, name, ...rest] = args;
    const context = { appId: "shell", principal: this.principal };
    if (!action || action === "list") {
      const records = this.os.keychain.list(context);
      return records.length
        ? records.map((record) => formatKeychainRecord(record)).join("\n")
        : "keychain: no secrets";
    }
    if (action === "status") {
      const status = this.os.keychain.status(context);
      return [
        `user=${status.user}`,
        `locked=${status.locked}`,
        `records=${status.records}`,
        `grants=${status.grants}`,
        `unlock=${status.unlockMethod}`,
        `webcrypto=${status.webCrypto}`,
        `passkey=${status.passkeyEnrolled}`,
        `passkeySupported=${status.passkeySupported}`,
        `warning=${status.fallbackWarning || "-"}`,
      ].join(" ");
    }
    if (action === "get") {
      if (!name) return "keychain: usage: keychain get <name>";
      return this.os.keychain.getSecret(name, context).value;
    }
    if (action === "export") {
      if (!name) return "keychain: usage: keychain export <name>";
      return JSON.stringify(this.os.keychain.exportSecret(name, context));
    }
    if (action === "set") {
      const value = rest.join(" ");
      if (!name || !value) return "keychain: usage: keychain set <name> <value>";
      const record = this.os.keychain.setSecret(name, value, { ownerAppId: "shell" }, context);
      return `keychain secret set ${record.name}`;
    }
    if (action === "delete" || action === "rm") {
      if (!name) return "keychain: usage: keychain delete <name>";
      return `keychain secret deleted ${this.os.keychain.deleteSecret(name, context).name}`;
    }
    if (action === "lock") {
      this.os.keychain.lock(context);
      return "keychain locked";
    }
    if (action === "unlock") {
      const status = this.os.keychain.unlock(rest.join(" ") || name || "", context);
      return `keychain unlocked ${status.unlockMethod}${status.fallbackWarning ? ` warning=${status.fallbackWarning}` : ""}`;
    }
    if (action === "grant") {
      const [appId, ttl] = rest;
      if (!name || !appId) return "keychain: usage: keychain grant <name> <app-id> [ttl-ms]";
      const record = this.os.keychain.grant(name, appId, { ttlMs: Number(ttl || 0) || undefined }, context);
      return `keychain grant ${record.name} ${appId}`;
    }
    if (action === "revoke") {
      const [appId] = rest;
      if (!name || !appId) return "keychain: usage: keychain revoke <name> <app-id>";
      const record = this.os.keychain.revoke(name, appId, context);
      return `keychain revoke ${record.name} ${appId}`;
    }
    if (action === "audit") {
      const entries = this.os.keychain.auditEntries(context).slice(-20);
      return entries.length
        ? entries.map((entry) => `${entry.at} ${entry.action} ${entry.name} requester=${entry.requester} result=${entry.result}${entry.detail ? ` ${entry.detail}` : ""}`).join("\n")
        : "keychain: no audit records";
    }
    if (action === "passkey") return this.keychainPasskey(name, rest, context);
    if (action === "signing") return this.keychainSigning(name, rest, context);
    return "keychain: usage: keychain list|get|set|delete|lock|unlock|grant|revoke|audit|export|passkey|signing";
  }

  async keychainPasskey(action, args, context) {
    if (action === "enroll") {
      const status = await this.os.keychain.enrollPasskey({ label: args.join(" ") || "default" }, context);
      return `keychain passkey enrolled credential=${status.passkeyCredentialId || "-"} label=${status.passkeyLabel || "default"}`;
    }
    if (action === "unlock") {
      const status = await this.os.keychain.unlockWithPasskey(context);
      return `keychain unlocked ${status.unlockMethod}`;
    }
    if (action === "reauth" || action === "reauthenticate") {
      const status = await this.os.keychain.reauthenticateWithPasskey(context);
      return `keychain passkey reauthenticated ${status.unlockMethod}`;
    }
    return "keychain: usage: keychain passkey enroll [label] | unlock | reauth";
  }

  keychainSigning(action, args, context) {
    const [name, publisherId] = args;
    if (action === "create") {
      if (!name || !publisherId) return "keychain: usage: keychain signing create <name> <publisher-id>";
      const record = this.os.keychain.createSigningKey(name, publisherId, context);
      return `keychain signing key ${record.name} ${record.publicKey}`;
    }
    if (action === "lookup") {
      if (!name) return "keychain: usage: keychain signing lookup <name>";
      const record = this.os.keychain.signingKey(name, context);
      return `keychain signing key ${record.name} publisher=${record.publisherId || "-"} publicKey=${record.publicKey} ref=${record.secretRef}`;
    }
    return "keychain: usage: keychain signing create|lookup";
  }

  async curl(args) {
    const [url] = args;
    if (!url) return "curl: usage: curl <url>";
    const response = await this.os.network.fetch(url, {}, { appId: "shell", principal: this.principal });
    return response.text;
  }

  netstat() {
    const status = this.os.network.status();
    return [
      `active=${status.totals.active}`,
      `requests=${status.totals.requests}`,
      `denied=${status.totals.denied}`,
      `bytesReceived=${status.totals.bytesReceived}`,
      `websocket=${status.websocket.supported ? "supported" : status.websocket.reason}`,
      `websocketSessions=${status.websocket.sessions.length}`,
      `webrtc=${status.webrtc.supported ? "supported" : status.webrtc.reason}`,
      `webrtcDataChannels=${status.webrtc.dataChannels.length}`,
      `rawSockets=${status.rawSockets.sessions.length}`,
      `loopbackServices=${status.services?.length || 0}`,
      `firewallAllowed=${status.firewall?.allowed || 0}`,
      `firewallDenied=${status.firewall?.denied || 0}`,
      `companion=${status.companion.rawTcpUdp}`,
      ...(status.services || []).slice(-5).map((entry) => `service ${entry.id} ${entry.host} requests=${entry.requests}`),
      ...status.history.slice(-5).map((entry) => `${entry.status} ${entry.host} ${entry.statusCode || "-"} ${entry.bytesReceived || 0}B`),
      ...status.websocket.sessions.slice(-5).map((entry) => `websocket-${entry.state} ${entry.host} sent=${entry.messagesSent} recv=${entry.messagesReceived}`),
      ...status.websocket.history.slice(-5).map((entry) => `websocket-${entry.state} ${entry.host} code=${entry.closeCode}`),
      ...status.webrtc.dataChannels.slice(-5).map((entry) => `webrtc-${entry.state} ${entry.peer} sent=${entry.messagesSent} recv=${entry.messagesReceived}`),
      ...status.webrtc.history.slice(-5).map((entry) => `webrtc-${entry.state} ${entry.peer}`),
      ...status.rawSockets.sessions.slice(-5).map((entry) => `raw-${entry.protocol}-${entry.state} ${entry.host}:${entry.port} companion=${entry.companion}`),
      ...status.rawSockets.history.slice(-5).map((entry) => `raw-${entry.protocol}-${entry.state} ${entry.host}:${entry.port} companion=${entry.companion}`),
      ...status.deniedHosts.slice(-5).map((entry) => `denied ${entry.host} ${entry.reason}`),
    ].join("\n");
  }

  ping(args) {
    const [host] = args;
    if (!host) return "ping: usage: ping <host>";
    const url = host.includes("://") ? host : `https://${host}`;
    const probe = this.os.network.policyProbe(url, { appId: "shell", principal: this.principal });
    return probe.allowed
      ? `ping: ${probe.host}: policy allowed; raw ICMP unsupported in browser-only mode`
      : `ping: ${probe.host}: ${probe.reason}`;
  }

  dig(args) {
    const [host] = args;
    if (!host) return "dig: usage: dig <host>";
    const probe = this.os.network.dnsProbe(host, { appId: "shell", principal: this.principal });
    return probe.allowed
      ? `dig: ${probe.host}: ${probe.addresses.join(",")} rawDnsSupported=${probe.rawDnsSupported}`
      : `dig: ${probe.host}: ${probe.reason}`;
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

  pkgCache(action, args) {
    if (action === "clear" || action === "evict") {
      const [packageId] = args;
      if (!packageId) return "pkg: usage: pkg cache clear <package>";
      const result = this.os.packages.evictNamespaceCache(packageId);
      return `package cache cleared ${result.packageId} ${result.cacheRoot} bytes=${result.removedBytes}`;
    }
    return "pkg: usage: pkg cache clear <package>";
  }

  pkgPrefs(action, args) {
    if (!action || action === "list") {
      const prefs = this.os.packagePreferences?.(this.env.USER);
      const packages = Object.entries(prefs?.packages || {});
      if (!packages.length) return "pkg: no package preferences";
      return packages
        .flatMap(([packageId, values]) => Object.entries(values).map(([key, value]) => `${packageId} ${key}=${JSON.stringify(value)}`))
        .join("\n");
    }
    if (action === "set") {
      const [packageId, key, ...valueParts] = args;
      if (!packageId || !key || !valueParts.length) return "pkg: usage: pkg prefs set <package> <key> <value>";
      const value = this.os.setPackagePreference(packageId, key, valueParts.join(" "), this.env.USER);
      return `package preference set ${packageId} ${key}=${JSON.stringify(value)}`;
    }
    if (action === "remove" || action === "unset") {
      const [packageId, key] = args;
      if (!packageId || !key) return "pkg: usage: pkg prefs remove <package> <key>";
      return `package preference removed ${packageId} ${key} existed=${this.os.removePackagePreference(packageId, key, this.env.USER)}`;
    }
    return "pkg: usage: pkg prefs list | set <package> <key> <value> | remove <package> <key>";
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
    if (args[0] === "kernel") {
      this.os.writeStorageKernelProcfs?.("shell");
      return formatStorageKernel(this.os.storageKernelStatus?.("shell") || {});
    }
    if (args[0] === "fsck") {
      const repair = args.includes("--repair") || args.includes("--dry-run");
      const dryRun = args.includes("--dry-run") || !args.includes("--repair");
      const salvage = args.includes("--salvage");
      return this.os.runStorageFsck({ repair, dryRun, salvage }).then((result) => formatFsck(result, { explain: args.includes("--explain") }));
    }
    if (args[0] === "flush") {
      this.os.assertAdminOperation?.("system-settings:storage-flush", { principal: this.principal, target: "storage.flush" });
      return this.os.flushPersistentFileSystem().then(() => formatStorage(this.withPersistenceStatus(this.os.storage.status())));
    }
    if (args[0] === "persist") {
      this.os.assertAdminOperation?.("system-settings:storage-persist", { principal: this.principal, target: "storage.persist" });
      return this.os.storage.persist().then((status) => formatStorage(this.withPersistenceStatus(status)));
    }
    return this.os.storage.estimate().then((status) => formatStorage(this.withPersistenceStatus(status)));
  }

  async fsck(args = []) {
    const repair = args.includes("--repair") || args.includes("--dry-run");
    const dryRun = args.includes("--dry-run") || !args.includes("--repair");
    const explain = args.includes("--explain") || args[0] === "explain";
    const salvage = args.includes("--salvage");
    let result = this.os.fs.checkIntegrity({ repair, dryRun });
    result = mergeFsckResults(result, safeRead(() => this.os.packages?.checkIntegrity?.({ repair, dryRun }), null));
    result = mergeFsckResults(result, await safeAsync(() => this.os.storage?.checkIntegrity?.({ repair, dryRun }), null));
    result = mergeFsckResults(result, await safeAsync(() => this.os.localMounts?.checkIntegrity?.({ repair, dryRun }), null));
    if (salvage) result = { ...result, salvage: this.writeFsckSalvageExport() };
    this.recordFsckLog(result);
    return formatFsck(result, { explain });
  }

  writeFsckSalvageExport() {
    const principal = this.os.permissions?.systemPrincipal?.() || this.principal;
    ["/var", "/var/recovery", RECOVERY_ROOT].forEach((path) => {
      if (!this.os.fs.exists(path)) this.os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, principal);
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = this.os.fs.join(RECOVERY_ROOT, stamp);
    this.os.fs.createDirectory(directory, "/", { owner: "root", group: "root", permissions: "drwx------" }, principal);
    const archive = this.os.fs.salvageExport({ root: "/" });
    const path = this.os.fs.join(directory, "salvage.dindbos-fsck-export.json");
    this.os.fs.writeOrCreateFile(path, `${JSON.stringify(archive, null, 2)}\n`, "/", {
      owner: "root",
      group: "root",
      permissions: "-rw-------",
      mime: "application/json",
    }, principal);
    return {
      path,
      directory,
      entries: archive.entryCount,
      skipped: archive.skippedCount,
    };
  }

  recordFsckLog(result = {}) {
    const principal = this.os.permissions?.systemPrincipal?.() || this.principal;
    ["/var", "/var/log", "/var/log/dindbos"].forEach((path) => {
      if (!this.os.fs.exists(path)) this.os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, principal);
    });
    const runId = `fsck-${Date.now().toString(36)}`;
    const auditRecords = this.fsckAuditRecords(result, runId);
    const line = [
      new Date().toISOString(),
      `run=${runId}`,
      `ok=${Boolean(result.ok)}`,
      `dryRun=${Boolean(result.dryRun)}`,
      `repaired=${Boolean(result.repaired)}`,
      `checked=${Number(result.checkedNodes || 0)}`,
      `packages=${Number(result.checkedPackages || 0)}`,
      `storage=${Number(result.checkedStorage || 0)}`,
      `localMounts=${Number(result.checkedLocalMounts || 0)}`,
      `problems=${Number(result.problemCount || 0)}`,
      `repairs=${Number(result.repairCount || 0)}`,
      `salvage=${result.salvage?.path || "-"}`,
      `auditRecords=${auditRecords.length}`,
      `codes=${[...(result.problems || [])].map((entry) => entry.code).join(",") || "-"}`,
    ].join(" ");
    const path = "/var/log/dindbos/fsck.log";
    if (this.os.fs.exists(path)) this.os.fs.appendFile(path, `${line}\n`, "/", principal);
    else this.os.fs.writeOrCreateFile(path, `${line}\n`, "/", { owner: "root", group: "root", permissions: "-rw-r--r--", mime: "text/plain" }, principal);
    if (auditRecords.length) this.appendFsckAuditLog(auditRecords, principal);
  }

  fsckAuditRecords(result = {}, runId = "") {
    const at = new Date().toISOString();
    const problems = (result.problems || []).map((entry) => ({
      at,
      runId,
      record: "problem",
      action: entry.repairable
        ? (result.dryRun ? "repair-planned" : "repair-eligible")
        : "repair-refused",
      code: entry.code || "unknown",
      path: entry.path || "",
      message: entry.message || "",
      repairable: Boolean(entry.repairable),
      dryRun: Boolean(result.dryRun),
    }));
    const repairs = (result.repairs || []).map((entry) => ({
      at,
      runId,
      record: "repair",
      action: entry.dryRun ? "mutation-planned" : "mutation-applied",
      kind: entry.kind || "unknown",
      path: entry.path || "",
      from: entry.from ?? "",
      to: entry.to ?? "",
      dryRun: Boolean(entry.dryRun),
    }));
    return [...problems, ...repairs];
  }

  appendFsckAuditLog(records = [], principal = this.principal) {
    const path = "/var/log/dindbos/fsck-audit.log";
    const lines = records.map((record) => `${JSON.stringify(record)}\n`).join("");
    if (this.os.fs.exists(path)) this.os.fs.appendFile(path, lines, "/", principal);
    else this.os.fs.writeOrCreateFile(path, lines, "/", { owner: "root", group: "root", permissions: "-rw-r--r--", mime: "application/jsonl" }, principal);
  }

  sync(args) {
    const [action, operand, target] = args;
    if (!action || action === "status") {
      const status = safeRead(() => this.os.remoteSyncStatus?.(), null);
      const conflicts = safeRead(() => this.os.listRemoteSyncConflicts?.(), []);
      return [
        `backend=${status?.backend || "unavailable"} encrypted=${Boolean(status?.encrypted)} rules=${Number(status?.mergeRuleCount || 0)}`,
        `lastSnapshot=${status?.lastSuccessfulSnapshot?.createdAt || "-"}`,
        `lastApplied=${status?.lastAppliedSnapshot?.appliedAt || "-"} conflicts=${Number(status?.lastAppliedSnapshot?.conflicts || 0)} refused=${Number(status?.lastAppliedSnapshot?.refused || 0)}`,
        `applyRun=${status?.lastApplyRun?.status || "-"} next=${Number(status?.lastApplyRun?.nextIndex || 0)}/${Number(status?.lastApplyRun?.totalFiles || 0)}`,
        `lastRetry=${status?.lastRetry?.retriedAt || "-"} applied=${Number(status?.lastRetry?.applied || 0)} refused=${Number(status?.lastRetry?.refused || 0)}`,
        `pendingConflicts=${Array.isArray(conflicts) ? conflicts.length : 0}`,
      ].join("\n");
    }
    if (action === "conflicts") {
      const conflicts = safeRead(() => this.os.listRemoteSyncConflicts?.(), []);
      if (!conflicts.length) return "sync: no pending conflicts";
      return conflicts.map((conflict) => `${conflict.path} -> ${conflict.targetPath} bytes=${conflict.bytes}`).join("\n");
    }
    if (action === "resolve") {
      if (!operand || !target) return "sync: usage: sync resolve <use-conflict|keep-local|delete-conflict> <conflict-path>";
      const result = this.os.resolveRemoteSyncConflict(target, { action: operand });
      return `sync: resolved ${result.path} action=${result.action} target=${result.targetPath} remaining=${result.remainingConflicts}`;
    }
    return "sync: usage: sync status | conflicts | resolve <use-conflict|keep-local|delete-conflict> <conflict-path>";
  }

  async doctor(args = []) {
    if (args[0] === "compat") return this.doctorCompat();
    if (args[0] === "browser") return this.doctorBrowser();
    const sessionStatus = safeRead(() => this.os.sessionStatus?.(), null);
    const storage = await safeAsync(() => this.os.storage?.estimate?.(), safeRead(() => this.os.storage?.status?.(), {}));
    const mounts = await safeAsync(() => this.os.localMounts?.status?.(), []);
    const packages = safeRead(() => this.os.packages?.list?.(), []);
    const processes = safeRead(() => this.os.processes?.list?.(), []);
    const lifecycle = safeRead(() => this.os.lifecycleStatus?.(), null);
    const recovery = safeRead(() => this.os.recoveryStatus?.(), null);
    const sync = safeRead(() => this.os.remoteSyncStatus?.(), null);
    const syncMerge = safeRead(() => this.os.remoteSyncMergePolicy?.(), null);
    const handoff = sessionStatus?.coordination?.handoff;
    const handoffRelay = handoff?.relay || {};
    const compositor = safeRead(() => this.os.windows?.compositorStatus?.(), null);
    const groups = this.os.session.groups || ["users"];
    const localMountSupported = Boolean(safeRead(() => this.os.localMounts?.supported?.(), false));
    const mounted = Array.isArray(mounts) ? mounts.filter((mount) => mount.status !== "forgotten").length : 0;
    const persistedMounts = Array.isArray(mounts) ? mounts.filter((mount) => mount.persisted).length : 0;
    const mountErrors = Array.isArray(mounts) ? mounts.filter((mount) => mount.error).length : 0;
    const helper = safeRead(() => this.os.localMounts?.nativeHelperStatus?.(), {});
    return [
      "DindbOS doctor",
      `session user=${this.env.USER} groups=${groups.join(",")} home=${this.env.HOME} cwd=${this.cwd} locked=${sessionStatus?.locked || false}`,
      `sessionCoord role=${sessionStatus?.coordination?.role || "unknown"} owner=${sessionStatus?.coordination?.lockOwner || "-"} readonly=${Boolean(sessionStatus?.coordination?.readonly)}`,
      `sessionHandoff active=${handoff?.activeOfferId || "-"} mode=${handoff?.activeMode || "-"} peer=${handoff?.activePeerInstanceId || handoff?.lastPeerSource || "-"} last=${handoff?.lastPeerAction || handoff?.lastLocalAction || "-"} relayFrames=${Number(handoffRelay.framesSent || 0) + Number(handoffRelay.framesReceived || 0)} relayInputs=${Number(handoffRelay.inputsSent || 0) + Number(handoffRelay.inputsReceived || 0)}`,
      `storage backend=${storage?.backend || "memory"} persisted=${storage?.persisted || false} bytes=${storage?.bytes || 0} dirtyInodes=${storage?.dirtyInodes || 0} dirtyFiles=${storage?.dirtyFiles || 0} pending=${storage?.persistPending || false}`,
      `localMounts supported=${localMountSupported} mounted=${mounted} persisted=${persistedMounts} errors=${mountErrors} helper=${helper?.status || "unavailable"} rename=${helper?.renameSupported || false}`,
      `packages installed=${Array.isArray(packages) ? packages.length : 0}`,
      `processes running=${Array.isArray(processes) ? processes.length : 0}`,
      `compositor focused=${compositor?.activeWindowId || "-"} pid=${Number(compositor?.focusedPid || 0)} surfaces=${Number(compositor?.surfaceCount || 0)} lastInput=${compositor?.lastInputEvent?.type || "-"}`,
      `lifecycle state=${lifecycle?.state || "unknown"} reason=${lifecycle?.reason || "-"} updated=${lifecycle?.updatedAt || "-"}`,
      `recovery lastShutdown=${recovery?.lastShutdown?.recordedAt || "-"} lastRecovery=${recovery?.lastRecovery?.recoveredAt || "-"} closedPagePersistent=${Boolean(recovery?.closedPagePersistence)}`,
      `sync backend=${sync?.backend || "unavailable"} encrypted=${Boolean(sync?.encrypted)} lastSnapshot=${sync?.lastSuccessfulSnapshot?.createdAt || "-"} files=${Number(sync?.lastSuccessfulSnapshot?.fileCount || 0)} cache=${Number(sync?.lastSuccessfulSnapshot?.cacheRecords || 0)} settings=${Number(sync?.lastSuccessfulSnapshot?.settingsRecords || 0)} lastApplied=${sync?.lastAppliedSnapshot?.appliedAt || "-"} conflicts=${Number(sync?.lastAppliedSnapshot?.conflicts || 0)} refused=${Number(sync?.lastAppliedSnapshot?.refused || 0)} lastRetry=${sync?.lastRetry?.retriedAt || "-"} retryApplied=${Number(sync?.lastRetry?.applied || 0)} retryRefused=${Number(sync?.lastRetry?.refused || 0)}`,
      `syncMerge planner=${syncMerge?.planner || "unavailable"} rules=${Array.isArray(syncMerge?.rules) ? syncMerge.rules.length : 0}`,
      "troubleshooting docs=docs/support.md command=storage|mount-local --list|ps|pkg list",
    ].join("\n");
  }

  doctorBrowser() {
    const status = safeRead(() => this.os.browserBrokerStatus?.(), { capabilities: [], ledgerEntries: [], revokedGrants: [] });
    const available = status.capabilities.filter((entry) => entry.available).length;
    const total = status.capabilities.length;
    const brokerLines = status.capabilities.map((entry) => (
      `${entry.id} ${entry.available ? "available" : "unavailable"} broker=${entry.broker} device=${entry.device} access=${Number(entry.accessCount || 0)} revoked=${Number(entry.revoked || 0)}`
    ));
    return [
      "DindbOS browser brokers",
      `summary available=${available}/${total} ledger=${status.ledgerEntries.length} revoked=${status.revokedGrants.length}`,
      ...brokerLines,
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
    const background = snapshot.backgroundMaintenance || {};
    return [
      "DindbOS compatibility",
      `runtime=${snapshot.runtime || "DindbOS.js"} version=${snapshot.version || "0.2.0"} mode=${snapshot.mode || "browser-native"}`,
      ...tierLines,
      `browser workers=${Boolean(browser.workers)} wasm=${Boolean(browser.webAssembly)} opfs=${Boolean(browser.opfs)} indexedDB=${Boolean(browser.indexedDB)} cacheApi=${Boolean(browser.cacheApi)} fileSystemAccess=${Boolean(browser.fileSystemAccess)} serviceWorker=${Boolean(browser.serviceWorker)} periodicSync=${Boolean(browser.periodicSync)}`,
      `background serviceWorker=${Boolean(background.serviceWorkerSupported)} periodicSync=${Boolean(background.periodicSyncSupported)} registered=${Boolean(background.registered)} closedPagePersistent=${Boolean(background.closedPagePersistence)} decision=${background.decision || "unknown"}`,
      `storage backend=${storage.backend || "memory"} structured=${storage.structuredBackend || "memory"} persisted=${Boolean(storage.persisted)} buckets=${storage.buckets || "unknown"}`,
      `companions browserProvider=${companions.browserProviderUrl || "ws://127.0.0.1:8787/browser"} localMounts=${companions.localMounts || 0}`,
      `unsupported native=${(snapshot.unsupportedNative || []).join("; ")}`,
    ].join("\n");
  }

  syscall(args) {
    const [name, ...jsonParts] = args;
    if (!name) return "syscall: usage: syscall <name> [json]";
    const payload = jsonParts.length ? parseJsonArgument(jsonParts.join(" "), "syscall") : {};
    const context = { principal: this.principal, env: this.env };
    if (typeof this.os.syscallAsync === "function") {
      return this.os.syscallAsync(name, payload, context).then((result) => JSON.stringify(result, null, 2));
    }
    const result = this.os.syscall(name, payload, context);
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

  wasm(args, stdin = "") {
    const [file, ...argv] = args;
    if (!file) return "wasm: usage: wasm <file> [args...]";
    return this.executeWasm(this.os.fs.normalize(file, this.cwd), argv, stdin);
  }

  async executeWasm(path, argv = [], stdin = "") {
    if (!this.os.wasm?.runFile) throw new Error("wasm: WebAssembly runner is unavailable");
    const result = await this.os.wasm.runFile(path, "/", { argv, stdin, principal: this.principal, ptySessionId: this.ptySessionId });
    const output = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : "");
    if (result.status) throw new Error(output || `wasm: ${path}: exited with status ${result.status}`);
    return output;
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
    const content = existing ? this.os.fs.readFile(path, this.cwd, this.principal) : "";
    reserveShellStorage(this.os, content, path, this.cwd, "touch");
    this.os.fs.writeOrCreateFile(path, content, this.cwd, {}, this.principal);
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
    reserveShellStorage(this.os, content, target, "/", "copy");
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
    const normalized = this.os.fs.normalize(path, this.cwd);
    if (this.os.localMounts?.isMountedPath?.(normalized)) {
      return this.os.localMounts.unmount(normalized, { forget })
        .then((mount) => `unmounted ${mount.path}${forget ? " and forgot persisted handle" : ""}`);
    }
    const result = this.os.syscall("mount.unmount", { path: normalized }, { principal: this.principal, env: this.env });
    if (!result.ok) throw new Error(result.error.message);
    return `unmounted ${result.value.root}`;
  }

  kill(args) {
    const pid = Number(args[0]);
    if (!Number.isFinite(pid)) return "kill: usage: kill <pid>";
    const signal = args[1] || "SIGTERM";
    const result = this.os.processes.signal?.(pid, signal) || { process: this.os.processes.kill(pid) };
    return `killed ${result.process.pid} ${result.process.appId} signal=${result.signal || "SIGTERM"}`;
  }

  jobs() {
    const jobs = this.os.processes?.listJobs?.() || [];
    if (!jobs.length) return "JOB PGID STATE FOREGROUND PIDS COMMAND";
    return [
      "JOB PGID STATE FOREGROUND PIDS COMMAND",
      ...jobs.map((job) => [
        String(job.id),
        String(job.processGroupId),
        job.state,
        job.foreground ? "fg" : "bg",
        job.pids.join(",") || "-",
        job.command || "-",
      ].join(" ")),
    ].join("\n");
  }

  fg(args) {
    const pid = Number(args[0]);
    if (!Number.isFinite(pid)) return "fg: usage: fg <pid>";
    const process = this.os.processes.foreground(pid);
    return `foreground ${process.pid} ${process.appId}`;
  }

  bg(args) {
    const pid = Number(args[0]);
    if (!Number.isFinite(pid)) return "bg: usage: bg <pid>";
    const process = this.os.processes.background(pid);
    return `background ${process.pid} ${process.appId}`;
  }

  wait(args) {
    const pid = Number(args[0]);
    if (!Number.isFinite(pid)) return "wait: usage: wait <pid>";
    const result = this.os.processes.wait(pid);
    return `wait ${result.pid} ${result.appId} running=${result.running} status=${result.status ?? "-"}`;
  }

  handlectl(args = []) {
    const action = args[0] || "list";
    if (!this.os.objects) return "handlectl: unavailable: kernel object registry is not installed";
    if (action === "list") {
      const includeAll = args.includes("--all");
      const pidArg = args.find((arg, index) => index > 0 && !arg.startsWith("-"));
      const filters = {};
      if (!includeAll) filters.status = "active";
      if (pidArg !== undefined) filters.ownerPid = numericShellArg(pidArg, "pid", "handlectl");
      return formatHandleRows(this.os.objects.listHandles(filters));
    }
    if (action === "stat") {
      const handleId = args[1];
      if (!handleId) return "handlectl: usage: handlectl stat <handle>";
      const handle = this.os.objects.getHandle(handleId);
      if (!handle) return `handlectl: no such handle: ${handleId}`;
      return formatHandleDetail(handle, this.os.objects.get(handle.objectId));
    }
    if (action === "revoke" || action === "close") {
      const handleId = args[1];
      if (!handleId) return `handlectl: usage: handlectl ${action} <handle> [reason]`;
      this.os.assertAdminOperation?.("handlectl:revoke", { principal: this.principal, target: handleId });
      const handle = this.os.objects.revokeHandle(handleId, args.slice(2).join(" ") || "handlectl-revoke");
      if (!handle) return `handlectl: no such handle: ${handleId}`;
      return `revoked ${handle.id} reason=${handle.revocationReason}`;
    }
    return "handlectl: usage: handlectl list [pid] [--all] | stat <handle> | revoke <handle> [reason]";
  }

  lsof(args = []) {
    if (!this.os.objects) return "lsof: unavailable: kernel object registry is not installed";
    const includeAll = args.includes("--all");
    const pidArg = args.find((arg) => !arg.startsWith("-"));
    const filters = {};
    if (!includeAll) filters.status = "active";
    if (pidArg !== undefined) filters.ownerPid = numericShellArg(pidArg, "pid", "lsof");
    return formatLsofRows(this.os.objects.listHandles(filters), this.os.objects);
  }

  timerctl(args = []) {
    const action = args[0] || "list";
    if (action === "list") return formatTimerRows(this.os.timers.status());
    if (action === "stat") {
      const id = args[1];
      if (!id) return "timerctl: usage: timerctl stat <timer|handle>";
      const timer = this.os.timers.get(id);
      return timer ? formatTimerDetail(timer) : `timerctl: no such timer: ${id}`;
    }
    if (action === "cancel") {
      const id = args[1];
      if (!id) return "timerctl: usage: timerctl cancel <timer|handle>";
      this.os.assertAdminOperation?.("timerctl:cancel", { principal: this.principal, target: id });
      const timer = this.os.timers.cancel(id, null, { reason: "timerctl-cancel", force: true });
      return `canceled ${timer.id} status=${timer.status}`;
    }
    return "timerctl: usage: timerctl list|stat <timer|handle>|cancel <timer|handle>";
  }

  resetFileSystem() {
    this.os.assertAdminOperation?.("system-settings:resetfs", { principal: this.principal, target: "storage.resetFileSystem" });
    if (typeof this.os.resetPersistentFileSystem === "function") this.os.resetPersistentFileSystem();
    else this.os.storage.resetFileSystem();
    globalThis.window?.setTimeout?.(() => window.location.reload(), 250);
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
    if (typeof this.os.mountTable === "function") {
      return [
        "Filesystem     Driver     Flags Durability   Used       Quota              Support",
        ...this.os.mountTable().map((entry) => [
          String(entry.root || "/").padEnd(14),
          String(entry.driver || "vfs").padEnd(10),
          (entry.readonly ? "ro" : "rw").padEnd(5),
          String(entry.durability || "runtime").padEnd(12),
          formatBytes(entry.usedBytes).padEnd(10),
          String(entry.quotaPolicy || "unknown").padEnd(18),
          entry.support || "browser-vfs",
        ].join(" ")),
      ].join("\n");
    }
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

  mount(args = []) {
    try {
      if (args.length) return this.mountVirtual(args);
      if (typeof this.os.mountLines === "function") return this.os.mountLines().join("\n");
      return this.os.fs.readFile("/proc/mounts").trim().split("\n").filter(Boolean).join("\n");
    } catch {
      return "rootfs / virtualfs rw 0 0";
    }
  }

  mountVirtual(args = []) {
    const [flag, driver, path, ...rest] = args;
    if (flag !== "-t" || !driver || !path) return "mount: usage: mount -t memfs <path> [--readonly] | mount -t overlayfs <path> --lower <path> --upper <path> | mount -t zipfs <path> --archive <file.zip>";
    const lowerIndex = rest.indexOf("--lower");
    const upperIndex = rest.indexOf("--upper");
    const archiveIndex = rest.indexOf("--archive");
    const result = this.os.syscall("mount.mount", {
      driver,
      path: this.os.fs.normalize(path, this.cwd),
      readonly: rest.includes("--readonly") || rest.includes("-r"),
      lower: lowerIndex >= 0 ? this.os.fs.normalize(rest[lowerIndex + 1] || "", this.cwd) : "",
      upper: upperIndex >= 0 ? this.os.fs.normalize(rest[upperIndex + 1] || "", this.cwd) : "",
      archive: archiveIndex >= 0 ? this.os.fs.normalize(rest[archiveIndex + 1] || "", this.cwd) : "",
      source: "shell",
    }, { principal: this.principal, env: this.env });
    if (!result.ok) throw new Error(result.error.message);
    return `mounted ${result.value.root} ${result.value.driver} ${result.value.readonly ? "ro" : "rw"}`;
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
    const pipeProcess = pipeline.length > 1 ? this.spawnPipelineProcess() : null;
    try {
      for (const segment of pipeline) {
        result = await this.executeSegmentAsyncWithDepth(segment, nextStdin, depth);
        nextStdin = this.pipeThroughDescriptor(pipeProcess, result.output);
        if (result.clear || result.reload) return result;
      }
      return result;
    } finally {
      this.closePipelineProcess(pipeProcess);
    }
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
      } else {
        reserveShellStorage(this.os, value, redirect.target, this.cwd, redirect.append ? "redirect-append" : "redirect-write");
        if (redirect.append) this.os.fs.appendFile(redirect.target, value, this.cwd, this.principal);
        else this.os.fs.writeOrCreateFile(redirect.target, value, this.cwd, {}, this.principal);
      }
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

function ensureShellHistoryDirectory(os, user = "guest") {
  const system = os.permissions.systemPrincipal();
  ["/var", "/var/lib", "/var/lib/dindbos", SHELL_HISTORY_DIR].forEach((path) => {
    if (!os.fs.exists(path)) os.fs.createDirectory(path, "/", { owner: "root", group: "root", permissions: "drwxr-xr-x" }, system);
  });
  const path = `${SHELL_HISTORY_DIR}/${encodeURIComponent(String(user || "guest"))}.json`;
  if (!os.fs.exists(path)) {
    os.fs.writeOrCreateFile(path, `${JSON.stringify({ version: 1, user, updatedAt: "", entries: [] }, null, 2)}\n`, "/", {
      owner: user || "guest",
      group: "users",
      permissions: "-rw-------",
      mime: "application/json",
    }, system);
  }
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
  if (text.startsWith(`${command}:`) && text.includes("denied")) return 1;
  if (text.startsWith(`${command}:`) && text.includes("unavailable")) return 1;
  if (text.startsWith(`${command}:`) && text.includes("package not installed")) return 1;
  if (text.startsWith(`${command}:`) && text.includes("registry not found")) return 1;
  if (text.startsWith(`${command}:`) && text.includes(": exit ")) return 1;
  if (text.startsWith(`${command}:`) && text.includes("strict failed")) return 1;
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

function numericShellArg(value, name, command) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${command}: invalid ${name}: ${value}`);
  return number;
}

function formatHandleRows(handles = []) {
  if (!handles.length) return "HANDLE OBJECT TYPE PID STATUS RIGHTS";
  return [
    "HANDLE OBJECT TYPE PID STATUS RIGHTS",
    ...handles.map((handle) => [
      String(handle.id).padEnd(18),
      String(handle.objectId).padEnd(20),
      String(handle.objectType).padEnd(12),
      String(handle.ownerPid || 0).padEnd(5),
      String(handle.status).padEnd(8),
      (handle.rights || []).join(",") || "-",
    ].join(" ")),
  ].join("\n");
}

function formatHandleDetail(handle, object = null) {
  return [
    `Handle:\t${handle.id}`,
    `Object:\t${handle.objectId}`,
    `Type:\t${handle.objectType}`,
    `OwnerPid:\t${handle.ownerPid || 0}`,
    `User:\t${handle.user || "-"}`,
    `Status:\t${handle.status}`,
    `Rights:\t${(handle.rights || []).join(",") || "-"}`,
    `CloseOnExec:\t${Boolean(handle.closeOnExec)}`,
    `TransferPolicy:\t${handle.transferPolicy || "-"}`,
    `Expires:\t${handle.expiresAt || "-"}`,
    `RevocationReason:\t${handle.revocationReason || "-"}`,
    `ObjectStatus:\t${object?.status || "missing"}`,
    `ObjectRef:\t${object?.ref || "-"}`,
  ].join("\n");
}

function formatLsofRows(handles = [], objects = null) {
  if (!handles.length) return "PID HANDLE TYPE STATUS RIGHTS REF";
  return [
    "PID HANDLE TYPE STATUS RIGHTS REF",
    ...handles.map((handle) => {
      const object = objects?.get?.(handle.objectId) || null;
      return [
        String(handle.ownerPid || 0).padEnd(5),
        String(handle.id).padEnd(18),
        String(handle.objectType).padEnd(12),
        String(handle.status).padEnd(8),
        String((handle.rights || []).join(",") || "-").padEnd(28),
        object?.ref || handle.metadata?.path || handle.metadata?.endpoint || handle.metadata?.windowId || "-",
      ].join(" ");
    }),
  ].join("\n");
}

function formatTimerRows(timers = []) {
  if (!timers.length) return "TIMER PID STATUS DELAY HANDLE";
  return [
    "TIMER PID STATUS DELAY HANDLE",
    ...timers.map((timer) => [
      String(timer.id).padEnd(12),
      String(timer.ownerPid || 0).padEnd(5),
      String(timer.status).padEnd(9),
      `${timer.delayMs}ms`.padEnd(8),
      timer.handleId || "-",
    ].join(" ")),
  ].join("\n");
}

function formatTimerDetail(timer) {
  return [
    `Timer:\t${timer.id}`,
    `OwnerPid:\t${timer.ownerPid || 0}`,
    `Status:\t${timer.status}`,
    `Delay:\t${timer.delayMs}ms`,
    `DueAt:\t${timer.dueAt || "-"}`,
    `FiredAt:\t${timer.firedAt || "-"}`,
    `CanceledAt:\t${timer.canceledAt || "-"}`,
    `Object:\t${timer.objectId || "-"}`,
    `Handle:\t${timer.handleId || "-"}`,
    `Reason:\t${timer.reason || "-"}`,
  ].join("\n");
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
    `storageTransactions=${status.storageTransactions?.length || 0}`,
    `storageTransactionGroups=${status.storageTransactionGroups?.length || 0}`,
    `lastStorageTransaction=${status.storageTransactions?.at?.(-1)?.id || "-"}`,
    `usage=${status.usage ?? status.bytes}`,
    `quota=${status.quota || 0}`,
  ].join("\n");
}

function formatStorageKernel(status = {}) {
  const cache = status.pageCache || {};
  const writeback = status.writeback || {};
  const recovery = status.recovery || {};
  return [
    `state=${status.state || "unknown"}`,
    `backend=${writeback.backend || "memory"}`,
    `format=${cache.format || "unknown"}`,
    `dirtyInodes=${Number(cache.dirtyInodes || 0)}`,
    `dirtyFiles=${Number(cache.dirtyFiles || 0)}`,
    `contentBytes=${Number(cache.contentBytes || 0)}`,
    `pending=${Boolean(writeback.pending)}`,
    `flushes=${Number(writeback.flushes || 0)}`,
    `coalesced=${Number(writeback.coalesced || 0)}`,
    `transactions=${Number(status.transactions?.length || 0)}`,
    `transactionGroups=${Number(status.transactionGroups?.length || 0)}`,
    `localConflicts=${Number(status.conflicts?.localMounts?.length || 0)}`,
    `remoteConflicts=${Number(status.conflicts?.remoteSync?.length || 0)}`,
    `lastRepair=${recovery.lastRepair?.checkedAt || "-"}`,
    `lastError=${writeback.lastError || "-"}`,
  ].join("\n");
}

function formatFsck(result = {}, options = {}) {
  const lines = [
    `fsck: ok=${Boolean(result.ok)} checked=${Number(result.checkedNodes || 0)} packages=${Number(result.checkedPackages || 0)} storage=${Number(result.checkedStorage || 0)} localMounts=${Number(result.checkedLocalMounts || 0)} problems=${Number(result.problemCount || 0)} repairs=${Number(result.repairCount || 0)} dryRun=${Boolean(result.dryRun)}`,
  ];
  (result.problems || []).slice(0, 20).forEach((entry) => {
    lines.push(`${entry.code} ${entry.path} repairable=${Boolean(entry.repairable)} ${entry.message}`);
    if (options.explain) lines.push(`explain ${entry.code}: ${fsckExplanation(entry.code, entry.repairable)}`);
  });
  (result.repairs || []).slice(0, 20).forEach((entry) => {
    lines.push(`repair ${entry.kind} ${entry.path} ${entry.from} -> ${entry.to} dryRun=${Boolean(entry.dryRun)}`);
  });
  if (result.salvage?.path) lines.push(`salvage ${result.salvage.path} entries=${Number(result.salvage.entries || 0)} skipped=${Number(result.salvage.skipped || 0)}`);
  if (options.explain && !(result.problems || []).length) lines.push("explain ok: no integrity problems detected");
  return lines.join("\n");
}

function fsckExplanation(code, repairable = false) {
  const suffix = repairable
    ? "This repair is conservative and preserves ownership, permissions, and security policy."
    : "This is reported without repair because automatic mutation could weaken runtime guarantees.";
  const explanations = {
    "size-mismatch": "File size metadata differs from content bytes; safe repair recalculates size only.",
    "invalid-children": "Directory children metadata is malformed; safe repair replaces only invalid child lists.",
    "orphaned-atomic-staging": "An interrupted atomic write left a staged temporary file; safe repair removes only the staged file.",
    "orphaned-unnamed-node": "A directory child has no path name and cannot be addressed normally; salvage first, then safe repair removes only the unreachable child.",
    "package-record-missing": "A pkgfs root exists without a package DB record; safe repair can remove the orphan root.",
    "package-root-missing": "A package DB record points at a missing package root; reinstall or restore is required.",
    "package-root-invalid": "A package install path exists but is not mounted as pkgfs.",
    "package-record-invalid": "A package DB JSON record cannot be parsed into a package id.",
    "package-entry-missing": "A package root exists but its declared app entry file is missing; reinstall or restore is required.",
    "storage-journal-invalid": "A persisted storage transaction marker cannot be parsed; reload or manual recovery is required.",
    "storage-journal-partial": "A storage transaction marker is present without a replay manifest; the last complete manifest remains authoritative.",
    "storage-journal-pending-replay": "A storage replay manifest exists and should be promoted during the next storage load before normal boot continues.",
    "local-mount-metadata-invalid": "Persisted local mount metadata is malformed; inspect or forget the local mount record.",
    "local-mount-stale-metadata": "A persisted local mount record no longer contains a usable directory handle or mount path; safe repair removes only that stale record.",
  };
  return `${explanations[code] || "DindbOS detected an integrity invariant violation."} ${suffix}`;
}

function mergeFsckResults(base = {}, extra = null) {
  if (!extra) return base;
  const problems = [...(base.problems || []), ...(extra.problems || [])];
  const repairs = [...(base.repairs || []), ...(extra.repairs || [])];
  return {
    ...base,
    ok: Boolean(base.ok) && Boolean(extra.ok),
    repaired: Boolean(base.repaired || extra.repaired),
    checkedPackages: Number(base.checkedPackages || 0) + Number(extra.checkedPackages || 0),
    checkedStorage: Number(base.checkedStorage || 0) + Number(extra.checkedStorage || 0),
    checkedLocalMounts: Number(base.checkedLocalMounts || 0) + Number(extra.checkedLocalMounts || 0),
    problemCount: problems.length,
    repairCount: repairs.length,
    problems,
    repairs,
  };
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
    `cli.entry=${record.cli?.entry || (record.files?.some((file) => file.path === "bin/cli.js") ? "bin/cli.js" : "-")}`,
    `capabilities=${record.permissions?.capabilities?.join(",") || record.app.capabilities?.join(",") || "-"}`,
    `fs.read=${record.permissions?.fileSystem?.read?.join(",") || record.app.fileSystem?.read?.join(",") || "-"}`,
    `fs.write=${record.permissions?.fileSystem?.write?.join(",") || record.app.fileSystem?.write?.join(",") || "-"}`,
    `secrets=${(record.secrets || []).map((secret) => `${secret.name}:${secret.kind}`).join(",") || "-"}`,
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

function formatStrictNamespaceReport(report) {
  const header = `strict=${report.strict ? "ok" : "fail"} package=${report.packageId} source=${report.source}`;
  const lines = report.checks.map((check) => `${check.status} ${check.id} ${check.detail}`);
  return [header, ...lines].join("\n");
}

function formatPackageAudit(report) {
  const header = `audit ok=${Boolean(report.ok)} packages=${report.packageCount || 0} failed=${report.failed || 0}`;
  const rows = (report.packages || []).flatMap((entry) => [
    `${entry.packageId} ok=${Boolean(entry.ok)} trusted=${Boolean(entry.trusted)} strict=${Boolean(entry.strict)} signature=${entry.signatureStatus || "-"} warnings=${entry.warningCount || 0}`,
    ...entry.checks.map((check) => `  ${check.status} ${check.id} ${check.detail}`),
  ]);
  return [header, ...rows].join("\n");
}

function formatPolicyStatus(status) {
  const header = `policy packages=${status.packageCount || 0} updatedAt=${status.updatedAt || "-"}`;
  const rows = (status.packages || []).map((entry) => [
    entry.packageId,
    `app=${entry.appId || "-"}`,
    `version=${entry.version || "-"}`,
    `trusted=${Boolean(entry.trusted)}`,
    `signature=${entry.signatureStatus || "-"}`,
    `warnings=${entry.warningCount || 0}`,
  ].join(" "));
  return [header, ...rows].join("\n");
}

function formatPackagePolicy(policy = {}) {
  return [
    `package=${policy.packageId || "-"}`,
    `app=${policy.appId || "-"}`,
    `version=${policy.version || "-"}`,
    `runtime=${policy.runtime?.appRuntime || "-"}`,
    `container=${policy.runtime?.containerMode || "-"}`,
    `trusted=${Boolean(policy.trust?.trusted)}`,
    `signature=${policy.trust?.signatureStatus || "-"}`,
    `capabilities=${policy.capabilities?.join(",") || "-"}`,
    `fs.read=${policy.filesystem?.read?.join(",") || "-"}`,
    `fs.write=${policy.filesystem?.write?.join(",") || "-"}`,
    `devices=${policy.devices?.join(",") || "-"}`,
    `network.hosts=${policy.network?.hosts?.join(",") || "-"}`,
    `dependencies=${policy.dependencies?.allowlist?.join(",") || "-"}`,
    `process.group=${policy.process?.processGroup || "-"}`,
    `warnings=${policy.warnings?.join("; ") || "-"}`,
    `enforcement=${policy.enforcement?.join(",") || "-"}`,
  ].join("\n");
}

function formatDependencies(dependencies) {
  const packageDeps = Object.entries(dependencies.packages || {})
    .map(([name, dependency]) => `package ${name}@${dependency.version || "latest"} ${dependency.manifestUrl || ""}`);
  const npmDeps = Object.entries(dependencies.npm || {})
    .map(([name, dependency]) => `npm ${name}@${dependency.version || "latest"} ${dependency.url || ""}`);
  return [...packageDeps, ...npmDeps].join("\n") || "pkg: no dependencies";
}

function formatCompanionPermission(record = {}) {
  return [
    record.identity || "-",
    `protocol=${record.protocolVersion || "-"}`,
    `approved=${Boolean(record.approved)}`,
    `capabilities=${record.capabilities?.join(",") || "-"}`,
    record.revokedAt ? `revokedAt=${record.revokedAt}` : `grantedAt=${record.grantedAt || "-"}`,
  ].join(" ");
}

function formatKeychainRecord(record = {}) {
  return [
    record.name,
    record.kind || "generic",
    `owner=${record.ownerAppId || "-"}`,
    `grants=${(record.grants || []).map((grant) => grant.appId).join(",") || "-"}`,
    `encrypted=${Boolean(record.encrypted)}`,
  ].join(" ");
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

function reserveShellStorage(os, content, path, cwd, operation) {
  if (typeof os.storage?.reserveStorageBytes !== "function") return;
  os.storage.reserveStorageBytes(contentByteLength(content), {
    scope: "shell-write",
    runtime: "shell",
    path: os.fs?.normalize ? os.fs.normalize(path, cwd) : String(path || ""),
    cwd,
    operation,
  });
}

function contentByteLength(value) {
  if (value instanceof Uint8Array) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}
