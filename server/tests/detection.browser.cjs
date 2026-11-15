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
    let mode = 'boxes', release, delayed, detectionCalls = 0;
    const image = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
      return canvas.toDataURL('image/jpeg').split(',')[1];
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://detect.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/detection') {
        detectionCalls++;
        if (mode === 'delay') { delayed = true; await new Promise(resolve => { release = resolve; }); }
        if (mode === 'error') return route.fulfill({ status: 503, json: { detail: 'Model missing' } });
        if (mode === 'gone') return route.fulfill({ status: 404, json: { detail: 'No live screen' } });
        return route.fulfill({ json: { image, width: 200, height: 100,
          elapsed_ms: 20, ocr: { enabled: true, error: mode === 'ocr-error' ? 'OCR unavailable' : null, skipped: 0,
            regions: mode === 'empty' ? [] : [
              { class_name: 'map_entry', lines: [{ text: '长安城 123,456', confidence: .92 }] },
              { class_name: 'quest_panel', lines: [{ text: '<img src=x onerror=alert(1)>任务', confidence: .85 }] },
              { class_name: 'dialog_option', source_xyxy: [10, 60, 180, 80], lines: [{ text: '第二个选项', confidence: .9 }] },
              { class_name: 'dialog_option', source_xyxy: [10, 10, 180, 30], lines: [{ text: '<b>第一个选项</b>', confidence: .8 }] }
            ] }, boxes: mode === 'empty' ? [] : [
            { class_id: 38, class_name: 'front', confidence: .9, xyxy: [20, 10, 80, 80] },
            { class_id: 3, class_name: 'back', confidence: .8, xyxy: [100, 20, 180, 90] },
            { class_id: 0, class_name: 'achievement_button', confidence: .7, xyxy: [5, 5, 15, 15] },
            { class_id: 148, class_name: 'new_label', confidence: .6, xyxy: [30, 5, 40, 15] }] } });
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
    await page.waitForFunction(() => document.querySelectorAll('#detection-overlay rect').length === 4);
    assert.match(await page.locator('#detection-overlay').textContent(), /Front 90%.*Back 80%/);
    assert.equal(await page.locator('#detection-overlay rect').first().getAttribute('stroke'), '#22c55e');
    assert.equal(await page.locator('#detection-overlay rect').nth(1).getAttribute('stroke'), '#f59e0b');
    await page.waitForFunction(() => document.getElementById('ocr-map').textContent.includes('长安城'));
    assert.match(await page.locator('#ocr-map').textContent(), /长安城 123,456.*92%/);
    assert.match(await page.locator('#ocr-quest').textContent(), /<img src=x onerror=alert\(1\)>任务/);
    assert.equal(await page.locator('#ocr-quest img').count(), 0);
    assert.match(await page.locator('#ocr-dialog').textContent(), /第一个选项.*第二个选项/);
    assert.equal(await page.locator('#ocr-dialog b').count(), 0);
    await page.locator('[data-lang="zh"]').click();
    await page.waitForFunction(() => document.getElementById('detection-overlay').textContent.includes('正面'));
    assert.match(await page.locator('#detection-overlay').textContent(), /成就按钮.*new_label/);
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
    mode = 'ocr-error';
    await page.waitForFunction(() => document.getElementById('ocr-status').textContent.includes('OCR unavailable'));
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#detection-overlay rect').count(), 4);
    mode = 'empty';
    await page.waitForFunction(() => document.querySelectorAll('#detection-overlay rect').length === 0);
    await page.waitForFunction(() => !document.getElementById('ocr-map').textContent.includes('长安城'));
    assert.doesNotMatch(await page.locator('#ocr-dialog').textContent(), /选项/);
    mode = 'error';
    await page.waitForFunction(() => document.getElementById('detection-status').textContent.includes('Model missing'));
    await page.waitForFunction(() => document.getElementById('live').naturalWidth === 200);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#detection-overlay').isVisible(), false);
    const callsAfterError = detectionCalls;
    await page.waitForTimeout(700);
    assert.equal(detectionCalls, callsAfterError);
    assert.match(await page.locator('#detection-status').textContent(), /Model missing/);
    mode = 'delay';
    await toggle.click();
    while (!delayed) await page.waitForTimeout(25);
    await toggle.click();
    await page.waitForFunction(() => document.getElementById('live').naturalWidth === 200);
    release();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#detection-overlay').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
