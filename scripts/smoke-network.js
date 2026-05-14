#!/usr/bin/env node
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { ShellSession } from "../src/dindbos/shell.js";
import { createDindbOSTestRuntime } from "./helpers/dindbos-test-runtime.js";

const fetchCalls = [];
const sockets = [];
const peerConnections = [];
const rawCompanionCalls = [];
let slowReject = null;
class FakeWebSocket {
  constructor(url, protocols = undefined) {
    this.url = url;
    this.protocols = protocols;
    this.listeners = {};
    this.sent = [];
    sockets.push(this);
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  send(data) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "closed") {
    this.listeners.close?.({ code, reason });
  }

  emit(type, event = {}) {
    this.listeners[type]?.(event);
  }
}

class FakeDataChannel {
  constructor(label) {
    this.label = label;
    this.listeners = {};
    this.sent = [];
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.listeners.close?.({});
  }

  emit(type, event = {}) {
    this.listeners[type]?.(event);
  }
}

class FakePeerConnection {
  constructor(configuration = {}) {
    this.configuration = configuration;
    this.channels = [];
    this.closed = false;
    peerConnections.push(this);
  }

  createDataChannel(label, options = {}) {
    const channel = new FakeDataChannel(label);
    channel.options = options;
    this.channels.push(channel);
    return channel;
  }

  close() {
    this.closed = true;
  }
}

const os = createDindbOSTestRuntime(null, {
  networkFetch: async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url.includes("/slow")) {
      return new Promise((resolve, reject) => {
        slowReject = reject;
        options.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
    return {
      status: 200,
      ok: true,
      headers: { "content-type": "text/plain" },
      text: async () => `ok:${new URL(url).hostname}:${new URL(url).pathname}`,
    };
  },
  networkWebSocket: FakeWebSocket,
  networkPeerConnection: FakePeerConnection,
});
const shell = new ShellSession(os);
const loopback = os.network.registerLoopbackService({
  id: "echo",
  title: "Echo Loopback",
  handler: async (request) => ({
    status: 200,
    ok: true,
    headers: { "x-dindbos-service": "echo" },
    text: async () => `loopback:${request.path}:${request.requester}`,
  }),
}, { appId: "system", principal: os.permissions.systemPrincipal() });
assert(loopback.host === "echo.loopback.dindbos", "loopback service host mismatch");

let result = await shell.executeAsync("curl https://shell.example.test/hello?token=raw-secret");
assert(result.status === 0 && result.output === "ok:shell.example.test:/hello", `shell curl mismatch: ${JSON.stringify(result)}`);
assert(!os.fs.readFile("/var/log/dindbos/network.log").includes("raw-secret"), "network log exposed query secret");
assert(JSON.parse(os.fs.readFile("/proc/net/status.json")).totals.requests === 1, "/proc/net status did not record shell curl");

result = await shell.executeAsync("netstat");
assert(result.status === 0 && result.output.includes("requests=1") && result.output.includes("shell.example.test"), `netstat mismatch: ${JSON.stringify(result)}`);
result = await shell.executeAsync("ping shell.example.test");
assert(result.status === 0 && result.output.includes("raw ICMP unsupported"), `ping policy probe mismatch: ${JSON.stringify(result)}`);
result = await shell.executeAsync("dig shell.example.test");
assert(result.status === 0 && result.output.includes("browser-policy-only"), `dig policy probe mismatch: ${JSON.stringify(result)}`);

const allowedProcess = processFor("network-app", ["net.fetch", "net.websocket", "net.webrtc", "net.dns", "net.rawTcp", "net.rawUdp"], { networkHosts: ["api.example.test", "echo.loopback.dindbos"] });
const allowedSandbox = new AppSandbox(os, allowedProcess);
const response = await allowedSandbox.net.fetch("https://api.example.test/data?token=package-secret");
assert(response.text === "ok:api.example.test:/data", "sandbox net.fetch did not return broker response");
assert(!os.fs.readFile("/var/log/dindbos/network.log").includes("package-secret"), "network log exposed package query secret");
const loopbackResponse = await allowedSandbox.net.fetch("https://echo.loopback.dindbos/health?token=loopback-secret");
assert(loopbackResponse.loopback === true && loopbackResponse.serviceId === "echo", "loopback fetch did not route through virtual service");
assert(loopbackResponse.text === "loopback:/health:network-app", `loopback response mismatch: ${loopbackResponse.text}`);
assert(!os.fs.readFile("/var/log/dindbos/network.log").includes("loopback-secret"), "network log exposed loopback query secret");
assert(allowedSandbox.net.services().some((entry) => entry.id === "echo" && entry.requests === 1), "sandbox service discovery missing loopback service");
await assertRejects(() => allowedSandbox.net.fetch("https://blocked.example.test/data"), "host denied");
const ws = allowedSandbox.net.openWebSocket("wss://api.example.test/socket");
assert(ws.objectId && ws.handleId, "websocket did not expose socket object and handle ids");
const wsObject = os.objects.get(ws.objectId);
assert(wsObject?.type === "socket" && wsObject.rights.includes("send") && wsObject.rights.includes("close"), "websocket kernel object rights mismatch");
sockets.at(-1).emit("open");
assert(os.objects.get(ws.objectId).metadata.state === "open", "websocket kernel object did not refresh open state");
ws.send("hello socket");
sockets.at(-1).emit("message", { data: "reply" });
assert(os.objects.get(ws.objectId).metadata.messagesSent === 1 && os.objects.get(ws.objectId).metadata.messagesReceived === 1, "websocket kernel object did not refresh traffic counters");
assert(os.network.status().websocket.sessions.some((entry) => entry.id === ws.id && entry.state === "open" && entry.messagesSent === 1 && entry.messagesReceived === 1), "websocket session did not open through broker");
ws.close(1000, "done");
assert(os.network.status().websocket.history.some((entry) => entry.id === ws.id && entry.state === "closed"), "websocket close was not recorded");
assert(os.objects.get(ws.objectId).status === "revoked", "websocket kernel object was not revoked on close");
const guardedWs = allowedSandbox.net.openWebSocket("wss://api.example.test/guarded-socket");
os.objects.revokeHandle(guardedWs.handleId, "websocket-handle-smoke");
await assertRejects(() => guardedWs.send("blocked"), "stale handle");
os.network.finishWebSocket(guardedWs.id, 1000, "smoke-cleanup");
await assertRejects(() => allowedSandbox.net.openWebSocket("wss://blocked.example.test/socket"), "host denied");
const rtc = allowedSandbox.net.openDataChannel("api.example.test", { label: "updates" });
assert(rtc.objectId && rtc.handleId && os.objects.get(rtc.objectId).metadata.kind === "webrtc", "WebRTC data channel did not expose socket object and handle ids");
peerConnections.at(-1).channels[0].emit("open");
rtc.send("hello rtc");
peerConnections.at(-1).channels[0].emit("message", { data: "rtc reply" });
assert(os.network.status().webrtc.dataChannels.some((entry) => entry.id === rtc.id && entry.state === "open" && entry.messagesSent === 1 && entry.messagesReceived === 1), "WebRTC data channel did not open through broker");
rtc.close("done");
assert(os.network.status().webrtc.history.some((entry) => entry.id === rtc.id && entry.state === "closed"), "WebRTC data channel close was not recorded");
await assertRejects(() => allowedSandbox.net.openDataChannel("blocked.example.test"), "host denied");
await assertRejects(() => allowedSandbox.net.openRawSocket("tcp", "api.example.test", 443), "requires approved networkd companion");
os.network.rawSocketCompanion = {
  identity: "networkd",
  protocolVersion: "dindbos-networkd-v1",
  approved: true,
  capabilities: ["rawTcp", "rawUdp"],
  openRaw: (request) => {
    rawCompanionCalls.push({ action: "open", ...request });
    return { id: `companion-${request.id}` };
  },
  closeRaw: (id, reason) => rawCompanionCalls.push({ action: "close", id, reason }),
};
const rawTcp = allowedSandbox.net.openRawSocket("tcp", "api.example.test", 443);
assert(rawTcp.objectId && rawTcp.handleId && os.objects.get(rawTcp.objectId).metadata.kind === "raw", "raw TCP socket did not expose socket object and handle ids");
assert(os.network.status().rawSockets.sessions.some((entry) => entry.id === rawTcp.id && entry.companion === "networkd"), "raw TCP session did not open through companion boundary");
rawTcp.close("done");
assert(os.objects.get(rawTcp.objectId).status === "revoked", "raw TCP socket object was not revoked on close");
const rawUdp = allowedSandbox.net.openRawSocket("udp", "api.example.test", 53);
rawUdp.close("done");
assert(os.network.status().rawSockets.history.some((entry) => entry.protocol === "udp" && entry.state === "closed"), "raw UDP close was not recorded");
os.companionPermissionStatus = () => ({
  identity: "networkd",
  protocolVersion: "dindbos-networkd-v1",
  approved: false,
  capabilities: ["rawTcp", "rawUdp"],
});
await assertRejects(() => allowedSandbox.net.openRawSocket("tcp", "api.example.test", 443), "requires approved networkd companion");
os.companionPermissionStatus = () => ({
  identity: "networkd",
  protocolVersion: "dindbos-networkd-v1",
  approved: true,
  capabilities: ["rawUdp"],
});
await assertRejects(() => allowedSandbox.net.openRawSocket("tcp", "api.example.test", 443), "requires approved networkd companion");
os.companionPermissionStatus = () => ({
  identity: "networkd",
  protocolVersion: "dindbos-networkd-v1",
  approved: true,
  capabilities: ["rawTcp", "rawUdp"],
});
await assertRejects(() => allowedSandbox.net.openRawSocket("tcp", "blocked.example.test", 443), "host denied");
assert(rawCompanionCalls.some((entry) => entry.action === "open" && entry.protocol === "tcp") && rawCompanionCalls.some((entry) => entry.action === "close"), "raw companion adapter was not called");
const netStatusSyscall = allowedSandbox.syscall("net.status");
assert(netStatusSyscall.ok && netStatusSyscall.value.websocket.history.length > 0 && netStatusSyscall.value.webrtc.history.length > 0 && netStatusSyscall.value.rawSockets.history.length > 0, "net.status syscall did not expose broker status");
const netServicesSyscall = allowedSandbox.syscall("net.services");
assert(netServicesSyscall.ok && netServicesSyscall.value.some((entry) => entry.id === "echo"), "net.services syscall did not expose loopback service");
const netFirewallSyscall = allowedSandbox.syscall("net.firewall");
assert(netFirewallSyscall.ok && netFirewallSyscall.value.allowed > 0 && netFirewallSyscall.value.denied > 0, "net.firewall syscall did not expose allow/deny events");
const netPolicySyscall = allowedSandbox.syscall("net.policy", { url: "https://api.example.test/data" });
assert(netPolicySyscall.ok && netPolicySyscall.value.allowed === true, "net.policy syscall did not allow declared host");
const netDnsSyscall = allowedSandbox.syscall("net.dns", { host: "api.example.test" });
assert(netDnsSyscall.ok && netDnsSyscall.value.addresses.includes("browser-policy-only"), "net.dns syscall did not expose browser DNS policy");

const deniedProcess = processFor("no-network-app", [], { networkHosts: ["api.example.test"] });
const deniedSandbox = new AppSandbox(os, deniedProcess);
await assertRejects(() => deniedSandbox.net.fetch("https://api.example.test/data"), "capability denied");
await assertRejects(() => deniedSandbox.net.openWebSocket("wss://api.example.test/socket"), "capability denied");
await assertRejects(() => deniedSandbox.net.openDataChannel("api.example.test"), "capability denied");
await assertRejects(() => deniedSandbox.net.openRawSocket("tcp", "api.example.test", 443), "capability denied");
assert(deniedSandbox.syscall("net.status").ok === false, "net.status syscall allowed app without network capability");

os.packages.install({
  id: "network-package",
  name: "Network Package",
  version: "0.1.0",
  permissions: { capabilities: ["net.fetch", "net.websocket", "net.webrtc", "net.dns"] },
  sandbox: { networkHosts: ["api.example.test"] },
  app: { id: "network-package", name: "Network Package", title: "Network Package.app", entry: "app.js" },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export async function mount({ content, os, pkg }) {",
        "  const allowed = await os.net.fetch('https://api.example.test/from-package');",
        "  const socket = os.net.openWebSocket('wss://api.example.test/from-package');",
        "  socket.close(1000, 'package-done');",
        "  const channel = os.net.openDataChannel('api.example.test', { label: 'package' });",
        "  channel.close('package-done');",
        "  let denied = 'not-denied';",
        "  try { await os.net.fetch('https://blocked.example.test/from-package'); }",
        "  catch (error) { denied = error.message.includes('host denied') ? 'host-denied' : error.message; }",
        "  content.innerHTML = `<main data-network-package>${pkg.namespace.networkHosts[0]}:${allowed.text}:${socket.host}:${channel.peer}:${denied}</main>`;",
        "}",
      ].join("\n"),
    },
  ],
});
assert(os.packages.info("network-package").namespace.networkHosts[0] === "api.example.test", "package namespace did not expose network host allowlist");
const window = os.apps.launch("network-package");
await window.rendered;
assert(window.content.innerHTML.includes("api.example.test:ok:api.example.test:/from-package:api.example.test:api.example.test:host-denied"), `network package render mismatch: ${window.content.innerHTML}`);

const controller = new AbortController();
const pending = os.network.fetch("https://api.example.test/slow", { signal: controller.signal }, { appId: "shell", principal: os.permissions.principal(os.session) });
assert(os.network.status().activeRequests.length === 1, "network broker did not expose active request");
const cancelled = assertRejects(() => pending, "request cancelled");
controller.abort();
await cancelled;
assert(os.network.status().history.some((entry) => entry.status === "cancelled"), "network broker did not record cancelled request");
if (slowReject) slowReject(new Error("cleanup"));

const netStatus = JSON.parse(os.fs.readFile("/proc/net/status.json"));
assert(netStatus.deniedHosts.some((entry) => entry.host === "blocked.example.test"), "/proc/net status missing denied host");
assert(JSON.parse(os.fs.readFile("/proc/net/services.json")).some((entry) => entry.id === "echo" && entry.requests >= 1), "/proc/net services missing loopback service");
assert(JSON.parse(os.fs.readFile("/proc/net/firewall.json")).events.some((entry) => entry.action === "deny" && entry.host === "blocked.example.test"), "/proc/net firewall missing denied host event");
assert(JSON.parse(os.fs.readFile("/proc/sockets.json")).some((entry) => entry.host === "api.example.test"), "/proc/sockets missing broker socket table");
assert(netStatus.websocket.history.some((entry) => entry.host === "api.example.test" && entry.state === "closed"), "/proc/net status missing WebSocket history");
assert(netStatus.webrtc.history.some((entry) => entry.peer === "api.example.test" && entry.state === "closed"), "/proc/net status missing WebRTC data channel history");
assert(netStatus.rawSockets.history.some((entry) => entry.host === "api.example.test" && entry.state === "closed"), "/proc/net status missing raw socket companion history");
assert(netStatus.companion.approved === true && netStatus.companion.rawTcpUdp === "companion-gated", "/proc/net status missing approved raw socket companion");
assert(netStatus.totals.bytesReceived > 0, "/proc/net status missing bandwidth estimate");
assert(fetchCalls.some((call) => call.url.includes("api.example.test")), "network fetch adapter was not called for allowed host");

console.log("network smoke ok broker fetch websocket webrtc raw policy procfs syscalls shell package cancellation");

function processFor(appId, capabilities, namespace = {}) {
  return {
    pid: Math.floor(Math.random() * 10000) + 100,
    appId,
    user: "guest",
    cwd: "/home/guest",
    manifest: {
      capabilities,
      namespace,
      fileSystem: { read: ["/home/guest"], write: ["/home/guest"] },
    },
  };
}

async function assertRejects(action, expected) {
  try {
    await action();
  } catch (error) {
    if (String(error.message || "").includes(expected)) return;
    throw new Error(`expected rejection containing ${expected}, got ${error.message}`);
  }
  throw new Error(`expected rejection containing ${expected}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
