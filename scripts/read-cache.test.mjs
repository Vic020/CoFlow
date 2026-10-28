import test from "node:test";
import assert from "node:assert/strict";
import {
  ReadCache,
  cacheableRead,
  readKey,
} from "../apps/web/lib/read-cache.ts";
import { loadTodoPages } from "../apps/web/lib/todo-loader.ts";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("short-lived reads deduplicate, expire and return independent snapshots", async () => {
  let now = 0,
    calls = 0;
  const cache = new ReadCache(() => now);
  cache.setScope("member-a:team-a:member");
  const pending = deferred();
  const read = () => {
    calls++;
    return pending.promise;
  };
  const a = cache.read("/todos", read),
    b = cache.read("/todos", read);
  assert.equal(calls, 1);
  pending.resolve({ items: [{ title: "synthetic task" }] });
  const [first, second] = await Promise.all([a, b]);
  first.items[0].title = "local edit";
  assert.equal(second.items[0].title, "synthetic task");
  assert.equal(
    (await cache.read("/todos", read)).items[0].title,
    "synthetic task",
  );
  assert.equal(calls, 1);
  now = 10000;
  await cache.read("/todos", read);
  assert.equal(calls, 2);
});

test("writes invalidate cached and in-flight results without letting a late response replace new data", async () => {
  const cache = new ReadCache();
  cache.setScope("a");
  const pending = deferred();
  const stale = cache.read("/reports", () => pending.promise);
  cache.invalidate();
  assert.deepEqual(
    await cache.read("/reports", async () => ({ revision: 2 })),
    { revision: 2 },
  );
  pending.resolve({ revision: 1 });
  await stale;
  assert.deepEqual(
    await cache.read("/reports", async () =>
      assert.fail("fresh cache was lost"),
    ),
    { revision: 2 },
  );
});

test("account, team and role changes discard late responses and logout disables caching", async () => {
  for (const next of [
    "member-b:team-a:member",
    "member-a:team-b:member",
    "member-a:team-a:admin",
    null,
  ]) {
    const cache = new ReadCache();
    cache.setScope("member-a:team-a:member");
    const pending = deferred();
    const old = cache.read("/meta", () => pending.promise);
    cache.setScope(next);
    pending.resolve({ private: "synthetic old context" });
    await assert.rejects(old, /请求身份已变化/);
    assert.deepEqual(
      await cache.read("/meta", async () => ({ current: next })),
      { current: next },
    );
  }
  const cache = new ReadCache();
  let calls = 0;
  await cache.read("/meta", async () => ++calls);
  await cache.read("/meta", async () => ++calls);
  assert.equal(calls, 2);
});

test("failed reads never become cached, and memory has a finite entry bound", async () => {
  const cache = new ReadCache(Date.now, 10000, 2);
  cache.setScope("a");
  await assert.rejects(
    cache.read("/meta", async () => {
      throw Error("offline");
    }),
    /offline/,
  );
  assert.equal(await cache.read("/meta", async () => 1), 1);
  await cache.read("/reports", async () => 2);
  await cache.read("/todos", async () => 3);
  assert.equal(await cache.read("/meta", async () => 4), 4);
});

test("cache is limited to ordinary context/list GETs, never credentials, details or explicit refreshes", () => {
  for (const path of [
    "/meta",
    "/reports",
    "/todo-board",
    "/todos?archived=false",
    "/reads",
    "/collaborations",
    "/todo-completions",
  ])
    assert.equal(cacheableRead(path), true, path);
  for (const path of [
    "/auth/me",
    "/auth/status",
    "/tokens",
    "/reports/id",
    "/todos/id",
    "/invitations",
  ])
    assert.equal(cacheableRead(path), false, path);
  for (const init of [
    { method: "POST" },
    { method: "PATCH" },
    { headers: { Authorization: "synthetic" } },
    { headers: new Headers() },
    { cache: "no-store" },
    { cache: "reload" },
    { cache: "no-cache" },
    { signal: new AbortController().signal },
    { credentials: "omit" },
  ])
    assert.equal(cacheableRead("/meta", init), false);
  assert.equal(
    readKey("/todos?scope=all&q=a+b&archived=false"),
    readKey("/todos?archived=false&q=a%20b&scope=all"),
  );
  assert.notEqual(readKey("/todos?q=one"), readKey("/todos?q=two"));
});

test("all-column loading includes every page and preserves filters and cursor encoding", async () => {
  const calls = [];
  const items = await loadTodoPages(
    async (path) => {
      calls.push(path);
      const params = new URLSearchParams(path.split("?")[1]);
      assert.equal(params.get("limit"), "200");
      assert.equal(params.get("q"), "a + b");
      assert.equal(params.has("column"), false);
      if (!params.has("cursor"))
        return {
          items: Array.from({ length: 200 }, (_, i) => ({ id: String(i) })),
          next_cursor: "id+ /&?",
        };
      assert.equal(params.get("cursor"), "id+ /&?");
      return { items: [{ id: "200" }], next_cursor: "" };
    },
    { archived: "false", scope: "all", q: "a + b", project: "" },
  );
  assert.equal(items.length, 201);
  assert.equal(calls.length, 2);
  assert.equal(new URLSearchParams(calls[0].split("?")[1]).has("scope"), false);
});

test("pagination failures and repeated cursors fail visibly, without returning a truncated success", async () => {
  let calls = 0;
  await assert.rejects(
    loadTodoPages(async () => {
      if (++calls === 2) throw Error("offline");
      return { items: [{ id: "1" }], next_cursor: "1" };
    }, {}),
    /offline/,
  );
  await assert.rejects(
    loadTodoPages(async () => ({ items: [], next_cursor: "repeat" }), {}),
    /分页已变化/,
  );
});

test("request transport invalidates on writes, bypasses token reads and synchronizes other tabs", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { readFile } = await import("node:fs/promises");
  const { stripTypeScriptTypes } = await import("node:module");
  const folder = await mkdtemp(join(tmpdir(), "coflow-request-test-"));
  const globals = {
    window: globalThis.window,
    fetch: globalThis.fetch,
    BroadcastChannel: globalThis.BroadcastChannel,
  };
  t.after(async () => {
    for (const [key, value] of Object.entries(globals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    await rm(folder, { recursive: true, force: true });
  });
  let source = await readFile(
    new URL("../apps/web/lib/types.ts", import.meta.url),
    "utf8",
  );
  for (const [relative, file] of [
    ["./i18n/core", "i18n/core.ts"],
    ["./runtime", "runtime.ts"],
    ["./read-cache", "read-cache.ts"],
  ])
    source = source.replace(
      `"${relative}"`,
      JSON.stringify(new URL(`../apps/web/lib/${file}`, import.meta.url).href),
    );
  const compiled = stripTypeScriptTypes(source, { mode: "transform" });
  await writeFile(join(folder, "request.mjs"), compiled);
  globalThis.window = new EventTarget();
  let channel;
  globalThis.BroadcastChannel = class {
    constructor() {
      channel = this;
    }
    messages = [];
    postMessage(value) {
      this.messages.push(value);
    }
  };
  let calls = 0,
    revision = 1,
    failWrite = false,
    unauthorized = false;
  globalThis.fetch = async (url, init) => {
    calls++;
    if (unauthorized)
      return new Response(JSON.stringify({ error: "expired" }), {
        status: 401,
      });
    if (init.method === "POST" && failWrite)
      return new Response(JSON.stringify({ error: "conflict" }), {
        status: 409,
      });
    return new Response(JSON.stringify({ revision }), { status: 200 });
  };
  const { request, setReadCacheScope } = await import(
    pathToFileURL(join(folder, "request.mjs")).href
  );
  setReadCacheScope("synthetic-member:synthetic-team:member");
  await Promise.all([request("/meta"), request("/meta")]);
  assert.equal(calls, 1);
  await request("/meta");
  assert.equal(calls, 1);
  revision = 2;
  await request("/todos", { method: "POST", body: "{}" });
  assert.equal((await request("/meta")).revision, 2);
  assert.equal(calls, 3);
  assert.equal(channel.messages.at(-1), "data");
  failWrite = true;
  await assert.rejects(
    request("/todos", { method: "POST", body: "{}" }),
    /conflict/,
  );
  revision = 3;
  assert.equal((await request("/meta")).revision, 3);
  const beforeTokens = calls;
  await request("/tokens");
  await request("/tokens");
  assert.equal(calls, beforeTokens + 2);
  revision = 4;
  channel.onmessage({ data: "data" });
  assert.equal((await request("/meta")).revision, 4);
  let sessionEvents = 0;
  window.addEventListener("coflow:session-changed", () => sessionEvents++);
  channel.onmessage({ data: "session" });
  assert.equal(sessionEvents, 1);
  const noScope = calls;
  await request("/meta");
  await request("/meta");
  assert.equal(calls, noScope + 2);
  setReadCacheScope("new-member:new-team:member");
  let unauthorizedEvents = 0;
  window.addEventListener("coflow:unauthorized", () => unauthorizedEvents++);
  unauthorized = true;
  await assert.rejects(request("/todo-board"), /expired/);
  assert.equal(unauthorizedEvents, 1);
  unauthorized = false;
  const after401 = calls;
  await request("/meta");
  await request("/meta");
  assert.equal(calls, after401 + 2);
});

test("logging out and back into the same identity still rejects a previous session response", async () => {
  const cache = new ReadCache();
  cache.setScope("a");
  const pending = deferred();
  const old = cache.read("/meta", () => pending.promise);
  cache.setScope(null);
  cache.setScope("a");
  pending.resolve({ old: true });
  await assert.rejects(old, /请求身份已变化/);
});
