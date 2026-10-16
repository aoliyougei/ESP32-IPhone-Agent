// Run in a development container: npx tsx --test extension.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import extension from "./index.ts";

test("registers three tools without connecting; approvals, image results and action serialization", async () => {
  const tools = new Map<string, any>();
  extension({ registerTool(tool: any) { tools.set(tool.name, tool); } } as any);
  assert.deepEqual([...tools.keys()], ["phone_status", "phone_screenshot", "phone_action"]);
  const originalFetch = globalThis.fetch;
  const oldURL = process.env.PHONE_SERVER_URL, oldAllow = process.env.PHONE_ALLOW_ACTIONS;
  process.env.PHONE_SERVER_URL = "http://127.0.0.1:8890";
  delete process.env.PHONE_ALLOW_ACTIONS;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path.endsWith(".jpg")) return new Response(new Uint8Array([255, 216, 255, 217]), {
      headers: { "content-type": "image/jpeg" },
    });
    return Response.json(path === "/api/status"
      ? { device: true, screen: true, calibrated: true, agent: { running: false } } : { ok: true });
  };
  const act = (args: any, ctx: any) => tools.get("phone_action").execute("test", args, undefined, undefined, ctx);
  try {
    await assert.rejects(act({ action: "home" }, { hasUI: false }), /interactive approval/);
    await assert.rejects(act({ action: "home" }, { hasUI: true, ui: { confirm: async () => false } }), /denied/);
    assert.equal(calls.length, 0);
    const image = await tools.get("phone_screenshot").execute("test", {}, undefined);
    assert.equal(image.content[1].type, "image");
    assert.equal(image.content[1].data, "/9j/2Q==");
    let approve: (value: boolean) => void;
    const first = act({ action: "home" }, { hasUI: true, ui: {
      confirm: () => new Promise<boolean>(resolve => { approve = resolve; }),
    } });
    await assert.rejects(act({ action: "back" }, { hasUI: true }), /in progress/);
    await act({ action: "stop" }, { hasUI: false });
    approve!(true);
    await assert.rejects(first, /cancelled/);
    assert.equal(calls.includes("/api/home"), false);
    process.env.PHONE_ALLOW_ACTIONS = "1";
    await act({ action: "back" }, { hasUI: false });
    assert.ok(calls.includes("/api/back"));
  } finally {
    globalThis.fetch = originalFetch;
    if (oldURL === undefined) delete process.env.PHONE_SERVER_URL; else process.env.PHONE_SERVER_URL = oldURL;
    if (oldAllow === undefined) delete process.env.PHONE_ALLOW_ACTIONS; else process.env.PHONE_ALLOW_ACTIONS = oldAllow;
  }
});
