// Run with node --test tests/browser.cjs; requires playwright-core and Chromium.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');

test('cards, left click, context menu, shared CRUD and mobile menu', async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let items = [{ id: 'a', name: '手机 A', host: '10.0.30.51', port: 8890, url: 'http://10.0.30.51:8890' }];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'manager.test') return route.fulfill({ body: 'control page' });
      if (url.pathname.startsWith('/api/servers')) {
        const request = route.request();
        if (request.method() !== 'GET') {
          assert.equal(request.headers()['x-admin-token'], 'test-token');
          if (request.method() === 'DELETE') items = items.filter(item => !url.pathname.endsWith('/' + item.id));
          else {
            const value = request.postDataJSON();
            const item = { ...value, id: request.method() === 'POST' ? 'b' : 'a', url: `http://${value.host}:${value.port}` };
            items = [...items.filter(old => old.id !== item.id), item];
          }
          return route.fulfill({ json: {} });
        }
        if (url.pathname.endsWith('/status')) return route.fulfill({ json: { device: true, screen: false, calibrated: true } });
        return route.fulfill({ json: items });
      }
      if (url.pathname.startsWith('/servers/')) return route.fulfill({ body: '<h1>control page</h1>', contentType: 'text/html' });
      const file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
      return route.fulfill({ body: await fs.readFile(path.join(__dirname, '../manager/static', file)),
        contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('http://manager.test');
    await page.locator('.card').waitFor();
    let phone = await page.locator('.card .phone').boundingBox();
    assert.ok(phone.height > phone.width, 'portrait by default');
    await page.locator('#layout-toggle').click();
    phone = await page.locator('.card .phone').boundingBox();
    assert.ok(phone.width > phone.height, 'landscape thumbnail');
    assert.equal(await page.locator('#layout-toggle').getAttribute('aria-pressed'), 'true');
    await page.reload();
    await page.locator('.card').waitFor();
    assert.equal(await page.locator('#layout-toggle').textContent(), '布局：横向');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#layout-toggle').click();
    phone = await page.locator('.card .phone').boundingBox();
    assert.ok(phone.height > phone.width, 'switch back to portrait');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.phone-link').click();
    await page.frameLocator('#console-frame').locator('h1').waitFor();
    assert.equal(page.url(), 'http://manager.test/#server/a');
    assert.equal(await page.locator('#console-view').isVisible(), true);
    assert.equal(await page.locator('#servers').isVisible(), false);
    const header = await page.locator('.top').boundingBox();
    const back = await page.locator('#return-list').boundingBox();
    const frame = await page.locator('#console-frame').boundingBox();
    assert.ok(back.x + back.width > 1240, 'return button is at the right edge');
    assert.ok(back.y < header.y + header.height, 'return button shares the header row');
    assert.ok(frame.y < 80, 'compact header leaves room for the console');
    assert.ok(frame.y + frame.height <= 900, 'console fits the viewport');
    await page.locator('#return-list').click();
    await page.locator('#servers').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#console-frame').getAttribute('src'), null);
    await page.locator('.phone-link').click();
    await page.locator('#console-view').waitFor({ state: 'visible' });
    await page.frameLocator('#console-frame').locator('h1').waitFor();
    await page.evaluate(() => history.back());
    await page.locator('#servers').waitFor({ state: 'visible' });
    await page.locator('.card').click({ button: 'right' });
    assert.equal(await page.locator('#menu').isVisible(), true);
    assert.deepEqual(await page.locator('#menu button').allTextContents(), ['连接', '编辑', '删除']);
    await page.keyboard.press('Escape');
    await page.locator('#admin').click();
    await page.locator('#token').fill('test-token');
    await page.locator('#token-form button[type=submit]').click();
    await page.locator('#add').click();
    await page.locator('[name=name]').fill('手机 B');
    await page.locator('[name=host]').fill('10.0.30.51');
    await page.locator('[name=port]').fill('8891');
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 2);
    await page.locator('.card').first().click({ button: 'right' });
    await page.locator('[data-action=edit]').click();
    await page.locator('[name=name]').fill('手机 A 修改');
    await page.locator('#save').click();
    await page.waitForFunction(() => document.body.textContent.includes('手机 A 修改'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('.more').first().click();
    assert.equal(await page.locator('#menu').isVisible(), true);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-action=delete]').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
    assert.equal(await page.locator('#servers > :last-child').getAttribute('id'), 'add');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
