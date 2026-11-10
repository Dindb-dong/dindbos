import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const base = process.env.DINDBOS_QA_URL || 'http://127.0.0.1:5186/';
  const root = page.locator('#dindbos-root .dindbos-host');
  for (const [device, desktop, mobile] of [['macos', 'windows', 'android'], ['windows', 'macos', 'ios'], ['ios', 'windows', 'android'], ['android', 'macos', 'ios'], ['other', 'macos', 'macos']]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    const url = new URL(base);
    url.searchParams.set('device', device);
    await page.goto(url.href);
    await expect(root).toHaveAttribute('data-ui-style', desktop);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(root).toHaveAttribute('data-ui-style', mobile);
    if (['ios', 'android'].includes(device)) {
      await page.setViewportSize({ width: 740, height: 390 });
      await expect(root).toHaveAttribute('data-ui-style', desktop);
    }
    console.log(`${device}: query identity, compact and rotation passed`);
  }
  await page.goto(new URL('?device=ios&style=macos', base).href);
  await expect(root).toHaveAttribute('data-ui-style', 'macos');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base);
  await expect(root).toHaveAttribute('data-ui-style', /^(macos|windows|ios|android)$/);
  const detected = await root.getAttribute('data-ui-style');
  await page.goto(new URL('?device=invalid', base).href);
  await expect(root).toHaveAttribute('data-ui-style', detected);
  console.log('explicit style precedence and invalid query fallback passed');
} finally { await browser.close(); }
