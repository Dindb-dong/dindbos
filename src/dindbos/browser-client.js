export class BrowserCompanionClient {
  constructor(url = "ws://127.0.0.1:8787/browser") {
    this.url = url;
    this.healthUrl = companionHealthUrl(url);
    this.socket = null;
    this.connecting = null;
    this.closing = false;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }

  emit(type, payload) {
    (this.listeners.get(type) || []).forEach((listener) => listener(payload));
  }

  connect() {
    if (this.connected) return Promise.resolve(this);
    if (this.connecting) return this.connecting;
    this.connecting = this.checkHealth().then(() => new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      this.closing = false;
      socket.addEventListener("open", () => {
        this.connecting = null;
        this.emit("status", { status: "connected", message: "browserd connected" });
        resolve(this);
      }, { once: true });
      socket.addEventListener("error", () => {
        const error = new Error(`browserd unavailable at ${this.url}`);
        this.connecting = null;
        this.emit("error", error);
        reject(error);
      }, { once: true });
      socket.addEventListener("close", () => {
        const expected = this.closing || socket.__dindbosExpectedClose;
        this.connecting = null;
        if (this.socket === socket) this.socket = null;
        if (expected) {
          this.emit("status", { status: "closed", message: "browserd connection closed", reconnect: false });
          this.pending.clear();
        } else {
          const error = new Error("browserd disconnected; start browserd and press Connect to reconnect");
          this.emit("status", { status: "disconnected", message: error.message, reconnect: true });
          this.rejectPending(error);
        }
      });
      socket.addEventListener("message", (event) => this.handleMessage(event.data));
    })).catch((error) => {
      this.connecting = null;
      throw error;
    });
    return this.connecting;
  }

  reconnect() {
    if (this.connected) return Promise.resolve(this);
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      this.socket.__dindbosExpectedClose = true;
      this.socket.close();
    }
    this.socket = null;
    this.closing = false;
    return this.connect();
  }

  close() {
    this.closing = true;
    this.pending.clear();
    if (this.socket) this.socket.__dindbosExpectedClose = true;
    this.socket?.close();
  }

  async checkHealth() {
    const response = await fetch(this.healthUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`browserd health check failed: ${response.status}`);
    const health = await response.json();
    if (health.service !== "dindbos-browserd") {
      throw new Error(`port ${new URL(this.healthUrl).port} is not dindbos-browserd`);
    }
    return health;
  }

  async handleMessage(data) {
    const text = await socketMessageText(data);
    const message = JSON.parse(text);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.ok === false) reject(new Error(message.error || "browserd command failed"));
      else resolve(message.result || message);
      return;
    }
    this.emit(message.type || "message", message);
  }

  send(type, payload = {}) {
    if (!this.connected) return Promise.reject(new Error("browserd is not connected"));
    const id = this.nextId++;
    const message = { id, type, ...payload };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }

  navigate(url) {
    return this.send("navigate", { url });
  }

  reload() {
    return this.send("reload");
  }

  back() {
    return this.send("back");
  }

  forward() {
    return this.send("forward");
  }

  resize(width, height, deviceScaleFactor = globalThis.devicePixelRatio || 1) {
    return this.send("resize", { width: Math.round(width), height: Math.round(height), deviceScaleFactor });
  }

  click(x, y) {
    return this.send("click", { x: Math.round(x), y: Math.round(y) });
  }

  type(text) {
    return this.send("type", { text });
  }

  key(key, options = {}) {
    const payload = typeof key === "object" && key !== null ? key : { key, ...options };
    return this.send("key", normalizeKeyPayload(payload));
  }

  scroll(deltaX, deltaY, x = 0, y = 0) {
    return this.send("scroll", { deltaX, deltaY, x: Math.round(x), y: Math.round(y) });
  }

  rejectPending(error) {
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }
}

async function socketMessageText(data) {
  if (typeof data === "string") return data;
  if (data?.text) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data || "");
}

function companionHealthUrl(url) {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function normalizeKeyPayload(payload = {}) {
  const key = String(payload.key || "");
  if (!key) throw new Error("browserd key command requires a key");
  const normalized = {
    key,
    code: payload.code ? String(payload.code) : undefined,
    modifiers: Number(payload.modifiers || 0),
  };
  if (payload.text !== undefined) normalized.text = String(payload.text);
  return normalized;
}
