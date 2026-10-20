// Run in a development container with the Pi package installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent';

test('repository package exposes only the iPhone extension entry point', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const agentDir = mkdtempSync(join(tmpdir(), 'phone-package-'));
  try {
    const manager = new DefaultPackageManager({
      cwd: root, agentDir, settingsManager: SettingsManager.inMemory(),
    });
    const resources = await manager.resolveExtensionSources([root], { temporary: true });
    assert.deepEqual(resources.extensions.map(item => item.path), [join(root, 'pi-extension/index.ts')]);
    assert.equal(resources.extensions[0].enabled, true);
    assert.deepEqual(resources.skills, []);
    assert.deepEqual(resources.prompts, []);
    assert.deepEqual(resources.themes, []);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
});
