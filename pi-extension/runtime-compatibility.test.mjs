import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

test('missing method has a compatibility error with cause; HTTP/schema errors are not relabeled', async () => {
  // Fixtures stay under the package so host-provided imports resolve normally.
  const dir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.compat-'));
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Unexpected network call'); };
  try {
    mkdirSync(join(dir, '.pi'));
    writeFileSync(join(dir, '.pi/phone.json'), JSON.stringify({ serverUrl: 'http://mock.example' }));
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const entry = join(dir, 'index.ts');
    writeFileSync(entry, source);
    const load = async body => {
      writeFileSync(join(dir, 'client.ts'), `export class PhoneClient { constructor() { this.origin = 'http://mock.example'; } ${body} }`);
      const factory = await createJiti(import.meta.url, { moduleCache: false, fsCache: false }).import(entry, { default: true });
      let screenshot;
      factory({ on(_event, handler) { handler({}, { cwd: dir }); }, registerCommand() {},
        registerTool(t) { if (t.name === 'phone_screenshot') screenshot = t; } });
      return screenshot;
    };
    const missing = await load('');
    await assert.rejects(missing.execute('test', { source: 'detection', analysis: 'none' }), error => {
      assert.match(error.message, /runtime.*incompatib/i);
      assert.match(error.message, /restart.*RPC/i);
      assert.ok(error.cause instanceof TypeError);
      assert.match(error.cause.message, /detection.*not a function/);
      assert.equal(error.message.includes(dir), false);
      return true;
    });
    for (const message of ['/api/detection: HTTP 503', '/api/detection: Invalid detection response']) {
      const failing = await load(`async detection() { throw new Error(${JSON.stringify(message)}); }`);
      await assert.rejects(failing.execute('test', { source: 'detection', analysis: 'none' }), error => {
        assert.equal(error.message, message);
        assert.equal(error.cause, undefined);
        return true;
      });
    }
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
