import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';

// Mirrors Pi's unbundled Node loader: new Jiti per load, moduleCache:false.
async function upgrade(suffix, fsCache) {
  const dir = mkdtempSync(join(tmpdir(), 'phone-reload-'));
  try {
    const entry = join(dir, 'index.ts');
    const client = join(dir, `client.${suffix}`);
    writeFileSync(client, 'export class PhoneClient { status() { return "old"; } }');
    writeFileSync(entry, `import {PhoneClient} from './client.${suffix}'; export default () => ({marker:'before', client:new PhoneClient()});`);
    const load = async () => (await createJiti(import.meta.url, { moduleCache: false,
      ...(fsCache === undefined ? {} : { fsCache }) }).import(entry, { default: true }))();
    const before = await load();
    assert.equal(before.marker, 'before');
    assert.equal(before.client.detection, undefined);
    writeFileSync(client, 'export class PhoneClient { status() { return "updated"; } detection() { return "available"; } }');
    writeFileSync(entry, `import {PhoneClient} from './client.${suffix}'; export default () => ({marker:'after', client:new PhoneClient()});`);
    return await load();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('native mjs negative control reproduces refreshed entry with stale dependency', async () => {
  const after = await upgrade('mjs', false);
  assert.equal(after.marker, 'after');
  assert.equal(after.client.status(), 'old');
  assert.equal(after.client.detection, undefined);
});

for (const fsCache of [undefined, false]) {
  test(`real entry dependency refreshes in the same process (fsCache=${fsCache ?? 'default'})`, async () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const suffix = source.match(/from ["']\.\/client\.(\w+)["']/)?.[1];
    assert.ok(suffix, 'entry must import its relative client');
    const after = await upgrade(suffix, fsCache);
    assert.equal(after.marker, 'after');
    assert.equal(after.client.status(), 'updated');
    assert.equal(after.client.detection(), 'available');
  });
}
