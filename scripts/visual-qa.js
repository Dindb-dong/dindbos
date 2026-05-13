#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const baseUrl = process.env.DINDBOS_QA_URL || "http://127.0.0.1:5180/";
const outputDir = process.env.DINDBOS_QA_OUTPUT || "/private/tmp";
const chromePath = process.env.CHROME_PATH || "";
const disableMotion = process.env.DINDBOS_QA_DISABLE_MOTION !== "0";
const browserLabel = chromePath || chromium.executablePath();
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

mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  ...(chromePath ? { executablePath: chromePath } : {}),
  headless: true,
  args: launchArgs,
});

try {
  console.log(`visual-qa: browser=${browserLabel} disableMotion=${disableMotion}`);
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
  const context = await browser.newContext({
    viewport,
    reducedMotion: disableMotion ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const messages = [];
  const failures = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(error.message));

  try {
    if (disableMotion) await installReducedMotionStyles(page);

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
      rawRuntimeGlobal: Boolean(window.dindbos),
    }));

    console.log(`${name}: ${JSON.stringify(state)} screenshot=${finalPath}`);
    if (bootPath) console.log(`${name}: boot=${bootPath}`);
    if (messages.length) console.log(`${name}: console=${JSON.stringify(messages)}`);
    if (failures.length) throw new Error(`${name}: page errors: ${failures.join(" | ")}`);
    if (state.overlays) throw new Error(`${name}: Vite error overlay rendered`);
    if (!state.rootBytes) throw new Error(`${name}: DindbOS root did not render`);
    if (state.rawRuntimeGlobal) throw new Error(`${name}: raw DindbOS runtime leaked on window`);
  } finally {
    await context.close();
  }
}

function withParams(rawUrl, params) {
  const url = new URL(rawUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function installReducedMotionStyles(page) {
  await page.addInitScript(() => {
    const css = `
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-delay: 0ms !important;
        transition-duration: 1ms !important;
        transition-delay: 0ms !important;
        scroll-behavior: auto !important;
      }
    `;
    const install = () => {
      const style = document.createElement("style");
      style.setAttribute("data-dindbos-qa", "reduced-motion");
      style.textContent = css;
      document.head?.appendChild(style);
    };
    if (document.head) install();
    else document.addEventListener("DOMContentLoaded", install, { once: true });
  });
}
