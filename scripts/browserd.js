#!/usr/bin/env node
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_PORT = 8787;
const DEFAULT_CDP_PORT = 9223;
const BROWSERD_SERVICE = "dindbos-browserd";
const BROWSERD_PROTOCOL = "dindbos-browserd.v1";
const BROWSERD_CAPABILITIES = [
  "browser.capture",
  "browser.history",
  "browser.navigate",
  "browser.input",
  "browser.frames.binary",
  "browser.download.deny",
];
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_FRAME_INTERVAL_MS = 100;
const DEFAULT_JPEG_QUALITY = 58;
const DEFAULT_MAX_FRAME_WIDTH = 1280;
const DEFAULT_MAX_FRAME_HEIGHT = 900;

class BrowserDaemon {
  constructor(options = {}) {
    this.port = Number(options.port || process.env.DINDBOS_BROWSERD_PORT || DEFAULT_PORT);
    this.cdpPort = Number(options.cdpPort || process.env.DINDBOS_CHROME_DEBUG_PORT || DEFAULT_CDP_PORT);
    this.chromePath = options.chrome || process.env.CHROME_PATH || findChrome();
    this.headless = options.headful ? false : options.headless !== false;
    this.chrome = null;
    this.profileDir = mkdtempSync(join(tmpdir(), "dindbos-browserd-"));
    this.server = null;
  }

  async start() {
    if (!this.chromePath) {
      throw new Error("browserd: Chrome/Chromium was not found. Set CHROME_PATH=/path/to/chrome.");
    }
    await this.launchChrome();
    this.server = createServer((request, response) => this.handleHttp(request, response));
    this.server.on("upgrade", (request, socket) => this.handleUpgrade(request, socket));
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.listen(this.port, "127.0.0.1", onListening);
    });
    console.log(`dindbos-browserd listening on ws://127.0.0.1:${this.port}/browser`);
    console.log(`chromium=${this.chromePath}`);
  }

  async launchChrome() {
    if ((this.chromePath.includes("/") || this.chromePath.includes("\\")) && !existsSync(this.chromePath)) {
      throw new Error("browserd: Chrome/Chromium was not found. Set CHROME_PATH=/path/to/chrome.");
    }
    const args = [
      `--remote-debugging-port=${this.cdpPort}`,
      `--user-data-dir=${this.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--window-size=1280,800",
      "about:blank",
    ];
    if (this.headless) args.unshift("--headless=new");
    this.chrome = spawn(this.chromePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.chrome.on("exit", (code) => {
      console.error(`browserd: chromium exited with code ${code}`);
    });
    const startupFailure = new Promise((_, reject) => {
      const onError = (error) => reject(new Error(`browserd: failed to launch Chromium: ${error.message}`));
      const onExit = (code, signal) => reject(new Error(`browserd: Chromium exited before CDP was ready (${signal || `code ${code}`})`));
      this.chrome.once("error", onError);
      this.chrome.once("exit", onExit);
      this.chrome.once("spawn", () => {
        this.chrome.off("error", onError);
      });
    });
    await Promise.race([waitForCdp(this.cdpPort), startupFailure]);
    process.once("SIGINT", () => this.shutdown(0));
    process.once("SIGTERM", () => this.shutdown(0));
    process.once("exit", () => this.cleanup());
  }

  handleHttp(request, response) {
    if (request.url === "/health") {
      response.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      response.end(JSON.stringify({
        ok: true,
        service: BROWSERD_SERVICE,
        protocol: BROWSERD_PROTOCOL,
        port: this.port,
        capabilities: BROWSERD_CAPABILITIES,
      }));
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("dindbos-browserd\nWebSocket: /browser\nHealth: /health\n");
  }

  handleUpgrade(request, socket) {
    if (!request.url?.startsWith("/browser")) {
      socket.destroy();
      return;
    }
    const key = request.headers["sec-websocket-key"];
    const protocols = String(request.headers["sec-websocket-protocol"] || "")
      .split(",")
      .map((protocol) => protocol.trim())
      .filter(Boolean);
    if (!key || !protocols.includes(BROWSERD_PROTOCOL)) {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      `Sec-WebSocket-Protocol: ${BROWSERD_PROTOCOL}`,
      "",
      "",
    ].join("\r\n"));
    new BrowserSocket(socket, this.cdpPort);
  }

  shutdown(code = 0) {
    this.server?.close();
    this.chrome?.kill();
    this.cleanup();
    process.exit(code);
  }

  cleanup() {
    try {
      rmSync(this.profileDir, { recursive: true, force: true });
    } catch {}
  }
}

class BrowserSocket {
  constructor(socket, cdpPort) {
    this.socket = socket;
    this.cdpPort = cdpPort;
    this.buffer = Buffer.alloc(0);
    this.session = new BrowserSession(
      cdpPort,
      (message) => this.send(message),
      (metadata, bytes) => this.sendBinaryFrame(metadata, bytes),
    );
    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("close", () => this.session.close());
    socket.on("error", () => this.session.close());
    this.send({ type: "status", status: "connected", message: "browserd socket ready" });
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let parsed;
    while ((parsed = decodeClientFrame(this.buffer))) {
      this.buffer = this.buffer.slice(parsed.consumed);
      if (parsed.opcode === 8) {
        this.socket.end();
        return;
      }
      if (parsed.opcode === 9) {
        this.socket.write(encodeFrame(parsed.payload, 10));
        continue;
      }
      if (parsed.opcode !== 1) continue;
      this.handleMessage(parsed.payload.toString("utf8"));
    }
  }

  async handleMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
      const result = await this.session.dispatch(message);
      if (message.id) this.send({ id: message.id, ok: true, result });
    } catch (error) {
      if (message?.id) this.send({ id: message.id, ok: false, error: error.message });
      else this.send({ type: "error", error: error.message });
    }
  }

  send(message) {
    if (this.socket.destroyed) return;
    this.socket.write(encodeFrame(JSON.stringify(message)));
  }

  sendBinaryFrame(metadata, bytes) {
    if (this.socket.destroyed) return;
    this.socket.write(encodeFrame(encodeBinaryFrame(metadata, bytes), 2));
  }
}

class BrowserSession {
  constructor(cdpPort, send, sendBinaryFrame) {
    this.cdpPort = cdpPort;
    this.send = send;
    this.sendBinaryFrame = sendBinaryFrame;
    this.cdp = null;
    this.width = 1280;
    this.height = 800;
    this.deviceScaleFactor = 1;
    this.hasNavigated = false;
    this.screencastStarted = false;
    this.metadata = { url: "about:blank", title: "" };
    this.metadataTimer = null;
    this.lastFrameAt = 0;
    this.frameTimer = null;
    this.pendingFrame = null;
    this.frameInterval = Number(process.env.DINDBOS_BROWSERD_FRAME_INTERVAL_MS || DEFAULT_FRAME_INTERVAL_MS);
    this.jpegQuality = Number(process.env.DINDBOS_BROWSERD_JPEG_QUALITY || DEFAULT_JPEG_QUALITY);
    this.maxFrameWidth = Number(process.env.DINDBOS_BROWSERD_MAX_FRAME_WIDTH || DEFAULT_MAX_FRAME_WIDTH);
    this.maxFrameHeight = Number(process.env.DINDBOS_BROWSERD_MAX_FRAME_HEIGHT || DEFAULT_MAX_FRAME_HEIGHT);
  }

  async dispatch(message) {
    await this.ensureCdp();
    if (message.type === "navigate") return this.navigate(normalizeUrl(message.url));
    if (message.type === "reload") {
      this.scheduleMetadataRefresh();
      return this.command("Page.reload");
    }
    if (message.type === "back") return this.navigateHistory(-1);
    if (message.type === "forward") return this.navigateHistory(1);
    if (message.type === "resize") return this.resize(message);
    if (message.type === "click") return this.click(message);
    if (message.type === "type") return this.command("Input.insertText", { text: String(message.text || "") });
    if (message.type === "key") return this.key(message);
    if (message.type === "scroll") return this.scroll(message);
    if (message.type === "capture") return this.capture();
    throw new Error(`browserd: unknown command ${message.type}`);
  }

  async ensureCdp() {
    if (this.cdp) return;
    const target = await createTarget(this.cdpPort);
    this.cdp = new CdpClient(target.webSocketDebuggerUrl);
    await this.cdp.connect();
    await this.command("Page.enable");
    await this.command("Runtime.enable");
    await this.configureDownloadPolicy();
    this.cdp.on("Page.screencastFrame", (params) => this.handleScreencastFrame(params).catch(() => {}));
    this.cdp.on("Page.loadEventFired", () => this.scheduleMetadataRefresh());
    this.cdp.on("Page.frameNavigated", () => this.scheduleMetadataRefresh());
    this.cdp.on("Page.downloadWillBegin", (params) => this.handleDownloadWillBegin(params));
    this.cdp.on("Browser.downloadWillBegin", (params) => this.handleDownloadWillBegin(params));
    await this.resize({ width: this.width, height: this.height, deviceScaleFactor: this.deviceScaleFactor, force: true });
    await this.startScreencast();
    this.send({ type: "status", status: "ready", url: "about:blank", title: "" });
  }

  command(method, params = {}) {
    return this.cdp.send(method, params);
  }

  async configureDownloadPolicy() {
    await this.command("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => (
      this.command("Page.setDownloadBehavior", { behavior: "deny" }).catch(() => {})
    ));
  }

  handleDownloadWillBegin(params = {}) {
    const filename = params.suggestedFilename || "download";
    this.send({
      type: "status",
      status: "download-blocked",
      message: `download blocked by DindbOS policy: ${filename}`,
      url: params.url || this.metadata.url,
      title: this.metadata.title,
      suggestedFilename: filename,
    });
  }

  async navigate(url) {
    this.hasNavigated = true;
    this.metadata = { url, title: "" };
    await this.command("Page.navigate", { url });
    this.send({ type: "status", status: "loading", url });
    this.scheduleMetadataRefresh();
    return this.metadata;
  }

  async resize({ width, height, deviceScaleFactor, force = false }) {
    const nextWidth = Math.max(320, Number(width || this.width));
    const nextHeight = Math.max(240, Number(height || this.height));
    const nextScale = Math.max(1, Number(deviceScaleFactor || this.deviceScaleFactor));
    const changed = Math.abs(nextWidth - this.width) > 1
      || Math.abs(nextHeight - this.height) > 1
      || Math.abs(nextScale - this.deviceScaleFactor) > 0.01;
    if (!changed && !force) return {};
    this.width = nextWidth;
    this.height = nextHeight;
    this.deviceScaleFactor = nextScale;
    await this.command("Emulation.setDeviceMetricsOverride", {
      width: this.width,
      height: this.height,
      deviceScaleFactor: this.deviceScaleFactor,
      mobile: false,
    });
    await this.restartScreencast();
    return {};
  }

  async click({ x, y }) {
    const params = { x: Number(x || 0), y: Number(y || 0), button: "left", clickCount: 1 };
    await this.command("Input.dispatchMouseEvent", { ...params, type: "mousePressed" });
    await this.command("Input.dispatchMouseEvent", { ...params, type: "mouseReleased" });
    this.scheduleMetadataRefresh();
    return {};
  }

  async scroll({ deltaX = 0, deltaY = 0, x = 0, y = 0 }) {
    await this.command("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Number(x || this.width / 2),
      y: Number(y || this.height / 2),
      deltaX: Number(deltaX || 0),
      deltaY: Number(deltaY || 0),
    });
    return {};
  }

  async key(input) {
    const key = String(input?.key || "");
    if (!key) throw new Error("browserd: key command requires a key");
    const params = keyboardEventParams(input);
    await this.command("Input.dispatchKeyEvent", { ...params, type: params.text ? "keyDown" : "rawKeyDown" });
    await this.command("Input.dispatchKeyEvent", { ...params, text: undefined, type: "keyUp" });
    this.scheduleMetadataRefresh();
    return {};
  }

  async navigateHistory(direction) {
    const history = await this.command("Page.getNavigationHistory");
    const nextIndex = history.currentIndex + direction;
    const entry = history.entries[nextIndex];
    if (!entry) return {};
    this.hasNavigated = true;
    await this.command("Page.navigateToHistoryEntry", { entryId: entry.id });
    this.scheduleMetadataRefresh();
    return {};
  }

  async capture() {
    if (!this.hasNavigated) return {};
    const metadata = await this.refreshMetadata();
    const screenshot = await this.command("Page.captureScreenshot", {
      format: "jpeg",
      quality: this.jpegQuality,
      fromSurface: true,
    });
    this.sendFrame(screenshot.data);
    return metadata;
  }

  async startScreencast() {
    if (this.screencastStarted) return;
    await this.command("Page.startScreencast", {
      format: "jpeg",
      quality: this.jpegQuality,
      maxWidth: Math.min(Math.round(this.width), this.maxFrameWidth),
      maxHeight: Math.min(Math.round(this.height), this.maxFrameHeight),
      everyNthFrame: 1,
    });
    this.screencastStarted = true;
  }

  async restartScreencast() {
    if (!this.cdp) return;
    if (this.screencastStarted) {
      await this.command("Page.stopScreencast").catch(() => {});
      this.screencastStarted = false;
    }
    await this.startScreencast();
  }

  async handleScreencastFrame({ data, sessionId }) {
    if (sessionId) await this.command("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (!this.hasNavigated || !data) return;
    const now = Date.now();
    const remaining = this.frameInterval - (now - this.lastFrameAt);
    if (remaining <= 0) {
      this.sendFrame(data);
      return;
    }
    this.pendingFrame = data;
    if (this.frameTimer) return;
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      const frame = this.pendingFrame;
      this.pendingFrame = null;
      if (frame) this.sendFrame(frame);
    }, remaining);
  }

  sendFrame(data) {
    this.lastFrameAt = Date.now();
    const metadata = {
      type: "frame",
      status: "ready",
      url: this.metadata.url,
      title: this.metadata.title,
      mime: "image/jpeg",
      transport: "binary",
    };
    this.sendBinaryFrame(metadata, Buffer.from(data, "base64"));
  }

  scheduleMetadataRefresh() {
    clearTimeout(this.metadataTimer);
    this.metadataTimer = setTimeout(() => {
      this.refreshMetadata().catch(() => {});
    }, 120);
  }

  async refreshMetadata() {
    try {
      const result = await this.command("Runtime.evaluate", {
        expression: "({ title: document.title, url: location.href })",
        returnByValue: true,
      });
      this.metadata = result.result?.value || this.metadata;
      this.send({ type: "status", status: "ready", url: this.metadata.url, title: this.metadata.title });
      return this.metadata;
    } catch {
      return this.metadata;
    }
  }

  close() {
    clearTimeout(this.metadataTimer);
    clearTimeout(this.frameTimer);
    if (this.screencastStarted) this.command("Page.stopScreencast").catch(() => {});
    this.cdp?.close();
  }
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.closing = false;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.closing = false;
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`CDP websocket failed: ${this.url}`)), { once: true });
      this.ws.addEventListener("message", (event) => this.handleMessage(event.data));
      this.ws.addEventListener("close", () => {
        if (this.closing) this.pending.clear();
        else this.rejectPending(new Error("CDP websocket closed"));
      });
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async handleMessage(data) {
    const text = await socketMessageText(data);
    const message = JSON.parse(text);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    (this.listeners.get(message.method) || []).forEach((listener) => listener(message.params || {}));
  }

  close() {
    this.closing = true;
    this.pending.clear();
    this.ws?.close();
  }

  rejectPending(error) {
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
  }
}

function decodeClientFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = Boolean(buffer[1] & 0x80);
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;
  const mask = masked ? buffer.slice(offset, offset + 4) : null;
  offset += maskLength;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode, payload, consumed: offset + length };
}

function encodeFrame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const length = data.length;
  if (length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, length]), data]);
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, data]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, data]);
}

function encodeBinaryFrame(metadata, bytes) {
  const header = Buffer.from(JSON.stringify(metadata), "utf8");
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(header.length, 0);
  return Buffer.concat([prefix, header, body]);
}

async function createTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
    .catch(() => fetch(`http://127.0.0.1:${port}/json/new?about:blank`));
  if (!response.ok) throw new Error(`browserd: cannot create CDP target (${response.status})`);
  return response.json();
}

async function waitForCdp(port) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await delay(125);
  }
  throw new Error(`browserd: Chromium did not expose CDP on ${port}`);
}

function findChrome() {
  const candidates = chromeCandidates();
  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const found = spawnSync(process.platform === "win32" ? "where" : "which", [candidate], { encoding: "utf8" });
    const line = found.stdout?.split(/\r?\n/).find(Boolean);
    if (line) return line.trim();
  }
  return "";
}

function chromeCandidates() {
  if (process.platform === "darwin") return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "google-chrome",
    "chromium",
  ];
  if (process.platform === "win32") return [
    "chrome.exe",
    "msedge.exe",
    "brave.exe",
  ];
  return [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
  ];
}

function normalizeUrl(value) {
  const url = String(value || "about:blank").trim();
  if (!url) return "about:blank";
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (url.includes(".") || url === "localhost") return `https://${url}`;
  return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
}

function keyboardEventParams(input = {}) {
  const key = String(input.key || "");
  const definition = KEY_DEFINITIONS[key] || {};
  const modifiers = Number(input.modifiers || 0);
  const text = input.text !== undefined
    ? String(input.text)
    : key.length === 1 && modifiers === 0 ? key : undefined;
  const virtualKeyCode = Number(input.windowsVirtualKeyCode || definition.windowsVirtualKeyCode || inferredVirtualKeyCode(key) || 0);
  const params = {
    key,
    code: String(input.code || definition.code || inferredCodeForKey(key) || key),
    modifiers,
  };
  if (text !== undefined) params.text = text;
  if (virtualKeyCode) {
    params.windowsVirtualKeyCode = virtualKeyCode;
    params.nativeVirtualKeyCode = virtualKeyCode;
  }
  return params;
}

function inferredCodeForKey(key) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return "";
}

function inferredVirtualKeyCode(key) {
  if (key.length !== 1) return 0;
  return key.toUpperCase().charCodeAt(0);
}

const KEY_DEFINITIONS = {
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  Enter: { code: "Enter", windowsVirtualKeyCode: 13 },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  Delete: { code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowLeft: { code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowRight: { code: "ArrowRight", windowsVirtualKeyCode: 39 },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  Home: { code: "Home", windowsVirtualKeyCode: 36 },
  End: { code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { code: "PageDown", windowsVirtualKeyCode: 34 },
};

async function socketMessageText(data) {
  if (typeof data === "string") return data;
  if (data?.text) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data || "");
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--headful") options.headful = true;
    else if (arg === "--no-headless") options.headful = true;
    else if (arg === "--port") options.port = args[++index];
    else if (arg.startsWith("--port=")) options.port = arg.split("=").slice(1).join("=");
    else if (arg === "--cdp-port") options.cdpPort = args[++index];
    else if (arg.startsWith("--cdp-port=")) options.cdpPort = arg.split("=").slice(1).join("=");
    else if (arg === "--chrome") options.chrome = args[++index];
    else if (arg.startsWith("--chrome=")) options.chrome = arg.split("=").slice(1).join("=");
  }
  return options;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const options = parseArgs(process.argv.slice(2));
const browserd = new BrowserDaemon(options);
try {
  await browserd.start();
} catch (error) {
  console.error(error.message);
  browserd.server?.close();
  browserd.chrome?.kill();
  browserd.cleanup();
  process.exit(1);
}
