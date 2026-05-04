const DEFAULT_CACHE_NAME = "dindbos-runtime-cache-v1";

export class RuntimeCacheStore {
  constructor(options = {}) {
    this.name = options.name || DEFAULT_CACHE_NAME;
    this.cacheApi = options.cacheApi || globalThis.caches || null;
    this.memory = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      bytes: 0,
      backend: this.cacheApi ? "cache-api" : "memory",
    };
  }

  async fetchBytes(fetcher, url, options = {}) {
    const key = cacheKey(url, options);
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

  async matchBytes(key) {
    if (this.memory.has(key)) return copyBytes(this.memory.get(key));
    const cache = await this.openCache();
    if (!cache || typeof Request === "undefined") return null;
    const response = await cache.match(new Request(key));
    if (!response) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.memory.set(key, copyBytes(bytes));
    return bytes;
  }

  async readBytes(key) {
    const bytes = await this.matchBytes(key);
    if (bytes) this.stats.hits += 1;
    else this.stats.misses += 1;
    return bytes;
  }

  async rememberBytes(key, bytes) {
    await this.putBytes(key, bytes);
    return copyBytes(bytes);
  }

  async putBytes(key, bytes) {
    const copy = copyBytes(bytes);
    this.memory.set(key, copy);
    const cache = await this.openCache();
    if (cache && typeof Request !== "undefined" && typeof Response !== "undefined") {
      await cache.put(new Request(key), new Response(copyBytes(copy)));
    }
    this.stats.writes += 1;
    this.stats.bytes += copy.byteLength;
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
      entries: this.memory.size,
    };
  }
}

function cacheKey(url, options = {}) {
  const namespace = options.namespace || "runtime";
  const headers = Object.entries(options.headers || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key.toLowerCase()}=${value}`)
    .join("&");
  return `https://dindbos.cache/${encodeURIComponent(namespace)}?url=${encodeURIComponent(url)}&${headers}`;
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
