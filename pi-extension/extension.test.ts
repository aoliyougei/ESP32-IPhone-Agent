// Run in a development container: npx tsx --test extension.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "./index.ts";

function load(cwd: string, extra: any = {}) {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  let start: any;
  extension({
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    on(event: string, handler: any) { if (event === "session_start") start = handler; },
  } as any);
  start({}, { cwd });
  const menu = (answers: (string | undefined)[], confirmed = true, hasUI = true, notices: string[] = []) =>
    commands.get("esp32-iphone-server").handler("", { cwd, hasUI, ...extra, ui: {
      select: async () => answers.shift(), input: async () => answers.shift(),
      confirm: async () => confirmed, notify(message: string) { notices.push(message); },
    } });
  return { tools, menu, configure: (input: string | undefined, hasUI = true) => {
    if (input === undefined) return menu(["新增", undefined], true, hasUI);
    const parsed = new URL(input.trim());
    return menu(["新增", parsed.protocol.slice(0, -1), parsed.hostname + (parsed.pathname === "/" ? "" : parsed.pathname), parsed.port || "8890"], true, hasUI);
  } };
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
    await assert.rejects(app.configure("http://invalid.example/path"), /host|origin/);
    assert.equal(readFileSync(configPath, "utf8"), saved);
    assert.equal((await status()).details.requested, "http://project.example:8890/api/status");
    const notices: string[] = [];
    await app.menu(["查看"], true, true, notices);
    assert.ok(notices[0].includes("http://project.example:8890"));
    assert.ok(notices[0].includes(configPath));
    for (const answers of [[undefined], ["新增", undefined], ["新增", "https", undefined], ["新增", "https", "new.example", undefined]]) {
      await app.menu(answers);
      assert.equal(readFileSync(configPath, "utf8"), saved);
    }
    await app.menu(["新增", "https", "new.example", "9443"], false);
    assert.equal(readFileSync(configPath, "utf8"), saved);
    for (const port of ["0", "65536", "1.5", "abc"]) {
      await assert.rejects(app.menu(["新增", "http", "new.example", port]), /port/i);
    }
    for (const host of ["new.example/path", "user@host", "host:8890", ""]) {
      await assert.rejects(app.menu(["新增", "http", host, "8890"]), /host|origin/i);
    }
    await app.menu(["删除"], false);
    assert.equal(readFileSync(configPath, "utf8"), saved);
    await app.menu(["新增", "https", "new.example", "9443"]);
    assert.equal((await status()).details.requested, "https://new.example:9443/api/status");
    await app.configure("http://project.example:8890");
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
    await broken.menu(["删除"]);
    await assert.rejects(broken.tools.get("phone_status").execute("test", {}, undefined), /\/esp32-iphone-server/);
    await broken.menu(["删除"]);
    await broken.configure("https://repaired.example:8890");
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

test("actions execute without approval, preserve serialization and block server changes during actions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "phone-actions-"));
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let finishHome: () => void;
  try {
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
      if (path === "/api/home") await new Promise<void>(resolve => { finishHome = resolve; });
      return Response.json(path === "/api/status"
        ? { device: true, screen: true, calibrated: true, agent: { running: false } } : { ok: true });
    };
    const act = (args: any, ctx: any) => tools.get("phone_action").execute("test", args, undefined, undefined, ctx);
    const noConfirmation = { hasUI: true, ui: { confirm() { throw new Error("Unexpected confirmation"); } } };
    assert.ok(tools.get("phone_action").parameters.properties.action.anyOf.some((item: any) => item.const === "double_tap"));
    await act({ action: "double_tap", x: 0.25, y: 0.75 }, noConfirmation);
    assert.equal(calls.filter(path => path === "/api/double_tap").length, 1);
    assert.equal(calls.includes("/api/tap"), false);
    const image = await tools.get("phone_screenshot").execute("test", {}, undefined);
    assert.equal(image.content[1].type, "image");
    assert.equal(image.content[1].data, "/9j/2Q==");
    const first = act({ action: "home" }, { hasUI: false });
    while (!finishHome!) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(act({ action: "back" }, { hasUI: true }), /in progress/);
    await assert.rejects(app.configure("http://different.example:8890"), /in progress/);
    await act({ action: "stop" }, { hasUI: false });
    finishHome!();
    await first;
    assert.ok(calls.includes("/api/home"));
    const before = calls.length;
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(tools.get("phone_action").execute("test", { action: "back" }, controller.signal, undefined, { hasUI: false }), /cancelled/);
    assert.equal(calls.length, before);
    await act({ action: "back" }, { hasUI: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});
