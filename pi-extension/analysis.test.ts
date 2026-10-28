import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from './index.ts';

test('popup model setting persists, preserves Server config, analyzes the same JPEG with context and can be disabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phone-analysis-'));
  const originalFetch = globalThis.fetch;
  const path = join(dir, '.pi', 'phone.json');
  const image = Buffer.from([255, 216, 255, 217]);
  const visual = { provider: 'custom', id: 'vision', input: ['text', 'image'] };
  const textOnly = { provider: 'custom', id: 'text', input: ['text'] };
  const usage = { input: 10, output: 5, totalTokens: 15 };
  let requests = 0, analyses = 0, responseError = false;
  const context = {
    modelRegistry: {
      getAvailable: () => [visual, textOnly],
      find: (provider: string, id: string) => provider === 'custom' && id === 'vision' ? visual : undefined,
      hasConfiguredAuth: () => true,
      streamSimple(model: any, prompt: any, options: any) {
        analyses++;
        assert.equal(model, visual);
        assert.ok(prompt.messages[0].content[0].text.includes('打开微信'));
        assert.deepEqual(prompt.messages[0].content[1], { type: 'image', data: image.toString('base64'), mimeType: 'image/jpeg' });
        assert.ok(options.signal);
        return { result: async () => ({ content: [{ type: 'text', text: '微信位于 x=0.25, y=0.75' }], usage,
          stopReason: responseError ? 'error' : 'stop', errorMessage: 'provider failed' }) };
      },
    },
    sessionManager: { getBranch: () => [{ type: 'message', id: 'user-1', parentId: null, timestamp: new Date().toISOString(),
      message: { role: 'user', content: '打开微信', timestamp: 1 } }] },
  };
  function load() {
    const tools = new Map<string, any>();
    let command: any, start: any;
    extension({ registerTool(tool: any) { tools.set(tool.name, tool); },
      registerCommand(_name: string, c: any) { command = c; },
      on(_event: string, handler: any) { start = handler; } } as any);
    start({}, { cwd: dir });
    return { screenshot: () => tools.get('phone_screenshot').execute('test', {}, undefined, undefined, context),
      menu: async (selection: string | undefined) => {
        const answers = ['截图分析模型', selection];
        await command.handler('', { cwd: dir, hasUI: true, ...context, ui: {
          select: async (_title: string, options: string[]) => {
            assert.equal(options.some(s => s === 'custom/text'), false);
            return answers.shift();
          }, notify() {},
        } });
      } };
  }
  try {
    mkdirSync(join(dir, '.pi'));
    writeFileSync(path, JSON.stringify({ serverUrl: 'http://server.example:8890' }));
    globalThis.fetch = async () => { requests++; return new Response(image, { headers: { 'content-type': 'image/jpeg' } }); };
    const app = load();
    await app.menu(undefined);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).analysisModel, undefined);
    await app.menu('custom/vision');
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
      serverUrl: 'http://server.example:8890', analysisModel: { provider: 'custom', id: 'vision' },
    });
    const result = await load().screenshot();
    assert.equal(requests, 1);
    assert.equal(analyses, 1);
    assert.ok(result.content[0].text.includes('微信位于'));
    assert.equal(result.content[1].data, image.toString('base64'));
    assert.equal(result.usage, usage);
    responseError = true;
    await assert.rejects(app.screenshot(), /provider failed/);
    responseError = false;
    context.modelRegistry.find = () => undefined;
    await assert.rejects(app.screenshot(), /unavailable/i);
    context.modelRegistry.find = () => visual;
    await app.menu('不使用额外模型');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).analysisModel, undefined);
    const before = analyses;
    await app.screenshot();
    assert.equal(analyses, before);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
