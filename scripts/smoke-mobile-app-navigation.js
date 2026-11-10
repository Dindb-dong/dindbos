import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  for (const style of ['ios', 'android']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(new URL(`scripts/fixtures/platform-apps.html?style=${style}&width=390`, process.env.DINDBOS_QA_URL || 'http://127.0.0.1:5186/').href);
    await page.waitForFunction(() => window.platformAppsQA);
    const show = id => page.evaluate(id => window.platformAppsQA.show(id), id);
    await show('notes');
    const notes = page.locator('.dos-window[data-app-id=notes]');
    await expect(notes).toHaveAttribute('data-mobile-pane', 'list');
    const count = await notes.locator('[data-note-id]').count();
    for (const modifier of ['Meta', 'Control']) {
      await notes.getByRole('searchbox', { name: 'Search notes', exact: true }).focus();
      await page.keyboard.press(`${modifier}+n`);
      await expect(notes).toHaveAttribute('data-mobile-pane', 'detail');
      await expect(notes.getByRole('textbox', { name: 'Note title', exact: true })).toBeFocused();
      await notes.getByRole('textbox', { name: 'Note text', exact: true }).fill(`${modifier} draft`);
      await notes.locator('[data-mobile-app-back]').click();
    }
    await expect(notes.locator('[data-note-id]')).toHaveCount(count + 2);
    await notes.locator('[data-note-id=plan]').click();
    if (style === 'android') {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(notes).toBeVisible();
      await expect(notes).toHaveAttribute('data-mobile-pane', 'list');
      await expect(notes.locator('[data-note-id=plan]')).toBeFocused();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(notes).toBeHidden();
      await show('notes');
      await notes.locator('[data-note-id=plan]').click();
    }
    const guarded = await page.evaluate(() => {
      const os = window.platformAppsQA.os;
      const frame = os.root.querySelector('.dos-window[data-app-id=notes]');
      const original = os.windows.hasVisibleTrustedSurface;
      os.windows.hasVisibleTrustedSurface = () => true;
      const untouched = frame.dispatchEvent(new CustomEvent('dindbos:back', { bubbles: true, cancelable: true }));
      os.windows.hasVisibleTrustedSurface = original;
      const nested = document.createElement('div');
      nested.className = 'dindbos-host';
      frame.append(nested);
      const isolated = nested.dispatchEvent(new CustomEvent('dindbos:back', { bubbles: true, cancelable: true }));
      nested.remove();
      return { untouched, isolated, pane: frame.dataset.mobilePane };
    });
    assert.deepEqual(guarded, { untouched: true, isolated: true, pane: 'detail' });
    await page.evaluate(() => {
      const os = window.platformAppsQA.os;
      window.restoreQAFlush = os.flushPersistentFileSystem;
      os.flushPersistentFileSystem = async () => { throw Error('simulated storage failure'); };
    });
    await notes.getByRole('textbox', { name: 'Note text', exact: true }).fill('Unsaved draft survives a failed flush');
    await notes.locator('[data-mobile-app-back]').click();
    await expect(notes.getByRole('alert')).toBeVisible();
    await expect(notes.getByRole('button', { name: 'Retry Save', exact: true })).toBeVisible();
    await expect(notes.getByRole('textbox', { name: 'Note text', exact: true })).toHaveValue('Unsaved draft survives a failed flush');
    await page.evaluate(() => { window.platformAppsQA.os.flushPersistentFileSystem = window.restoreQAFlush; });
    await notes.getByRole('button', { name: 'Retry Save', exact: true }).click();
    await expect(notes.getByRole('alert')).toBeHidden();
    if (style === 'android') {
      await show('settings');
      const settings = page.locator('.dos-window[data-app-id=settings]');
      await expect(settings).toHaveAttribute('data-mobile-pane', 'list');
      await settings.locator('[data-settings-section-button=wallpaper]').click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(settings).toBeVisible();
      await expect(settings.locator('[data-settings-section-button=wallpaper]')).toBeFocused();
    }
    await page.evaluate(() => window.platformAppsQA.os.destroy());
    await page.close();
    console.log(`${style}: keyboard create, save failure/retry, Back and ownership guards passed`);
  }
} finally { await browser.close(); }
