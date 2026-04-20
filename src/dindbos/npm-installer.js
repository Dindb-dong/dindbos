const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_TARBALL_BYTES = 16 * 1024 * 1024;

export class NpmInstaller {
  constructor(os, options = {}) {
    this.os = os;
    this.registry = options.registry || DEFAULT_REGISTRY;
    this.system = os.permissions.systemPrincipal();
  }

  async install(specifiers, cwd = this.os.session.home || "/", options = {}) {
    const targets = Array.isArray(specifiers) ? specifiers : [specifiers];
    if (!targets.length || targets.some((target) => !target)) throw new Error("npm: usage: npm install <package...>");
    const fetcher = options.fetch || globalThis.fetch;
    if (typeof fetcher !== "function") throw new Error("npm: fetch is not available in this runtime");
    const root = this.os.fs.normalize(cwd);
    this.ensureProject(root);
    const context = {
      fetcher,
      root,
      maxDepth: options.maxDepth ?? 12,
      maxPackages: options.maxPackages ?? 128,
      metadata: new Map(),
      records: [],
      recordsByPath: new Map(),
      rootRecordsByName: new Map(),
      topLevelDependencies: new Map(),
      pendingDependencies: [],
      deferDependencies: true,
    };
    const requests = targets.map((specifier) => parsePackageSpecifier(specifier));
    for (const request of requests) {
      context.topLevelDependencies.set(request.name, request.range);
    }
    for (const request of requests) {
      await this.installRequest(context, { ...request, depth: 0, parent: null, topLevel: true });
    }
    context.deferDependencies = false;
    while (context.pendingDependencies.length) {
      const request = context.pendingDependencies.shift();
      await this.installRequest(context, request);
    }
    this.updateProjectManifests(root, context.records, context.topLevelDependencies);
    return context.records;
  }

  async fetchMetadata(fetcher, packageName) {
    const url = `${this.registry.replace(/\/$/, "")}/${encodePackageName(packageName)}`;
    return JSON.parse(await fetchText(fetcher, url, MAX_METADATA_BYTES, `metadata ${packageName}`));
  }

  async metadataFor(context, packageName) {
    if (!context.metadata.has(packageName)) {
      context.metadata.set(packageName, await this.fetchMetadata(context.fetcher, packageName));
    }
    return context.metadata.get(packageName);
  }

  async installRequest(context, request) {
    if (context.records.length >= context.maxPackages) throw new Error(`npm: package limit exceeded (${context.maxPackages})`);
    if (request.depth > context.maxDepth) throw new Error(`npm: dependency depth exceeded (${context.maxDepth})`);
    const reusable = this.findReusableRecord(context, request);
    if (reusable) return reusable;
    const metadata = await this.metadataFor(context, request.name);
    const version = resolveVersion(metadata, request.range);
    const versionMeta = metadata.versions?.[version];
    if (!versionMeta?.dist?.tarball) throw new Error(`npm: ${request.name}@${version}: missing tarball`);
    const installBase = this.installBaseFor(context, request, version);
    const packageRoot = this.packageInstallPath(installBase, request.name);
    const existingAtPath = context.recordsByPath.get(packageRoot);
    if (existingAtPath) {
      if (satisfies(existingAtPath.version, request.range)) return existingAtPath;
      throw new Error(`npm: dependency conflict at ${packageRoot}: ${existingAtPath.version} does not satisfy ${request.range}`);
    }
    const tarball = await fetchBytes(context.fetcher, versionMeta.dist.tarball, MAX_TARBALL_BYTES, `${request.name} tarball`);
    await verifyIntegrity(tarball, versionMeta.dist.integrity || versionMeta.dist.shasum || "", `${request.name}@${version}`);
    const files = await extractPackageTarball(tarball);
    this.installFiles(packageRoot, files);
    const dependencies = dependencyMap(versionMeta.dependencies || {});
    const record = {
      name: request.name,
      version,
      range: request.range,
      packageRoot,
      tarball: versionMeta.dist.tarball,
      integrity: versionMeta.dist.integrity || versionMeta.dist.shasum || "",
      fileCount: files.length,
      dependencies,
      depth: request.depth,
      dependencyOf: request.parent?.name || "",
      topLevel: Boolean(request.topLevel),
    };
    context.records.push(record);
    context.recordsByPath.set(packageRoot, record);
    if (packageRoot === this.packagePath(context.root, record.name)) {
      context.rootRecordsByName.set(record.name, record);
    }
    for (const [dependencyName, dependencyRange] of Object.entries(dependencies)) {
      const dependencyRequest = {
        name: dependencyName,
        range: dependencyRange,
        depth: request.depth + 1,
        parent: record,
        topLevel: false,
      };
      if (context.deferDependencies && request.topLevel) context.pendingDependencies.push(dependencyRequest);
      else await this.installRequest(context, dependencyRequest);
    }
    return record;
  }

  findReusableRecord(context, request) {
    const candidates = [];
    if (request.parent) {
      let cursor = request.parent.packageRoot;
      while (true) {
        candidates.push(this.packagePath(cursor, request.name));
        if (cursor === context.root) break;
        const parent = this.os.fs.dirname(this.os.fs.dirname(cursor));
        if (parent === cursor || !parent.startsWith(context.root)) break;
        cursor = parent;
      }
    }
    candidates.push(this.packagePath(context.root, request.name));
    for (const path of candidates) {
      const record = context.recordsByPath.get(path);
      if (record && satisfies(record.version, request.range)) return record;
    }
    return null;
  }

  installBaseFor(context, request, version) {
    if (!request.parent) return context.root;
    const rootRecord = context.rootRecordsByName.get(request.name);
    if (!rootRecord || satisfies(rootRecord.version, request.range)) return context.root;
    if (satisfies(version, request.range)) return request.parent.packageRoot;
    throw new Error(`npm: ${request.name}@${version} does not satisfy ${request.range}`);
  }

  ensureProject(cwd) {
    const root = this.os.fs.normalize(cwd);
    const nodeModules = this.os.fs.join(root, "node_modules");
    if (!this.os.fs.exists(nodeModules)) {
      this.os.fs.createDirectory(nodeModules, "/", { owner: "guest", group: "users", permissions: "drwxr-xr-x" }, this.system);
    }
    const packageJson = this.os.fs.join(root, "package.json");
    if (!this.os.fs.exists(packageJson)) {
      this.os.fs.writeOrCreateFile(
        packageJson,
        `${JSON.stringify({ name: this.os.fs.basename(root), version: "0.1.0", dependencies: {} }, null, 2)}\n`,
        "/",
        { mime: "application/json", owner: "guest", group: "users", permissions: "-rw-r--r--" },
        this.system,
      );
    }
  }

  packageInstallPath(cwd, packageName) {
    const parts = packageName.split("/");
    let cursor = this.os.fs.join(this.os.fs.normalize(cwd), "node_modules");
    if (!this.os.fs.exists(cursor)) {
      this.os.fs.createDirectory(cursor, "/", { owner: "guest", group: "users", permissions: "drwxr-xr-x" }, this.system);
    }
    parts.forEach((part) => {
      cursor = this.os.fs.join(cursor, part);
      if (!this.os.fs.exists(cursor)) {
        this.os.fs.createDirectory(cursor, "/", { owner: "guest", group: "users", permissions: "drwxr-xr-x" }, this.system);
      }
    });
    return cursor;
  }

  packagePath(cwd, packageName) {
    return packageName
      .split("/")
      .reduce((cursor, part) => this.os.fs.join(cursor, part), this.os.fs.join(this.os.fs.normalize(cwd), "node_modules"));
  }

  installFiles(packageRoot, files) {
    files.forEach((file) => {
      const path = this.resolvePackageFilePath(packageRoot, file.path);
      if (file.type === "directory") {
        this.ensureDirectory(path);
        return;
      }
      if (file.type !== "file") return;
      this.ensureDirectory(this.os.fs.dirname(path));
      this.os.fs.writeOrCreateFile(
        path,
        textFromBytes(file.content),
        "/",
        { mime: mimeFromName(path), owner: "guest", group: "users", permissions: file.executable ? "-rwxr-xr-x" : "-rw-r--r--" },
        this.system,
      );
    });
  }

  resolvePackageFilePath(packageRoot, relativePath) {
    const relative = String(relativePath || "").trim();
    if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) {
      throw new Error(`npm: invalid tarball path: ${relativePath || ""}`);
    }
    const path = this.os.fs.normalize(relative, packageRoot);
    if (path === packageRoot || path.startsWith(`${packageRoot}/`)) return path;
    throw new Error(`npm: tarball path escapes package root: ${relativePath}`);
  }

  ensureDirectory(path) {
    const normalized = this.os.fs.normalize(path);
    let cursor = "/";
    normalized.split("/").filter(Boolean).forEach((part) => {
      cursor = this.os.fs.join(cursor, part);
      if (!this.os.fs.exists(cursor)) {
        this.os.fs.createDirectory(cursor, "/", { owner: "guest", group: "users", permissions: "drwxr-xr-x" }, this.system);
      }
    });
  }

  updateProjectManifests(cwd, records, topLevelDependencies) {
    const root = this.os.fs.normalize(cwd);
    const packageJsonPath = this.os.fs.join(root, "package.json");
    const packageJson = safeJson(this.os.fs.readFile(packageJsonPath, "/", this.system), {});
    packageJson.dependencies = packageJson.dependencies || {};
    for (const [name, range] of topLevelDependencies.entries()) {
      packageJson.dependencies[name] = range;
    }
    this.os.fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "/", this.system);
    const lockPath = this.os.fs.join(root, "package-lock.json");
    const lock = this.os.fs.exists(lockPath)
      ? safeJson(this.os.fs.readFile(lockPath, "/", this.system), null)
      : null;
    const nextLock = lock || {
      name: packageJson.name || this.os.fs.basename(root),
      version: packageJson.version || "0.1.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: packageJson.name || this.os.fs.basename(root),
          version: packageJson.version || "0.1.0",
          dependencies: {},
        },
      },
    };
    nextLock.packages = nextLock.packages || {};
    nextLock.packages[""] = nextLock.packages[""] || { dependencies: {} };
    nextLock.packages[""].dependencies = packageJson.dependencies;
    nextLock.dependencies = nextLock.dependencies || {};
    for (const record of records) {
      const lockKey = relativePackagePath(root, record.packageRoot);
      nextLock.packages[lockKey] = {
        version: record.version,
        resolved: record.tarball,
        integrity: record.integrity,
        ...(Object.keys(record.dependencies || {}).length ? { dependencies: record.dependencies } : {}),
      };
      if (record.topLevel || !nextLock.dependencies[record.name]) {
        nextLock.dependencies[record.name] = {
          version: record.version,
          resolved: record.tarball,
          integrity: record.integrity,
          ...(Object.keys(record.dependencies || {}).length ? { requires: record.dependencies } : {}),
        };
      }
    }
    this.os.fs.writeOrCreateFile(
      lockPath,
      `${JSON.stringify(nextLock, null, 2)}\n`,
      "/",
      { mime: "application/json", owner: "guest", group: "users", permissions: "-rw-r--r--" },
      this.system,
    );
  }
}

export function parsePackageSpecifier(specifier) {
  const value = String(specifier || "").trim();
  if (!value) throw new Error("npm: missing package specifier");
  if (/^https?:/.test(value) || value.endsWith(".tgz")) throw new Error("npm: tarball URL installs are not supported yet");
  const atIndex = value.startsWith("@") ? value.lastIndexOf("@") : value.indexOf("@");
  const name = atIndex > 0 ? value.slice(0, atIndex) : value;
  const range = atIndex > 0 ? value.slice(atIndex + 1) : "latest";
  if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error(`npm: invalid package name: ${specifier}`);
  return { name, range: range || "latest" };
}

function dependencyMap(dependencies) {
  return Object.fromEntries(Object.entries(dependencies)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, range]) => {
      if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name)) throw new Error(`npm: unsupported dependency name: ${name}`);
      return [name, normalizeDependencyRange(range, name)];
    }));
}

function normalizeDependencyRange(range, name) {
  const value = String(range || "latest").trim();
  if (/^(file|git|github|http|https|workspace):/i.test(value) || value.startsWith("npm:")) {
    throw new Error(`npm: unsupported dependency specifier for ${name}: ${value}`);
  }
  return value || "latest";
}

function resolveVersion(metadata, range) {
  const versions = Object.keys(metadata.versions || {}).filter((version) => parseSemver(version));
  if (!versions.length) throw new Error(`npm: ${metadata.name}: no installable versions`);
  if (!range || range === "latest") {
    return metadata["dist-tags"]?.latest || versions.sort(compareSemver).at(-1);
  }
  if (metadata.versions?.[range]) return range;
  const candidates = versions.filter((version) => satisfies(version, range)).sort(compareSemver);
  if (!candidates.length) throw new Error(`npm: ${metadata.name}: no version satisfies ${range}`);
  return candidates.at(-1);
}

function satisfies(version, range) {
  const normalized = String(range || "latest").trim();
  if (normalized === "*" || /^x$/i.test(normalized) || normalized === "latest") return true;
  return normalized
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => satisfiesRangeSet(version, part));
}

function satisfiesRangeSet(version, rangeSet) {
  const comparators = rangeSet.match(/(?:[<>]=?|=)?\s*v?\d+(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?(?:[-+][0-9A-Za-z.-]+)?|\^[^\s]+|~[^\s]+|[x*]/gi) || [];
  if (!comparators.length) return version === rangeSet;
  return comparators.every((comparator) => satisfiesComparator(version, comparator));
}

function satisfiesComparator(version, comparator) {
  const normalized = comparator.trim();
  if (!normalized || normalized === "*" || /^x$/i.test(normalized)) return true;
  if (normalized.startsWith("^")) return satisfiesCaret(version, normalized.slice(1));
  if (normalized.startsWith("~")) return satisfiesTilde(version, normalized.slice(1));
  const match = /^(<=|>=|<|>|=)?\s*(.+)$/.exec(normalized);
  const operator = match?.[1] || "";
  const target = match?.[2] || normalized;
  if (/[x*]/i.test(target)) return satisfiesWildcard(version, target);
  const parsedTarget = parseSemver(normalizeRangeBase(target));
  if (!parsedTarget) return version === target;
  const comparison = compareSemver(version, parsedTarget.raw);
  if (operator === ">=") return comparison >= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === "<") return comparison < 0;
  return comparison === 0;
}

function satisfiesWildcard(version, range) {
  const candidate = parseSemver(version);
  if (!candidate) return false;
  const parts = String(range || "").replace(/^v/i, "").split(".");
  if (!parts[0] || /[x*]/i.test(parts[0])) return true;
  if (candidate.major !== Number(parts[0])) return false;
  if (!parts[1] || /[x*]/i.test(parts[1])) return true;
  if (candidate.minor !== Number(parts[1])) return false;
  if (!parts[2] || /[x*]/i.test(parts[2])) return true;
  return candidate.patch === Number(parts[2]);
}

function satisfiesCaret(version, base) {
  const candidate = parseSemver(version);
  const minimum = parseSemver(normalizeRangeBase(base));
  if (!candidate || !minimum || compareSemver(version, minimum.raw) < 0) return false;
  if (minimum.major > 0) return candidate.major === minimum.major;
  if (minimum.minor > 0) return candidate.major === 0 && candidate.minor === minimum.minor;
  return candidate.major === 0 && candidate.minor === 0 && candidate.patch === minimum.patch;
}

function satisfiesTilde(version, base) {
  const candidate = parseSemver(version);
  const minimum = parseSemver(normalizeRangeBase(base));
  if (!candidate || !minimum || compareSemver(version, minimum.raw) < 0) return false;
  return candidate.major === minimum.major && candidate.minor === minimum.minor;
}

function normalizeRangeBase(value) {
  const parts = String(value || "").trim().replace(/^v/i, "").split(".");
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).map((part) => part.replace(/[x*]/i, "0")).join(".");
}

function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version || "").trim());
  if (!match) return null;
  return {
    raw: match[0],
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(a, b) {
  const left = typeof a === "string" ? parseSemver(a) : a;
  const right = typeof b === "string" ? parseSemver(b) : b;
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

async function extractPackageTarball(tarball) {
  const tar = await gunzip(tarball);
  const entries = parseTar(tar);
  return entries
    .map((entry) => ({ ...entry, path: stripPackagePrefix(entry.path) }))
    .filter((entry) => entry.path);
}

async function gunzip(bytes) {
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const zlib = await import("node:zlib");
  return new Uint8Array(zlib.gunzipSync(Buffer.from(bytes)));
}

function parseTar(bytes) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.slice(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = readString(header, 156, 1) || "0";
    const prefix = readString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (typeFlag === "0" || typeFlag === "") {
      entries.push({
        type: "file",
        path,
        content: bytes.slice(contentStart, contentEnd),
        executable: isExecutable(readOctal(header, 100, 8)),
      });
    } else if (typeFlag === "5") {
      entries.push({ type: "directory", path });
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function readString(bytes, offset, length) {
  const slice = bytes.slice(offset, offset + length);
  const end = slice.indexOf(0);
  return textFromBytes(end >= 0 ? slice.slice(0, end) : slice).trim();
}

function readOctal(bytes, offset, length) {
  const value = readString(bytes, offset, length).replace(/\0.*$/, "").trim();
  return value ? parseInt(value, 8) : 0;
}

function isExecutable(mode) {
  return Boolean(mode & 0o111);
}

function stripPackagePrefix(path) {
  return String(path || "").replace(/^package\/?/, "").replace(/^\/+/, "");
}

async function fetchText(fetcher, url, maxBytes, label) {
  const bytes = await fetchBytes(fetcher, url, maxBytes, label, { Accept: "application/vnd.npm.install-v1+json, application/json" });
  return textFromBytes(bytes);
}

async function fetchBytes(fetcher, url, maxBytes, label, headers = {}) {
  const response = await fetcher(url, { headers });
  if (!response?.ok) throw new Error(`npm: failed to fetch ${label}: ${response?.status || "network error"}`);
  const length = Number(response.headers?.get?.("content-length") || 0);
  if (length > maxBytes) throw new Error(`npm: ${label} is too large`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`npm: ${label} is too large`);
  return new Uint8Array(buffer);
}

async function verifyIntegrity(bytes, integrity, label) {
  if (!integrity) return;
  if (/^[a-f0-9]{40}$/i.test(integrity)) {
    const digest = await hashHex(bytes, "sha1");
    if (digest !== integrity.toLowerCase()) throw new Error(`npm: integrity mismatch for ${label}`);
    return;
  }
  const match = /^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/.exec(integrity);
  if (!match) return;
  const digest = await hashBase64(bytes, match[1]);
  if (digest !== match[2]) throw new Error(`npm: integrity mismatch for ${label}`);
}

async function hashBase64(bytes, algorithm) {
  const hash = await digest(bytes, algorithm);
  return base64FromBytes(hash);
}

async function hashHex(bytes, algorithm) {
  const hash = await digest(bytes, algorithm);
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(bytes, algorithm) {
  const webAlgorithm = algorithm.toUpperCase().replace("SHA", "SHA-");
  if (globalThis.crypto?.subtle) {
    return new Uint8Array(await globalThis.crypto.subtle.digest(webAlgorithm, bytes));
  }
  const crypto = await import("node:crypto");
  return new Uint8Array(crypto.createHash(algorithm).update(bytes).digest());
}

function base64FromBytes(bytes) {
  if (typeof btoa === "function") return btoa(String.fromCharCode(...bytes));
  return Buffer.from(bytes).toString("base64");
}

function textFromBytes(bytes) {
  return new TextDecoder().decode(bytes);
}

function encodePackageName(name) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    return `${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
  }
  return encodeURIComponent(name);
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function relativePackagePath(root, packageRoot) {
  const normalizedRoot = String(root || "/").replace(/\/$/, "");
  const normalizedPackageRoot = String(packageRoot || "").replace(/\/$/, "");
  if (normalizedPackageRoot === normalizedRoot) return "";
  if (normalizedPackageRoot.startsWith(`${normalizedRoot}/`)) return normalizedPackageRoot.slice(normalizedRoot.length + 1);
  return normalizedPackageRoot.replace(/^\//, "");
}

function mimeFromName(path) {
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.md$/i.test(path)) return "text/markdown";
  if (/\.txt$/i.test(path)) return "text/plain";
  if (/\.html?$/i.test(path)) return "text/html";
  if (/\.css$/i.test(path)) return "text/css";
  if (/\.m?js$/i.test(path)) return "text/javascript";
  return "text/plain";
}
