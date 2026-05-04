const JS_EXTENSIONS = ["", ".js", ".mjs", ".json", ".cjs"];
const BUILTIN_MODULES = new Set([
  "fs",
  "node:fs",
  "path",
  "node:path",
  "path/posix",
  "node:path/posix",
  "path/win32",
  "node:path/win32",
  "process",
  "node:process",
  "buffer",
  "node:buffer",
  "events",
  "node:events",
  "url",
  "node:url",
  "util",
  "node:util",
  "util/types",
  "node:util/types",
  "timers",
  "node:timers",
  "perf_hooks",
  "node:perf_hooks",
  "async_hooks",
  "node:async_hooks",
  "stream",
  "node:stream",
  "crypto",
  "node:crypto",
  "assert",
  "node:assert",
  "querystring",
  "node:querystring",
  "punycode",
  "node:punycode",
  "os",
  "node:os",
  "tty",
  "node:tty",
  "module",
  "node:module",
  "string_decoder",
  "node:string_decoder",
  "constants",
  "node:constants",
  "diagnostics_channel",
  "node:diagnostics_channel",
  "dns",
  "node:dns",
  "console",
  "node:console",
  "http",
  "node:http",
  "https",
  "node:https",
  "child_process",
  "node:child_process",
  "worker_threads",
  "node:worker_threads",
  "zlib",
  "node:zlib",
]);
const AsyncFunction = Object.getPrototypeOf(async function createAsyncFunction() {}).constructor;

export class NodeCompat {
  constructor(os, options = {}) {
    this.os = os;
    this.system = os.permissions.systemPrincipal();
    this.fsRoot = options.fsRoot ? os.fs.normalize(options.fsRoot) : "";
  }

  runFile(path, cwd = this.os.session.home || "/", options = {}) {
    const filename = this.resolveEntry(path, cwd);
    const process = this.createProcessContext(this.os.fs.dirname(filename), ["/usr/bin/node", filename, ...(options.argv || [])]);
    if (this.isEsmFile(filename, options)) {
      const runtime = new EsmRuntime(this, process);
      return runtime.loadModule(filename).then(() => runtime.result());
    }
    const runtime = new CommonJsRuntime(this, process);
    runtime.loadModule(filename);
    return runtime.result();
  }

  evaluate(source, cwd = this.os.session.home || "/", options = {}) {
    const normalizedCwd = this.os.fs.normalize(cwd);
    const filename = options.filename || this.os.fs.join(normalizedCwd, options.inputType === "module" ? "[eval].mjs" : "[eval].js");
    const process = this.createProcessContext(normalizedCwd, ["/usr/bin/node", "-e", String(source)]);
    if (options.inputType === "module") {
      const runtime = new EsmRuntime(this, process);
      return runtime.evaluate(String(source), filename).then(() => runtime.result());
    }
    const runtime = new CommonJsRuntime(this, process);
    runtime.evaluate(String(source), filename);
    return runtime.result();
  }

  resolveEntry(path, cwd = this.os.session.home || "/") {
    const normalized = this.os.fs.normalize(path, cwd);
    return this.resolveFsPath(this.resolveAsFileOrDirectory(normalized), "/");
  }

  resolveModule(specifier, fromFilename, cwd, options = {}) {
    const request = String(specifier || "");
    if (BUILTIN_MODULES.has(request)) return { type: "builtin", id: request.replace(/^node:/, "") };
    if (request.startsWith("/") || request.startsWith("./") || request.startsWith("../")) {
      const base = request.startsWith("/") ? "/" : this.os.fs.dirname(fromFilename || this.os.fs.join(cwd, "[eval].js"));
      return { type: "file", path: this.resolveFsPath(this.resolveAsFileOrDirectory(this.os.fs.normalize(request, base), options), "/") };
    }
    return { type: "file", path: this.resolveFsPath(this.resolvePackage(request, fromFilename, cwd, options), "/") };
  }

  resolveAsFileOrDirectory(path, options = {}) {
    for (const extension of JS_EXTENSIONS) {
      const candidate = `${path}${extension}`;
      const node = this.os.fs.resolve(candidate);
      if (node?.type === "file") return candidate;
    }
    const directory = this.os.fs.resolve(path);
    if (directory?.type !== "directory") throw new Error(`node: module not found: ${path}`);
    const packageJsonPath = this.os.fs.join(path, "package.json");
    if (this.os.fs.exists(packageJsonPath)) {
      const manifest = safeJson(this.os.fs.readFile(packageJsonPath, "/", this.system), {});
      const entry = stringEntry(manifest.exports, options.condition) || packageEntry(manifest, options.condition);
      try {
        return this.resolveAsFileOrDirectory(this.os.fs.normalize(entry, path), options);
      } catch (error) {
        if (!String(error.message || "").includes("module not found")) throw error;
      }
    }
    const indexExtensions = options.condition === "import" ? [".mjs", ".js", ".json"] : [".js", ".json", ".cjs"];
    for (const extension of indexExtensions) {
      const candidate = this.os.fs.join(path, `index${extension}`);
      const node = this.os.fs.resolve(candidate);
      if (node?.type === "file") return candidate;
    }
    throw new Error(`node: module not found: ${path}`);
  }

  resolvePackage(specifier, fromFilename, cwd, options = {}) {
    const { packageName, subpath } = splitPackageSpecifier(specifier);
    let cursor = this.os.fs.dirname(fromFilename || this.os.fs.join(cwd, "[eval].js"));
    while (true) {
      const packageRoot = this.os.fs.join(this.os.fs.join(cursor, "node_modules"), packageName);
      if (this.os.fs.exists(packageRoot)) {
        const target = this.resolvePackageExportTarget(packageRoot, subpath, options);
        return this.resolveAsFileOrDirectory(target, options);
      }
      if (cursor === "/") break;
      cursor = this.os.fs.dirname(cursor);
    }
    throw new Error(`node: cannot find module '${specifier}'`);
  }

  resolvePackageExportTarget(packageRoot, subpath = "", options = {}) {
    const packageJsonPath = this.os.fs.join(packageRoot, "package.json");
    const manifest = this.os.fs.exists(packageJsonPath)
      ? safeJson(this.os.fs.readFile(packageJsonPath, "/", this.system), {})
      : {};
    const exportTarget = exportEntry(manifest.exports, subpath, options.condition);
    if (exportTarget) return this.os.fs.normalize(exportTarget, packageRoot);
    if (subpath) return this.os.fs.join(packageRoot, subpath);
    return packageRoot;
  }

  createProcessContext(cwd, argv) {
    const env = {
      HOME: this.os.session.home || "/home/guest",
      USER: this.os.session.user || "guest",
      PATH: "/bin:/usr/bin",
      PWD: cwd,
    };
    return {
      argv,
      env,
      cwd,
      exitCode: 0,
    };
  }

  isEsmFile(filename, options = {}) {
    if (options.inputType === "module") return true;
    if (options.inputType === "commonjs") return false;
    if (filename.endsWith(".mjs")) return true;
    if (filename.endsWith(".cjs") || filename.endsWith(".json")) return false;
    if (!filename.endsWith(".js")) return false;
    return this.packageTypeFor(filename) === "module";
  }

  packageTypeFor(filename) {
    let cursor = this.os.fs.dirname(filename);
    while (true) {
      const packageJsonPath = this.os.fs.join(cursor, "package.json");
      if (this.os.fs.exists(packageJsonPath)) {
        return safeJson(this.os.fs.readFile(packageJsonPath, "/", this.system), {}).type || "";
      }
      if (cursor === "/") return "";
      cursor = this.os.fs.dirname(cursor);
    }
  }

  resolveFsPath(path, cwd = this.os.session.home || "/") {
    const normalized = this.os.fs.normalize(path, cwd);
    if (!this.fsRoot || normalized === this.fsRoot || normalized.startsWith(`${this.fsRoot}/`)) return normalized;
    throw new Error(`NodeCompat filesystem sandbox denied: ${normalized}`);
  }
}

class CommonJsRuntime {
  constructor(node, processContext) {
    this.node = node;
    this.os = node.os;
    this.cache = new Map();
    this.output = [];
    this.processContext = processContext;
    this.buffer = createBufferFacade();
    this.process = this.createProcess();
    this.console = this.createConsole();
    const events = createEventsModule();
    const stream = createStreamModule(events);
    const utilTypes = createUtilTypesModule();
    this.builtins = {
      fs: this.createFsModule(stream),
      path: this.createPathModule(),
      process: this.process,
      buffer: { Buffer: this.buffer },
      events,
      url: createUrlModule(),
      util: createUtilModule(utilTypes, this.console, this.processContext),
      "util/types": utilTypes,
      timers: createTimersModule(),
      perf_hooks: createPerfHooksModule(),
      async_hooks: createAsyncHooksModule(),
      stream,
      crypto: createCryptoModule(this.buffer),
      assert: createAssertModule(),
      querystring: createQuerystringModule(),
      punycode: createPunycodeModule(),
      os: createOsModule(this.processContext),
      tty: createTtyModule(),
      string_decoder: createStringDecoderModule(),
      constants: createConstantsModule(),
      diagnostics_channel: createDiagnosticsChannelModule(),
      dns: createDnsModule(),
      console: createConsoleModule(this.output),
      http: createNetworkModule("http"),
      https: createNetworkModule("https"),
      child_process: createChildProcessModule(),
      worker_threads: createWorkerThreadsModule(),
      zlib: createZlibModule(),
    };
    this.builtins["path/posix"] = this.builtins.path.posix;
    this.builtins["path/win32"] = this.builtins.path.win32;
    this.builtins.module = this.createModuleModule();
  }

  evaluate(source, filename) {
    this.executeJavaScript(source, filename, { exports: {}, filename, loaded: false });
  }

  loadModule(filename) {
    const normalized = this.os.fs.normalize(filename);
    if (this.cache.has(normalized)) return this.cache.get(normalized).exports;
    if (this.node.isEsmFile(normalized)) throw new Error(`require() of ES module is not supported: ${normalized}`);
    if (normalized.endsWith(".json")) {
      const jsonModule = {
        id: normalized,
        filename: normalized,
        loaded: true,
        exports: JSON.parse(this.os.fs.readFile(normalized, "/", this.node.system)),
      };
      this.cache.set(normalized, jsonModule);
      return jsonModule.exports;
    }
    const module = {
      id: normalized,
      filename: normalized,
      loaded: false,
      exports: {},
    };
    this.cache.set(normalized, module);
    const source = this.os.fs.readFile(normalized, "/", this.node.system);
    this.executeJavaScript(source, normalized, module);
    module.loaded = true;
    return module.exports;
  }

  executeJavaScript(source, filename, module) {
    const dirname = this.os.fs.dirname(filename);
    const localRequire = (specifier) => this.require(specifier, filename);
    localRequire.resolve = (specifier) => {
      const resolved = this.node.resolveModule(specifier, filename, dirname);
      return resolved.type === "builtin" ? resolved.id : resolved.path;
    };
    try {
      const run = new Function(
        "exports",
        "require",
        "module",
        "__filename",
        "__dirname",
        "process",
        "console",
        "Buffer",
        `${source}\n//# sourceURL=dindbos://${encodeURI(filename)}`,
      );
      run.call(module.exports, module.exports, localRequire, module, filename, dirname, this.process, this.console, this.buffer);
    } catch (error) {
      if (error?.code === "DINDOS_PROCESS_EXIT" && error.exitCode === 0) return;
      throw error;
    }
  }

  require(specifier, fromFilename) {
    const resolved = this.node.resolveModule(specifier, fromFilename, this.processContext.cwd);
    if (resolved.type === "builtin") return this.builtins[resolved.id];
    return this.loadModule(resolved.path);
  }

  createRequire(fromFilename) {
    const filename = normalizeRequireFilename(this.os, fromFilename, this.processContext.cwd);
    const requireFrom = (specifier) => this.require(specifier, filename);
    requireFrom.resolve = (specifier) => {
      const resolved = this.node.resolveModule(specifier, filename, this.os.fs.dirname(filename));
      return resolved.type === "builtin" ? resolved.id : resolved.path;
    };
    return requireFrom;
  }

  createModuleModule() {
    class Module {}
    Module.builtinModules = builtinModuleNames();
    Module.createRequire = (filename) => this.createRequire(filename);
    Module.isBuiltin = (specifier) => isBuiltinSpecifier(specifier);
    return {
      Module,
      builtinModules: Module.builtinModules,
      createRequire: Module.createRequire,
      isBuiltin: Module.isBuiltin,
      syncBuiltinESMExports: () => undefined,
    };
  }

  result() {
    return {
      output: this.output.join("\n"),
      status: this.process.exitCode || 0,
    };
  }

  createConsole() {
    return createConsoleModule(this.output).console;
  }

  createProcess() {
    const context = this.processContext;
    const startedAt = Date.now();
    const hrtimeOrigin = Number(globalThis.performance?.now?.() || Date.now());
    const hrtime = (previous) => {
      const elapsedMs = Number(globalThis.performance?.now?.() || Date.now()) - hrtimeOrigin;
      const seconds = Math.floor(elapsedMs / 1000);
      const nanoseconds = Math.floor((elapsedMs - seconds * 1000) * 1_000_000);
      if (Array.isArray(previous)) {
        let deltaSeconds = seconds - Number(previous[0] || 0);
        let deltaNanoseconds = nanoseconds - Number(previous[1] || 0);
        if (deltaNanoseconds < 0) {
          deltaSeconds -= 1;
          deltaNanoseconds += 1_000_000_000;
        }
        return [Math.max(0, deltaSeconds), Math.max(0, deltaNanoseconds)];
      }
      return [seconds, nanoseconds];
    };
    hrtime.bigint = () => {
      const [seconds, nanoseconds] = hrtime();
      return BigInt(seconds) * 1_000_000_000n + BigInt(nanoseconds);
    };
    return {
      argv: context.argv,
      env: context.env,
      platform: "browser",
      browser: true,
      version: "v0.0.0-dindbos",
      versions: { node: "0.0.0-dindbos", dindbos: "0.1.0" },
      release: { name: "dindbos-nodecompat", sourceUrl: "", headersUrl: "" },
      title: "dindbos-nodecompat",
      execPath: "/usr/bin/node",
      get exitCode() {
        return context.exitCode;
      },
      set exitCode(value) {
        context.exitCode = Number(value) || 0;
      },
      cwd: () => context.cwd,
      uptime: () => Math.max(0, (Date.now() - startedAt) / 1000),
      hrtime,
      memoryUsage: () => ({
        rss: 0,
        heapTotal: 0,
        heapUsed: 0,
        external: 0,
        arrayBuffers: 0,
      }),
      nextTick: (callback, ...args) => {
        if (typeof callback !== "function") throw new Error("process.nextTick: callback must be a function");
        callback(...args);
      },
      chdir: (path) => {
        const nextPath = this.node.resolveFsPath(path, context.cwd);
        const next = this.os.fs.resolve(nextPath);
        if (!next || next.type !== "directory") throw new Error(`process.chdir: no such directory: ${path}`);
        context.cwd = next.path;
        context.env.PWD = next.path;
      },
      exit: (code = 0) => {
        context.exitCode = Number(code) || 0;
        const error = new Error(`process.exit(${context.exitCode})`);
        error.code = "DINDOS_PROCESS_EXIT";
        error.exitCode = context.exitCode;
        throw error;
      },
    };
  }

  createPathModule() {
    const normalize = (path) => this.os.fs.normalize(path || ".", "/");
    const pathModule = {
      sep: "/",
      delimiter: ":",
      normalize,
      isAbsolute: (path) => String(path || "").startsWith("/"),
      join: (...parts) => normalize(parts.filter(Boolean).join("/")),
      resolve: (...parts) => {
        let cursor = this.processContext.cwd;
        parts.forEach((part) => {
          if (!part) return;
          cursor = String(part).startsWith("/") ? this.os.fs.normalize(part) : this.os.fs.join(cursor, part);
        });
        return this.os.fs.normalize(cursor);
      },
      dirname: (path) => this.os.fs.dirname(path),
      basename: (path, ext = "") => {
        const base = this.os.fs.basename(path);
        return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
      },
      extname: (path) => {
        const base = this.os.fs.basename(path);
        const index = base.lastIndexOf(".");
        return index > 0 ? base.slice(index) : "";
      },
      relative: (from, to) => relativePath(this.os.fs.normalize(from), this.os.fs.normalize(to)),
    };
    pathModule.posix = pathModule;
    pathModule.win32 = createWin32PathModule();
    return pathModule;
  }

  createFsModule(streamModule) {
    const fsModule = {
      constants: createFsConstants(),
      readFileSync: (path, encoding = null) => {
        const resolved = this.node.resolveFsPath(path, this.processContext.cwd);
        if (encoding === "utf8" || encoding === "utf-8" || encoding?.encoding) {
          return this.os.fs.readFile(resolved, "/", this.node.system);
        }
        return this.buffer.from(this.os.fs.readFileBytes(resolved, "/", this.node.system));
      },
      writeFileSync: (path, data) => {
        const resolved = this.node.resolveFsPath(path, this.processContext.cwd);
        if (data instanceof Uint8Array) {
          this.os.fs.writeOrCreateFileBytes(resolved, data, "/", {}, this.node.system);
          return;
        }
        this.os.fs.writeOrCreateFile(resolved, stringifyFileData(data), "/", {}, this.node.system);
      },
      appendFileSync: (path, data) => {
        const resolved = this.node.resolveFsPath(path, this.processContext.cwd);
        this.os.fs.appendFile(resolved, stringifyFileData(data), "/", this.node.system);
      },
      existsSync: (path) => this.os.fs.exists(this.node.resolveFsPath(path, this.processContext.cwd), "/"),
      realpathSync: (path) => {
        const resolved = this.node.resolveFsPath(path, this.processContext.cwd);
        if (!this.os.fs.exists(resolved, "/")) throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
        return resolved;
      },
      statSync: (path) => createStats(this.os.fs.stat(this.node.resolveFsPath(path, this.processContext.cwd), "/")),
      lstatSync: (path) => createStats(this.os.fs.lstat(this.node.resolveFsPath(path, this.processContext.cwd), "/")),
      readdirSync: (path = ".", options = {}) => {
        const entries = this.os.fs.list(this.node.resolveFsPath(path, this.processContext.cwd), "/", this.node.system);
        if (options?.withFileTypes) return entries.map((entry) => createDirent(entry));
        return entries.map((entry) => entry.name);
      },
      opendirSync: (path = ".", options = {}) => createDirHandle(this.node.resolveFsPath(path, this.processContext.cwd), fsModule.readdirSync(path, { ...options, withFileTypes: true })),
      mkdirSync: (path, options = {}) => {
        const resolved = this.node.resolveFsPath(path, this.processContext.cwd);
        if (options?.recursive) return ensureDirectory(this.os, resolved, "/", this.node.system);
        return this.os.fs.createDirectory(resolved, "/", {}, this.node.system);
      },
      mkdtempSync: (prefix) => createTempDirectory(this.os, this.node.resolveFsPath(prefix, this.processContext.cwd), this.node.system),
      rmSync: (path, options = {}) => this.os.fs.remove(this.node.resolveFsPath(path, this.processContext.cwd), "/", options, this.node.system),
      unlinkSync: (path) => this.os.fs.remove(this.node.resolveFsPath(path, this.processContext.cwd), "/", {}, this.node.system),
      renameSync: (oldPath, newPath) => this.os.fs.move(this.node.resolveFsPath(oldPath, this.processContext.cwd), this.node.resolveFsPath(newPath, this.processContext.cwd), "/", this.node.system),
      copyFileSync: (source, destination, mode = 0) => {
        const resolvedSource = this.node.resolveFsPath(source, this.processContext.cwd);
        const resolvedDestination = this.node.resolveFsPath(destination, this.processContext.cwd);
        if ((Number(mode) & fsModule.constants.COPYFILE_EXCL) && this.os.fs.exists(resolvedDestination, "/")) {
          throw new Error(`EEXIST: file already exists, copyfile '${source}' -> '${destination}'`);
        }
        this.os.fs.writeOrCreateFileBytes(resolvedDestination, this.os.fs.readFileBytes(resolvedSource, "/", this.node.system), "/", {}, this.node.system);
      },
      readFile: (path, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.readFileSync(path, optionalOptions(options))),
      writeFile: (path, data, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.writeFileSync(path, data)),
      appendFile: (path, data, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.appendFileSync(path, data)),
      realpath: (path, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.realpathSync(path)),
      readdir: (path, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.readdirSync(path, optionalOptions(options))),
      opendir: (path, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.opendirSync(path, optionalOptions(options))),
      mkdir: (path, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.mkdirSync(path, optionalOptions(options))),
      mkdtemp: (prefix, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.mkdtempSync(prefix)),
      rm: (path, options, callback) => invokeFsCallback(optionalCallback(options, callback), () => fsModule.rmSync(path, optionalOptions(options))),
      unlink: (path, callback) => invokeFsCallback(callback, () => fsModule.unlinkSync(path)),
      rename: (oldPath, newPath, callback) => invokeFsCallback(callback, () => fsModule.renameSync(oldPath, newPath)),
      copyFile: (source, destination, mode, callback) => invokeFsCallback(optionalCallback(mode, callback), () => fsModule.copyFileSync(source, destination, optionalOptions(mode) || 0)),
      stat: (path, callback) => invokeFsCallback(callback, () => fsModule.statSync(path)),
      lstat: (path, callback) => invokeFsCallback(callback, () => fsModule.lstatSync(path)),
      access: (path, mode, callback) =>
        invokeFsCallback(optionalCallback(mode, callback), () => {
          if (!fsModule.existsSync(path)) throw new Error(`ENOENT: no such file or directory, access '${path}'`);
        }),
      createReadStream: (path, options = {}) => {
        const streamOptions = normalizeStreamOptions(options);
        const data = fsModule.readFileSync(path, streamOptions.encoding || null);
        const stream = streamModule.Readable.from([data]);
        stream.path = path;
        stream.bytesRead = data?.length || 0;
        stream.pending = false;
        if (streamOptions.autoClose !== false) stream.on("end", () => stream.emit("close"));
        return stream;
      },
      createWriteStream: (path, options = {}) => {
        const streamOptions = normalizeStreamOptions(options);
        const chunks = [];
        const stream = new streamModule.Writable({
          write: (chunk, encoding, callback) => {
            chunks.push(chunk);
            stream.bytesWritten += measureChunkLength(chunk, this.buffer, encoding);
            callback?.();
          },
          final: (callback) => {
            fsModule.writeFileSync(path, mergeStreamChunks(chunks, this.buffer, streamOptions.encoding || "utf8"));
            callback?.();
          },
        });
        stream.path = path;
        stream.bytesWritten = 0;
        stream.pending = false;
        if (streamOptions.autoClose !== false) stream.on("finish", () => stream.emit("close"));
        return stream;
      },
    };
    fsModule.promises = {
      readFile: async (path, encoding = null) => fsModule.readFileSync(path, encoding),
      writeFile: async (path, data) => fsModule.writeFileSync(path, data),
      appendFile: async (path, data) => fsModule.appendFileSync(path, data),
      realpath: async (path) => fsModule.realpathSync(path),
      readdir: async (path = ".", options = {}) => fsModule.readdirSync(path, options),
      opendir: async (path = ".", options = {}) => fsModule.opendirSync(path, options),
      mkdir: async (path, options = {}) => fsModule.mkdirSync(path, options),
      mkdtemp: async (prefix) => fsModule.mkdtempSync(prefix),
      rm: async (path, options = {}) => fsModule.rmSync(path, options),
      unlink: async (path) => fsModule.unlinkSync(path),
      rename: async (oldPath, newPath) => fsModule.renameSync(oldPath, newPath),
      copyFile: async (source, destination, mode = 0) => fsModule.copyFileSync(source, destination, mode),
      stat: async (path) => fsModule.statSync(path),
      lstat: async (path) => fsModule.lstatSync(path),
      access: async (path) => {
        if (!fsModule.existsSync(path)) throw new Error(`ENOENT: no such file or directory, access '${path}'`);
      },
    };
    fsModule.realpathSync.native = fsModule.realpathSync;
    fsModule.realpath.native = fsModule.realpath;
    return fsModule;
  }
}

class EsmRuntime extends CommonJsRuntime {
  constructor(node, processContext) {
    super(node, processContext);
    this.esmCache = new Map();
  }

  async evaluate(source, filename) {
    const module = { id: filename, filename, namespace: {}, loaded: false };
    await this.executeModuleSource(source, filename, module);
    return module.namespace;
  }

  async loadModule(filename) {
    const normalized = this.os.fs.normalize(filename);
    if (this.esmCache.has(normalized)) return this.esmCache.get(normalized).namespace;
    if (normalized.endsWith(".json")) {
      const jsonModule = {
        id: normalized,
        filename: normalized,
        namespace: { default: JSON.parse(this.os.fs.readFile(normalized, "/", this.node.system)) },
        loaded: true,
      };
      this.esmCache.set(normalized, jsonModule);
      return jsonModule.namespace;
    }
    if (!this.node.isEsmFile(normalized)) {
      return commonJsNamespace(super.loadModule(normalized));
    }
    const module = { id: normalized, filename: normalized, namespace: {}, loaded: false };
    this.esmCache.set(normalized, module);
    const source = this.os.fs.readFile(normalized, "/", this.node.system);
    await this.executeModuleSource(source, normalized, module);
    module.loaded = true;
    return module.namespace;
  }

  async executeModuleSource(source, filename, module) {
    const transformed = transformEsmSource(source);
    const moduleImport = (specifier) => this.importModule(specifier, filename);
    const moduleExport = (values) => Object.assign(module.namespace, values);
    try {
      const run = new AsyncFunction(
        "__import",
        "__export",
        "process",
        "console",
        "Buffer",
        `${transformed}\n//# sourceURL=dindbos://${encodeURI(filename)}`,
      );
      await run(moduleImport, moduleExport, this.process, this.console, this.buffer);
    } catch (error) {
      if (error?.code === "DINDOS_PROCESS_EXIT" && error.exitCode === 0) return;
      throw error;
    }
  }

  async importModule(specifier, fromFilename) {
    const resolved = this.node.resolveModule(specifier, fromFilename, this.processContext.cwd, { condition: "import" });
    if (resolved.type === "builtin") return commonJsNamespace(this.builtins[resolved.id]);
    return this.loadModule(resolved.path);
  }

  require(specifier, fromFilename) {
    const resolved = this.node.resolveModule(specifier, fromFilename, this.processContext.cwd, { condition: "require" });
    if (resolved.type === "builtin") return this.builtins[resolved.id];
    return CommonJsRuntime.prototype.loadModule.call(this, resolved.path);
  }
}

function splitPackageSpecifier(specifier) {
  const parts = String(specifier || "").split("/");
  if (parts[0]?.startsWith("@")) {
    return {
      packageName: `${parts[0]}/${parts[1]}`,
      subpath: parts.slice(2).join("/"),
    };
  }
  return {
    packageName: parts[0],
    subpath: parts.slice(1).join("/"),
  };
}

function stringEntry(exportsField, condition = "require") {
  return conditionEntry(exportsField, condition);
}

function exportEntry(exportsField, subpath = "", condition = "require") {
  if (!exportsField) return "";
  const key = subpath ? `./${subpath.replace(/^\.\//, "")}` : ".";
  if (typeof exportsField === "string" || isConditionMap(exportsField)) {
    return key === "." ? conditionEntry(exportsField, condition) : "";
  }
  if (typeof exportsField !== "object") return "";
  if (exportsField[key]) return conditionEntry(exportsField[key], condition);
  if (key === "." && exportsField["."]) return conditionEntry(exportsField["."], condition);
  return "";
}

function conditionEntry(entry, condition = "require") {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return "";
  const keys = condition === "import"
    ? ["import", "module", "browser", "default", "require"]
    : ["require", "browser", "default", "import", "module"];
  for (const key of keys) {
    const value = conditionEntry(entry[key], condition);
    if (value) return value;
  }
  return "";
}

function isConditionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => !key.startsWith("."));
}

function packageEntry(manifest, condition = "require") {
  if (condition === "import") return manifest.module || manifest.main || "index.js";
  return manifest.main || manifest.module || "index.js";
}

function transformEsmSource(source) {
  const state = { importIndex: 0, exportedNames: [], defaultExportAssigned: false };
  let code = transformImportStatements(String(source), state);
  code = code.replace(/\bexport\s+default\s+(async\s+function|function|class)\s*/g, (_, declaration) => {
    state.defaultExportAssigned = true;
    return `const __default_export__ = ${declaration} `;
  });
  code = code.replace(/\bexport\s+default\s+([^;\n]+);?/g, (_, expression) => {
    state.defaultExportAssigned = true;
    return `const __default_export__ = ${expression};`;
  });
  code = code.replace(/\bexport\s+(async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/g, (_, declaration, name) => {
    state.exportedNames.push(name);
    return `${declaration} ${name}`;
  });
  code = code.replace(/\bexport\s+(const|let|var)\s+([^;\n]+);?/g, (_, declaration, declarations) => {
    state.exportedNames.push(...declarationNames(declarations));
    return `${declaration} ${declarations};`;
  });
  code = code.replace(/\bexport\s*\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];?/g, (_, specifiers, specifier) => {
    const moduleName = `__esm_reexport_${state.importIndex++}`;
    return `const ${moduleName} = await __import(${JSON.stringify(specifier)});\n__export({ ${exportFromProperties(specifiers, moduleName)} });`;
  });
  code = code.replace(/\bexport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];?/g, (_, name, specifier) => {
    const moduleName = `__esm_reexport_${state.importIndex++}`;
    return `const ${moduleName} = await __import(${JSON.stringify(specifier)});\n__export({ ${name}: ${moduleName} });`;
  });
  code = code.replace(/\bexport\s+\*\s+from\s+["']([^"']+)["'];?/g, (_, specifier) => {
    const moduleName = `__esm_reexport_${state.importIndex++}`;
    return `const ${moduleName} = await __import(${JSON.stringify(specifier)});\n__export(Object.fromEntries(Object.entries(${moduleName}).filter(([key]) => key !== "default")));`;
  });
  code = code.replace(/\bexport\s*\{([\s\S]*?)\};?/g, (_, specifiers) => `__export({ ${exportObjectProperties(specifiers)} });`);
  const footer = [];
  if (state.exportedNames.length) footer.push(`__export({ ${[...new Set(state.exportedNames)].join(", ")} });`);
  if (state.defaultExportAssigned) footer.push("__export({ default: __default_export__ });");
  return `${code}\n${footer.join("\n")}`;
}

function transformImportStatements(source, state) {
  let code = source.replace(/^\s*import\s+["']([^"']+)["'];?/gm, (_, specifier) => `await __import(${JSON.stringify(specifier)});`);
  code = code.replace(/^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm, (_, clause, specifier) => importClauseToCode(clause.trim(), specifier, state.importIndex++));
  code = code.replace(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, (_, specifier) => `__import(${JSON.stringify(specifier)})`);
  return code;
}

function importClauseToCode(clause, specifier, index) {
  const serializedSpecifier = JSON.stringify(specifier);
  if (clause.startsWith("* as ")) {
    return `const ${clause.slice(5).trim()} = await __import(${serializedSpecifier});`;
  }
  if (clause.startsWith("{")) {
    return `const { ${importDestructureProperties(clause.slice(1, -1))} } = await __import(${serializedSpecifier});`;
  }
  if (clause.includes(",")) {
    const [defaultName, rest] = splitImportClause(clause);
    const moduleName = `__esm_import_${index}`;
    const lines = [`const ${moduleName} = await __import(${serializedSpecifier});`, `const ${defaultName.trim()} = ${moduleName}.default;`];
    const named = rest.trim();
    if (named.startsWith("{")) lines.push(`const { ${importDestructureProperties(named.slice(1, -1))} } = ${moduleName};`);
    else if (named.startsWith("* as ")) lines.push(`const ${named.slice(5).trim()} = ${moduleName};`);
    return lines.join("\n");
  }
  return `const ${clause} = (await __import(${serializedSpecifier})).default;`;
}

function splitImportClause(clause) {
  const commaIndex = clause.indexOf(",");
  return [clause.slice(0, commaIndex), clause.slice(commaIndex + 1)];
}

function importDestructureProperties(specifiers) {
  return specifiers.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\s+as\s+/g, ": "))
    .join(", ");
}

function declarationNames(declarations) {
  return String(declarations || "")
    .split(",")
    .map((part) => part.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1] || "")
    .filter(Boolean);
}

function exportObjectProperties(specifiers) {
  return specifiers.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [local, exported] = part.split(/\s+as\s+/);
      return exported ? `${exported.trim()}: ${local.trim()}` : part;
    })
    .join(", ");
}

function exportFromProperties(specifiers, moduleName) {
  return specifiers.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [imported, exported] = part.split(/\s+as\s+/);
      const local = imported.trim();
      const name = exported ? exported.trim() : local;
      return `${name}: ${moduleName}.${local}`;
    })
    .join(", ");
}

function commonJsNamespace(exports) {
  if (exports && (typeof exports === "object" || typeof exports === "function")) return { default: exports, ...exports };
  return { default: exports };
}

function builtinModuleNames() {
  const names = [...BUILTIN_MODULES].map((name) => name.replace(/^node:/, ""));
  return [...new Set(names)].sort();
}

function isBuiltinSpecifier(specifier) {
  return BUILTIN_MODULES.has(String(specifier || ""));
}

function normalizeRequireFilename(os, fromFilename, cwd) {
  const value = String(fromFilename || cwd || "/");
  const path = value.startsWith("file://")
    ? decodeURIComponent(new URL(value).pathname || "/")
    : value;
  const normalized = os.fs.normalize(path, cwd);
  return normalized.endsWith("/") ? os.fs.join(normalized, "[require].js") : normalized;
}

function safeJson(content, fallback) {
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

function createBufferFacade() {
  if (globalThis.Buffer) return globalThis.Buffer;
  const BufferFacade = {
    from: (value, encodingOrOffset = "utf8", length = undefined) => createByteBuffer(value, encodingOrOffset, length),
    alloc: (size = 0, fill = 0, encoding = "utf8") => {
      const bytes = createByteBuffer(new Uint8Array(Math.max(0, Number(size) || 0)));
      if (fill !== 0 && fill !== undefined && bytes.length) bytes.fill(resolveBufferFill(fill, encoding));
      return bytes;
    },
    allocUnsafe: (size = 0) => createByteBuffer(new Uint8Array(Math.max(0, Number(size) || 0))),
    allocUnsafeSlow: (size = 0) => createByteBuffer(new Uint8Array(Math.max(0, Number(size) || 0))),
    concat: (chunks = [], totalLength = undefined) => {
      const normalized = chunks.map((chunk) => createByteBuffer(chunk));
      const total = totalLength === undefined ? normalized.reduce((sum, chunk) => sum + chunk.byteLength, 0) : Number(totalLength) || 0;
      const bytes = createByteBuffer(new Uint8Array(Math.max(0, total)));
      let offset = 0;
      for (const chunk of normalized) {
        if (offset >= bytes.length) break;
        bytes.set(chunk.slice(0, bytes.length - offset), offset);
        offset += chunk.byteLength;
      }
      return bytes;
    },
    compare: (left, right) => compareByteBuffers(left, right),
    isBuffer: (value) => Boolean(value?.__dindbosBuffer),
    isEncoding: (encoding) => isBufferEncoding(encoding),
    byteLength: (value, encoding = "utf8") => createByteBuffer(value, encoding).byteLength,
  };
  BufferFacade.kMaxLength = Number.MAX_SAFE_INTEGER;
  return BufferFacade;
}

function createByteBuffer(value, encodingOrOffset = "utf8", length = undefined) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(
      value,
      Math.max(0, Number(encodingOrOffset) || 0),
      length === undefined ? undefined : Math.max(0, Number(length) || 0),
    )
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : Array.isArray(value)
        ? Uint8Array.from(value.map((byte) => Number(byte) & 0xff))
        : decodeBufferString(String(value ?? ""), encodingOrOffset);
  Object.defineProperty(bytes, "__dindbosBuffer", { value: true });
  bytes.toString = (encoding = "utf8") => {
    if (encoding === "hex") return bytesToHex(bytes);
    if (encoding === "base64") return bytesToBase64(bytes);
    if (encoding === "base64url") return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    if (["latin1", "binary", "ascii"].includes(normalizeBufferEncoding(encoding))) return [...bytes].map((byte) => String.fromCharCode(byte)).join("");
    if (encoding !== "utf8" && encoding !== "utf-8") throw new Error(`Buffer: unsupported encoding: ${encoding}`);
    return new TextDecoder().decode(bytes);
  };
  bytes.equals = (other) => compareByteBuffers(bytes, other) === 0;
  bytes.compare = (other) => compareByteBuffers(bytes, other);
  return bytes;
}

function compareByteBuffers(left, right) {
  const leftBytes = createByteBuffer(left);
  const rightBytes = createByteBuffer(right);
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] < rightBytes[index] ? -1 : 1;
  }
  if (leftBytes.byteLength === rightBytes.byteLength) return 0;
  return leftBytes.byteLength < rightBytes.byteLength ? -1 : 1;
}

function decodeBufferString(value, encoding = "utf8") {
  const normalized = normalizeBufferEncoding(encoding);
  if (normalized === "hex") return hexToBytes(value);
  if (normalized === "base64" || normalized === "base64url") return base64ToBytes(value, normalized);
  if (["latin1", "binary", "ascii"].includes(normalized)) return Uint8Array.from([...value].map((character) => character.charCodeAt(0) & 0xff));
  if (normalized !== "utf8") throw new Error(`Buffer: unsupported encoding: ${encoding}`);
  return new TextEncoder().encode(value);
}

function normalizeBufferEncoding(encoding = "utf8") {
  const normalized = String(encoding || "utf8").toLowerCase().replace(/[-_]/g, "");
  if (normalized === "utf8") return "utf8";
  if (normalized === "base64url") return "base64url";
  return normalized;
}

function isBufferEncoding(encoding = "") {
  return ["utf8", "hex", "base64", "base64url", "latin1", "binary", "ascii"].includes(normalizeBufferEncoding(encoding));
}

function resolveBufferFill(fill, encoding = "utf8") {
  if (typeof fill === "number") return fill & 0xff;
  const bytes = createByteBuffer(fill, encoding);
  return bytes[0] || 0;
}

function hexToBytes(value = "") {
  const clean = String(value || "").replace(/\s+/g, "");
  const length = clean.length - (clean.length % 2);
  const bytes = new Uint8Array(length / 2);
  for (let index = 0; index < length; index += 2) bytes[index / 2] = Number.parseInt(clean.slice(index, index + 2), 16) || 0;
  return bytes;
}

function base64ToBytes(value = "", encoding = "base64") {
  const normalized = encoding === "base64url"
    ? String(value).replace(/-/g, "+").replace(/_/g, "/")
    : String(value);
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof atob === "function") return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  throw new Error("base64 decoding is not available");
}

function createEventsModule() {
  class EventEmitter {
    constructor() {
      this._events = new Map();
    }

    on(eventName, listener) {
      return this.addListener(eventName, listener);
    }

    addListener(eventName, listener) {
      if (typeof listener !== "function") throw new Error("events: listener must be a function");
      const key = String(eventName);
      const listeners = this._events.get(key) || [];
      listeners.push(listener);
      this._events.set(key, listeners);
      return this;
    }

    once(eventName, listener) {
      if (typeof listener !== "function") throw new Error("events: listener must be a function");
      const wrapped = (...args) => {
        this.removeListener(eventName, wrapped);
        listener.apply(this, args);
      };
      wrapped.listener = listener;
      return this.addListener(eventName, wrapped);
    }

    off(eventName, listener) {
      return this.removeListener(eventName, listener);
    }

    removeListener(eventName, listener) {
      const key = String(eventName);
      const listeners = this._events.get(key) || [];
      const next = listeners.filter((candidate) => candidate !== listener && candidate.listener !== listener);
      if (next.length) this._events.set(key, next);
      else this._events.delete(key);
      return this;
    }

    removeAllListeners(eventName) {
      if (eventName === undefined) this._events.clear();
      else this._events.delete(String(eventName));
      return this;
    }

    emit(eventName, ...args) {
      const listeners = [...(this._events.get(String(eventName)) || [])];
      if (!listeners.length) return false;
      listeners.forEach((listener) => listener.apply(this, args));
      return true;
    }

    listeners(eventName) {
      return [...(this._events.get(String(eventName)) || [])].map((listener) => listener.listener || listener);
    }

    listenerCount(eventName) {
      return this.listeners(eventName).length;
    }

    eventNames() {
      return [...this._events.keys()];
    }
  }
  EventEmitter.listenerCount = (emitter, eventName) => emitter.listenerCount(eventName);
  return {
    EventEmitter,
    default: EventEmitter,
    once: (emitter, eventName) => new Promise((resolve) => {
      emitter.once(eventName, (...args) => resolve(args));
    }),
  };
}

function createUrlModule() {
  const pathToFileURL = (path) => {
    const normalized = String(path || "").startsWith("/") ? String(path) : `/${String(path || "")}`;
    return new URL(`file://${normalized.split("/").map(encodeURIComponent).join("/")}`);
  };
  const fileURLToPath = (value) => {
    const url = value instanceof URL ? value : new URL(String(value));
    if (url.protocol !== "file:") throw new Error(`url.fileURLToPath: unsupported protocol: ${url.protocol}`);
    return decodeURIComponent(url.pathname || "/");
  };
  const parse = (value = "", parseQueryString = false) => {
    const input = String(value || "");
    const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(input);
    const parsed = new URL(input, hasProtocol ? undefined : "http://dindbos.local");
    const absolute = hasProtocol || input.startsWith("//");
    const query = parsed.search ? parsed.search.slice(1) : "";
    return {
      href: absolute ? parsed.href : `${parsed.pathname}${parsed.search}${parsed.hash}`,
      protocol: absolute ? parsed.protocol : null,
      slashes: input.startsWith("//") || parsed.protocol === "http:" || parsed.protocol === "https:",
      auth: parsed.username || parsed.password ? `${decodeURIComponent(parsed.username)}${parsed.password ? `:${decodeURIComponent(parsed.password)}` : ""}` : null,
      host: absolute || input.startsWith("//") ? parsed.host : null,
      port: parsed.port || null,
      hostname: absolute || input.startsWith("//") ? parsed.hostname : null,
      hash: parsed.hash || null,
      search: parsed.search || null,
      query: parseQueryString ? Object.fromEntries(parsed.searchParams.entries()) : query,
      pathname: parsed.pathname,
      path: `${parsed.pathname}${parsed.search}`,
    };
  };
  const format = (value = {}) => {
    if (typeof value === "string") return value;
    if (value instanceof URL) return value.href;
    if (value.href) return String(value.href);
    const protocol = value.protocol ? String(value.protocol).replace(/:?$/, ":") : "";
    const slashes = value.slashes || protocol === "http:" || protocol === "https:" ? "//" : "";
    const auth = value.auth ? `${encodeURIComponent(String(value.auth))}@` : "";
    const host = value.host || [value.hostname, value.port].filter(Boolean).join(":");
    const pathname = value.pathname || "";
    const query = value.search
      ? String(value.search)
      : value.query && typeof value.query === "object"
        ? `?${new URLSearchParams(value.query).toString()}`
        : value.query
          ? `?${String(value.query).replace(/^\?/, "")}`
          : "";
    const hash = value.hash ? String(value.hash).replace(/^#?/, "#") : "";
    return `${protocol}${slashes}${auth}${host || ""}${pathname}${query}${hash}`;
  };
  const resolve = (from, to) => new URL(String(to || ""), new URL(String(from || ""), "http://dindbos.local")).href.replace(/^http:\/\/dindbos\.local/, "");
  return {
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    domainToASCII: (domain) => {
      try {
        return new URL(`http://${domain}`).hostname;
      } catch {
        return "";
      }
    },
    domainToUnicode: (domain) => String(domain || ""),
    fileURLToPath,
    format,
    pathToFileURL,
    parse,
    resolve,
  };
}

function createUtilModule(types = createUtilTypesModule(), consoleApi = null, processContext = null) {
  const format = (template, ...values) => {
    if (typeof template !== "string") return [template, ...values].map(formatConsoleValue).join(" ");
    let index = 0;
    const formatted = template.replace(/%[sdjifoO%]/g, (token) => {
      if (token === "%%") return "%";
      const value = values[index++];
      if (token === "%s") return String(value);
      if (token === "%d" || token === "%i") return String(Number.parseInt(value, 10));
      if (token === "%f") return String(Number.parseFloat(value));
      return formatConsoleValue(value);
    });
    const rest = values.slice(index).map(formatConsoleValue).join(" ");
    return rest ? `${formatted} ${rest}` : formatted;
  };
  const inspect = (value) => formatConsoleValue(value);
  const promisify = (fn) => (...args) => new Promise((resolve, reject) => {
    fn(...args, (error, value) => (error ? reject(error) : resolve(value)));
  });
  const callbackify = (fn) => (...args) => {
    const callback = args.pop();
    if (typeof callback !== "function") throw new Error("util.callbackify: callback must be a function");
    Promise.resolve()
      .then(() => fn(...args))
      .then((value) => callback(null, value), (error) => callback(error));
  };
  const inherits = (constructor, superConstructor) => {
    if (typeof constructor !== "function" || typeof superConstructor !== "function") {
      throw new Error("util.inherits: constructor arguments must be functions");
    }
    constructor.super_ = superConstructor;
    Object.setPrototypeOf(constructor.prototype, superConstructor.prototype);
  };
  const debuglog = (section, callback) => {
    const name = String(section || "").toUpperCase();
    const pattern = String(processContext?.env?.NODE_DEBUG || "");
    const enabled = pattern
      .split(/[,\s]+/)
      .filter(Boolean)
      .some((entry) => {
        const normalized = entry.toUpperCase();
        return normalized === "*" || normalized === name;
      });
    const logger = (...values) => {
      if (!enabled) return;
      consoleApi?.error?.(`${name}: ${format(...values)}`);
    };
    if (typeof callback === "function") callback(logger);
    return logger;
  };
  const deprecate = (fn, message, code) => {
    if (typeof fn !== "function") throw new Error("util.deprecate: first argument must be a function");
    let warned = false;
    return function deprecatedWrapper(...args) {
      if (!warned && !processContext?.noDeprecation) {
        warned = true;
        const suffix = code ? ` [${code}]` : "";
        consoleApi?.warn?.(`DeprecationWarning${suffix}: ${message}`);
      }
      return fn.apply(this, args);
    };
  };
  return {
    TextDecoder: globalThis.TextDecoder,
    TextEncoder: globalThis.TextEncoder,
    format,
    inspect,
    promisify,
    callbackify,
    inherits,
    isDeepStrictEqual: (left, right) => deepStrictEqual(left, right),
    debuglog,
    deprecate,
    types,
  };
}

function createUtilTypesModule() {
  const tag = (value) => Object.prototype.toString.call(value);
  const objectTag = (name) => (value) => tag(value) === `[object ${name}]`;
  const typedArrayConstructors = new Set([
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    globalThis.BigInt64Array,
    globalThis.BigUint64Array,
  ].filter(Boolean));
  const isTypedArray = (value) => ArrayBuffer.isView(value) && !(value instanceof DataView);
  return {
    isAnyArrayBuffer: (value) => value instanceof ArrayBuffer || tag(value) === "[object SharedArrayBuffer]",
    isArrayBuffer: (value) => value instanceof ArrayBuffer,
    isArrayBufferView: (value) => ArrayBuffer.isView(value),
    isArgumentsObject: objectTag("Arguments"),
    isBigInt64Array: (value) => typeof BigInt64Array !== "undefined" && value instanceof BigInt64Array,
    isBigUint64Array: (value) => typeof BigUint64Array !== "undefined" && value instanceof BigUint64Array,
    isBigIntObject: objectTag("BigInt"),
    isBooleanObject: objectTag("Boolean"),
    isBoxedPrimitive: (value) => ["[object Boolean]", "[object Number]", "[object String]", "[object Symbol]", "[object BigInt]"].includes(tag(value)),
    isDataView: (value) => value instanceof DataView,
    isDate: (value) => value instanceof Date,
    isFloat32Array: (value) => value instanceof Float32Array,
    isFloat64Array: (value) => value instanceof Float64Array,
    isInt8Array: (value) => value instanceof Int8Array,
    isInt16Array: (value) => value instanceof Int16Array,
    isInt32Array: (value) => value instanceof Int32Array,
    isMap: (value) => value instanceof Map,
    isMapIterator: (value) => tag(value) === "[object Map Iterator]",
    isNativeError: (value) => value instanceof Error,
    isNumberObject: objectTag("Number"),
    isPromise: (value) => Boolean(value && typeof value.then === "function"),
    isRegExp: (value) => value instanceof RegExp,
    isSet: (value) => value instanceof Set,
    isSetIterator: (value) => tag(value) === "[object Set Iterator]",
    isStringObject: objectTag("String"),
    isSymbolObject: objectTag("Symbol"),
    isTypedArray: (value) => isTypedArray(value) && typedArrayConstructors.has(value.constructor),
    isUint8Array: (value) => value instanceof Uint8Array,
    isUint8ClampedArray: (value) => value instanceof Uint8ClampedArray,
    isUint16Array: (value) => value instanceof Uint16Array,
    isUint32Array: (value) => value instanceof Uint32Array,
    isWeakMap: (value) => value instanceof WeakMap,
    isWeakSet: (value) => value instanceof WeakSet,
  };
}

function createTimersModule() {
  return {
    setTimeout: globalThis.setTimeout?.bind(globalThis),
    clearTimeout: globalThis.clearTimeout?.bind(globalThis),
    setInterval: globalThis.setInterval?.bind(globalThis),
    clearInterval: globalThis.clearInterval?.bind(globalThis),
    setImmediate: (callback, ...args) => globalThis.setTimeout?.(() => callback(...args), 0),
    clearImmediate: globalThis.clearTimeout?.bind(globalThis),
  };
}

function createPerfHooksModule() {
  const marks = [];
  const measures = [];
  const now = () => Number(globalThis.performance?.now?.() || Date.now());
  const timeOrigin = Number(globalThis.performance?.timeOrigin || Date.now());
  const toEntry = (entry) => ({
    name: entry.name,
    entryType: entry.entryType,
    startTime: entry.startTime,
    duration: entry.duration,
    detail: entry.detail,
    toJSON: () => ({ ...entry }),
  });
  const findMark = (name) => [...marks].reverse().find((entry) => entry.name === name);
  const performance = {
    get timeOrigin() {
      return timeOrigin;
    },
    now,
    mark: (name, options = {}) => {
      const entry = toEntry({
        name: String(name),
        entryType: "mark",
        startTime: options.startTime === undefined ? now() : Number(options.startTime),
        duration: 0,
        detail: options.detail,
      });
      marks.push(entry);
      return entry;
    },
    measure: (name, startOrOptions, endMark) => {
      const options = typeof startOrOptions === "object" && startOrOptions !== null ? startOrOptions : {};
      const startName = typeof startOrOptions === "string" ? startOrOptions : options.start;
      const endName = typeof endMark === "string" ? endMark : options.end;
      const startTime = options.start === undefined && startName
        ? findMark(startName)?.startTime
        : Number(options.start ?? 0);
      const endTime = options.end === undefined && endName
        ? findMark(endName)?.startTime
        : Number(options.end ?? now());
      if (startName && startTime === undefined) throw new Error(`perf_hooks: mark not found: ${startName}`);
      if (endName && endTime === undefined) throw new Error(`perf_hooks: mark not found: ${endName}`);
      const entry = toEntry({
        name: String(name),
        entryType: "measure",
        startTime: Number(startTime ?? 0),
        duration: Math.max(0, Number(endTime ?? 0) - Number(startTime ?? 0)),
        detail: options.detail,
      });
      measures.push(entry);
      return entry;
    },
    clearMarks: (name) => clearEntries(marks, name),
    clearMeasures: (name) => clearEntries(measures, name),
    getEntries: () => [...marks, ...measures],
    getEntriesByName: (name, type) => performance.getEntries().filter((entry) => entry.name === name && (!type || entry.entryType === type)),
    getEntriesByType: (type) => performance.getEntries().filter((entry) => entry.entryType === type),
  };
  class PerformanceObserver {
    constructor(callback) {
      if (typeof callback !== "function") throw new Error("perf_hooks: observer callback must be a function");
      this.callback = callback;
      this.entryTypes = [];
    }

    observe(options = {}) {
      this.entryTypes = Array.isArray(options.entryTypes) ? [...options.entryTypes] : [options.type].filter(Boolean);
      if (options.buffered) {
        const entries = performance.getEntries().filter((entry) => this.entryTypes.includes(entry.entryType));
        this.callback({ getEntries: () => entries }, this);
      }
    }

    disconnect() {
      this.entryTypes = [];
    }

    takeRecords() {
      return [];
    }

    static get supportedEntryTypes() {
      return ["mark", "measure"];
    }
  }
  return {
    performance,
    PerformanceObserver,
    constants: {
      NODE_PERFORMANCE_GC_MAJOR: 1,
      NODE_PERFORMANCE_GC_MINOR: 2,
      NODE_PERFORMANCE_GC_INCREMENTAL: 4,
      NODE_PERFORMANCE_GC_WEAKCB: 8,
    },
    monitorEventLoopDelay: () => {
      throw new Error("NodeCompat perf_hooks monitorEventLoopDelay is unavailable in the browser runtime.");
    },
  };
}

function clearEntries(entries, name) {
  if (name === undefined) {
    entries.splice(0, entries.length);
    return;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].name === name) entries.splice(index, 1);
  }
}

function createAsyncHooksModule() {
  let nextAsyncId = 1;
  let currentAsyncId = 0;
  let currentTriggerAsyncId = 0;

  class AsyncLocalStorage {
    constructor() {
      this.store = undefined;
      this.enabled = true;
    }

    run(store, callback, ...args) {
      if (typeof callback !== "function") throw new Error("async_hooks: callback must be a function");
      const previousStore = this.store;
      const previousEnabled = this.enabled;
      this.store = store;
      this.enabled = true;
      try {
        return callback(...args);
      } finally {
        this.store = previousStore;
        this.enabled = previousEnabled;
      }
    }

    enterWith(store) {
      this.store = store;
      this.enabled = true;
    }

    getStore() {
      return this.enabled ? this.store : undefined;
    }

    exit(callback, ...args) {
      if (typeof callback !== "function") throw new Error("async_hooks: callback must be a function");
      const previousStore = this.store;
      const previousEnabled = this.enabled;
      this.store = undefined;
      this.enabled = false;
      try {
        return callback(...args);
      } finally {
        this.store = previousStore;
        this.enabled = previousEnabled;
      }
    }

    disable() {
      this.store = undefined;
      this.enabled = false;
    }

    static bind(callback) {
      if (typeof callback !== "function") throw new Error("async_hooks: callback must be a function");
      return (...args) => callback(...args);
    }

    static snapshot() {
      return (callback, ...args) => callback(...args);
    }
  }

  class AsyncResource {
    constructor(type = "DindbOSAsyncResource", options = {}) {
      this.type = String(type || "DindbOSAsyncResource");
      this.id = nextAsyncId++;
      this.triggerId = Number(options.triggerAsyncId ?? currentAsyncId);
      this.destroyed = false;
    }

    asyncId() {
      return this.id;
    }

    triggerAsyncId() {
      return this.triggerId;
    }

    runInAsyncScope(callback, thisArg, ...args) {
      if (typeof callback !== "function") throw new Error("async_hooks: callback must be a function");
      const previousAsyncId = currentAsyncId;
      const previousTriggerAsyncId = currentTriggerAsyncId;
      currentAsyncId = this.id;
      currentTriggerAsyncId = this.triggerId;
      try {
        return callback.apply(thisArg, args);
      } finally {
        currentAsyncId = previousAsyncId;
        currentTriggerAsyncId = previousTriggerAsyncId;
      }
    }

    bind(callback, thisArg) {
      if (typeof callback !== "function") throw new Error("async_hooks: callback must be a function");
      return (...args) => this.runInAsyncScope(callback, thisArg, ...args);
    }

    emitDestroy() {
      this.destroyed = true;
      return this;
    }

    static bind(callback, type, thisArg) {
      return new AsyncResource(type || "DindbOSAsyncResource").bind(callback, thisArg);
    }
  }

  const createHook = () => {
    let enabled = false;
    return {
      enable() {
        enabled = true;
        return this;
      },
      disable() {
        enabled = false;
        return this;
      },
      get enabled() {
        return enabled;
      },
    };
  };

  return {
    AsyncLocalStorage,
    AsyncResource,
    createHook,
    executionAsyncId: () => currentAsyncId,
    triggerAsyncId: () => currentTriggerAsyncId,
    executionAsyncResource: () => null,
  };
}

function createNetworkModule(protocol) {
  const unsupported = () => {
    throw new Error(`NodeCompat ${protocol} networking is unavailable; use an explicit DindbOS network capability outside NodeCompat.`);
  };
  class ClientRequest {
    constructor() {
      unsupported();
    }
  }
  class IncomingMessage {
    constructor() {
      unsupported();
    }
  }
  class Agent {
    constructor() {
      unsupported();
    }
  }
  return {
    Agent,
    ClientRequest,
    IncomingMessage,
    globalAgent: null,
    request: unsupported,
    get: unsupported,
    createServer: unsupported,
    STATUS_CODES: {},
    METHODS: [],
  };
}

function createChildProcessModule() {
  const unsupported = () => {
    throw new Error("NodeCompat child_process is unavailable; browser-safe packages must use DindbOS app capabilities instead of spawning host processes.");
  };
  class ChildProcess {
    constructor() {
      unsupported();
    }
  }
  return {
    ChildProcess,
    exec: unsupported,
    execFile: unsupported,
    fork: unsupported,
    spawn: unsupported,
    execSync: unsupported,
    execFileSync: unsupported,
    spawnSync: unsupported,
  };
}

function createWorkerThreadsModule() {
  const unsupported = () => {
    throw new Error("NodeCompat worker_threads is unavailable; use browser Workers through an explicit DindbOS app capability.");
  };
  class Worker {
    constructor() {
      unsupported();
    }
  }
  class MessagePort {
    constructor() {
      this.onmessage = null;
    }
    postMessage() {
      unsupported();
    }
    close() {}
    ref() {
      return this;
    }
    unref() {
      return this;
    }
  }
  class MessageChannel {
    constructor() {
      this.port1 = new MessagePort();
      this.port2 = new MessagePort();
    }
  }
  return {
    Worker,
    MessageChannel,
    MessagePort,
    isMainThread: true,
    parentPort: null,
    workerData: null,
    threadId: 0,
    resourceLimits: {},
    SHARE_ENV: Symbol.for("dindbos.nodecompat.worker_threads.SHARE_ENV"),
    markAsUntransferable: () => undefined,
    moveMessagePortToContext: unsupported,
    receiveMessageOnPort: () => undefined,
  };
}

function createZlibModule() {
  const unsupported = () => {
    throw new Error("NodeCompat zlib compression is unavailable; use browser CompressionStream or an explicit DindbOS compression capability outside NodeCompat.");
  };
  class Zlib {
    constructor() {
      unsupported();
    }
  }
  return {
    Zlib,
    createGzip: unsupported,
    createGunzip: unsupported,
    createDeflate: unsupported,
    createInflate: unsupported,
    createDeflateRaw: unsupported,
    createInflateRaw: unsupported,
    createBrotliCompress: unsupported,
    createBrotliDecompress: unsupported,
    gzip: unsupported,
    gunzip: unsupported,
    deflate: unsupported,
    inflate: unsupported,
    deflateRaw: unsupported,
    inflateRaw: unsupported,
    unzip: unsupported,
    brotliCompress: unsupported,
    brotliDecompress: unsupported,
    gzipSync: unsupported,
    gunzipSync: unsupported,
    deflateSync: unsupported,
    inflateSync: unsupported,
    deflateRawSync: unsupported,
    inflateRawSync: unsupported,
    unzipSync: unsupported,
    brotliCompressSync: unsupported,
    brotliDecompressSync: unsupported,
    constants: {
      Z_NO_COMPRESSION: 0,
      Z_BEST_SPEED: 1,
      Z_BEST_COMPRESSION: 9,
      Z_DEFAULT_COMPRESSION: -1,
      BROTLI_PARAM_QUALITY: 1,
    },
  };
}

function createAssertModule() {
  class AssertionError extends Error {
    constructor(options = {}) {
      super(options.message || `Expected ${formatConsoleValue(options.actual)} ${options.operator || "=="} ${formatConsoleValue(options.expected)}`);
      this.name = "AssertionError";
      this.code = "ERR_ASSERTION";
      this.actual = options.actual;
      this.expected = options.expected;
      this.operator = options.operator || "==";
      this.generatedMessage = !options.message;
    }
  }
  const fail = (options = {}) => {
    throw new AssertionError(typeof options === "string" ? { message: options } : options);
  };
  const assert = (value, message = "") => {
    if (!value) fail({ actual: value, expected: true, operator: "==", message });
  };
  assert.AssertionError = AssertionError;
  assert.fail = (message = "Failed") => fail({ message });
  assert.ok = assert;
  assert.equal = (actual, expected, message = "") => {
    // Node's loose assertion survives for compatibility with older browser-safe packages.
    if (actual != expected) fail({ actual, expected, operator: "==", message });
  };
  assert.notEqual = (actual, expected, message = "") => {
    if (actual == expected) fail({ actual, expected, operator: "!=", message });
  };
  assert.strictEqual = (actual, expected, message = "") => {
    if (!Object.is(actual, expected)) fail({ actual, expected, operator: "strictEqual", message });
  };
  assert.notStrictEqual = (actual, expected, message = "") => {
    if (Object.is(actual, expected)) fail({ actual, expected, operator: "notStrictEqual", message });
  };
  assert.deepStrictEqual = (actual, expected, message = "") => {
    if (!deepStrictEqual(actual, expected)) fail({ actual, expected, operator: "deepStrictEqual", message });
  };
  assert.notDeepStrictEqual = (actual, expected, message = "") => {
    if (deepStrictEqual(actual, expected)) fail({ actual, expected, operator: "notDeepStrictEqual", message });
  };
  assert.throws = (fn, expected = undefined, message = "") => {
    if (typeof fn !== "function") fail({ message: "assert.throws: expected a function" });
    try {
      fn();
    } catch (error) {
      if (!matchesExpectedError(error, expected)) fail({ actual: error, expected, operator: "throws", message });
      return error;
    }
    fail({ actual: undefined, expected, operator: "throws", message: message || "Missing expected exception" });
  };
  assert.doesNotThrow = (fn, expected = undefined, message = "") => {
    if (typeof fn !== "function") fail({ message: "assert.doesNotThrow: expected a function" });
    try {
      fn();
    } catch (error) {
      if (matchesExpectedError(error, expected)) fail({ actual: error, expected, operator: "doesNotThrow", message });
    }
  };
  assert.strict = assert;
  return assert;
}

function deepStrictEqual(actual, expected, seen = new WeakMap()) {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== typeof expected) return false;
  if (!actual || !expected || typeof actual !== "object") return false;
  if (actual.constructor !== expected.constructor) return false;
  if (actual instanceof Date) return actual.getTime() === expected.getTime();
  if (actual instanceof RegExp) return String(actual) === String(expected);
  if (ArrayBuffer.isView(actual)) {
    if (!ArrayBuffer.isView(expected) || actual.byteLength !== expected.byteLength) return false;
    const actualBytes = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
    const expectedBytes = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
    return actualBytes.every((value, index) => value === expectedBytes[index]);
  }
  if (actual instanceof ArrayBuffer) {
    if (!(expected instanceof ArrayBuffer) || actual.byteLength !== expected.byteLength) return false;
    return new Uint8Array(actual).every((value, index) => value === new Uint8Array(expected)[index]);
  }
  if (seen.get(actual) === expected) return true;
  seen.set(actual, expected);
  if (actual instanceof Map) {
    if (expected.size !== actual.size) return false;
    return [...actual.entries()].every(([key, value]) => expected.has(key) && deepStrictEqual(value, expected.get(key), seen));
  }
  if (actual instanceof Set) {
    if (expected.size !== actual.size) return false;
    return [...actual.values()].every((value) => expected.has(value));
  }
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  if (actualKeys.length !== expectedKeys.length) return false;
  return actualKeys.every((key) => Object.prototype.hasOwnProperty.call(expected, key) && deepStrictEqual(actual[key], expected[key], seen));
}

function matchesExpectedError(error, expected) {
  if (!expected) return true;
  if (expected instanceof RegExp) return expected.test(error?.message || String(error));
  if (typeof expected === "function") {
    if (error instanceof expected) return true;
    try {
      return expected(error) === true;
    } catch {
      return false;
    }
  }
  if (typeof expected === "object") {
    return Object.entries(expected).every(([key, value]) => error?.[key] === value);
  }
  return String(error?.message || error).includes(String(expected));
}

function createQuerystringModule() {
  const escape = (value) => encodeURIComponent(String(value));
  const unescape = (value) => decodeURIComponent(String(value || "").replace(/\+/g, " "));
  const stringify = (object = {}, separator = "&", equals = "=", options = {}) => {
    const encode = options.encodeURIComponent || escape;
    return Object.entries(object).flatMap(([key, value]) => {
      const values = Array.isArray(value) ? value : [value];
      return values.map((entry) => `${encode(key)}${equals}${encode(entry ?? "")}`);
    }).join(separator);
  };
  const parse = (text = "", separator = "&", equals = "=", options = {}) => {
    const decode = options.decodeURIComponent || unescape;
    const maxKeys = options.maxKeys === 0 ? Infinity : Number(options.maxKeys ?? 1000);
    const result = {};
    String(text || "").split(separator).filter(Boolean).slice(0, maxKeys).forEach((pair) => {
      const index = pair.indexOf(equals);
      const rawKey = index >= 0 ? pair.slice(0, index) : pair;
      const rawValue = index >= 0 ? pair.slice(index + equals.length) : "";
      const key = decode(rawKey);
      const value = decode(rawValue);
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
      } else {
        result[key] = value;
      }
    });
    return result;
  };
  return {
    stringify,
    encode: stringify,
    parse,
    decode: parse,
    escape,
    unescape,
  };
}

function createPunycodeModule() {
  const maxInt = 2147483647;
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  const initialBias = 72;
  const initialN = 128;
  const delimiter = "-";

  const adapt = (delta, numPoints, firstTime) => {
    let nextDelta = firstTime ? Math.floor(delta / damp) : delta >> 1;
    nextDelta += Math.floor(nextDelta / numPoints);
    let k = 0;
    while (nextDelta > Math.floor(((base - tMin) * tMax) / 2)) {
      nextDelta = Math.floor(nextDelta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * nextDelta) / (nextDelta + skew));
  };

  const basicToDigit = (codePoint) => {
    if (codePoint >= 48 && codePoint < 58) return 26 + codePoint - 48;
    if (codePoint >= 65 && codePoint < 91) return codePoint - 65;
    if (codePoint >= 97 && codePoint < 123) return codePoint - 97;
    return base;
  };

  const digitToBasic = (digit) => String.fromCharCode(digit + 22 + 75 * (digit < 26));

  const ucs2 = {
    decode: (input = "") => Array.from(String(input), (character) => character.codePointAt(0)),
    encode: (codePoints = []) => String.fromCodePoint(...codePoints.map((codePoint) => Number(codePoint) || 0)),
  };

  const decode = (input = "") => {
    const value = String(input);
    const output = [];
    const basic = value.lastIndexOf(delimiter);
    let index = 0;
    if (basic > -1) {
      for (let counter = 0; counter < basic; counter += 1) {
        const codePoint = value.charCodeAt(counter);
        if (codePoint >= 0x80) throw new Error("punycode: invalid input");
        output.push(codePoint);
      }
      index = basic + 1;
    }
    let i = 0;
    let n = initialN;
    let bias = initialBias;
    while (index < value.length) {
      const oldI = i;
      let w = 1;
      for (let k = base; ; k += base) {
        if (index >= value.length) throw new Error("punycode: invalid input");
        const digit = basicToDigit(value.charCodeAt(index));
        index += 1;
        if (digit >= base || digit > Math.floor((maxInt - i) / w)) throw new Error("punycode: overflow");
        i += digit * w;
        const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (digit < t) break;
        if (w > Math.floor(maxInt / (base - t))) throw new Error("punycode: overflow");
        w *= base - t;
      }
      const out = output.length + 1;
      bias = adapt(i - oldI, out, oldI === 0);
      if (Math.floor(i / out) > maxInt - n) throw new Error("punycode: overflow");
      n += Math.floor(i / out);
      i %= out;
      output.splice(i, 0, n);
      i += 1;
    }
    return ucs2.encode(output);
  };

  const encode = (input = "") => {
    const codePoints = ucs2.decode(input);
    const output = [];
    for (const codePoint of codePoints) {
      if (codePoint < 0x80) output.push(String.fromCharCode(codePoint));
    }
    const basicLength = output.length;
    let handled = basicLength;
    if (basicLength) output.push(delimiter);
    let n = initialN;
    let delta = 0;
    let bias = initialBias;
    while (handled < codePoints.length) {
      let m = maxInt;
      for (const codePoint of codePoints) {
        if (codePoint >= n && codePoint < m) m = codePoint;
      }
      if (m - n > Math.floor((maxInt - delta) / (handled + 1))) throw new Error("punycode: overflow");
      delta += (m - n) * (handled + 1);
      n = m;
      for (const codePoint of codePoints) {
        if (codePoint < n) {
          delta += 1;
          if (delta > maxInt) throw new Error("punycode: overflow");
        }
        if (codePoint === n) {
          let q = delta;
          for (let k = base; ; k += base) {
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (q < t) break;
            output.push(digitToBasic(t + ((q - t) % (base - t))));
            q = Math.floor((q - t) / (base - t));
          }
          output.push(digitToBasic(q));
          bias = adapt(delta, handled + 1, handled === basicLength);
          delta = 0;
          handled += 1;
        }
      }
      delta += 1;
      n += 1;
    }
    return output.join("");
  };

  const mapDomain = (input, mapper) => String(input || "")
    .replace(/[\u3002\uff0e\uff61]/g, ".")
    .split(".")
    .map(mapper)
    .join(".");

  const toASCII = (input = "") => mapDomain(input, (label) => {
    if (!/[^\0-\x7E]/.test(label)) return label;
    return `xn--${encode(label)}`;
  });

  const toUnicode = (input = "") => mapDomain(input, (label) => (
    /^xn--/i.test(label) ? decode(label.slice(4).toLowerCase()) : label
  ));

  const module = {
    version: "2.1.0-dindbos",
    ucs2,
    decode,
    encode,
    toASCII,
    toUnicode,
  };
  return { default: module, ...module };
}

function createOsModule(processContext) {
  const endianness = () => {
    const bytes = new Uint8Array(new Uint16Array([0x00ff]).buffer);
    return bytes[0] === 0xff ? "LE" : "BE";
  };
  return {
    EOL: "\n",
    constants: {
      signals: {},
      errno: {},
      priority: {},
    },
    arch: () => "wasm32",
    availableParallelism: () => Math.max(1, Number(globalThis.navigator?.hardwareConcurrency || 1)),
    cpus: () => Array.from({ length: Math.max(1, Number(globalThis.navigator?.hardwareConcurrency || 1)) }, () => ({
      model: "DindbOS Browser CPU",
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    })),
    devNull: "/dev/null",
    endianness,
    freemem: () => 0,
    getPriority: () => 0,
    homedir: () => processContext.env.HOME || "/home/guest",
    hostname: () => "dindbos.local",
    loadavg: () => [0, 0, 0],
    machine: () => "wasm32",
    networkInterfaces: () => ({}),
    platform: () => "browser",
    release: () => "0.0.0-dindbos",
    setPriority: () => undefined,
    tmpdir: () => "/tmp",
    totalmem: () => 0,
    type: () => "DindbOS",
    uptime: () => Math.floor((globalThis.performance?.now?.() || 0) / 1000),
    userInfo: () => ({
      uid: -1,
      gid: -1,
      username: processContext.env.USER || "guest",
      homedir: processContext.env.HOME || "/home/guest",
      shell: "/bin/dindbsh",
    }),
    version: () => "DindbOS Browser Runtime",
  };
}

function createTtyModule() {
  class ReadStream {
    constructor(fd = 0) {
      this.fd = fd;
      this.isTTY = false;
      this.readable = true;
    }

    setRawMode() {
      return this;
    }
  }
  class WriteStream {
    constructor(fd = 1) {
      this.fd = fd;
      this.isTTY = false;
      this.writable = true;
      this.columns = 80;
      this.rows = 24;
    }

    clearLine() {
      return false;
    }

    clearScreenDown() {
      return false;
    }

    cursorTo() {
      return false;
    }

    getColorDepth() {
      return 1;
    }

    hasColors() {
      return false;
    }

    moveCursor() {
      return false;
    }
  }
  return {
    ReadStream,
    WriteStream,
    isatty: () => false,
  };
}

function createStringDecoderModule() {
  class StringDecoder {
    constructor(encoding = "utf8") {
      this.encoding = normalizeStringDecoderEncoding(encoding);
      this.decoder = this.encoding === "utf16le"
        ? new TextDecoder("utf-16le", { fatal: false })
        : this.encoding === "utf8" ? new TextDecoder("utf-8", { fatal: false }) : null;
    }

    write(buffer = new Uint8Array()) {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
      if (this.encoding === "hex") return bytesToHex(bytes);
      if (this.encoding === "base64") return bytesToBase64(bytes);
      if (this.encoding === "latin1" || this.encoding === "binary" || this.encoding === "ascii") return [...bytes].map((byte) => String.fromCharCode(byte)).join("");
      return this.decoder.decode(bytes, { stream: true });
    }

    end(buffer = new Uint8Array()) {
      const tail = buffer && Number(buffer.byteLength || buffer.length || 0) ? this.write(buffer) : "";
      const flush = this.decoder ? this.decoder.decode() : "";
      return `${tail}${flush}`;
    }
  }
  return { StringDecoder };
}

function normalizeStringDecoderEncoding(encoding) {
  const normalized = String(encoding || "utf8").toLowerCase().replace(/[-_]/g, "");
  if (normalized === "utf8" || normalized === "utf") return "utf8";
  if (normalized === "ucs2" || normalized === "utf16le") return "utf16le";
  if (["base64", "hex", "latin1", "binary", "ascii"].includes(normalized)) return normalized;
  return "utf8";
}

function createConstantsModule() {
  return {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
    E2BIG: 7,
    EACCES: 13,
    EADDRINUSE: 98,
    EADDRNOTAVAIL: 99,
    EAGAIN: 11,
    EBADF: 9,
    EBUSY: 16,
    EEXIST: 17,
    EINVAL: 22,
    EIO: 5,
    EISDIR: 21,
    EMFILE: 24,
    ENOENT: 2,
    ENOSPC: 28,
    ENOTDIR: 20,
    ENOTEMPTY: 39,
    EPERM: 1,
    EPIPE: 32,
    SIGINT: 2,
    SIGTERM: 15,
    SIGKILL: 9,
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR: 2,
    O_CREAT: 64,
    O_EXCL: 128,
    O_TRUNC: 512,
    O_APPEND: 1024,
    S_IFREG: 32768,
    S_IFDIR: 16384,
    S_IRUSR: 256,
    S_IWUSR: 128,
    S_IXUSR: 64,
  };
}

function createFsConstants() {
  return {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
    COPYFILE_EXCL: 1,
    COPYFILE_FICLONE: 2,
    COPYFILE_FICLONE_FORCE: 4,
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR: 2,
    O_CREAT: 64,
    O_EXCL: 128,
    O_TRUNC: 512,
    O_APPEND: 1024,
  };
}

function createDiagnosticsChannelModule() {
  const channels = new Map();
  const getChannel = (name) => {
    const key = String(name || "");
    if (!channels.has(key)) channels.set(key, new DiagnosticsChannel(key));
    return channels.get(key);
  };
  class DiagnosticsChannel {
    constructor(name) {
      this.name = name;
      this.subscribers = new Set();
    }

    get hasSubscribers() {
      return this.subscribers.size > 0;
    }

    publish(message) {
      this.subscribers.forEach((subscriber) => subscriber(message, this.name));
    }

    subscribe(callback) {
      if (typeof callback !== "function") throw new Error("diagnostics_channel: subscriber must be a function");
      this.subscribers.add(callback);
    }

    unsubscribe(callback) {
      this.subscribers.delete(callback);
      return true;
    }
  }
  return {
    channel: getChannel,
    hasSubscribers: (name) => getChannel(name).hasSubscribers,
    subscribe: (name, callback) => getChannel(name).subscribe(callback),
    unsubscribe: (name, callback) => getChannel(name).unsubscribe(callback),
    tracingChannel: (name) => ({
      start: getChannel(`${name}:start`),
      end: getChannel(`${name}:end`),
      asyncStart: getChannel(`${name}:asyncStart`),
      asyncEnd: getChannel(`${name}:asyncEnd`),
      error: getChannel(`${name}:error`),
    }),
  };
}

function createConsoleModule(output) {
  class Console {
    constructor(stdout = null, stderr = stdout, ignoreErrors = true) {
      this.stdout = stdout;
      this.stderr = stderr || stdout;
      this.ignoreErrors = ignoreErrors;
    }

    log(...values) {
      writeConsoleLine(output, this.stdout, values);
    }

    info(...values) {
      this.log(...values);
    }

    warn(...values) {
      writeConsoleLine(output, this.stderr, values);
    }

    error(...values) {
      this.warn(...values);
    }

    debug(...values) {
      this.log(...values);
    }

    dir(value) {
      this.log(value);
    }

    trace(...values) {
      this.error("Trace:", ...values);
    }

    assert(condition, ...values) {
      if (!condition) this.error("Assertion failed:", ...values);
    }
  }
  const console = new Console();
  return {
    Console,
    console,
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
    dir: console.dir.bind(console),
    trace: console.trace.bind(console),
    assert: console.assert.bind(console),
  };
}

function writeConsoleLine(output, stream, values) {
  const line = values.map(formatConsoleValue).join(" ");
  if (stream && typeof stream.write === "function") {
    stream.write(`${line}\n`);
    return;
  }
  output.push(line);
}

function createDnsModule() {
  const unsupported = () => {
    throw new Error("NodeCompat dns networking is unavailable; use an explicit DindbOS network capability outside NodeCompat.");
  };
  const promises = {
    lookup: async () => unsupported(),
    resolve: async () => unsupported(),
    resolve4: async () => unsupported(),
    resolve6: async () => unsupported(),
    resolveCname: async () => unsupported(),
    resolveMx: async () => unsupported(),
    resolveTxt: async () => unsupported(),
    reverse: async () => unsupported(),
  };
  class Resolver {
    cancel() {}
    getServers() {
      return [];
    }
    setServers() {}
    resolve() {
      unsupported();
    }
    resolve4() {
      unsupported();
    }
    resolve6() {
      unsupported();
    }
    reverse() {
      unsupported();
    }
  }
  return {
    ADDRCONFIG: 32,
    ALL: 16,
    V4MAPPED: 8,
    NODATA: "ENODATA",
    FORMERR: "EFORMERR",
    SERVFAIL: "ESERVFAIL",
    NOTFOUND: "ENOTFOUND",
    Resolver,
    promises,
    getServers: () => [],
    setServers: () => undefined,
    lookup: unsupported,
    lookupService: unsupported,
    resolve: unsupported,
    resolve4: unsupported,
    resolve6: unsupported,
    resolveCname: unsupported,
    resolveMx: unsupported,
    resolveTxt: unsupported,
    reverse: unsupported,
  };
}

function createStreamModule(eventsModule) {
  const { EventEmitter } = eventsModule;
  class Readable extends EventEmitter {
    constructor(options = {}) {
      super();
      this.readable = true;
      this.destroyed = false;
      this._chunks = [];
      this._ended = false;
      this._endEmitted = false;
      this._read = typeof options.read === "function" ? options.read : null;
    }

    static from(iterable = []) {
      const stream = new Readable();
      for (const chunk of iterable) stream._chunks.push(chunk);
      stream._ended = true;
      return stream;
    }

    push(chunk) {
      if (chunk === null) {
        this._ended = true;
        this.resume();
        return false;
      }
      this._chunks.push(chunk);
      this.resume();
      return true;
    }

    read() {
      if (!this._chunks.length && this._read) this._read();
      return this._chunks.length ? this._chunks.shift() : null;
    }

    on(eventName, listener) {
      super.on(eventName, listener);
      if (eventName === "end" && this._endEmitted) listener.call(this);
      if (eventName === "data" || eventName === "end") this.resume();
      return this;
    }

    resume() {
      while (this._chunks.length && this.listenerCount("data")) {
        this.emit("data", this._chunks.shift());
      }
      if (this._ended && !this._chunks.length && !this._endEmitted) {
        this._endEmitted = true;
        this.emit("end");
      }
      return this;
    }

    pipe(destination) {
      this.on("end", () => destination.end?.());
      this.on("data", (chunk) => destination.write?.(chunk));
      this.resume();
      return destination;
    }

    destroy(error = null) {
      this.destroyed = true;
      if (error) this.emit("error", error);
      this.emit("close");
      return this;
    }
  }

  class Writable extends EventEmitter {
    constructor(options = {}) {
      super();
      this.writable = true;
      this.destroyed = false;
      this.chunks = [];
      this._write = typeof options.write === "function" ? options.write : null;
      this._final = typeof options.final === "function" ? options.final : null;
    }

    write(chunk, encoding = "utf8", callback = null) {
      const done = typeof encoding === "function" ? encoding : callback;
      if (this._write) this._write(chunk, typeof encoding === "string" ? encoding : "utf8", done || (() => {}));
      else {
        this.chunks.push(chunk);
        done?.();
      }
      this.emit("drain");
      return true;
    }

    end(chunk = undefined, encoding = "utf8", callback = null) {
      const done = typeof encoding === "function" ? encoding : callback;
      if (chunk !== undefined) this.write(chunk, typeof encoding === "string" ? encoding : "utf8");
      if (this._final) this._final(done || (() => {}));
      else done?.();
      this.emit("finish");
      return this;
    }

    destroy(error = null) {
      this.destroyed = true;
      if (error) this.emit("error", error);
      this.emit("close");
      return this;
    }
  }

  class PassThrough extends Readable {
    constructor(options = {}) {
      super(options);
      this.writable = true;
    }

    write(chunk, encoding = "utf8", callback = null) {
      this.push(chunk);
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return true;
    }

    end(chunk = undefined, encoding = "utf8", callback = null) {
      if (chunk !== undefined) this.write(chunk, typeof encoding === "string" ? encoding : "utf8");
      this.push(null);
      this.emit("finish");
      const done = typeof encoding === "function" ? encoding : callback;
      done?.();
      return this;
    }
  }

  const pipeline = (...args) => {
    const callback = typeof args.at(-1) === "function" ? args.pop() : null;
    const streams = args.flat();
    if (streams.length < 2) throw new Error("stream.pipeline: expected at least two streams");
    const last = streams.at(-1);
    if (callback) {
      let settled = false;
      const done = (error = null) => {
        if (settled) return;
        settled = true;
        callback(error);
      };
      streams.forEach((stream) => stream.on?.("error", done));
      last.on?.("finish", () => done());
      last.on?.("end", () => done());
    }
    for (let index = 0; index < streams.length - 1; index += 1) {
      streams[index].pipe(streams[index + 1]);
    }
    return last;
  };

  const finished = (stream, callback) => {
    if (typeof callback !== "function") throw new Error("stream.finished: callback must be a function");
    let settled = false;
    const done = (error = null) => {
      if (settled) return;
      settled = true;
      callback(error);
    };
    stream.on?.("error", done);
    stream.on?.("finish", () => done());
    stream.on?.("end", () => done());
    return () => {};
  };

  return {
    Readable,
    Writable,
    Duplex: PassThrough,
    Transform: PassThrough,
    PassThrough,
    pipeline,
    finished,
  };
}

function createCryptoModule(buffer) {
  const webcrypto = globalThis.crypto || {};
  const randomBytes = (size) => {
    const length = Number(size || 0);
    if (!Number.isInteger(length) || length < 0) throw new Error("crypto.randomBytes: size must be a non-negative integer");
    const bytes = new Uint8Array(length);
    if (webcrypto.getRandomValues) webcrypto.getRandomValues(bytes);
    else {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    return buffer.from(bytes);
  };
  const getRandomValues = (typedArray) => {
    if (!typedArray || typeof typedArray.length !== "number") throw new Error("crypto.getRandomValues: expected a typed array");
    if (webcrypto.getRandomValues) return webcrypto.getRandomValues(typedArray);
    for (let index = 0; index < typedArray.length; index += 1) typedArray[index] = Math.floor(Math.random() * 256);
    return typedArray;
  };
  const randomUUID = () => {
    if (webcrypto.randomUUID) return webcrypto.randomUUID();
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  return {
    createHash: (algorithm) => createHashFacade(algorithm, buffer),
    getRandomValues,
    randomBytes,
    randomFillSync: (typedArray) => getRandomValues(typedArray),
    randomUUID,
    webcrypto,
  };
}

function createHashFacade(algorithm, buffer) {
  const normalized = String(algorithm || "").toLowerCase().replace(/-/g, "");
  if (normalized !== "sha256") throw new Error(`crypto.createHash: unsupported algorithm: ${algorithm}`);
  const chunks = [];
  return {
    update(value, encoding = "utf8") {
      chunks.push(bytesFromValue(value, encoding));
      return this;
    },
    digest(encoding = undefined) {
      const bytes = sha256(concatBytes(chunks));
      if (encoding === "hex") return bytesToHex(bytes);
      if (encoding === "base64") return bytesToBase64(bytes);
      if (encoding === "base64url") return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      if (encoding === undefined || encoding === null) return buffer.from(bytes);
      throw new Error(`crypto.Hash.digest: unsupported encoding: ${encoding}`);
    },
  };
}

function bytesFromValue(value, encoding = "utf8") {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  const text = String(value ?? "");
  if (encoding === "hex") {
    if (text.length % 2) throw new Error("crypto: invalid hex input");
    const bytes = new Uint8Array(text.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
    return bytes;
  }
  return new TextEncoder().encode(text);
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  if (typeof btoa === "function") return btoa(String.fromCharCode(...bytes));
  if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString("base64");
  throw new Error("base64 encoding is not available");
}

function sha256(bytes) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = bytes.byteLength * 8;
  const paddedLength = (((bytes.byteLength + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => {
      hash[index] = (hash[index] + value) >>> 0;
    });
  }
  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  hash.forEach((value, index) => digestView.setUint32(index * 4, value, false));
  return digest;
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function stringifyFileData(data) {
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return String(data ?? "");
}

function optionalCallback(options, callback) {
  return typeof options === "function" ? options : callback;
}

function optionalOptions(options) {
  return typeof options === "function" || options === undefined ? undefined : options;
}

function invokeFsCallback(callback, operation) {
  if (typeof callback !== "function") throw new Error("fs: callback must be a function");
  let result;
  try {
    result = operation();
  } catch (error) {
    callback(error);
    return;
  }
  callback(null, result);
}

function normalizeStreamOptions(options = {}) {
  if (typeof options === "string") return { encoding: options };
  return options || {};
}

function measureChunkLength(chunk, buffer, encoding = "utf8") {
  if (chunk instanceof Uint8Array) return chunk.length;
  return buffer.byteLength(String(chunk ?? ""), encoding);
}

function mergeStreamChunks(chunks, buffer, encoding = "utf8") {
  if (!chunks.length) return "";
  if (chunks.every((chunk) => typeof chunk === "string")) return chunks.join("");
  return buffer.concat(chunks.map((chunk) => (chunk instanceof Uint8Array ? chunk : buffer.from(String(chunk ?? ""), encoding))));
}

function createStats(stat) {
  if (!stat) throw new Error("fs.statSync: no such file or directory");
  return {
    ...stat,
    isFile: () => stat.resolvedType === "file",
    isDirectory: () => stat.resolvedType === "directory",
    isSymbolicLink: () => stat.type === "link" || stat.type === "symlink",
  };
}

function createDirent(entry) {
  const type = entry.resolvedType || entry.type;
  return {
    name: entry.name,
    isFile: () => type === "file",
    isDirectory: () => type === "directory",
    isSymbolicLink: () => entry.type === "link" || entry.type === "symlink",
  };
}

function createDirHandle(path, entries) {
  let index = 0;
  let closed = false;
  const assertOpen = () => {
    if (closed) throw new Error("fs.Dir: directory handle is closed");
  };
  const dir = {
    path,
    readSync: () => {
      assertOpen();
      return index < entries.length ? entries[index++] : null;
    },
    read: (callback = null) => {
      if (callback) return invokeFsCallback(callback, () => dir.readSync());
      return Promise.resolve(dir.readSync());
    },
    closeSync: () => {
      closed = true;
    },
    close: (callback = null) => {
      if (callback) return invokeFsCallback(callback, () => dir.closeSync());
      dir.closeSync();
      return Promise.resolve();
    },
  };
  dir[Symbol.asyncIterator] = async function* iterateDir() {
    let entry;
    while ((entry = await dir.read())) yield entry;
  };
  return dir;
}

function createTempDirectory(os, prefix, principal) {
  const normalizedPrefix = os.fs.normalize(prefix || "/tmp/dindbos-", "/");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = Math.floor(Math.random() * 0x1000000).toString(36).padStart(6, "0").slice(-6);
    const candidate = `${normalizedPrefix}${suffix}`;
    if (!os.fs.exists(candidate, "/")) {
      os.fs.createDirectory(candidate, "/", {}, principal);
      return candidate;
    }
  }
  throw new Error(`fs.mkdtemp: could not create a unique directory for prefix '${prefix}'`);
}

function ensureDirectory(os, path, cwd, principal) {
  const normalized = os.fs.normalize(path, cwd);
  let cursor = "/";
  normalized.split("/").filter(Boolean).forEach((part) => {
    cursor = os.fs.join(cursor, part);
    if (!os.fs.exists(cursor)) os.fs.createDirectory(cursor, "/", {}, principal);
  });
}

function relativePath(from, to) {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => ".."), ...toParts].join("/") || ".";
}

function createWin32PathModule() {
  const normalizeSlashes = (value) => String(value || "").replace(/[\\/]+/g, "\\");
  const splitRoot = (value) => {
    const normalized = normalizeSlashes(value);
    const drive = normalized.match(/^[a-zA-Z]:\\/);
    if (drive) return { root: drive[0], rest: normalized.slice(drive[0].length) };
    if (normalized.startsWith("\\\\")) {
      const parts = normalized.slice(2).split("\\");
      if (parts.length >= 2) {
        const root = `\\\\${parts[0]}\\${parts[1]}\\`;
        return { root, rest: parts.slice(2).join("\\") };
      }
    }
    if (normalized.startsWith("\\")) return { root: "\\", rest: normalized.slice(1) };
    return { root: "", rest: normalized };
  };
  const normalize = (path = ".") => {
    const { root, rest } = splitRoot(path || ".");
    const stack = [];
    rest.split("\\").forEach((part) => {
      if (!part || part === ".") return;
      if (part === ".." && stack.length && stack[stack.length - 1] !== "..") stack.pop();
      else if (part !== ".." || !root) stack.push(part);
    });
    const joined = stack.join("\\");
    if (root) return `${root}${joined}` || root;
    return joined || ".";
  };
  const isAbsolute = (path = "") => /^[a-zA-Z]:[\\/]/.test(String(path)) || String(path).startsWith("\\\\") || String(path).startsWith("\\");
  const dirname = (path = "") => {
    const normalized = normalize(path);
    const { root, rest } = splitRoot(normalized);
    const parts = rest.split("\\").filter(Boolean);
    parts.pop();
    return normalize(`${root}${parts.join("\\")}`) || root || ".";
  };
  const basename = (path = "", ext = "") => {
    const parts = normalize(path).split("\\").filter(Boolean);
    const base = parts.pop() || "";
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
  };
  const extname = (path = "") => {
    const base = basename(path);
    const index = base.lastIndexOf(".");
    return index > 0 ? base.slice(index) : "";
  };
  const join = (...parts) => normalize(parts.filter(Boolean).join("\\"));
  const resolve = (...parts) => {
    let cursor = "";
    parts.forEach((part) => {
      if (!part) return;
      cursor = isAbsolute(part) ? String(part) : join(cursor, part);
    });
    return normalize(cursor || ".");
  };
  const relative = (from, to) => {
    const fromParts = normalize(from).toLowerCase().split("\\").filter(Boolean);
    const toNormalized = normalize(to);
    const toParts = toNormalized.toLowerCase().split("\\").filter(Boolean);
    while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
      fromParts.shift();
      toParts.shift();
    }
    const originalToParts = toNormalized.split("\\").filter(Boolean).slice(-toParts.length);
    return [...fromParts.map(() => ".."), ...originalToParts].join("\\") || ".";
  };
  return {
    sep: "\\",
    delimiter: ";",
    normalize,
    isAbsolute,
    join,
    resolve,
    dirname,
    basename,
    extname,
    relative,
    toNamespacedPath: (path) => String(path || ""),
  };
}

function formatConsoleValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "undefined") return "undefined";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
