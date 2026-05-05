#!/usr/bin/env node
import { AppSandbox } from "../src/dindbos/app-sandbox.js";
import { ShellSession } from "../src/dindbos/shell.js";
import { createDindbOSTestRuntime } from "./helpers/dindbos-test-runtime.js";

const fetchCalls = [];
let slowReject = null;
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
});
const shell = new ShellSession(os);

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

const allowedProcess = processFor("network-app", ["net.fetch"], { networkHosts: ["api.example.test"] });
const allowedSandbox = new AppSandbox(os, allowedProcess);
const response = await allowedSandbox.net.fetch("https://api.example.test/data?token=package-secret");
assert(response.text === "ok:api.example.test:/data", "sandbox net.fetch did not return broker response");
assert(!os.fs.readFile("/var/log/dindbos/network.log").includes("package-secret"), "network log exposed package query secret");
await assertRejects(() => allowedSandbox.net.fetch("https://blocked.example.test/data"), "host denied");

const deniedProcess = processFor("no-network-app", [], { networkHosts: ["api.example.test"] });
const deniedSandbox = new AppSandbox(os, deniedProcess);
await assertRejects(() => deniedSandbox.net.fetch("https://api.example.test/data"), "capability denied");

os.packages.install({
  id: "network-package",
  name: "Network Package",
  version: "0.1.0",
  permissions: { capabilities: ["net.fetch"] },
  sandbox: { networkHosts: ["api.example.test"] },
  app: { id: "network-package", name: "Network Package", title: "Network Package.app", entry: "app.js" },
  files: [
    {
      path: "app.js",
      mime: "text/javascript",
      content: [
        "export async function mount({ content, os, pkg }) {",
        "  const allowed = await os.net.fetch('https://api.example.test/from-package');",
        "  let denied = 'not-denied';",
        "  try { await os.net.fetch('https://blocked.example.test/from-package'); }",
        "  catch (error) { denied = error.message.includes('host denied') ? 'host-denied' : error.message; }",
        "  content.innerHTML = `<main data-network-package>${pkg.namespace.networkHosts[0]}:${allowed.text}:${denied}</main>`;",
        "}",
      ].join("\n"),
    },
  ],
});
assert(os.packages.info("network-package").namespace.networkHosts[0] === "api.example.test", "package namespace did not expose network host allowlist");
const window = os.apps.launch("network-package");
await window.rendered;
assert(window.content.innerHTML.includes("api.example.test:ok:api.example.test:/from-package:host-denied"), `network package render mismatch: ${window.content.innerHTML}`);

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
assert(netStatus.totals.bytesReceived > 0, "/proc/net status missing bandwidth estimate");
assert(fetchCalls.some((call) => call.url.includes("api.example.test")), "network fetch adapter was not called for allowed host");

console.log("network smoke ok broker fetch policy procfs shell package cancellation");

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
