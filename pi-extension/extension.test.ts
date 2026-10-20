// Run in a development container: npx tsx --test extension.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "./index.ts";

test("project .env supplies a startup-only URL without changing process environment or disabling approval", async () => {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "phone-env-"));
  const oldURL = process.env.PHONE_SERVER_URL, oldAllow = process.env.PHONE_ALLOW_ACTIONS;
  const originalFetch = globalThis.fetch;
  const register = () => {
    const tools = new Map<string, any>();
    extension({ registerTool(tool: any) { tools.set(tool.name, tool); } } as any);
    return tools;
  };
  try {
    process.chdir(dir);
    delete process.env.PHONE_SERVER_URL;
    delete process.env.PHONE_ALLOW_ACTIONS;
    const missing = register();
    await assert.rejects(missing.get("phone_status").execute("test", {}, undefined), /PHONE_SERVER_URL/);
    writeFileSync(".env", '# project settings\r\nexport PHONE_SERVER_URL="http://project.example:8890" # trusted server\r\nPHONE_ALLOW_ACTIONS=1\r\nOTHER_SETTING=ignored\r\n');
    const tools = register();
    writeFileSync(".env", "PHONE_SERVER_URL=http://changed.example:8890\n");
    globalThis.fetch = async (url) => Response.json({ requested: String(url) });
    const status = await tools.get("phone_status").execute("test", {}, undefined);
    assert.equal(status.details.requested, "http://project.example:8890/api/status");
    assert.equal(process.env.PHONE_SERVER_URL, undefined);
    assert.equal(process.env.PHONE_ALLOW_ACTIONS, undefined);
    await assert.rejects(tools.get("phone_action").execute("test", { action: "home" }, undefined, undefined,
      { hasUI: false }), /interactive approval/);

    process.env.PHONE_SERVER_URL = "http://override.example:8890";
    const overridden = register();
    assert.equal((await overridden.get("phone_status").execute("test", {}, undefined)).details.requested,
      "http://override.example:8890/api/status");
    delete process.env.PHONE_SERVER_URL;
    writeFileSync(".env", "PHONE_SERVER_URL=http://invalid.example/path\n");
    await assert.rejects(register().get("phone_status").execute("test", {}, undefined), /origin/);
    mkdirSync("child");
    process.chdir("child");
    await assert.rejects(register().get("phone_status").execute("test", {}, undefined), /PHONE_SERVER_URL/);
    process.chdir(dir);
    rmSync(".env");
    mkdirSync(".env");
    assert.throws(register, /EISDIR/);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    if (oldURL === undefined) delete process.env.PHONE_SERVER_URL; else process.env.PHONE_SERVER_URL = oldURL;
    if (oldAllow === undefined) delete process.env.PHONE_ALLOW_ACTIONS; else process.env.PHONE_ALLOW_ACTIONS = oldAllow;
  }
});

test("registers three tools without connecting; approvals, image results and action serialization", async () => {
  const tools = new Map<string, any>();
  const originalFetch = globalThis.fetch;
  const oldURL = process.env.PHONE_SERVER_URL, oldAllow = process.env.PHONE_ALLOW_ACTIONS;
  process.env.PHONE_SERVER_URL = "http://127.0.0.1:8890";
  delete process.env.PHONE_ALLOW_ACTIONS;
  extension({ registerTool(tool: any) { tools.set(tool.name, tool); } } as any);
  assert.deepEqual([...tools.keys()], ["phone_status", "phone_screenshot", "phone_action"]);
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
