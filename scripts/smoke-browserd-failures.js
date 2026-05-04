#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { createServer } from "node:net";
import { BrowserCompanionClient } from "../src/dindbos/browser-client.js";

await verifyMissingChrome();
await verifyCdpStartupFailure();
await verifyWebSocketDrop();

console.log("browserd failures smoke ok");

async function verifyMissingChrome() {
  const result = await runBrowserdExpectFailure([
    "--chrome",
    "/tmp/dindbos-missing-chrome-for-smoke",
  ]);
  assert(result.output.includes("Chrome/Chromium was not found"), `missing Chrome output mismatch: ${result.output}`);
}

async function verifyCdpStartupFailure() {
  if (!existsSync("/bin/false")) return;
  const result = await runBrowserdExpectFailure(["--chrome", "/bin/false"]);
  assert(result.output.includes("Chromium exited before CDP was ready"), `CDP startup output mismatch: ${result.output}`);
}

async function verifyWebSocketDrop() {
  const browserPort = await openPort();
  const cdpPort = await openPort();
  const child = spawn(process.execPath, [
    "scripts/browserd.js",
    "--port",
    String(browserPort),
    "--cdp-port",
    String(cdpPort),
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(browserPort, child);
    const client = new BrowserCompanionClient(`ws://127.0.0.1:${browserPort}/browser`);
    await client.connect();
    child.kill("SIGTERM");
    await waitForExit(child, 5000);
    await delay(100);
    await assertRejects(() => client.reload(), "browserd");
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child, 1000);
  }
}

async function runBrowserdExpectFailure(extraArgs) {
  const browserPort = await openPort();
  const cdpPort = await openPort();
  const child = spawn(process.execPath, [
    "scripts/browserd.js",
    "--port",
    String(browserPort),
    "--cdp-port",
    String(cdpPort),
    ...extraArgs,
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  const [code] = await once(child, "exit");
  const output = Buffer.concat(chunks).toString("utf8");
  assert(code !== 0, `browserd unexpectedly exited successfully: ${output}`);
  return { code, output };
}

async function openPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`browserd exited before health with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await delay(125);
  }
  throw new Error("browserd health check timed out");
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return Promise.race([
    once(child, "exit"),
    delay(timeoutMs).then(() => child.kill("SIGKILL")),
  ]);
}

async function assertRejects(action, expectedMessage) {
  try {
    await action();
  } catch (error) {
    if (error.message.includes(expectedMessage)) return;
    throw new Error(`unexpected rejection: ${error.message}`);
  }
  throw new Error(`expected rejection: ${expectedMessage}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
