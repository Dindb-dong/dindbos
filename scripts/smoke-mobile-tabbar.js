import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const css = ["theme", "mobile-tabbar"].map(name => readFileSync(`src/styles/${name}.css`, "utf8")).join("\n");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 844 } });
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}
.host-nav > button { width: 100%; }</style><div class="dindbos-host" style="container-type:inline-size;width:300px"><nav class="dos-mobile-tabbar host-nav" aria-label="Sections">${["Overview", "Projects", "Media library", "Responsibilities", "Settings"].map((label, i) => `<button type="button" ${i === 0 ? 'aria-current="page"' : ""}>${label}</button>`).join("")}</nav></div><nav class="dos-mobile-tabbar" id="outside"><button>Outside</button></nav>`);
  await page.locator(".dindbos-host button").evaluateAll(buttons => buttons.forEach(button => button.onclick = () => { buttons.forEach(el => el.removeAttribute("aria-current")); button.setAttribute("aria-current", "page"); }));
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav).toHaveCSS("display", "flex");
  assert.equal(await page.locator("#outside").evaluate(el => getComputedStyle(el).backdropFilter), "none", "component must not leak outside a desktop");
  for (const button of await nav.locator("button").all()) {
    await button.scrollIntoViewIfNeeded();
    const bounds = await button.boundingBox();
    assert(bounds.width >= 63.99 && bounds.height >= 51.99, `targets cannot shrink when the menu overflows: ${JSON.stringify(bounds)}`);
    assert(bounds.width < 160, "host sidebar width rules must not stretch each tab across the bar");
    await button.tap();
    await expect(button).toHaveAttribute("aria-current", "page");
  }
  assert(await nav.evaluate(el => el.scrollLeft) > 0, "overflow destinations must remain reachable");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(nav).toHaveCSS("backdrop-filter", "none");
  await expect(nav.locator('[aria-current="page"]')).toHaveCSS("outline-style", "solid");
  await page.emulateMedia({ forcedColors: "none" });
  await nav.locator("button").first().focus();
  await page.keyboard.press("Tab");
  await expect(nav.locator("button").nth(1)).toBeFocused();
  await page.locator(".dindbos-host").evaluate(el => el.style.width = "1000px");
  await expect(nav).not.toHaveCSS("display", "flex");
  console.log("PASS: mobile tab bar touch, overflow, keyboard, accessibility and host scoping");
} finally {
  await browser.close();
}
