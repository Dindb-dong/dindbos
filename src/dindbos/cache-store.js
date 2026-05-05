const DEFAULT_CACHE_NAME = "dindbos-runtime-cache-v1";

export class RuntimeCacheStore {
  constructor(options = {}) {
    this.name = options.name || DEFAULT_CACHE_NAME;
    this.cacheApi = options.cacheApi || globalThis.caches || null;
    this.user = normalizeCacheUser(options.user || "guest");
    this.memory = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      bytes: 0,
      backend: this.cacheApi ? "cache-api" : "memory",
    };
  }

  setUser(user) {
    this.user = normalizeCacheUser(user || "guest");
  }

  async fetchBytes(fetcher, url, options = {}) {
    const key = cacheKey(url, { ...options, user: options.user || this.user });
    const cached = await this.readBytes(key);
    if (cached) {
      return cached;
    }
    const response = await fetcher(url, { headers: options.headers || {} });
    if (!response?.ok) throw new Error(`${options.errorPrefix || "cache"}: failed to fetch ${options.label || url}: ${response?.status || "network error"}`);
    const length = Number(response.headers?.get?.("content-length") || 0);
    if (options.maxBytes && length > options.maxBytes) throw new Error(`${options.errorPrefix || "cache"}: ${options.label || url} is too large`);
    const bytes = await responseBytes(response);
    if (options.maxBytes && bytes.byteLength > options.maxBytes) throw new Error(`${options.errorPrefix || "cache"}: ${options.label || url} is too large`);
    await this.putBytes(key, bytes);
    return bytes;
  }

  async fetchText(fetcher, url, options = {}) {
    return new TextDecoder().decode(await this.fetchBytes(fetcher, url, options));
  }

  async matchBytes(key, options = {}) {
    const scopedKey = this.scopedKey(key, options);
    if (this.memory.has(scopedKey)) return copyBytes(this.memory.get(scopedKey));
    const cache = await this.openCache();
    if (!cache || typeof Request === "undefined") return null;
    const response = await cache.match(new Request(scopedKey));
    if (!response) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.memory.set(scopedKey, copyBytes(bytes));
    return bytes;
  }

  async readBytes(key, options = {}) {
    const bytes = await this.matchBytes(key, options);
    if (bytes) this.stats.hits += 1;
    else this.stats.misses += 1;
    return bytes;
  }

  async rememberBytes(key, bytes, options = {}) {
    await this.putBytes(key, bytes, options);
    return copyBytes(bytes);
  }

  async putBytes(key, bytes, options = {}) {
    const scopedKey = this.scopedKey(key, options);
    const copy = copyBytes(bytes);
    this.memory.set(scopedKey, copy);
    const cache = await this.openCache();
    if (cache && typeof Request !== "undefined" && typeof Response !== "undefined") {
      await cache.put(new Request(scopedKey), new Response(copyBytes(copy)));
    }
    this.stats.writes += 1;
    this.stats.bytes += copy.byteLength;
  }

  scopedKey(key, options = {}) {
    if (options.shared) return String(key || "");
    const user = normalizeCacheUser(options.user || this.user);
    const value = String(key || "");
    return `https://dindbos.cache/user/${encodeURIComponent(user)}?key=${encodeURIComponent(value)}`;
  }

  async openCache() {
    if (!this.cacheApi?.open) return null;
    try {
      return await this.cacheApi.open(this.name);
    } catch {
      this.stats.backend = "memory";
      return null;
    }
  }

  status() {
    return {
      ...this.stats,
      user: this.user,
      entries: this.memory.size,
    };
  }
}

function cacheKey(url, options = {}) {
  const namespace = options.namespace || "runtime";
  const user = normalizeCacheUser(options.user || "guest");
  const headers = Object.entries(options.headers || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key.toLowerCase()}=${value}`)
    .join("&");
  return `https://dindbos.cache/${encodeURIComponent(namespace)}?user=${encodeURIComponent(user)}&url=${encodeURIComponent(url)}&${headers}`;
}

function copyBytes(bytes) {
  return new Uint8Array(bytes);
}

async function responseBytes(response) {
  if (typeof response.arrayBuffer === "function") {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (typeof response.text === "function") return new TextEncoder().encode(await response.text());
  throw new Error("cache: response body is not readable");
}

function normalizeCacheUser(user) {
  return String(user || "guest").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "guest";
}
