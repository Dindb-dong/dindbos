const JS_EXTENSIONS = ["", ".js", ".mjs", ".json", ".cjs"];
const BUILTIN_MODULES = new Set([
  "fs",
  "node:fs",
  "path",
  "node:path",
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
  "timers",
  "node:timers",
  "stream",
  "node:stream",
  "crypto",
  "node:crypto",
  "assert",
  "node:assert",
  "querystring",
  "node:querystring",
  "http",
  "node:http",
  "https",
  "node:https",
]);
const AsyncFunction = Object.getPrototypeOf(async function createAsyncFunction() {}).constructor;

export class NodeCompat {
  constructor(os) {
    this.os = os;
    this.system = os.permissions.systemPrincipal();
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
    return this.resolveAsFileOrDirectory(normalized);
  }

  resolveModule(specifier, fromFilename, cwd, options = {}) {
    const request = String(specifier || "");
    if (BUILTIN_MODULES.has(request)) return { type: "builtin", id: request.replace(/^node:/, "") };
    if (request.startsWith("/") || request.startsWith("./") || request.startsWith("../")) {
      const base = request.startsWith("/") ? "/" : this.os.fs.dirname(fromFilename || this.os.fs.join(cwd, "[eval].js"));
      return { type: "file", path: this.resolveAsFileOrDirectory(this.os.fs.normalize(request, base), options) };
    }
    return { type: "file", path: this.resolvePackage(request, fromFilename, cwd, options) };
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
    this.builtins = {
      fs: this.createFsModule(),
      path: this.createPathModule(),
      process: this.process,
      buffer: { Buffer: this.buffer },
      events,
      url: createUrlModule(),
      util: createUtilModule(),
      timers: createTimersModule(),
      stream: createStreamModule(events),
      crypto: createCryptoModule(this.buffer),
      assert: createAssertModule(),
      querystring: createQuerystringModule(),
      http: createNetworkModule("http"),
      https: createNetworkModule("https"),
    };
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

  result() {
    return {
      output: this.output.join("\n"),
      status: this.process.exitCode || 0,
    };
  }

  createConsole() {
    const print = (...values) => this.output.push(values.map(formatConsoleValue).join(" "));
    return {
      log: print,
      info: print,
      warn: print,
      error: print,
      debug: print,
    };
  }

  createProcess() {
    const context = this.processContext;
    return {
      argv: context.argv,
      env: context.env,
      platform: "browser",
      version: "v0.0.0-dindbos",
      versions: { node: "0.0.0-dindbos", dindbos: "0.1.0" },
      get exitCode() {
        return context.exitCode;
      },
      set exitCode(value) {
        context.exitCode = Number(value) || 0;
      },
      cwd: () => context.cwd,
      chdir: (path) => {
        const next = this.os.fs.resolve(path, context.cwd);
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
    return pathModule;
  }

  createFsModule() {
    return {
      readFileSync: (path, encoding = null) => {
        if (encoding === "utf8" || encoding === "utf-8" || encoding?.encoding) {
          return this.os.fs.readFile(path, this.processContext.cwd, this.node.system);
        }
        return this.buffer.from(this.os.fs.readFileBytes(path, this.processContext.cwd, this.node.system));
      },
      writeFileSync: (path, data) => {
        if (data instanceof Uint8Array) {
          this.os.fs.writeOrCreateFileBytes(path, data, this.processContext.cwd, {}, this.node.system);
          return;
        }
        this.os.fs.writeOrCreateFile(path, stringifyFileData(data), this.processContext.cwd, {}, this.node.system);
      },
      existsSync: (path) => this.os.fs.exists(path, this.processContext.cwd),
      statSync: (path) => createStats(this.os.fs.stat(path, this.processContext.cwd)),
      lstatSync: (path) => createStats(this.os.fs.lstat(path, this.processContext.cwd)),
      readdirSync: (path = ".", options = {}) => {
        const entries = this.os.fs.list(path, this.processContext.cwd, this.node.system);
        if (options?.withFileTypes) return entries.map((entry) => createDirent(entry));
        return entries.map((entry) => entry.name);
      },
      mkdirSync: (path, options = {}) => {
        if (options?.recursive) return ensureDirectory(this.os, path, this.processContext.cwd, this.node.system);
        return this.os.fs.createDirectory(path, this.processContext.cwd, {}, this.node.system);
      },
      rmSync: (path, options = {}) => this.os.fs.remove(path, this.processContext.cwd, options, this.node.system),
      unlinkSync: (path) => this.os.fs.remove(path, this.processContext.cwd, {}, this.node.system),
    };
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

function safeJson(content, fallback) {
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

function createBufferFacade() {
  if (globalThis.Buffer) return globalThis.Buffer;
  return {
    from: (value) => createByteBuffer(value),
    isBuffer: (value) => value instanceof Uint8Array,
    byteLength: (value) => new TextEncoder().encode(String(value ?? "")).byteLength,
  };
}

function createByteBuffer(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value ?? ""));
  bytes.toString = (encoding = "utf8") => {
    if (encoding === "hex") return bytesToHex(bytes);
    if (encoding === "base64") return bytesToBase64(bytes);
    if (encoding !== "utf8" && encoding !== "utf-8") throw new Error(`Buffer: unsupported encoding: ${encoding}`);
    return new TextDecoder().decode(bytes);
  };
  return bytes;
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
    pathToFileURL,
  };
}

function createUtilModule() {
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
  return {
    format,
    inspect,
    promisify,
    callbackify,
    inherits,
    types: {
      isPromise: (value) => Boolean(value && typeof value.then === "function"),
      isUint8Array: (value) => value instanceof Uint8Array,
    },
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

function deepStrictEqual(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== typeof expected) return false;
  if (!actual || !expected || typeof actual !== "object") return false;
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  if (actualKeys.length !== expectedKeys.length) return false;
  return actualKeys.every((key) => Object.prototype.hasOwnProperty.call(expected, key) && deepStrictEqual(actual[key], expected[key]));
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
