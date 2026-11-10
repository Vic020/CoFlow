import test from "node:test";
import assert from "node:assert/strict";
import { AIOperationStore } from "../apps/web/lib/ai-operations.ts";
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
