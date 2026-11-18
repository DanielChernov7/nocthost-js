import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NoctHost, NoctHostError, VERSION } from "../dist/esm/index.js";

const KEY = "nh_test_not_a_real_key";

/** Fake fetch: answers from a queue of responses and records every call. */
function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    const { status = 200, body, headers = {} } = next;
    return new Response(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  };
  fn.calls = calls;
  return fn;
}

const server = (over = {}) => ({
  id: "srv_1",
  label: "my-bot",
  status: "PROVISIONING",
  region: "ams",
  plan: "vc2-1c-1gb",
  ipv4: null,
  hourlyPrice: "0.012",
  createdAt: "2026-11-18T10:00:00.000Z",
  ...over,
});

test("me() sends bearer key and unwraps user", async () => {
  const f = fakeFetch([{ body: { user: { id: "u1", email: "a@example.com", balance: "9.96" } } }]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  const me = await c.me();
  assert.equal(me.balance, "9.96");
  assert.equal(f.calls[0].url, "https://api.nocthost.com/auth/me");
  assert.equal(f.calls[0].method, "GET");
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(f.calls[0].headers["User-Agent"], `nocthost-js/${VERSION}`);
});

test("string constructor and custom baseUrl", async () => {
  const f = fakeFetch([{ body: { balance: "9.96", hourlySpend: "0.012" } }]);
  const c = new NoctHost({ apiKey: KEY, baseUrl: "http://localhost:4000/", fetch: f });
  const b = await c.billing.get();
  assert.deepEqual(b, { balance: "9.96", hourlySpend: "0.012" });
  assert.equal(f.calls[0].url, "http://localhost:4000/billing");
  assert.doesNotThrow(() => new NoctHost(KEY));
});

test("servers.list / get / create / createBulk / destroy", async () => {
  const f = fakeFetch([
    { body: { servers: [server()] } },
    { body: { server: server({ status: "ACTIVE" }) } },
    { status: 202, body: { server: server() } },
    { status: 202, body: { servers: [server({ label: "fleet-1" }), server({ label: "fleet-2" })] } },
    { status: 202, body: { ok: true } },
  ]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  assert.equal((await c.servers.list()).length, 1);
  assert.equal((await c.servers.get("srv/1")).status, "ACTIVE");
  assert.equal(f.calls[1].url, "https://api.nocthost.com/servers/srv%2F1");

  const input = { label: "my-bot", planId: "vc2-1c-1gb", regionId: "ams", providerId: "vultr", osId: 1743, password: "Example-Passw0rd" };
  const created = await c.servers.create(input);
  assert.equal(created.status, "PROVISIONING");
  assert.equal(f.calls[2].method, "POST");
  assert.equal(f.calls[2].url, "https://api.nocthost.com/servers");
  assert.deepEqual(f.calls[2].body, input);
  assert.equal(f.calls[2].headers["Content-Type"], "application/json");

  const fleet = await c.servers.createBulk({ ...input, label: "fleet", count: 2 });
  assert.equal(fleet.length, 2);
  assert.equal(f.calls[3].url, "https://api.nocthost.com/servers/bulk");
  assert.equal(f.calls[3].body.count, 2);

  assert.deepEqual(await c.servers.destroy("srv_1"), { ok: true });
  assert.equal(f.calls[4].method, "DELETE");
  assert.equal(f.calls[4].url, "https://api.nocthost.com/servers/srv_1");
});

test("power actions, providers and root password", async () => {
  const f = fakeFetch([
    { body: { server: server({ status: "ACTIVE" }) } },
    { body: { server: server({ status: "STOPPED" }) } },
    { body: { server: server({ status: "ACTIVE" }) } },
    { body: { providers: [{ id: "vultr", label: "Vultr", available: true }], outages: {} } },
    { body: { password: "Example-Passw0rd", matchesRequested: true, note: "x" } },
  ]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  await c.servers.reboot("srv_1");
  assert.equal((await c.servers.stop("srv_1")).status, "STOPPED");
  await c.servers.start("srv_1");
  assert.deepEqual(
    f.calls.slice(0, 3).map((x) => [x.method, x.url]),
    [
      ["POST", "https://api.nocthost.com/servers/srv_1/reboot"],
      ["POST", "https://api.nocthost.com/servers/srv_1/stop"],
      ["POST", "https://api.nocthost.com/servers/srv_1/start"],
    ],
  );
  const p = await c.servers.providers();
  assert.equal(p.providers[0].id, "vultr");
  assert.equal(f.calls[3].url, "https://api.nocthost.com/servers/providers");
  const pw = await c.servers.setRootPassword("srv_1", "Example-Passw0rd");
  assert.equal(pw.matchesRequested, true);
  assert.deepEqual(f.calls[4].body, { password: "Example-Passw0rd" });
  assert.equal(f.calls[4].url, "https://api.nocthost.com/servers/srv_1/root-password");
});

test("backups.*", async () => {
  const backup = { id: "b1", label: "my-bot", status: "PENDING", region: "ams", plan: "vc2-1c-1gb", createdAt: "x", expiresAt: "y" };
  const f = fakeFetch([
    { body: { backups: [backup] } },
    { body: { backups: [] } },
    { status: 202, body: { backup } },
    { status: 202, body: { server: server() } },
    { status: 202, body: { ok: true } },
  ]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  assert.equal((await c.backups.list())[0].id, "b1");
  assert.equal(f.calls[0].url, "https://api.nocthost.com/backups");
  await c.backups.list({ serverId: "srv_1" });
  assert.equal(f.calls[1].url, "https://api.nocthost.com/backups?serverId=srv_1");
  assert.equal((await c.backups.create("srv_1")).status, "PENDING");
  assert.deepEqual(f.calls[2].body, { serverId: "srv_1" });
  await c.backups.restore("b1", { password: "Example-Passw0rd", planId: "vc2-2c-4gb" });
  assert.equal(f.calls[3].url, "https://api.nocthost.com/backups/b1/restore");
  assert.deepEqual(f.calls[3].body, { password: "Example-Passw0rd", planId: "vc2-2c-4gb" });
  await c.backups.delete("b1");
  assert.equal(f.calls[4].method, "DELETE");
});

test("public endpoints need no key and pass filters", async () => {
  const f = fakeFetch([
    { body: { generated_at: "x", currency: "USD", totals: {}, categories: [], clouds: [], locations: [], gpus: [] } },
    { body: { generated_at: "x", currency: "USD", offer_count: 0, offers: [] } },
  ]);
  const c = new NoctHost({ fetch: f, apiKey: undefined });
  await c.public.deployable();
  assert.equal(f.calls[0].url, "https://nocthost.com/api/public/v1/deployable");
  assert.equal(f.calls[0].headers.Authorization, undefined);
  await c.public.gpus({ gpu_model: "L40S", min_vram_gb: 48, continent: undefined });
  assert.equal(f.calls[1].url, "https://nocthost.com/api/public/v1/gpus?gpu_model=L40S&min_vram_gb=48");
});

test("missing key fails before any request", async () => {
  const saved = process.env.NOCTHOST_API_KEY;
  delete process.env.NOCTHOST_API_KEY;
  try {
    const f = fakeFetch([]);
    const c = new NoctHost({ fetch: f });
    await assert.rejects(c.servers.list(), (e) => e instanceof NoctHostError && e.code === "missing_api_key");
    assert.equal(f.calls.length, 0);
  } finally {
    if (saved !== undefined) process.env.NOCTHOST_API_KEY = saved;
  }
});

test("NOCTHOST_API_KEY env fallback", async () => {
  const saved = process.env.NOCTHOST_API_KEY;
  process.env.NOCTHOST_API_KEY = KEY;
  try {
    const f = fakeFetch([{ body: { servers: [] } }]);
    await new NoctHost({ fetch: f }).servers.list();
    assert.equal(f.calls[0].headers.Authorization, `Bearer ${KEY}`);
  } finally {
    if (saved === undefined) delete process.env.NOCTHOST_API_KEY;
    else process.env.NOCTHOST_API_KEY = saved;
  }
});

test("401 becomes NoctHostError with status and API message", async () => {
  const f = fakeFetch([{ status: 401, body: { error: "Unauthorized" } }]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  await assert.rejects(c.me(), (e) => {
    assert.ok(e instanceof NoctHostError);
    assert.ok(e instanceof Error);
    assert.equal(e.status, 401);
    assert.equal(e.code, "http");
    assert.equal(e.message, "Unauthorized");
    assert.deepEqual(e.body, { error: "Unauthorized" });
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test("429 is retried using Retry-After, then surfaces", async () => {
  const f = fakeFetch([
    { status: 429, body: { error: "Rate limit exceeded" }, headers: { "retry-after": "0" } },
    { body: { servers: [] } },
  ]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  assert.deepEqual(await c.servers.list(), []);
  assert.equal(f.calls.length, 2);

  const g = fakeFetch([{ status: 429, body: "slow down", headers: { "retry-after": "3" } }]);
  const c2 = new NoctHost({ apiKey: KEY, fetch: g, maxRetries: 0 });
  await assert.rejects(c2.servers.list(), (e) => e.status === 429 && e.retryAfter === 3 && e.message === "slow down");
});

test("POST is not retried on 503, GET is", async () => {
  const f = fakeFetch([{ status: 503, body: { error: "Busy, retry" }, headers: { "retry-after": "0" } }]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  await assert.rejects(c.servers.create({ label: "a", planId: "p", regionId: "r", password: "Example-Passw0rd" }), (e) => e.status === 503);
  assert.equal(f.calls.length, 1);

  const g = fakeFetch([
    { status: 503, body: { error: "Busy, retry" }, headers: { "retry-after": "0" } },
    { body: { balance: "1", hourlySpend: "0" } },
  ]);
  const c2 = new NoctHost({ apiKey: KEY, fetch: g });
  assert.equal((await c2.billing.get()).balance, "1");
});

test("network error on POST surfaces as code network", async () => {
  const f = fakeFetch([new TypeError("fetch failed")]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  await assert.rejects(c.backups.create("srv_1"), (e) => e instanceof NoctHostError && e.status === 0 && e.code === "network");
});

test("waitForActive polls until ACTIVE", async () => {
  const f = fakeFetch([
    { body: { server: server() } },
    { body: { server: server() } },
    { body: { server: server({ status: "ACTIVE", ipv4: "203.0.113.10" }) } },
  ]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  const s = await c.waitForActive("srv_1", { intervalMs: 1, timeoutMs: 5000 });
  assert.equal(s.ipv4, "203.0.113.10");
  assert.equal(f.calls.length, 3);
});

test("waitForActive throws server_failed on ERROR", async () => {
  const f = fakeFetch([{ body: { server: server({ status: "ERROR", failureReason: "x" }) } }]);
  const c = new NoctHost({ apiKey: KEY, fetch: f });
  await assert.rejects(c.servers.waitForActive("srv_1", { intervalMs: 1 }), (e) => e.code === "server_failed" && e.body.status === "ERROR");
});

test("waitForActive times out", async () => {
  const responses = Array.from({ length: 50 }, () => ({ body: { server: server() } }));
  const c = new NoctHost({ apiKey: KEY, fetch: fakeFetch(responses) });
  await assert.rejects(c.servers.waitForActive("srv_1", { intervalMs: 5, timeoutMs: 20 }), (e) => e.code === "wait_timeout");
});

test("CommonJS build loads with require", () => {
  const require = createRequire(import.meta.url);
  const cjs = require("../dist/cjs/index.js");
  assert.equal(typeof cjs.NoctHost, "function");
  assert.equal(typeof cjs.NoctHostError, "function");
  assert.equal(cjs.VERSION, VERSION);
});
