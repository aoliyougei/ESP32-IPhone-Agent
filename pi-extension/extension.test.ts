// Run in a development container: npx tsx --test extension.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "./index.ts";

function load(cwd: string) {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  let start: any;
  extension({
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    on(event: string, handler: any) { if (event === "session_start") start = handler; },
  } as any);
  start({}, { cwd });
  return { tools, configure: (input: string | undefined, hasUI = true) =>
    commands.get("esp32-iphone-server").handler("", { cwd, hasUI, ui: {
      input: async () => input, notify() {},
    } }) };
}

test("command saves project-local config for immediate use and later sessions; environment is ignored", async () => {
  const dir = mkdtempSync(join(tmpdir(), "phone-config-"));
  const oldURL = process.env.PHONE_SERVER_URL;
  const originalFetch = globalThis.fetch;
  try {
    assert.notEqual(dir, process.cwd());
    process.env.PHONE_SERVER_URL = "http://ignored.example:8890";
    writeFileSync(join(dir, ".env"), "PHONE_SERVER_URL=http://also-ignored.example:8890\n");
    globalThis.fetch = async url => Response.json({ requested: String(url), device: false, screen: false });
    const app = load(dir);
    const status = () => app.tools.get("phone_status").execute("test", {}, undefined);
    await assert.rejects(status(), /\/esp32-iphone-server/);
    await app.configure(undefined);
    await assert.rejects(status(), /\/esp32-iphone-server/);
    await assert.rejects(app.configure("http://ignored.example", false), /interactive/);
    await app.configure(" http://project.example:8890 ");
    const configPath = join(dir, ".pi", "phone.json");
    const saved = readFileSync(configPath, "utf8");
    assert.deepEqual(JSON.parse(saved), { serverUrl: "http://project.example:8890" });
    assert.equal((await status()).details.requested, "http://project.example:8890/api/status");
    assert.equal((await status()).details.device, false);
    await app.configure(undefined);
    await assert.rejects(app.configure("http://invalid.example/path"), /origin/);
    assert.equal(readFileSync(configPath, "utf8"), saved);
    assert.equal((await status()).details.requested, "http://project.example:8890/api/status");
    const next = load(dir);
    assert.equal((await next.tools.get("phone_status").execute("test", {}, undefined)).details.requested,
      "http://project.example:8890/api/status");
    const other = join(dir, "other");
    mkdirSync(other);
    await assert.rejects(load(other).tools.get("phone_status").execute("test", {}, undefined), /\/esp32-iphone-server/);
    writeFileSync(configPath, "{invalid json");
    const broken = load(dir);
    await assert.rejects(broken.tools.get("phone_status").execute("test", {}, undefined),
      error => String(error).includes(configPath));
    await broken.configure("https://repaired.example:8890");
    assert.equal((await broken.tools.get("phone_status").execute("test", {}, undefined)).details.requested,
      "https://repaired.example:8890/api/status");
    rmSync(configPath);
    mkdirSync(configPath);
    await assert.rejects(broken.configure("http://unsaved.example:8890"));
    assert.equal((await broken.tools.get("phone_status").execute("test", {}, undefined)).details.requested,
      "https://repaired.example:8890/api/status");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    if (oldURL === undefined) delete process.env.PHONE_SERVER_URL; else process.env.PHONE_SERVER_URL = oldURL;
  }
});

test("three tools preserve approvals, image results, action serialization and block server changes during actions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "phone-actions-"));
  const originalFetch = globalThis.fetch;
  const oldAllow = process.env.PHONE_ALLOW_ACTIONS;
  const calls: string[] = [];
  try {
    process.env.PHONE_ALLOW_ACTIONS = "1";
    const app = load(dir);
    await app.configure("http://127.0.0.1:8890");
    const tools = app.tools;
    assert.deepEqual([...tools.keys()], ["phone_status", "phone_screenshot", "phone_action"]);
    globalThis.fetch = async url => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.endsWith(".jpg")) return new Response(new Uint8Array([255, 216, 255, 217]), {
        headers: { "content-type": "image/jpeg" },
      });
      return Response.json(path === "/api/status"
        ? { device: true, screen: true, calibrated: true, agent: { running: false } } : { ok: true });
    };
    const act = (args: any, ctx: any) => tools.get("phone_action").execute("test", args, undefined, undefined, ctx);
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
    await assert.rejects(app.configure("http://different.example:8890"), /in progress/);
    await act({ action: "stop" }, { hasUI: false });
    approve!(true);
    await assert.rejects(first, /cancelled/);
    assert.equal(calls.includes("/api/home"), false);
    await act({ action: "back" }, { hasUI: true, ui: { confirm: async () => true } });
    assert.ok(calls.includes("/api/back"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    if (oldAllow === undefined) delete process.env.PHONE_ALLOW_ACTIONS; else process.env.PHONE_ALLOW_ACTIONS = oldAllow;
  }
});
