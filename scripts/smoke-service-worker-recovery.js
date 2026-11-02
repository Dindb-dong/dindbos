#!/usr/bin/env node
import { chromium } from "playwright";
import { createServer } from "vite";

const host = "127.0.0.1";
const port = Number(process.env.DINDBOS_SW_SMOKE_PORT || 0);
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
if (!address || typeof address === "string") throw new Error("service worker recovery smoke: Vite server did not expose a TCP port");
const baseUrl = `http://${host}:${address.port}/`;
let browser = null;

try {
  browser = await chromium.launch({ headless: true, args: launchArgs, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  const result = await runServiceWorkerRecoverySmoke(context, page, baseUrl);
  assert(result.supported, `service worker unsupported: ${JSON.stringify(result)}`);
  assert(result.registered, `service worker did not register: ${JSON.stringify(result)}`);
  assert(result.controlled, `service worker did not control the page: ${JSON.stringify(result)}`);
  assert(result.protocol === "dindbos-sw-boot.v1", `service worker protocol mismatch: ${JSON.stringify(result)}`);
  assert(result.cachedIndex, `index.html was not cached: ${JSON.stringify(result)}`);
  assert(result.offlineRecovered, `offline recovery navigation failed: ${JSON.stringify(result)}`);
  console.log(`service worker recovery smoke ok ${JSON.stringify(result)}`);
} finally {
  await browser?.close();
  await server.close();
}

async function runServiceWorkerRecoverySmoke(context, page, baseUrl) {
  await page.goto(withParams(baseUrl, { qa: "service-worker-recovery-smoke" }), { waitUntil: "domcontentloaded" });
  const registration = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    const registered = await navigator.serviceWorker.register("/dindbos-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return {
      supported: true,
      registered: Boolean(registered.active || registered.installing || registered.waiting),
      scriptURL: registered.active?.scriptURL || registered.installing?.scriptURL || registered.waiting?.scriptURL || "",
    };
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
  const handshake = await page.evaluate(() => new Promise((resolve) => {
    const controller = navigator.serviceWorker?.controller;
    if (!controller) {
      resolve({ ok: false, protocol: "", cache: "" });
      return;
    }
    const timeout = setTimeout(() => resolve({ ok: false, protocol: "", cache: "" }), 3000);
    navigator.serviceWorker.addEventListener("message", function onMessage(event) {
      if (event.data?.type !== "dindbos:boot:ready") return;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      resolve({
        ok: true,
        protocol: event.data.protocol || "",
        cache: event.data.cache || "",
        closedPageExecution: Boolean(event.data.closedPageExecution),
      });
    });
    controller.postMessage({ type: "dindbos:boot:hello" });
  }));
  const cachedIndex = await page.evaluate(async () => {
    const match = await caches.match("/index.html");
    return Boolean(match && match.ok);
  });
  await context.setOffline(true);
  let offlineRecovered = false;
  let offlineStatus = 0;
  let offlineError = "";
  try {
    const response = await page.goto(withParams(baseUrl, { qa: "offline-recovery", t: String(Date.now()) }), {
      waitUntil: "domcontentloaded",
      timeout: 8000,
    });
    offlineStatus = Number(response?.status() || 0);
    offlineRecovered = offlineStatus > 0 && offlineStatus < 500 && await page.evaluate(() => Boolean(document.querySelector("#dindbos-root")));
  } catch (error) {
    offlineError = error?.message || String(error);
  } finally {
    await context.setOffline(false);
  }
  return {
    ...registration,
    controlled,
    handshake: handshake.ok,
    protocol: handshake.protocol,
    cache: handshake.cache,
    closedPageExecution: Boolean(handshake.closedPageExecution),
    cachedIndex,
    offlineRecovered,
    offlineStatus,
    offlineError,
  };
}

function withParams(url, params) {
  const parsed = new URL(url);
  Object.entries(params).forEach(([key, value]) => parsed.searchParams.set(key, value));
  return parsed.href;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
