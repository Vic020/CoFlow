import assert from "node:assert/strict";
import test from "node:test";
import { demoMeta, publicDemoRequest } from "../apps/web/lib/public-demo.ts";

test("public demo uses synthetic identities and returns isolated read copies", async () => {
  assert.equal(demoMeta.team.id, "demo-team");
  assert.ok(demoMeta.members.every((m) => m.id.startsWith("demo-")));
  const first = await publicDemoRequest("/reports");
  assert.equal(first.items.length, 6);
  for (const report of first.items) {
    assert.ok(report.source_id.startsWith("demo-"));
    assert.ok(
      report.links.every((l) => new URL(l.url).hostname === "github.com"),
    );
  }
  first.items[0].title = "mutated returned copy";
  assert.notEqual(
    (await publicDemoRequest("/reports")).items[0].title,
    first.items[0].title,
  );
});

test("seeded Todo examples cover board states and reciprocal Timeline links", async () => {
  const fresh = await import("../apps/web/lib/public-demo.ts?seed-links");
  const { items: tasks } = await fresh.publicDemoRequest("/todos");
  const { items: reports } = await fresh.publicDemoRequest("/reports");
  const board = await fresh.publicDemoRequest("/todo-board");
  assert.equal(tasks.length, 6);
  assert.equal(new Set(tasks.map((t) => t.column_id)).size, 4);
  for (const task of tasks) {
    assert.ok(task.id.startsWith("demo-"));
    assert.ok(["none", "low", "medium", "high"].includes(task.priority));
    assert.ok(fresh.demoMeta.members.some((m) => m.id === task.assignee_id));
    assert.equal(
      Boolean(task.completed_at),
      board.columns.find((c) => c.id === task.column_id).done,
    );
    for (const id of task.report_ids)
      assert.ok(reports.find((r) => r.id === id)?.todo_ids.includes(task.id));
    assert.ok(
      (await fresh.publicDemoRequest(`/todos/${task.id}`)).history.length >= 2,
    );
  }
  for (const report of reports)
    for (const id of report.todo_ids)
      assert.ok(tasks.find((t) => t.id === id)?.report_ids.includes(report.id));
  for (const col of board.columns)
    assert.equal(
      col.task_count,
      tasks.filter((t) => t.column_id === col.id).length,
    );
  const completions = await fresh.publicDemoRequest("/todo-completions");
  assert.equal(completions.items.length, 2);
  const pending = await fresh.publicDemoRequest("/todos?scope=todo");
  assert.ok(pending.items.length > 0);
  assert.ok(
    pending.items.every(
      (t) => t.assignee_id === fresh.demoMeta.current_user && !t.completed_at,
    ),
  );
  tasks[0].title = "mutated seed";
  assert.notEqual(
    (await fresh.publicDemoRequest(`/todos/${tasks[0].id}`)).title,
    "mutated seed",
  );
});

test("demo writes stay in module memory and never use the network", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("unexpected network");
  };
  try {
    const created = await publicDemoRequest("/reports", {
      method: "POST",
      body: JSON.stringify({
        source_id: "demo-try",
        title: "synthetic draft",
        links: [],
      }),
    });
    await publicDemoRequest(`/reports/${created.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "synthetic feedback" }),
    });
    assert.equal(
      (await publicDemoRequest("/reports")).items[0].comments.length,
      1,
    );
    await publicDemoRequest(`/reports/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({ title: "synthetic revision" }),
    });
    assert.equal(
      (await publicDemoRequest("/reports")).items[0].title,
      "synthetic revision",
    );
    const fresh = await import("../apps/web/lib/public-demo.ts?new-page");
    assert.equal((await fresh.publicDemoRequest("/reports")).items.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public demo refuses real identity, credential and backend operations", async () => {
  for (const path of [
    "/auth/login",
    "/auth/bootstrap",
    "/tokens",
    "/teams",
    "/invitations",
  ]) {
    await assert.rejects(
      publicDemoRequest(path, { method: "POST", body: "{}" }),
      /公开演示不连接真实服务/,
    );
  }
  await assert.rejects(
    publicDemoRequest("/reports", {
      method: "POST",
      body: JSON.stringify({
        title: "bad link",
        links: [{ title: "bad", url: "javascript:alert(1)" }],
      }),
    }),
    /HTTP/,
  );
  await assert.rejects(
    publicDemoRequest("/reports/demo-report-2", { method: "PUT", body: "{}" }),
    /只能编辑/,
  );
});

test("offline Todo retries, conflict, ordering and linked report stay in memory", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("unexpected network");
  };
  try {
    const request = (p, v, method = "POST") =>
      publicDemoRequest(p, { method, body: JSON.stringify(v) });
    const input = {
      title: "Synthetic Todo",
      column_id: "backlog",
      assignee_id: "demo-alice",
      source_id: "todo-test",
      operation_id: "todo-create",
    };
    const t = await request("/todos", input);
    assert.equal((await request("/todos", input)).id, t.id);
    await assert.rejects(
      request("/todos", { ...input, title: "Different" }),
      /操作标识/,
    );
    await assert.rejects(
      request(
        `/todos/${t.id}`,
        {
          action: "edit",
          title: "Stale",
          expected_revision: 0,
          operation_id: "stale",
        },
        "PATCH",
      ),
      /已更新/,
    );
    const before = await publicDemoRequest("/todo-board");
    const done = await request(
      `/todos/${t.id}`,
      {
        action: "complete",
        expected_revision: t.revision,
        board_revision: before.revision,
        operation_id: "complete-test",
      },
      "PATCH",
    );
    assert.ok(done.completed_at);
    const joint = {
      title: "Synthetic linked progress",
      source_id: "todo-progress",
      todo_ids: [t.id],
      todo_moves: [
        { id: t.id, column_id: "review", expected_revision: done.revision },
      ],
      operation_id: "joint-test",
    };
    const report = await request("/reports", joint);
    assert.equal((await request("/reports", joint)).id, report.id);
    const updated = await publicDemoRequest(`/todos/${t.id}`);
    assert.equal(updated.column_id, "review");
    assert.deepEqual(updated.report_ids, [report.id]);
    assert.equal(
      (await publicDemoRequest("/todo-completions")).items.filter(
        (e) => e.todo_id === t.id,
      ).length,
      1,
    );
    const count = (await publicDemoRequest("/reports")).items.length;
    await assert.rejects(
      request("/reports", {
        ...joint,
        source_id: "failed-progress",
        operation_id: "failed-joint",
      }),
      /已更新/,
    );
    assert.equal((await publicDemoRequest("/reports")).items.length, count);
    const fresh = await import("../apps/web/lib/public-demo.ts?todo-new-page");
    const reset = (await fresh.publicDemoRequest("/todos")).items;
    assert.equal(reset.length, 6);
    assert.ok(!reset.some((task) => task.id === t.id));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
