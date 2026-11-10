import test from "node:test";
import assert from "node:assert/strict";
import {
  AIOperationStore,
  planContextSources,
} from "../apps/web/lib/ai-operations.ts";
const input = {
  scope: { mode: "organize" },
  contextIDs: ["one", "two"],
  configID: "config",
  locale: "en",
  origin: "/context/?filters=1",
};
const entry = (id) => ({ id, state: "active", needs_review: false });
const response = (id, extras = {}) => ({
  items: [entry(id)],
  errors: [],
  reply: "Synthetic result",
  conversation_id: "conversation-" + id,
  ...extras,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function settle(s, id) {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setImmediate(r));
    if (!s.runtimes.get(id)?.executing) return;
  }
  throw Error("operation did not settle");
}
test("operations deduplicate active clicks and continue across view changes", async () => {
  const gate = deferred(),
    calls = [];
  let changed = 0;
  const s = new AIOperationStore(
    async (_path, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      return calls.length === 1 ? gate.promise : response("two");
    },
    () => changed++,
    () => {},
  );
  const id = s.start({
    ...input,
    origin: "/context/?filters=1&token=synthetic-secret",
  });
  assert.equal(s.records[0].origin, "/context/?filters=1");
  assert(!JSON.stringify(s.snapshot()).includes("synthetic-secret"));
  assert.equal(s.start({ ...input, locale: "zh-CN" }), id);
  assert.equal(s.start({ ...input, contextIDs: ["two", "one"] }), id);
  assert.equal(s.records[0].status, "running");
  assert.equal(s.records[0].total, 2);
  s.changed = () => {};
  gate.resolve(response("one"));
  await settle(s, id);
  assert.equal(calls.length, 2);
  assert.equal(s.records[0].status, "completed");
  assert.deepEqual(s.records[0].results, ["one", "two"]);
  assert.equal(s.records[0].completed, 2);
  assert(changed > 0);
});
test("stop lets the current request finish and resume processes only remaining documents", async () => {
  const gate = deferred(),
    calls = [];
  const s = new AIOperationStore(
    async (_, o) => {
      calls.push(JSON.parse(o.body));
      return calls.length === 1 ? gate.promise : response("two");
    },
    () => {},
    () => {},
  );
  const id = s.start(input);
  s.stop(id);
  assert.equal(s.records[0].status, "stopping");
  gate.resolve(response("one"));
  await settle(s, id);
  assert.equal(calls.length, 1);
  assert.equal(s.records[0].status, "stopped");
  assert.equal(s.records[0].saved, 1);
  s.retry(id);
  await settle(s, id);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].source_id, "two");
  assert.equal(s.records[0].status, "completed");
});
test("uncertain transport retries preserve exact request identity and retain partial output", async () => {
  const calls = [];
  let n = 0;
  const s = new AIOperationStore(
    async (_, o) => {
      calls.push(o.body);
      if (++n === 1) throw Error("synthetic lost response");
      if (n === 2)
        throw Object.assign(Error("request still processing"), { status: 409 });
      return response("one");
    },
    () => {},
    () => {},
  );
  const id = s.start({ ...input, contextIDs: ["one"] });
  await settle(s, id);
  assert.equal(s.records[0].status, "failed");
  s.retry(id);
  await settle(s, id);
  assert.equal(calls[0], calls[1]);
  s.retry(id);
  await settle(s, id);
  assert.equal(calls[1], calls[2]);
  assert.equal(s.records[0].saved, 1);
  const errors = [];
  const s2 = new AIOperationStore(
    async (_, o) => {
      errors.push(JSON.parse(o.body));
      return response("one", {
        errors: errors.length === 1 ? ["synthetic partial failure"] : [],
      });
    },
    () => {},
    () => {},
  );
  const id2 = s2.start({ ...input, contextIDs: ["one"] });
  await settle(s2, id2);
  assert.equal(s2.records[0].saved, 1);
  assert.equal(s2.records[0].status, "failed");
  s2.retry(id2);
  await settle(s2, id2);
  assert.notEqual(errors[0].request_id, errors[1].request_id);
  assert.equal(s2.records[0].saved, 1);
});
test("a failed directory read is retried without widening to an unscoped write", async () => {
  let reads = 0;
  const writes = [];
  const s = new AIOperationStore(
    async (path, o) => {
      if (path.startsWith("/context-tree")) {
        if (++reads === 1) throw Error("synthetic directory outage");
        return { items: [{ id: "one", state: "active" }] };
      }
      writes.push(JSON.parse(o.body));
      return response("one");
    },
    () => {},
    () => {},
  );
  const id = s.start({ ...input, contextIDs: undefined });
  await settle(s, id);
  s.retry(id);
  await settle(s, id);
  assert.equal(reads, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].source_id, "one");
});
test("scope disposal stops follow-up writes; refresh restores unknown state without automatic execution", async () => {
  const gate = deferred();
  let calls = 0,
    saved = 0;
  const s = new AIOperationStore(
    async () => {
      calls++;
      return gate.promise;
    },
    () => {},
    () => {},
  );
  const id = s.start({ ...input, onSaved: () => saved++ });
  const snapshot = s.snapshot();
  assert(!JSON.stringify(snapshot).includes("Synthetic result"));
  s.dispose();
  gate.resolve(response("one"));
  await settle(s, id);
  assert.equal(calls, 1);
  assert.equal(saved, 0);
  const fresh = new AIOperationStore(
    async () => {
      throw Error("must not run");
    },
    () => {},
    () => {},
  );
  fresh.restore(snapshot);
  assert.equal(fresh.records[0].status, "unconfirmed");
  fresh.retry(id);
  assert.equal(fresh.runtimes.size, 0);
  assert.equal(fresh.records[0].error, "");
  fresh.restore([
    { ...snapshot[0], origin: "//outside.invalid" },
    { ...snapshot[0], origin: "/\\outside.invalid" },
  ]);
  assert.equal(fresh.records.length, 0);
});

test("item details retain partial saves, isolate failures and resume remaining items", async () => {
  const gate = deferred();
  let calls = 0;
  const s = new AIOperationStore(
    async (_path, opts) => {
      const body = JSON.parse(opts.body);
      calls++;
      if (calls === 1) return gate.promise;
      if (calls === 2)
        return response("two", { errors: ["synthetic private failure"] });
      return response(body.source_id);
    },
    () => {},
    () => {},
  );
  const id = s.start({ ...input, contextIDs: ["one", "two", "three"] });
  assert.deepEqual(
    s.records[0].steps.map((v) => v.state),
    ["running", "pending", "pending"],
  );
  gate.resolve(response("one"));
  await settle(s, id);
  let v = s.records[0];
  assert.deepEqual(
    v.steps.map((x) => x.state),
    ["completed", "failed", "pending"],
  );
  assert.equal(v.completed, 1);
  assert.equal(v.saved, 2);
  assert.deepEqual(v.steps[1].results, ["two"]);
  assert.equal(v.steps[1].error, "synthetic private failure");
  assert(!JSON.stringify(s.snapshot()).includes("synthetic private failure"));
  s.retry(id);
  await settle(s, id);
  v = s.records[0];
  assert.equal(calls, 4);
  assert.equal(v.saved, 3);
  assert.deepEqual(
    v.steps.map((x) => x.state),
    ["completed", "completed", "completed"],
  );
  assert.deepEqual(v.steps[1].results, ["two"]);
});
test("refresh strips item titles and errors and marks in-flight items unconfirmed", async () => {
  const gate = deferred();
  const s = new AIOperationStore(
    async (path) =>
      path.startsWith("/context-tree")
        ? { items: [{ id: "one", title: "private subject", state: "active" }] }
        : gate.promise,
    () => {},
    () => {},
  );
  const id = s.start({ ...input, contextIDs: undefined });
  await new Promise((r) => setImmediate(r));
  assert.equal(s.records[0].steps[0].title, "private subject");
  const snapshot = s.snapshot();
  assert(!JSON.stringify(snapshot).includes("private subject"));
  const fresh = new AIOperationStore(
    async () => {
      throw Error("must not restart");
    },
    () => {},
    () => {},
  );
  fresh.restore(snapshot);
  assert.equal(fresh.records[0].steps[0].state, "unconfirmed");
  assert.equal(fresh.records[0].steps[0].title, "");
  assert.equal(fresh.runtimes.size, 0);
  s.dispose();
  gate.resolve(response("one"));
  await settle(s, id);
});

test("planning is read-only and confirmed execution keeps its original source list", async () => {
  const reads = [],
    writes = [];
  const client = async (path, options) => {
    if (path.startsWith("/context-tree")) {
      reads.push(path);
      return {
        items: [
          { id: "one", title: "First", state: "active" },
          { id: "old", state: "archived" },
        ],
      };
    }
    writes.push(JSON.parse(options.body));
    return response("one");
  };
  const plan = await planContextSources(client, {
    scope: { project: "project", mode: "extract" },
  });
  assert.equal(writes.length, 0);
  assert.equal(plan.sources.length, 1);
  assert.equal(plan.titles.one, "First");
  const s = new AIOperationStore(
    client,
    () => {},
    () => {},
  );
  const id = s.start({
    ...input,
    contextIDs: undefined,
    plannedSources: plan.sources,
    contextTitles: plan.titles,
  });
  plan.sources.push({ source_kind: "context", source_id: "added-later" });
  await settle(s, id);
  assert.equal(reads.length, 1);
  assert.deepEqual(
    writes.map((v) => v.source_id),
    ["one"],
  );
  assert.equal(s.records[0].steps[0].title, "First");
});
