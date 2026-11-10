import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const source = `
import {createAndBootDindbOS} from '/src/sdk/index.js';
import '/src/styles/index.css';
import '/src/styles/productivity.css';
window.__ready = createAndBootDindbOS({ui:{style:'macos'},root:document.getElementById('desktop'),storage:{backend:'memory',name:'productivity-ui'},bootstrapPackages:false,builtins:{include:['notes','reminders','calendar']}}).then(os=>window.__os=os);`;
const server = await createServer({ configFile: false, logLevel: "error", optimizeDeps: { entries: [] }, plugins: [{ name: "productivity-fixture", resolveId(id) { if (id === "/productivity-fixture.js") return "\0productivity-fixture"; }, load(id) { if (id === "\0productivity-fixture") return source; }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (req.url?.split("?")[0] !== "/productivity-fixture") return next(); res.setHeader("Content-Type", "text/html"); try { res.end(await vite.transformIndexHtml(req.url, '<!doctype html><body style="margin:0"><div id="desktop" style="height:100vh"></div><script type="module" src="/productivity-fixture.js"></script>')); } catch (error) { next(error); } }); } }], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
const output = process.env.DINDBOS_QA_OUTPUT || "internal/docs/qa/productivity";
let browser;
try {
  await server.listen(); await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/productivity-fixture`); await page.evaluate(() => window.__ready);
  await page.evaluate(() => window.__os.launch("notes"));
  let notes = page.locator('.dos-window[data-app-id="notes"]');
  await notes.getByRole("button", { name: "New Note", exact: true }).click();
  await notes.getByLabel("Note title", { exact: true }).fill("Research notes");
  await notes.getByLabel("Note text", { exact: true }).fill("First idea\n두 번째 생각 & details");
  await notes.getByLabel("Search notes", { exact: true }).fill("두 번째");
  await expect(notes.locator("[data-note-id]")).toHaveCount(1);
  await page.screenshot({ path: `${output}/notes-light.png` });
  await notes.getByRole("button", { name: "Close", exact: true }).click();
  await expect(notes).toHaveCount(0);
  await page.evaluate(() => window.__os.launch("notes"));
  notes = page.locator('.dos-window[data-app-id="notes"]');
  await expect(notes.getByLabel("Note text", { exact: true })).toHaveValue("First idea\n두 번째 생각 & details");
  await notes.getByRole("button", { name: "Delete note", exact: true }).click();
  await notes.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(notes.getByLabel("Note title", { exact: true })).toHaveValue("Research notes");
  await page.evaluate(() => { window.__originalSyscall = window.__os.syscallAsync; window.__os.syscallAsync = function(name, ...args) { if (name === "storage.sync") return Promise.reject(new Error("Simulated save failure")); return window.__originalSyscall.call(this, name, ...args); }; });
  await notes.getByLabel("Note text", { exact: true }).fill("Retain this draft through a failed save");
  await notes.getByRole("button", { name: "Close", exact: true }).click();
  await expect(notes).toBeVisible();
  await expect(notes.getByRole("alert")).toContainText("Simulated save failure");
  await expect(notes.getByLabel("Note text", { exact: true })).toHaveValue("Retain this draft through a failed save");
  await page.evaluate(() => { window.__os.syscallAsync = window.__originalSyscall; });
  await notes.getByRole("button", { name: "Close", exact: true }).click();
  await expect(notes).toHaveCount(0);
  await page.evaluate(() => window.__os.launch("notes"));
  await expect(notes.getByLabel("Note text", { exact: true })).toHaveValue("Retain this draft through a failed save");

  await page.evaluate(() => window.__os.launch("reminders"));
  const reminders = page.locator('.dos-window[data-app-id="reminders"]');
  await reminders.getByLabel("New reminder", { exact: true }).fill("Ship the desktop");
  await reminders.getByRole("button", { name: "Add reminder", exact: true }).click();
  await reminders.getByRole("checkbox", { name: "Complete Ship the desktop", exact: true }).click();
  await reminders.locator('[data-reminder-filter="completed"]').click();
  await expect(reminders.getByText("Ship the desktop", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/reminders-light.png` });
  await reminders.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => window.__os.launch("reminders"));
  await reminders.locator('[data-reminder-filter="completed"]').click();
  await expect(reminders.getByRole("checkbox", { name: "Complete Ship the desktop", exact: true })).toBeChecked();

  await page.evaluate(() => window.__os.launch("calendar"));
  const calendar = page.locator('.dos-window[data-app-id="calendar"]');
  const initialMonth = await calendar.locator(".calendar-toolbar h1").textContent();
  await calendar.getByRole("button", { name: "Next month", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(calendar.getByRole("button", { name: "Next month", exact: true })).toBeFocused();
  const nextMonth = await calendar.locator(".calendar-toolbar h1").textContent();
  assert.notEqual(nextMonth, initialMonth);
  await page.keyboard.press("Enter");
  await expect(calendar.getByRole("button", { name: "Next month", exact: true })).toBeFocused();
  assert.notEqual(await calendar.locator(".calendar-toolbar h1").textContent(), nextMonth, "a second Enter advances again without refocusing");
  await calendar.getByRole("button", { name: "Today", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(calendar.getByRole("button", { name: "Today", exact: true })).toBeFocused();
  await expect(calendar.locator(".calendar-toolbar h1")).toHaveText(initialMonth);
  const chosenDay = calendar.locator("[data-calendar-day][aria-pressed='true']");
  await chosenDay.focus(); await page.keyboard.press("Enter");
  await expect(calendar.locator("[data-calendar-day][aria-pressed='true']")).toBeFocused();
  await calendar.locator("[data-mini-day][aria-pressed='true']").focus();
  await page.keyboard.press("Enter");
  await expect(calendar.locator("[data-mini-day][aria-pressed='true']")).toBeFocused();
  await calendar.locator("[data-calendar-visible]").focus();
  await page.keyboard.press("Space");
  await expect(calendar.locator("[data-calendar-visible]")).toBeFocused();
  await expect(calendar.locator("[data-calendar-visible]")).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(calendar.locator("[data-calendar-visible]")).toBeFocused();
  await expect(calendar.locator("[data-calendar-visible]")).toBeChecked();
  await calendar.getByRole("button", { name: "New event", exact: true }).click();
  await calendar.getByLabel("Event title", { exact: true }).fill("Design review");
  await calendar.getByLabel("Event time", { exact: true }).fill("14:30");
  await calendar.getByRole("button", { name: "Add Event", exact: true }).click();
  await expect(calendar.getByText("Design review", { exact: true })).toBeVisible();
  await expect(calendar.getByText("14:30", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/calendar-light.png` });
  await calendar.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => window.__os.launch("calendar"));
  await expect(calendar.getByText("Design review", { exact: true })).toBeVisible();
  await calendar.getByRole("button", { name: "Delete Design review", exact: true }).click();
  await calendar.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(calendar.getByText("Design review", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__os.setAppearance({ mode: "dark" }));
  for (const id of ["notes", "reminders", "calendar"]) {
    await page.evaluate((appId) => window.__os.windows.focusLatestAppWindow(appId), id);
    const app = page.locator(`.dos-window[data-app-id="${id}"] .productivity-app`);
    await expect.poll(() => app.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if (id === "calendar") await expect.poll(() => app.locator('.calendar-main').evaluate((element) => element.clientWidth)).toBeGreaterThan(300);
    if (id === "notes") await expect.poll(() => app.locator('.note-editor').evaluate((element) => element.clientWidth)).toBeGreaterThan(170);
    if (id === "reminders") await expect.poll(() => app.locator('.reminder-main').evaluate((element) => element.clientWidth)).toBeGreaterThan(300);
    if (id === "reminders") {
      await app.locator('[data-reminder-filter="all"]').click();
      const bounds = await page.locator('.dos-window[data-app-id="reminders"]').boundingBox();
      for (const control of [app.getByLabel("Due date", { exact: true }), app.getByRole("button", { name: "Add reminder", exact: true })]) {
        const box = await control.boundingBox();
        assert(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width, 'reminder date and Add stay within narrow window');
      }
      await app.getByLabel("New reminder", { exact: true }).fill("Created at 390px");
      await app.getByRole("button", { name: "Add reminder", exact: true }).click();
      await expect(app.getByText("Created at 390px", { exact: true })).toBeVisible();
    }
    await page.screenshot({ path: `${output}/${id}-390-dark.png` });
  }
  await page.evaluate(() => window.__os.windows.focusLatestAppWindow("notes"));
  await notes.getByRole("button", { name: "Delete note", exact: true }).click();
  await notes.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  for (const mode of ["light", "dark"]) {
    await page.evaluate((appearance) => window.__os.setAppearance({ mode: appearance }), mode);
    const bounds = await notes.boundingBox();
    for (const element of [notes.getByRole("heading", { name: "Your notes, in one place", exact: true }), notes.getByText("Capture an idea or keep something for later.", { exact: true })]) {
      await expect(element).toBeVisible();
      const box = await element.boundingBox();
      assert(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width, 'empty Notes heading and description fit narrow window');
      assert(await element.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), 'empty Notes text wraps instead of clipping');
    }
    await notes.getByRole("button", { name: "New Note", exact: true }).focus();
    await page.screenshot({ path: `${output}/notes-empty-390-${mode}.png` });
  }
  await page.evaluate(() => window.__os.destroy());
  assert.deepEqual(errors, []);
  console.log("productivity browser smoke ok notes/search/reopen, reminders completion, calendar events, narrow dark and teardown");
} finally { await browser?.close(); await server.close(); }
