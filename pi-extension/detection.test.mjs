import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PhoneClient } from './client.mjs';

const fixture = () => ({
  image: Buffer.from([255, 216, 255, 217]).toString('base64'), width: 1920, height: 888,
  boxes: [{ class_id: 77, class_name: 'map_entry', confidence: 0.93, xyxy: [10, 10, 250, 70] }], elapsed_ms: 150,
  ocr: { enabled: true, regions: [{ class_name: 'map_entry', xyxy: [6, 6, 254, 74],
    lines: [{ text: '长安城 123,456', confidence: 0.95 }], error: null }], error: null, skipped: 0, elapsed_ms: 200 },
});

test('detection validates JSON, decodes one image and supplies normalized box centers without acting', async () => {
  let value = fixture(), status = 200;
  const calls = [];
  const app = http.createServer((req, res) => {
    calls.push([req.method, req.url]);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const client = new PhoneClient(`http://127.0.0.1:${app.address().port}`);
  try {
    const result = await client.detection();
    assert.equal(result.image.toString('hex'), 'ffd8ffd9');
    assert.equal(result.detection.image, undefined);
    assert.deepEqual(result.detection.boxes[0].center, { x: 130 / 1920, y: 40 / 888 });
    assert.equal(result.detection.ocr.regions[0].lines[0].text, '长安城 123,456');
    assert.deepEqual(calls, [['GET', '/api/detection']]);
    value.ocr.error = 'OCR unavailable';
    value.ocr.regions[0].error = 'region failed';
    assert.equal((await client.detection()).detection.ocr.error, 'OCR unavailable');
    value = fixture();
    delete value.ocr;
    assert.equal((await client.detection()).detection.ocr, undefined);
    for (const change of [v => v.width = 0, v => v.height = 1.5,
      v => v.image = 'invalid!', v => v.image = Buffer.from('not jpeg').toString('base64'),
      v => v.boxes[0].xyxy = [250, 10, 10, 70], v => v.boxes[0].xyxy[2] = 1921,
      v => v.boxes[0].confidence = 2, v => v.ocr.regions[0].lines[0].text = 123]) {
      value = fixture(); change(value);
      await assert.rejects(client.detection(), /detection|JPEG/i);
    }
    // Detection has its own JSON budget; ordinary status keeps its small budget.
    value = fixture();
    value.image = Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(300_000), Buffer.from([255, 217])]).toString('base64');
    assert.ok((await client.detection()).image.length > 256 * 1024);
    await assert.rejects(client.status(), /size limit/);
    for (status of [404, 409, 503]) {
      const before = calls.length;
      await assert.rejects(client.detection(), new RegExp(`HTTP ${status}`));
      assert.equal(calls.length, before + 1);
    }
  } finally {
    app.closeAllConnections();
    await new Promise(resolve => app.close(resolve));
  }
});
