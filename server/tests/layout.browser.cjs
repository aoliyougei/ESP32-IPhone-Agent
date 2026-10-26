// Optional browser check: install playwright-core and Chromium in the execution container.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');

test('layout switch, persistence, responsive geometry and letterboxed tap coordinates', async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 2560, height: 911 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://layout.test/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '{}' });
      const filename = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
      const body = await fs.readFile(path.join(__dirname, '../hidagent/static', filename));
      const contentType = filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js')
        ? 'application/javascript' : 'text/html';
      return route.fulfill({ body, contentType });
    });
    await page.goto('http://layout.test');
    const box = (selector) => page.locator(selector).boundingBox();
    assert.ok((await box('.screen')).height > (await box('.screen')).width);
    await page.locator('#layout').click();
    for (const width of [2560, 1440, 1000]) {
      await page.setViewportSize({ width, height: 911 });
      const screen = await box('.screen'), phone = await box('.phone');
      const log = await box('.log'), work = await box('.work');
      assert.ok(screen.width > screen.height);
      assert.ok(log.y >= phone.y + phone.height - 1);
      assert.ok(work.x >= phone.x + phone.width - 1);
      assert.ok(log.height >= 180);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    // The screen content box must match the source, even when manual controls resize it.
    for (const [w, h] of [[2340, 1080], [1920, 1080], [1080, 2340]]) {
      await page.evaluate(([w, h]) => {
        const image = document.getElementById('live');
        Object.defineProperty(image, 'naturalWidth', { value: w, configurable: true });
        Object.defineProperty(image, 'naturalHeight', { value: h, configurable: true });
        image.dispatchEvent(new Event('load'));
      }, [w, h]);
      for (const open of [true, false]) {
        await page.locator('.manual').evaluate((element, open) => { element.open = open; }, open);
        const dimensions = await page.locator('#live').boundingBox();
        assert.ok(Math.abs(dimensions.width / dimensions.height - w / h) < 0.01,
          `source ${w}x${h}, manual=${open}: no artificial letterboxing`);
        const screen = await box('.screen'), phone = await box('.phone');
        assert.ok(screen.x >= phone.x && screen.x + screen.width <= phone.x + phone.width + 1);
      }
    }
    await page.reload();
    assert.equal(await page.locator('#layout').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-lang="zh"]').click();
    assert.equal(await page.locator('#layout').textContent(), '布局：横屏');
    // Existing frac() must still map the center correctly with both frame orientations.
    for (const [w, h] of [[1080, 498], [498, 1080]]) {
      const point = await page.evaluate(([w, h]) => {
        const image = document.getElementById('live');
        Object.defineProperty(image, 'naturalWidth', { value: w, configurable: true });
        Object.defineProperty(image, 'naturalHeight', { value: h, configurable: true });
        image.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
        const r = image.getBoundingClientRect();
        return frac({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
      }, [w, h]);
      assert.ok(Math.abs(point.x - 0.5) < 0.001 && Math.abs(point.y - 0.5) < 0.001);
    }
    await page.setViewportSize({ width: 600, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#layout').click();
    assert.equal(await page.locator('#layout').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
