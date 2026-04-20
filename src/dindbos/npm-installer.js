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
    this.ensureProject(cwd);
    const installed = [];
    for (const specifier of targets) {
      const request = parsePackageSpecifier(specifier);
      const metadata = await this.fetchMetadata(fetcher, request.name);
      const version = resolveVersion(metadata, request.range);
      const versionMeta = metadata.versions?.[version];
      if (!versionMeta?.dist?.tarball) throw new Error(`npm: ${request.name}@${version}: missing tarball`);
      const tarball = await fetchBytes(fetcher, versionMeta.dist.tarball, MAX_TARBALL_BYTES, `${request.name} tarball`);
      await verifyIntegrity(tarball, versionMeta.dist.integrity || versionMeta.dist.shasum || "", `${request.name}@${version}`);
      const files = await extractPackageTarball(tarball);
      const packageRoot = this.packageInstallPath(cwd, request.name);
      this.installFiles(packageRoot, files);
      const record = {
        name: request.name,
        version,
        range: request.range,
        packageRoot,
        tarball: versionMeta.dist.tarball,
        integrity: versionMeta.dist.integrity || "",
        fileCount: files.length,
      };
      this.updateProjectManifests(cwd, record);
      installed.push(record);
    }
    return installed;
  }

  async fetchMetadata(fetcher, packageName) {
    const url = `${this.registry.replace(/\/$/, "")}/${encodePackageName(packageName)}`;
    return JSON.parse(await fetchText(fetcher, url, MAX_METADATA_BYTES, `metadata ${packageName}`));
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
    const root = this.os.fs.normalize(cwd);
    const parts = packageName.split("/");
    let cursor = this.os.fs.join(root, "node_modules");
    parts.forEach((part) => {
      cursor = this.os.fs.join(cursor, part);
      if (!this.os.fs.exists(cursor)) {
        this.os.fs.createDirectory(cursor, "/", { owner: "guest", group: "users", permissions: "drwxr-xr-x" }, this.system);
      }
    });
    return cursor;
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

  updateProjectManifests(cwd, record) {
    const root = this.os.fs.normalize(cwd);
    const packageJsonPath = this.os.fs.join(root, "package.json");
    const packageJson = safeJson(this.os.fs.readFile(packageJsonPath, "/", this.system), {});
    packageJson.dependencies = packageJson.dependencies || {};
    packageJson.dependencies[record.name] = record.range || record.version;
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
    const lockKey = `node_modules/${record.name}`;
    nextLock.packages[lockKey] = {
      version: record.version,
      resolved: record.tarball,
      integrity: record.integrity,
    };
    nextLock.dependencies = nextLock.dependencies || {};
    nextLock.dependencies[record.name] = {
      version: record.version,
      resolved: record.tarball,
      integrity: record.integrity,
    };
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
  const normalized = range.trim();
  if (normalized === "*" || normalized === "latest") return true;
  if (/^\d+\.\d+\.\d+/.test(normalized)) return version === normalized;
  if (normalized.startsWith("^")) return satisfiesCaret(version, normalized.slice(1));
  if (normalized.startsWith("~")) return satisfiesTilde(version, normalized.slice(1));
  if (normalized.startsWith(">=")) return compareSemver(version, normalized.slice(2)) >= 0;
  if (/^\d+$/.test(normalized)) return parseSemver(version)?.major === Number(normalized);
  return version === normalized;
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
  const parts = String(value || "").split(".");
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).join(".");
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version || ""));
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

function mimeFromName(path) {
  if (/\.json$/i.test(path)) return "application/json";
  if (/\.md$/i.test(path)) return "text/markdown";
  if (/\.txt$/i.test(path)) return "text/plain";
  if (/\.html?$/i.test(path)) return "text/html";
  if (/\.css$/i.test(path)) return "text/css";
  if (/\.m?js$/i.test(path)) return "text/javascript";
  return "text/plain";
}
