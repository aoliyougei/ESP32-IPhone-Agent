// Run in the execution container with Chromium and playwright-core.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');

test('grid follows image bounds and hover coordinates equal tap API coordinates', async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [], taps = [], calibration = [];
    let size = [1080, 2340], axisStep = -1;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://grid.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/frame.jpg') return route.fulfill({ contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}"><rect width="100%" height="100%" fill="blue"/></svg>` });
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/tap') taps.push(route.request().postDataJSON());
        if (url.pathname.startsWith('/api/calibrate/')) {
          const body = route.request().postDataJSON();
          calibration.push({ path: url.pathname, body });
          if (url.pathname.endsWith('/start')) axisStep = body.mode === 'axis' ? 0 : -1;
          else if (axisStep >= 0) axisStep++;
          return route.fulfill({ json: { ok: true, auto: false,
            step: axisStep >= 0 ? ['x150', 'x350', 'y150', 'y350'][axisStep] || null : undefined } });
        }
        return route.fulfill({ json: url.pathname === '/api/status' ? {
          device: true, screen: true, calibrated: true, aspect: size[0] / size[1],
          models: {}, agent: { running: false, steps: [] }
        } : { ok: true } });
      }
      const filename = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
      return route.fulfill({ body: await fs.readFile(path.join(__dirname, '../hidagent/static', filename)),
        contentType: filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('http://grid.test');
    await page.waitForFunction(() => document.getElementById('live').naturalWidth > 0);
    // Keep each fixture stable while checking pointer events; production frames update independently.
    await page.evaluate(() => { showFrame = () => {}; });
    assert.equal(await page.locator('#grid-toggle').count(), 1);
    await page.locator('#grid-toggle').click();
    assert.equal(await page.locator('#grid-toggle').getAttribute('aria-pressed'), 'true');
    for (const [w, h] of [[1080, 2340], [2340, 1080]]) {
      size = [w, h];
      await page.evaluate(([w, h]) => {
        document.getElementById('live').src = 'data:image/svg+xml,' + encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="blue"/></svg>`);
      }, [w, h]);
      await page.waitForFunction(w => document.getElementById('live').naturalWidth === w, w);
      for (const landscape of [false, true]) {
        await page.evaluate(value => document.body.classList.toggle('landscape', value), landscape);
        for (const open of [false, true]) {
          await page.locator('.manual').evaluate((element, value) => { element.open = value; }, open);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const r = await page.locator('#live').boundingBox();
          const width = Math.min(r.width, r.height * w / h), height = width * h / w;
          const left = r.x + (r.width - width) / 2, top = r.y + (r.height - height) / 2;
          const x = left + width * 0.25, y = top + height * 0.75;
          await page.mouse.move(x, y);
          const label = await page.locator('#grid-coordinates').textContent();
          assert.match(label, /X: 0\.250.*Y: 0\.750/, JSON.stringify({ w, h, landscape, open, r, x, y }));
          const overlay = await page.locator('#coordinate-grid').boundingBox();
          assert.ok(Math.abs(overlay.width - width) < 1 && Math.abs(overlay.height - height) < 1);
          const count = taps.length;
          await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/api/tap')),
            page.mouse.click(x, y)
          ]);
          assert.equal(taps.length, count + 1);
          assert.ok(Math.abs(taps.at(-1).x - 0.25) < 0.003 && Math.abs(taps.at(-1).y - 0.75) < 0.003);
          // If the image element contains letterbox margins, they must not send a tap.
          if (left - r.x > 3 || top - r.y > 3) {
            const blank = left - r.x > 3 ? { x: r.x + 1, y } : { x, y: r.y + 1 };
            await page.mouse.move(blank.x, blank.y);
            assert.equal(await page.locator('#grid-crosshair').isVisible(), false);
            const before = taps.length;
            await page.mouse.click(blank.x, blank.y);
            assert.equal(taps.length, before);
          }
        }
      }
    }
    await page.locator('[data-lang="zh"]').click();
    assert.match(await page.locator('#grid-toggle').textContent(), /网格/);
    await page.locator('#grid-toggle').click();
    assert.equal(await page.locator('#coordinate-grid').isVisible(), false);
    await page.locator('.manual').evaluate(element => { element.open = true; });
    await page.locator('#cal-manual').click();
    await page.waitForFunction(() => calibrating);
    assert.deepEqual(calibration.at(-1), { path: '/api/calibrate/start', body: { manual: true, mode: 'default' } });
    const frame = await page.locator('#live').boundingBox();
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/calibrate/finish')),
      page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2)
    ]);
    assert.equal(calibration.at(-1).path, '/api/calibrate/finish');
    assert.ok(Math.abs(calibration.at(-1).body.x - 0.5) < 0.003);
    await page.locator('#cal-axis').click();
    await page.waitForFunction(() => calibrating);
    assert.deepEqual(calibration.at(-1).body, { manual: false, mode: 'axis' });
    for (let i = 0; i < 4; i++) {
      await page.waitForFunction(() => document.getElementById('live').style.pointerEvents !== 'none');
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/api/calibrate/finish')),
        page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2)
      ]);
    }
    await page.waitForFunction(() => !calibrating);
    assert.equal(await page.locator('#cal-cancel').isVisible(), false);
    await page.locator('#cal-axis').click();
    await page.waitForFunction(() => calibrating);
    await page.locator('#cal-cancel').click();
    await page.waitForFunction(() => !calibrating);
    await page.locator('#cal-axis').click();
    await page.waitForFunction(() => calibrating);
    await page.locator('#estop').click();
    await page.waitForFunction(() => !calibrating, null, { timeout: 2000 });
    assert.equal(await page.locator('#cal-cancel').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
