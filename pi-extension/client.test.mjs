import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PhoneClient } from './client.mjs';

async function server(run) {
  const requests = [];
  let state = { device: true, screen: true, calibrated: true, agent: { running: false } };
  const app = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body: body && JSON.parse(body) });
    if (req.url === '/api/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state)); }
    else if (req.url === '/api/frame.jpg') { res.setHeader('Content-Type', 'image/jpeg'); res.end(Buffer.from([255, 216, 255, 217])); }
    else if (req.url === '/api/back') { res.statusCode = 302; res.setHeader('Location', '/api/home'); res.end(); }
    else if (req.url === '/api/type') { res.statusCode = 409; res.end('{"detail":"board unavailable"}'); }
    else res.end('{"ok":true}');
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await run(new PhoneClient(`http://127.0.0.1:${app.address().port}`), requests, value => { state = value; }); }
  finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
}

test('returns status and JPEG image bytes', () => server(async client => {
  assert.equal((await client.status()).device, true);
  assert.equal((await client.screenshot()).toString('hex'), 'ffd8ffd9');
}));

test('routes normalized actions and rejects invalid arguments before any request', () => server(async (client, requests) => {
  await client.action({ action: 'tap', x: 0.25, y: 0.75 });
  assert.deepEqual(requests.at(-1), { path: '/api/tap', body: { x: 0.25, y: 0.75 } });
  const count = requests.length;
  for (const args of [{ action: 'tap', x: 500, y: 0 }, { action: 'tap', x: NaN, y: 0 },
    { action: 'swipe', x1: 0, y1: 0, x2: 1 }, { action: 'raw' }, { action: 'type', text: '中文' }]) {
    await assert.rejects(client.action(args));
  }
  assert.equal(requests.length, count);
}));

test('blocks disconnected, uncalibrated or internally controlled phones; stop is always available', () => server(async (client, requests, state) => {
  for (const value of [{ device: false }, { device: true, screen: false },
    { device: true, screen: true, calibrated: false },
    { device: true, screen: true, calibrated: true, agent: { running: true } }]) {
    state(value);
    await assert.rejects(client.action({ action: 'tap', x: 0.5, y: 0.5 }));
  }
  assert.equal(requests.some(r => r.path === '/api/tap'), false);
  await client.action({ action: 'stop' });
  assert.equal(requests.at(-1).path, '/api/agent/stop');
}));

test('does not retry failed actions or follow redirects', () => server(async (client, requests) => {
  await assert.rejects(client.action({ action: 'type', text: 'hello' }), /HTTP 409/);
  assert.equal(requests.filter(r => r.path === '/api/type').length, 1);
  await assert.rejects(client.action({ action: 'back' }));
  assert.equal(requests.some(r => r.path === '/api/home'), false);
}));

test('rejects invalid server URLs', () => {
  for (const url of ['file:///tmp/a', 'http://user:secret@localhost', 'http://localhost/api', 'http://localhost/?token=x']) {
    assert.throws(() => new PhoneClient(url));
  }
});
