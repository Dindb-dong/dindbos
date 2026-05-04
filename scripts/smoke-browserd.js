#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";

const HEALTH_TIMEOUT_MS = 12000;
const FRAME_TIMEOUT_MS = 12000;
const COMMAND_TIMEOUT_MS = 6000;

const browserPort = await openPort();
const cdpPort = await openPort();
const browserd = spawn(process.execPath, [
  "scripts/browserd.js",
  "--port",
  String(browserPort),
  "--cdp-port",
  String(cdpPort),
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DINDBOS_BROWSERD_FRAME_INTERVAL_MS: "50",
    DINDBOS_BROWSERD_JPEG_QUALITY: "50",
    DINDBOS_BROWSERD_MAX_FRAME_WIDTH: "800",
    DINDBOS_BROWSERD_MAX_FRAME_HEIGHT: "600",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
browserd.stdout.setEncoding("utf8");
browserd.stderr.setEncoding("utf8");
browserd.stdout.on("data", (chunk) => {
  output += chunk;
});
browserd.stderr.on("data", (chunk) => {
  output += chunk;
});

try {
  await waitForHealth(browserPort);
  const health = await readHealth(browserPort);
  assert(health.service === "dindbos-browserd", `unexpected health service: ${JSON.stringify(health)}`);
  assert(health.protocol === "dindbos-browserd.v1", `unexpected health protocol: ${JSON.stringify(health)}`);
  assert(health.capabilities.includes("browser.frames.binary"), "health capabilities missing binary frames");
  assert(health.capabilities.every((capability) => capability.startsWith("browser.")), `browserd exposed non-browser capability: ${health.capabilities.join(",")}`);
  assert(!health.capabilities.some((capability) => /file|mount|native|download\.save/.test(capability)), `browserd exposed native-adjacent capability: ${health.capabilities.join(",")}`);

  const socket = new WebSocket(`ws://127.0.0.1:${browserPort}/browser`, "dindbos-browserd.v1");
  await once(socket, "open");

  const received = [];
  socket.addEventListener("message", async (event) => {
    received.push(await socketMessage(event.data));
  });

  const resizeResult = await sendCommand(socket, 1, "resize", { width: 640, height: 420, deviceScaleFactor: 1 });
  assert(resizeResult.mobile === false && resizeResult.width === 640, "desktop resize result mismatch");
  const targetUrl = smokePageUrl();
  await sendCommand(socket, 2, "navigate", { url: targetUrl });
  await sendCommand(socket, 3, "capture");
  const frame = await waitForMessage(received, (message) => message.type === "frame", FRAME_TIMEOUT_MS);

  assert(frame.url === targetUrl, `frame url mismatch: ${frame.url}`);
  assert(frame.transport === "binary", `frame did not use binary transport: ${frame.transport}`);
  assert(frame.mime === "image/jpeg", `frame mime mismatch: ${frame.mime}`);
  assert(frame.payload?.byteLength > 1024, `frame payload too small: ${frame.payload?.byteLength}`);
  assert(frame.payload[0] === 0xff && frame.payload[1] === 0xd8, "frame payload did not start with JPEG magic bytes");

  await sendCommand(socket, 4, "key", { key: "a", code: "KeyA", text: "a" });
  await sendCommand(socket, 5, "key", { key: "b", code: "KeyB", text: "b" });
  await sendCommand(socket, 6, "key", { key: "c", code: "KeyC", text: "c" });
  await sendCommand(socket, 7, "key", { key: "Backspace", code: "Backspace" });
  await sendCommand(socket, 8, "key", { key: "Enter", code: "Enter" });
  await waitForMessage(
    received,
    (message) => message.type === "status" && message.title === "submitted:ab",
    COMMAND_TIMEOUT_MS,
  );
  await sendCommand(socket, 9, "key", { key: "a", code: "KeyA", modifiers: 2 });
  await waitForMessage(
    received,
    (message) => message.type === "status" && message.title === "modifier:ctrl-a",
    COMMAND_TIMEOUT_MS,
  );
  await sendCommand(socket, 10, "key", { key: "Tab", code: "Tab" });
  await sendCommand(socket, 11, "key", { key: "Tab", code: "Tab", modifiers: 8 });
  await waitForMessage(
    received,
    (message) => message.type === "status" && message.title === "focus:INPUT",
    COMMAND_TIMEOUT_MS,
  );
  await sendCommand(socket, 12, "navigate", { url: downloadPageUrl() });
  await waitForMessage(
    received,
    (message) => message.type === "status" && message.title === "DindbOS Download Smoke",
    COMMAND_TIMEOUT_MS,
  );
  await sendCommand(socket, 13, "click", { x: 78, y: 58 });
  await waitForMessage(
    received,
    (message) => message.type === "status"
      && message.status === "download-blocked"
      && message.suggestedFilename === "blocked.txt",
    COMMAND_TIMEOUT_MS,
  );
  const mobileResize = await sendCommand(socket, 14, "resize", { width: 390, height: 680, deviceScaleFactor: 2, mobile: true });
  assert(mobileResize.mobile === true && mobileResize.deviceScaleFactor === 2, "mobile resize result mismatch");
  await verifyBrowserSessionIsolation(browserPort);

  socket.close();
  console.log(`browserd smoke ok port=${browserPort} cdp=${cdpPort} frameBytes=${frame.payload.byteLength} session-isolation`);
} catch (error) {
  console.error(`browserd smoke failed: ${error.message}`);
  if (output.trim()) console.error(output.trim());
  process.exitCode = 1;
} finally {
  browserd.kill("SIGTERM");
  await waitForExit(browserd);
}

async function openPort() {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function verifyBrowserSessionIsolation(browserPort) {
  const app = await serveSessionPages();
  const first = new WebSocket(`ws://127.0.0.1:${browserPort}/browser`, "dindbos-browserd.v1");
  const second = new WebSocket(`ws://127.0.0.1:${browserPort}/browser`, "dindbos-browserd.v1");
  const firstReceived = [];
  const secondReceived = [];
  try {
    await Promise.all([once(first, "open"), once(second, "open")]);
    first.addEventListener("message", async (event) => {
      firstReceived.push(await socketMessage(event.data));
    });
    second.addEventListener("message", async (event) => {
      secondReceived.push(await socketMessage(event.data));
    });
    await sendCommand(first, 101, "navigate", { url: `http://127.0.0.1:${app.port}/set` });
    await waitForMessage(
      firstReceived,
      (message) => message.type === "status" && message.title === "stored:alpha:alpha",
      COMMAND_TIMEOUT_MS,
    );
    await sendCommand(second, 201, "navigate", { url: `http://127.0.0.1:${app.port}/read` });
    await waitForMessage(
      secondReceived,
      (message) => message.type === "status" && message.title === "read:none:none",
      COMMAND_TIMEOUT_MS,
    );
  } finally {
    first.close();
    second.close();
    app.server.close();
    await once(app.server, "close");
  }
}

async function serveSessionPages() {
  const server = createHttpServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    if (request.url === "/set") {
      response.end(`<!doctype html>
        <script>
          document.cookie = "dindbosSession=alpha; SameSite=Lax";
          localStorage.setItem("dindbosSession", "alpha");
          const cookie = document.cookie.includes("dindbosSession=alpha") ? "alpha" : "none";
          document.title = "stored:" + cookie + ":" + localStorage.getItem("dindbosSession");
        </script>`);
      return;
    }
    response.end(`<!doctype html>
      <script>
        const cookie = document.cookie.includes("dindbosSession=alpha") ? "alpha" : "none";
        document.title = "read:" + cookie + ":" + (localStorage.getItem("dindbosSession") || "none");
      </script>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: server.address().port };
}

async function waitForHealth(port) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    if (browserd.exitCode !== null) {
      throw new Error(`browserd exited before health check with code ${browserd.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(125);
  }
  throw new Error(`browserd health check timed out: ${lastError?.message || "no response"}`);
}

async function readHealth(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { cache: "no-store" });
  if (!response.ok) throw new Error(`health status ${response.status}`);
  return response.json();
}

function sendCommand(socket, id, type, payload = {}) {
  socket.send(JSON.stringify({ id, type, ...payload }));
  return waitForSocketResponse(socket, id);
}

function waitForSocketResponse(socket, id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`command ${id} timed out`));
    }, COMMAND_TIMEOUT_MS);
    const onMessage = async (event) => {
      const message = await socketMessage(event.data);
      if (!message.id) return;
      if (message.id !== id) return;
      cleanup();
      if (message.ok === false) reject(new Error(message.error || `command ${id} failed`));
      else resolve(message.result || message);
    };
    const onError = () => {
      cleanup();
      reject(new Error("browserd websocket error"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
}

function waitForMessage(messages, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const existing = messages.find(predicate);
    if (existing) {
      resolve(existing);
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for browser message; received=${summarizeMessages(messages)}`));
      }
    }, 50);
  });
}

function summarizeMessages(messages) {
  return messages
    .slice(-8)
    .map((message) => `${message.type || `id:${message.id}`}${message.title ? `:${message.title}` : ""}`)
    .join(",");
}

async function socketMessageText(data) {
  if (typeof data === "string") return data;
  if (data?.text) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data || "");
}

async function socketMessage(data) {
  if (!isBinarySocketData(data)) return JSON.parse(await socketMessageText(data));
  const bytes = await socketMessageBytes(data);
  if (bytes.byteLength < 4) throw new Error("binary browser frame missing header length");
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (bytes.byteLength < 4 + headerLength) throw new Error("binary browser frame header truncated");
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + headerLength)));
  return {
    ...header,
    payload: bytes.slice(4 + headerLength),
  };
}

function isBinarySocketData(data) {
  return data instanceof ArrayBuffer
    || ArrayBuffer.isView(data)
    || (typeof Blob !== "undefined" && data instanceof Blob && typeof data.arrayBuffer === "function");
}

async function socketMessageBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new Error("unsupported binary browser frame payload");
}

function smokePageUrl() {
  const html = `<!doctype html>
    <html>
      <head>
        <title>DindbOS Browser Smoke</title>
        <style>
          body { margin: 0; font: 22px system-ui; background: #f7f1e8; color: #111827; }
          main { min-height: 100vh; padding: 24px 32px; }
          input {
            position: fixed;
            left: 32px;
            top: 96px;
            width: 560px;
            height: 80px;
            box-sizing: border-box;
            font: inherit;
            padding: 12px 16px;
            border: 2px solid #3b82f6;
          }
          strong { color: #3b82f6; }
        </style>
        <script>
          addEventListener("DOMContentLoaded", () => {
            let typed = "";
            document.addEventListener("keydown", (event) => {
              if (event.ctrlKey && event.key.toLowerCase() === "a") {
                event.preventDefault();
                document.title = "modifier:ctrl-a";
                return;
              }
              if (event.key === "Backspace") {
                event.preventDefault();
                typed = typed.slice(0, -1);
                document.title = "typed:" + typed;
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                document.title = "submitted:" + typed;
                return;
              }
              if (event.key.length === 1) {
                typed += event.key;
                document.title = "typed:" + typed;
              }
            });
            document.addEventListener("focusin", (event) => {
              document.title = "focus:" + event.target.tagName;
            });
          });
        </script>
      </head>
      <body><main><p>browserd <strong>smoke frame</strong></p><form><input autofocus /></form></main></body>
    </html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function downloadPageUrl() {
  const html = `<!doctype html>
    <html>
      <head>
        <title>DindbOS Download Smoke</title>
        <style>
          body { margin: 0; font: 20px system-ui; background: #f7f1e8; }
          a {
            position: fixed;
            left: 24px;
            top: 24px;
            display: inline-block;
            padding: 14px 18px;
            background: #3b82f6;
            color: white;
          }
        </style>
      </head>
      <body>
        <a download="blocked.txt" href="data:text/plain,blocked">download</a>
      </body>
    </html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return Promise.race([
    once(child, "exit"),
    delay(2500).then(() => child.kill("SIGKILL")),
  ]);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
