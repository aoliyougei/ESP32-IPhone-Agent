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
  let expectedPrompt: string | undefined;
  let branchReads = 0;
  let expectDetection = false;
  const paths: string[] = [];
  const detection = { image: image.toString('base64'), width: 1920, height: 888,
    boxes: [{ class_id: 77, class_name: 'map_entry', confidence: 0.93, xyxy: [10, 10, 250, 70] }],
    ocr: { enabled: false, regions: [], error: 'OCR offline', skipped: 0, elapsed_ms: 0 }, elapsed_ms: 150 };
  const context = {
    modelRegistry: {
      getAvailable: () => [visual, textOnly],
      find: (provider: string, id: string) => provider === 'custom' && id === 'vision' ? visual : undefined,
      hasConfiguredAuth: () => true,
      streamSimple(model: any, prompt: any, options: any) {
        analyses++;
        assert.equal(model, visual);
        const text = prompt.messages[0].content[0].text;
        assert.ok(text.includes(expectedPrompt || '打开微信'));
        if (expectDetection) {
          assert.ok(text.includes('map_entry'));
          assert.ok(text.includes('OCR offline'));
          assert.equal(text.includes(detection.image), false);
        }
        if (expectedPrompt) assert.equal(text.includes('打开微信'), false);
        assert.ok(prompt.systemPrompt.includes('normalized 0–1'));
        assert.ok(prompt.systemPrompt.includes('Only analyze'));
        assert.deepEqual(prompt.messages[0].content[1], { type: 'image', data: image.toString('base64'), mimeType: 'image/jpeg' });
        assert.ok(options.signal);
        return { result: async () => ({ content: [{ type: 'text', text: '微信位于 x=0.25, y=0.75' }], usage,
          stopReason: responseError ? 'error' : 'stop', errorMessage: 'provider failed' }) };
      },
    },
    sessionManager: { getBranch: () => {
      branchReads++;
      return [{ type: 'message', id: 'user-1', parentId: null, timestamp: new Date().toISOString(),
        message: { role: 'user', content: '打开微信', timestamp: 1 } }];
    } },
  };
  function load() {
    const tools = new Map<string, any>();
    let command: any, start: any;
    extension({ registerTool(tool: any) { tools.set(tool.name, tool); },
      registerCommand(_name: string, c: any) { command = c; },
      on(_event: string, handler: any) { start = handler; } } as any);
    start({}, { cwd: dir });
    return { screenshot: (params: any = {}) => tools.get('phone_screenshot').execute('test', params, undefined, undefined, context),
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
    globalThis.fetch = async url => {
      requests++;
      const path = new URL(String(url)).pathname;
      paths.push(path);
      return path === '/api/detection' ? Response.json(detection)
        : new Response(image, { headers: { 'content-type': 'image/jpeg' } });
    };
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
    await app.screenshot({ analysis: 'context' });
    const pathsBeforeDetection = paths.length;
    const detectionOnly = await app.screenshot({ source: 'detection', analysis: 'none' });
    assert.deepEqual(paths.slice(pathsBeforeDetection), ['/api/detection']);
    assert.ok(detectionOnly.content[0].text.includes('map_entry'));
    assert.equal(detectionOnly.details.detection.boxes[0].center.x, 130 / 1920);
    assert.equal(detectionOnly.content[1].data, image.toString('base64'));
    expectDetection = true;
    expectedPrompt = '结合检测定位';
    await app.screenshot({ source: 'detection', prompt: expectedPrompt });
    expectedPrompt = undefined;
    expectDetection = false;
    assert.equal(paths.some(path => path === '/api/tap'), false);
    const reads = branchReads;
    expectedPrompt = '找到开始按钮';
    await app.screenshot({ analysis: 'prompt', prompt: expectedPrompt });
    await app.screenshot({ prompt: expectedPrompt });
    assert.equal(branchReads, reads);
    expectedPrompt = undefined;
    const callsBeforeNone = analyses;
    const screenshotOnly = await app.screenshot({ analysis: 'none' });
    assert.equal(analyses, callsBeforeNone);
    assert.equal(branchReads, reads);
    assert.equal(screenshotOnly.content[1].data, image.toString('base64'));
    const requestsBeforeInvalid = requests;
    for (const params of [{ analysis: 'prompt' }, { prompt: '' }, { prompt: '   ' },
      { analysis: 'none', prompt: 'target' }, { analysis: 'context', prompt: 'target' },
      { analysis: 'invalid' }, { prompt: 123 }, { source: 'invalid' }]) {
      await assert.rejects(app.screenshot(params));
    }
    assert.equal(requests, requestsBeforeInvalid);
    responseError = true;
    await assert.rejects(app.screenshot(), /provider failed/);
    responseError = false;
    context.modelRegistry.find = () => undefined;
    await assert.rejects(app.screenshot(), /unavailable/i);
    await app.screenshot({ analysis: 'none' });
    context.modelRegistry.find = () => visual;
    await app.menu('不使用额外模型');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).analysisModel, undefined);
    const before = analyses;
    await app.screenshot();
    assert.equal(analyses, before);
    const missingModelRequests = requests;
    await assert.rejects(app.screenshot({ analysis: 'context' }), /model/i);
    await assert.rejects(app.screenshot({ prompt: '找到开始按钮' }), /model/i);
    assert.equal(requests, missingModelRequests);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
