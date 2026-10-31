const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');

test('YOLO switches modes, aligns boxes and rejects late results', async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [], taps = [];
    let mode = 'boxes', release, delayed;
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
      return canvas.toDataURL('image/jpeg').split(',')[1];
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://detect.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/detection') {
        if (mode === 'delay') { delayed = true; await new Promise(resolve => { release = resolve; }); }
        if (mode === 'error') return route.fulfill({ status: 503, json: { detail: 'Model missing' } });
        if (mode === 'gone') return route.fulfill({ status: 404, json: { detail: 'No live screen' } });
        return route.fulfill({ json: { image, width: 200, height: 100,
          elapsed_ms: 20, boxes: mode === 'empty' ? [] : [
            { class_id: 0, confidence: .9, xyxy: [20, 10, 80, 80] },
            { class_id: 1, confidence: .8, xyxy: [100, 20, 180, 90] }] } });
      }
      if (url.pathname === '/api/frame.jpg') return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(image, 'base64') });
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/tap') taps.push(route.request().postDataJSON());
        return route.fulfill({ json: url.pathname === '/api/status' ? {
          device: true, screen: true, calibrated: true, aspect: 2, models: {}, agent: { running: false, steps: [] }
        } : { ok: true } });
      }
      const file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
      return route.fulfill({ body: await fs.readFile(path.join(__dirname, '../hidagent/static', file)),
        contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('http://detect.test');
    const toggle = page.locator('#detection-toggle');
    assert.equal(await toggle.count(), 1);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    await toggle.click();
    await page.waitForFunction(() => document.querySelectorAll('#detection-overlay rect').length === 2);
    assert.match(await page.locator('#detection-overlay').textContent(), /Front 90%.*Back 80%/);
    assert.equal(await page.locator('#detection-overlay rect').first().getAttribute('stroke'), '#22c55e');
    assert.equal(await page.locator('#detection-overlay rect').last().getAttribute('stroke'), '#f59e0b');
    await page.locator('[data-lang="zh"]').click();
    await page.waitForFunction(() => document.getElementById('detection-overlay').textContent.includes('正面'));
    await page.locator('#grid-toggle').click();
    for (const landscape of [false, true]) {
      await page.evaluate(value => document.body.classList.toggle('landscape', value), landscape);
      await page.waitForTimeout(100);
      const grid = await page.locator('#coordinate-grid').boundingBox();
      const ov = await page.locator('#detection-overlay').boundingBox();
      assert.ok(Math.abs(grid.x - ov.x) < 1 && Math.abs(grid.width - ov.width) < 1);
    }
    const bounds = await page.locator('#detection-overlay').boundingBox();
    await page.mouse.click(bounds.x + bounds.width * .25, bounds.y + bounds.height * .5);
    await page.waitForTimeout(100);
    assert.ok(taps.some(p => Math.abs(p.x - .25) < .01 && Math.abs(p.y - .5) < .01));
    mode = 'empty';
    await page.waitForFunction(() => document.querySelectorAll('#detection-overlay rect').length === 0);
    mode = 'error';
    await page.waitForFunction(() => document.getElementById('detection-status').textContent.includes('Model missing'));
    assert.equal(await page.locator('#live').getAttribute('src'), null);
    mode = 'gone';
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#live').getAttribute('src'), null);
    mode = 'delay';
    while (!delayed) await page.waitForTimeout(25);
    await toggle.click();
    await page.waitForFunction(() => document.getElementById('live').naturalWidth === 200);
    release();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#detection-overlay').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
