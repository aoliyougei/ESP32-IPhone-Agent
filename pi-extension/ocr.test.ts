import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "./index.ts";
import { PhoneClient } from "./client.ts";

const result = { width: 1920, height: 888, xyxy: [192, 177, 960, 311], error: null,
  lines: [{ text: "剩余自动 8 回合", confidence: 0.94 }], elapsed_ms: 120 };
const region = [0.1, 0.2, 0.5, 0.35];

test("region OCR tool reads configured Server directly without detection, model or action gates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "phone-ocr-"));
  const original = globalThis.fetch;
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi/phone.json"), JSON.stringify({ serverUrl: "http://mock.example:8890",
      analysisModel: { provider: "unavailable", id: "none" } }));
    let tool: any;
    extension({ on(event: string, cb: any) { if (event === "session_start") cb({}, { cwd: dir }); },
      registerCommand() {}, registerTool(t: any) { if (t.name === "phone_ocr_region") tool = t; } } as any);
    assert.ok(tool, "standalone OCR tool must be registered");
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "http://mock.example:8890/api/ocr/region");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal((init?.headers as Record<string, string>)["Content-Type"], "application/json");
      assert.ok(init?.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(init?.body as string), { region });
      return Response.json(result);
    };
    const response = await tool.execute("test", { region });
    assert.deepEqual(response.details, result);
    assert.match(response.content[0].text, /剩余自动 8 回合/);
    assert.match(response.content[0].text, /untrusted/i);
    assert.match(response.content[0].text, /no per-line positions/i);
    assert.equal(response.content.some((part: any) => part.type === "image"), false);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; rmSync(dir, { recursive: true, force: true }); }
});

test("region OCR rejects invalid coordinates before any request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected request"); };
  try {
    const client = new PhoneClient("http://mock.example");
    for (const value of [undefined, null, [], [0, 0, 1], [0, 0, 1, 1, 1], [0, 0, 0, 1],
      [0.8, 0, 0.2, 1], [0, 1, 1, 0], [-0.1, 0, 1, 1], [0, 0, 1.1, 1],
      [0, 0, NaN, 1], [0, 0, Infinity, 1], ["0", 0, 1, 1]]) {
      await assert.rejects(client.ocrRegion(value), /region/i);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("region OCR validates response and preserves empty lines and recognition errors", async () => {
  const original = globalThis.fetch;
  try {
    const client = new PhoneClient("http://mock.example");
    for (const patch of [{ width: 0 }, { height: 1.5 }, { xyxy: [0, 0, 1921, 888] },
      { xyxy: [0, 0, 0, 1] }, { xyxy: [0.5, 0, 1, 1] }, { error: false }, { lines: null },
      { lines: [{ text: 1, confidence: 0.5 }] }, { lines: [{ text: "x", confidence: 1.1 }] },
      { elapsed_ms: -1 }, { elapsed_ms: "120" }]) {
      globalThis.fetch = async () => Response.json({ ...result, ...patch });
      await assert.rejects(client.ocrRegion(region), /Invalid.*OCR/i);
    }
    const empty = { ...result, lines: [], error: "recognition unavailable" };
    globalThis.fetch = async () => Response.json(empty);
    assert.deepEqual(await client.ocrRegion([0, 0, 1, 1]), empty);
  } finally { globalThis.fetch = original; }
});

test("region OCR bounds response size and forwards caller cancellation", async () => {
  const original = globalThis.fetch;
  try {
    const client = new PhoneClient("http://mock.example");
    globalThis.fetch = async () => new Response("x".repeat(256 * 1024 + 1));
    await assert.rejects(client.ocrRegion(region), /size limit/);
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.signal?.aborted, true);
      init?.signal?.throwIfAborted();
      throw new Error("must be aborted");
    };
    await assert.rejects(client.ocrRegion(region, controller.signal), (error: any) => error.cause.name === "AbortError");
  } finally { globalThis.fetch = original; }
});

test("region OCR HTTP failures retain cause with no retries or YOLO fallback", async () => {
  const original = globalThis.fetch;
  try {
    const client = new PhoneClient("http://mock.example");
    for (const status of [404, 409, 422, 503]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response("unavailable", { status }); };
      await assert.rejects(client.ocrRegion(region), (error: any) => {
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.equal(error.cause.message, `HTTP ${status}`);
        return true;
      });
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});
