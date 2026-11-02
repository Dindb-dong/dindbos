#!/usr/bin/env node
import { chromium } from "playwright";
import { createServer } from "vite";

const host = "127.0.0.1";
const port = Number(process.env.DINDBOS_IFRAME_SMOKE_PORT || 0);
const launchArgs = [
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-gpu",
  "--disable-sync",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-first-run",
];

const server = await createServer({
  logLevel: "error",
  server: { host, port, strictPort: Boolean(port) },
});

await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === "string") throw new Error("iframe container smoke: Vite server did not expose a TCP port");
const baseUrl = `http://${host}:${address.port}/`;
let browser = null;

try {
  browser = await chromium.launch({ headless: true, args: launchArgs, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage();
  const result = await runIframeContainerSmoke(page, baseUrl);
  assert(result.heartbeatStatus === "mounted", `heartbeat status mismatch: ${JSON.stringify(result)}`);
  assert(result.heartbeatHealth === "healthy", `heartbeat health mismatch: ${JSON.stringify(result)}`);
  assert(result.heartbeatAt, `heartbeat timestamp missing: ${JSON.stringify(result)}`);
  assert(result.crashState === "crashed", `crash process state mismatch: ${JSON.stringify(result)}`);
  assert(result.crashStatus === "crashed", `crash container status mismatch: ${JSON.stringify(result)}`);
  assert(result.crashCode === "ECONTAINER", `crash code mismatch: ${JSON.stringify(result)}`);
  assert(result.auditHasHeartbeat, "audit log missing heartbeat event");
  assert(result.auditHasSyscall, "audit log missing iframe syscall trace");
  assert(result.auditHasSdkClock, "audit log missing SDK clock syscall trace");
  assert(result.auditHasSdkPackageInfo, "audit log missing SDK package info syscall trace");
  assert(result.auditHasSdkProcessCurrent, "audit log missing SDK process current syscall trace");
  assert(result.auditHasSdkStorageStatus, "audit log missing SDK storage status syscall trace");
  assert(result.auditHasCrash, "audit log missing crash event");
  assert(result.crashPanel, "container crash panel did not render");
  assert(result.sandbox === "allow-scripts", `iframe sandbox policy mismatch: ${result.sandbox}`);
  console.log(`iframe container smoke ok ${JSON.stringify(result)}`);
} finally {
  await browser?.close();
  await server.close();
}

async function runIframeContainerSmoke(page, baseUrl) {
  await page.goto(withParams(baseUrl, { qa: "iframe-container-smoke" }), { waitUntil: "domcontentloaded" });
  return page.evaluate(async () => {
    document.body.innerHTML = "<div id=\"root\"></div>";
    const cache = `iframe-container-smoke-${Date.now()}`;
    const [{ DindbOS }, { demoFileSystem }] = await Promise.all([
      import(`/src/dindbos/index.js?v=${cache}`),
      import(`/src/demo/portfolio-demo.js?v=${cache}`),
    ]);
    const os = new DindbOS({
      root: "#root",
      fileSystem: demoFileSystem,
      session: { user: "guest", groups: ["users"], product: "DindbOS.js" },
      sessionChannelName: `iframe-container-smoke-${Date.now()}`,
    });
    await os.runBootPhase("package-registry-load", () => os.packages.bootstrap());
    os.boot();

    const installIframePackage = (id, source, extraFiles = []) => os.packages.install({
      id,
      name: id,
      version: "0.1.0",
      description: "Focused iframe container smoke package.",
      app: { id, name: id, title: `${id}.app`, icon: "app", width: 520, height: 320, entry: "app.js", runtime: "javascript" },
      sandbox: { containerMode: "iframe" },
      permissions: { capabilities: ["package.read", "storage.read"], fileSystem: { read: [`/opt/${id}`], write: [] } },
      files: [{ path: "app.js", mime: "text/javascript", content: source }, ...extraFiles],
    });
    const waitFor = async (predicate, label, timeout = 12000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(label);
    };

    installIframePackage("iframe-heartbeat", [
      "export async function mount({ content, os, sdk }) {",
      "  const raw = await os.syscall('fs.readText', { path: '/opt/iframe-heartbeat/data.txt' });",
      "  const text = await sdk.fs.readText('/opt/iframe-heartbeat/data.txt');",
      "  const exists = await sdk.fs.exists('/opt/iframe-heartbeat/data.txt');",
      "  const stat = await sdk.fs.stat('/opt/iframe-heartbeat/data.txt');",
      "  const now = await sdk.clock.now();",
      "  const envUser = await sdk.env.get('USER');",
      "  const pkg = await sdk.packages.info('iframe-heartbeat');",
      "  const current = await sdk.processes.current();",
      "  const storage = await sdk.storage.status();",
      "  content.innerHTML = `<main data-iframe-heartbeat>${raw.value}:${text}:${exists}:${stat.mime}:${Boolean(now.iso)}:${envUser}:${pkg.id}:${current.appId}:${storage.backend || 'memory'}</main>`;",
      "}",
    ].join("\n"), [{ path: "data.txt", mime: "text/plain", content: "heartbeat-ok" }]);
    os.launch("iframe-heartbeat");
    const heartbeatProcess = await waitFor(
      () => os.processes.list().find((process) => process.appId === "iframe-heartbeat"),
      "heartbeat process missing",
    );
    await waitFor(() => {
      const container = JSON.parse(os.fs.readFile(`/proc/${heartbeatProcess.pid}/container.json`));
      return container.status === "mounted" && container.health === "healthy" && container.lastHeartbeatAt;
    }, "heartbeat container state was not written");
    const healthyContainer = JSON.parse(os.fs.readFile(`/proc/${heartbeatProcess.pid}/container.json`));
    const sandbox = document.querySelector("iframe[data-package-container='sandboxed-iframe']")?.getAttribute("sandbox") || "";

    installIframePackage("iframe-crash", [
      "export function mount() {",
      "  throw new Error('iframe deliberate crash');",
      "}",
    ].join("\n"));
    os.launch("iframe-crash");
    const crashProcess = await waitFor(
      () => os.processes.list().find((process) => process.appId === "iframe-crash"),
      "crash process missing",
    );
    await waitFor(() => os.processes.get(crashProcess.pid)?.state === "crashed", "crash process state did not update");
    const crashedContainer = JSON.parse(os.fs.readFile(`/proc/${crashProcess.pid}/container.json`));
    const audit = os.fs.readFile("/var/log/dindbos/package-container.log");

    return {
      heartbeatPid: heartbeatProcess.pid,
      heartbeatStatus: healthyContainer.status,
      heartbeatHealth: healthyContainer.health,
      heartbeatAt: healthyContainer.lastHeartbeatAt,
      crashPid: crashProcess.pid,
      crashState: os.processes.get(crashProcess.pid).state,
      crashStatus: crashedContainer.status,
      crashCode: crashedContainer.lastError?.code || "",
      auditHasHeartbeat: audit.includes("\"type\":\"heartbeat\""),
      auditHasSyscall: audit.includes("\"syscall\":\"fs.readText\""),
      auditHasSdkClock: audit.includes("\"syscall\":\"clock.now\""),
      auditHasSdkPackageInfo: audit.includes("\"syscall\":\"package.info\""),
      auditHasSdkProcessCurrent: audit.includes("\"syscall\":\"process.get\""),
      auditHasSdkStorageStatus: audit.includes("\"syscall\":\"storage.status\""),
      auditHasCrash: audit.includes("\"type\":\"crash\""),
      crashPanel: Boolean(document.querySelector("[data-package-container-crash]")),
      sandbox,
    };
  });
}

function withParams(rawUrl, params) {
  const url = new URL(rawUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
