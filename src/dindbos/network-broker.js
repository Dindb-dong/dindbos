const NET_LOG_PATH = "/var/log/dindbos/network.log";

export class NetworkBroker {
  constructor(os, options = {}) {
    this.os = os;
    this.fetchAdapter = options.fetch || null;
    this.requests = new Map();
    this.history = [];
    this.deniedHosts = [];
    this.nextRequestId = 1;
    this.bytesReceived = 0;
    this.bytesSent = 0;
  }

  async fetch(url, options = {}, context = {}) {
    const target = normalizeUrl(url);
    this.assertAllowed(target, "net.fetch", context);
    const adapter = this.fetchAdapter || this.os.networkFetch || globalThis.fetch;
    if (typeof adapter !== "function") throw new Error("net: fetch unavailable in this browser");
    const id = this.nextId();
    const startedAt = new Date().toISOString();
    const request = {
      id,
      url: redactedUrl(target),
      host: target.hostname,
      method: String(options.method || "GET").toUpperCase(),
      requester: requesterId(context),
      status: "active",
      startedAt,
      finishedAt: "",
      durationMs: 0,
      bytesReceived: 0,
    };
    this.requests.set(id, request);
    this.writeProcfs();
    try {
      const response = await adapter(target.toString(), {
        ...options,
      });
      const text = await responseText(response);
      request.status = "completed";
      request.finishedAt = new Date().toISOString();
      request.durationMs = Date.parse(request.finishedAt) - Date.parse(startedAt);
      request.statusCode = Number(response?.status ?? 200);
      request.ok = response?.ok !== false && request.statusCode < 400;
      request.bytesReceived = byteLength(text);
      this.bytesReceived += request.bytesReceived;
      this.completeRequest(id, request);
      return {
        url: request.url,
        status: request.statusCode,
        ok: request.ok,
        headers: headersObject(response?.headers),
        text,
        bytes: request.bytesReceived,
      };
    } catch (error) {
      request.status = isAbortError(error) || options.signal?.aborted ? "cancelled" : "error";
      request.finishedAt = new Date().toISOString();
      request.durationMs = Date.parse(request.finishedAt) - Date.parse(startedAt);
      request.error = error.message || String(error);
      this.completeRequest(id, request);
      throw new Error(`net: ${target.hostname}: ${request.status === "cancelled" ? "request cancelled" : request.error}`);
    }
  }

  policyProbe(url, context = {}, capability = "net.fetch") {
    const target = normalizeUrl(url);
    try {
      this.assertAllowed(target, capability, context);
      return {
        url: redactedUrl(target),
        host: target.hostname,
        capability,
        allowed: true,
        reason: "allowed",
        browserOnly: true,
        companionRequired: false,
      };
    } catch (error) {
      return {
        url: redactedUrl(target),
        host: target.hostname,
        capability,
        allowed: false,
        reason: error.message,
        browserOnly: true,
        companionRequired: false,
      };
    }
  }

  dnsProbe(host, context = {}) {
    const target = normalizeUrl(host.includes("://") ? host : `https://${host}`);
    const probe = this.policyProbe(target.toString(), context, "net.dns");
    return {
      ...probe,
      addresses: probe.allowed ? ["browser-policy-only"] : [],
      rawDnsSupported: false,
    };
  }

  status() {
    return {
      activeRequests: [...this.requests.values()].map(cloneRecord),
      history: this.history.slice(-50).map(cloneRecord),
      deniedHosts: this.deniedHosts.slice(-50).map(cloneRecord),
      totals: {
        requests: this.history.length,
        denied: this.deniedHosts.length,
        active: this.requests.size,
        bytesReceived: this.bytesReceived,
        bytesSent: this.bytesSent,
      },
      websocket: {
        sessions: [],
        supported: false,
        reason: "not implemented in first-pass broker",
      },
      companion: {
        rawTcpUdp: "unsupported-browser-only",
      },
    };
  }

  assertAllowed(url, capability, context = {}) {
    if (isShellOrSystem(context)) return true;
    if (typeof context.assertCapability === "function") context.assertCapability(capability);
    const hosts = allowedHosts(context);
    if (hosts.includes("*") || hosts.some((host) => hostMatches(url.hostname, host))) return true;
    const record = {
      at: new Date().toISOString(),
      url: redactedUrl(url),
      host: url.hostname,
      capability,
      requester: requesterId(context),
      reason: hosts.length ? "host-not-allowed" : "no-network-hosts",
    };
    this.deniedHosts.push(record);
    this.deniedHosts = this.deniedHosts.slice(-200);
    this.appendLog({ ...record, status: "denied" });
    this.writeProcfs();
    throw new Error(`net: ${url.hostname}: host denied by network policy`);
  }

  completeRequest(id, record) {
    this.requests.delete(id);
    this.history.push(cloneRecord(record));
    this.history = this.history.slice(-200);
    this.appendLog(record);
    this.writeProcfs();
  }

  nextId() {
    const id = `net-${this.nextRequestId}`;
    this.nextRequestId += 1;
    return id;
  }

  writeProcfs() {
    const system = this.os.permissions?.systemPrincipal?.();
    if (!system || !this.os.fs) return;
    ensureDirectory(this.os, "/proc", system);
    ensureDirectory(this.os, "/proc/net", system);
    const payload = `${JSON.stringify(this.status(), null, 2)}\n`;
    this.os.fs.writeOrCreateFile("/proc/net/status.json", payload, "/", {
      mime: "application/json",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
    this.os.fs.writeOrCreateFile("/proc/net/requests", `${formatRequests(this.status())}\n`, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-r--r--",
    }, system);
  }

  appendLog(record) {
    const system = this.os.permissions?.systemPrincipal?.();
    if (!system || !this.os.fs) return;
    ensureDirectory(this.os, "/var/log/dindbos", system);
    const line = `${record.finishedAt || record.at || new Date().toISOString()} requester=${record.requester || "-"} host=${record.host || "-"} status=${record.status || "unknown"} bytes=${record.bytesReceived || 0} url=${record.url || "-"}${record.error ? ` error=${record.error}` : ""}${record.reason ? ` reason=${record.reason}` : ""}\n`;
    if (this.os.fs.exists(NET_LOG_PATH)) this.os.fs.appendFile(NET_LOG_PATH, line, "/", system);
    else this.os.fs.writeOrCreateFile(NET_LOG_PATH, line, "/", {
      mime: "text/plain",
      owner: "root",
      group: "root",
      permissions: "-rw-------",
    }, system);
  }
}

function allowedHosts(context = {}) {
  const manifest = context.process?.manifest || {};
  return [
    ...(manifest.networkHosts || []),
    ...(manifest.sandbox?.networkHosts || []),
    ...(manifest.namespace?.networkHosts || []),
  ].map((host) => String(host || "").trim().toLowerCase()).filter(Boolean);
}

function hostMatches(hostname, rule) {
  const host = String(hostname || "").toLowerCase();
  const pattern = String(rule || "").toLowerCase();
  if (!pattern) return false;
  if (pattern === host) return true;
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
  return false;
}

function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new Error(`net: invalid URL: ${value || ""}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`net: unsupported URL scheme: ${parsed.protocol}`);
  return parsed;
}

function redactedUrl(url) {
  const safe = new URL(url.toString());
  [...safe.searchParams.keys()].forEach((key) => {
    if (/token|secret|password|auth|key/i.test(key)) safe.searchParams.set(key, "[redacted]");
  });
  safe.username = safe.username ? "[redacted]" : "";
  safe.password = "";
  return safe.toString();
}

async function responseText(response) {
  if (typeof response?.text === "function") return response.text();
  if (response?.body !== undefined) return String(response.body);
  return "";
}

function headersObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === "function") return Object.fromEntries(headers.entries());
  return { ...headers };
}

function isAbortError(error) {
  return error?.name === "AbortError" || /abort|cancel/i.test(error?.message || "");
}

function isShellOrSystem(context = {}) {
  return Boolean(context.principal?.system || context.system || requesterId(context) === "shell");
}

function requesterId(context = {}) {
  return String(context.process?.appId || context.appId || "shell");
}

function cloneRecord(record) {
  return { ...record };
}

function byteLength(value) {
  if (globalThis.TextEncoder) return new TextEncoder().encode(String(value)).length;
  return String(value).length;
}

function ensureDirectory(os, path, principal) {
  if (os.fs.exists(path)) return;
  const parent = os.fs.dirname(path);
  if (parent && parent !== path && !os.fs.exists(parent)) ensureDirectory(os, parent, principal);
  os.fs.createDirectory(path, "/", { owner: "root", group: "root" }, principal);
}

function formatRequests(status) {
  return [
    "ID STATUS HOST REQUESTER BYTES URL",
    ...status.activeRequests.map((entry) => `${entry.id} active ${entry.host} ${entry.requester} ${entry.bytesReceived || 0} ${entry.url}`),
    ...status.history.slice(-20).map((entry) => `${entry.id} ${entry.status} ${entry.host} ${entry.requester} ${entry.bytesReceived || 0} ${entry.url}`),
    ...status.deniedHosts.slice(-20).map((entry) => `- denied ${entry.host} ${entry.requester} 0 ${entry.url}`),
  ].join("\n");
}
