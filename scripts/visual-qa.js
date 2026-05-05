#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.env.DINDBOS_QA_URL || "http://127.0.0.1:5180/";
const outputDir = process.env.DINDBOS_QA_OUTPUT || "/private/tmp";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});

try {
  await captureScenario({
    name: "desktop",
    viewport: { width: 1440, height: 900 },
    url: withParams(baseUrl, { qa: "fresh" }),
    finalPath: `${outputDir}/dindbos-playwright-desktop.png`,
    bootPath: `${outputDir}/dindbos-playwright-boot.png`,
  });
  await captureScenario({
    name: "mobile",
    viewport: { width: 390, height: 844, isMobile: true },
    url: baseUrl,
    finalPath: `${outputDir}/dindbos-playwright-mobile.png`,
  });
} finally {
  await browser.close();
}

async function captureScenario({ name, viewport, url, finalPath, bootPath }) {
  const page = await browser.newPage({ viewport });
  const messages = [];
  const failures = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(error.message));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  if (bootPath) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: bootPath, fullPage: false });
  }
  await page.waitForSelector(".dos-boot-screen", { state: "detached", timeout: 7000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: finalPath, fullPage: false });

  const state = await page.evaluate(() => ({
    boot: Boolean(document.querySelector(".dos-boot-screen")),
    windows: document.querySelectorAll(".dos-window").length,
    tasks: document.querySelectorAll(".dos-task").length,
    icons: document.querySelectorAll(".dos-icon").length,
    dock: document.querySelectorAll(".dos-dock-item").length,
    overlays: document.querySelectorAll("vite-error-overlay").length,
    rootBytes: document.querySelector("#dindbos-root")?.innerHTML.length || 0,
  }));

  console.log(`${name}: ${JSON.stringify(state)} screenshot=${finalPath}`);
  if (bootPath) console.log(`${name}: boot=${bootPath}`);
  if (messages.length) console.log(`${name}: console=${JSON.stringify(messages)}`);
  if (failures.length) throw new Error(`${name}: page errors: ${failures.join(" | ")}`);
  if (state.overlays) throw new Error(`${name}: Vite error overlay rendered`);
  if (!state.rootBytes) throw new Error(`${name}: DindbOS root did not render`);
  await page.close();
}

function withParams(rawUrl, params) {
  const url = new URL(rawUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}
