const JS_EXTENSIONS = ["", ".js", ".mjs", ".json", ".cjs"];
const BUILTIN_MODULES = new Set(["fs", "node:fs", "path", "node:path", "process", "node:process", "buffer", "node:buffer"]);
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
        const target = subpath ? this.os.fs.join(packageRoot, subpath) : packageRoot;
        return this.resolveAsFileOrDirectory(target, options);
      }
      if (cursor === "/") break;
      cursor = this.os.fs.dirname(cursor);
    }
    throw new Error(`node: cannot find module '${specifier}'`);
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
    this.builtins = {
      fs: this.createFsModule(),
      path: this.createPathModule(),
      process: this.process,
      buffer: { Buffer: this.buffer },
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
  if (typeof exportsField === "string") return exportsField;
  if (exportsField && typeof exportsField === "object") {
    const keys = condition === "import"
      ? ["import", "module", "browser", "default", "require"]
      : ["require", "default", "import", "module", "browser"];
    for (const key of keys) {
      if (typeof exportsField[key] === "string") return exportsField[key];
    }
    if (typeof exportsField.default === "string") return exportsField.default;
    if (typeof exportsField["."] === "string") return exportsField["."];
    if (exportsField["."]) return stringEntry(exportsField["."], condition);
  }
  return "";
}

function packageEntry(manifest, condition = "require") {
  if (condition === "import") return manifest.module || manifest.main || "index.js";
  return manifest.main || manifest.module || "index.js";
}

function transformEsmSource(source) {
  const state = { importIndex: 0, exportedNames: [], defaultExportAssigned: false };
  let code = transformImportStatements(String(source), state);
  code = code.replace(/^\s*export\s+default\s+(async\s+function|function|class)\s*/gm, (_, declaration) => {
    state.defaultExportAssigned = true;
    return `const __default_export__ = ${declaration} `;
  });
  code = code.replace(/^\s*export\s+default\s+([^;\n]+);?/gm, (_, expression) => {
    state.defaultExportAssigned = true;
    return `const __default_export__ = ${expression};`;
  });
  code = code.replace(/^\s*export\s+(async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/gm, (_, declaration, name) => {
    state.exportedNames.push(name);
    return `${declaration} ${name}`;
  });
  code = code.replace(/^\s*export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);?/gm, (_, declaration, name, expression) => {
    state.exportedNames.push(name);
    return `${declaration} ${name} = ${expression};`;
  });
  code = code.replace(/^\s*export\s*\{([^}]+)\};?/gm, (_, specifiers) => `__export({ ${exportObjectProperties(specifiers)} });`);
  const footer = [];
  if (state.exportedNames.length) footer.push(`__export({ ${[...new Set(state.exportedNames)].join(", ")} });`);
  if (state.defaultExportAssigned) footer.push("__export({ default: __default_export__ });");
  return `${code}\n${footer.join("\n")}`;
}

function transformImportStatements(source, state) {
  let code = source.replace(/^\s*import\s+["']([^"']+)["'];?/gm, (_, specifier) => `await __import(${JSON.stringify(specifier)});`);
  code = code.replace(/^\s*import\s+(.+?)\s+from\s+["']([^"']+)["'];?/gm, (_, clause, specifier) => importClauseToCode(clause.trim(), specifier, state.importIndex++));
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

function commonJsNamespace(exports) {
  if (exports && typeof exports === "object") return { default: exports, ...exports };
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
    if (encoding !== "utf8" && encoding !== "utf-8") throw new Error(`Buffer: unsupported encoding: ${encoding}`);
    return new TextDecoder().decode(bytes);
  };
  return bytes;
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
