#!/usr/bin/env node
import { createServer } from "node:http";
import { once } from "node:events";
import { BrowserCompanionClient, pasteClipboardText } from "../src/dindbos/browser-client.js";

await verifyReconnectContract();
await verifyBinaryFrameProtocol();
await verifyPasteProtocol();
await verifyPasteHelper();
await verifyHealthIdentityGuard();

console.log("browser client smoke ok reconnect identity guard binary paste");

async function verifyReconnectContract() {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  const statuses = [];
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, service: "dindbos-browserd" }),
  });
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this.readyState = 0;
      this.listeners = new Map();
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatch("open", {});
      });
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    close() {
      this.closeFromServer();
    }

    send(message) {
      this.sent.push(JSON.parse(message));
    }

    closeFromServer() {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatch("close", {});
    }

    dispatch(type, event) {
      (this.listeners.get(type) || []).forEach((listener) => listener(event));
    }
  };

  try {
    const client = new BrowserCompanionClient("ws://127.0.0.1:8787/browser");
    client.on("status", (status) => statuses.push(status));
    await client.connect();
    assert(client.connected, "client did not connect");
    sockets[0].closeFromServer();
    await Promise.resolve();
    assert(!client.connected, "client remained connected after close");
    assert(statuses.some((status) => status.reconnect === true), "disconnect status did not request reconnect");
    await client.reconnect();
    assert(client.connected, "client did not reconnect");
    assert(sockets.length === 2, `expected second websocket, got ${sockets.length}`);
    client.close();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
}

async function verifyBinaryFrameProtocol() {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const frames = [];
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, service: "dindbos-browserd" }),
  });
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this.readyState = 0;
      this.listeners = new Map();
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatch("open", {});
      });
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatch("close", {});
    }

    send() {}

    dispatch(type, event) {
      (this.listeners.get(type) || []).forEach((listener) => listener(event));
    }
  };

  try {
    const client = new BrowserCompanionClient("ws://127.0.0.1:8787/browser");
    client.on("frame", (frame) => frames.push(frame));
    await client.connect();
    await client.handleMessage(encodeBinaryFrame(
      { type: "frame", status: "ready", url: "https://example.com", title: "Example", mime: "image/jpeg", transport: "binary" },
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ));
    assert(frames.length === 1, `expected one binary frame, got ${frames.length}`);
    assert(frames[0].transport === "binary", "binary frame transport metadata missing");
    assert(frames[0].bytes === 4, `binary frame byte count mismatch: ${frames[0].bytes}`);
    assert(frames[0].data.startsWith("blob:"), `binary frame did not create object URL: ${frames[0].data}`);
    URL.revokeObjectURL(frames[0].data);
    client.close();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
}

async function verifyPasteProtocol() {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ ok: true, service: "dindbos-browserd" }),
  });
  globalThis.WebSocket = class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;

    constructor() {
      this.readyState = 0;
      this.listeners = new Map();
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.dispatch("open", {});
      });
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatch("close", {});
    }

    send(message) {
      const parsed = JSON.parse(message);
      this.sent.push(parsed);
      queueMicrotask(() => this.dispatch("message", {
        data: JSON.stringify({ id: parsed.id, ok: true, result: { accepted: true } }),
      }));
    }

    dispatch(type, event) {
      (this.listeners.get(type) || []).forEach((listener) => listener(event));
    }
  };

  try {
    const client = new BrowserCompanionClient("ws://127.0.0.1:8787/browser");
    await client.connect();
    await client.paste("clip text");
    assert(sockets[0].sent.length === 1, `expected one paste command, got ${sockets[0].sent.length}`);
    assert(sockets[0].sent[0].type === "type", `paste used wrong protocol: ${sockets[0].sent[0].type}`);
    assert(sockets[0].sent[0].text === "clip text", "paste payload text mismatch");
    client.close();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
}

async function verifyPasteHelper() {
  const sent = [];
  const result = await pasteClipboardText(
    async () => "hello clipboard",
    async (text) => sent.push(text),
  );
  assert(result.pasted === true, "paste helper did not mark text as pasted");
  assert(result.bytes === 15, `paste helper byte count mismatch: ${result.bytes}`);
  assert(sent[0] === "hello clipboard", "paste helper did not send clipboard text");
  const empty = await pasteClipboardText(async () => "", async () => {
    throw new Error("empty paste should not send");
  });
  assert(empty.pasted === false && empty.bytes === 0, "empty paste helper result mismatch");
  await assertRejects(
    () => pasteClipboardText(null, async () => {}),
    "clipboard read access",
  );
}

async function verifyHealthIdentityGuard() {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      response.end(JSON.stringify({ ok: true, service: "not-dindbos-browserd" }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const { port } = server.address();
    const client = new BrowserCompanionClient(`ws://127.0.0.1:${port}/browser`);
    await assertRejects(
      () => client.connect(),
      `port ${port} is not dindbos-browserd`,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function assertRejects(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected rejection: ${error.message}`);
  }
  throw new Error("expected BrowserCompanionClient to reject non-DindbOS health service");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function encodeBinaryFrame(metadata, payload) {
  const header = new TextEncoder().encode(JSON.stringify(metadata));
  const bytes = new Uint8Array(4 + header.byteLength + payload.byteLength);
  new DataView(bytes.buffer).setUint32(0, header.byteLength);
  bytes.set(header, 4);
  bytes.set(payload, 4 + header.byteLength);
  return bytes.buffer;
}
