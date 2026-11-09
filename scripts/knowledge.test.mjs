import test from "node:test";
import assert from "node:assert/strict";
import { publicDemoRequest as call } from "../apps/web/lib/public-demo.ts";
import { blankContext } from "../apps/web/lib/context.ts";
import {
  sharedFilterPage,
  sharedFilterURL,
} from "../apps/web/lib/shared-filters.ts";
const mutate = (path, data, method = "POST") =>
  call(path, { method, body: JSON.stringify(data) });
test("Context demo saves only on explicit actions; retries, revision conflict, expiry and merge remain visible", async () => {
  const draft = {
    ...blankContext(),
    title: "Synthetic decision",
    body: "Evidence retained",
    operation_id: crypto.randomUUID(),
  };
  const a = await mutate("/context", draft),
    retry = await mutate("/context", draft);
  assert.equal(a.id, retry.id);
  assert.equal(
    (await mutate("/context", { ...draft, operation_id: crypto.randomUUID() }))
      .id,
    a.id,
  );
  assert.equal(a.state, "pending");
  const active = await mutate(
    "/context/" + a.id,
    {
      ...a,
      action: "confirm",
      expected_revision: a.revision,
      operation_id: crypto.randomUUID(),
    },
    "PATCH",
  );
  assert.equal(active.state, "active");
  await assert.rejects(
    mutate(
      "/context/" + a.id,
      {
        ...a,
        body: "stale",
        expected_revision: a.revision,
        operation_id: crypto.randomUUID(),
      },
      "PATCH",
    ),
    /变化/,
  );
  const b = await mutate("/context", {
    ...blankContext(),
    title: "Canonical",
    body: "Canonical body",
    operation_id: crypto.randomUUID(),
  });
  const merged = await mutate(
    "/context/" + a.id,
    {
      action: "merge",
      expected_revision: active.revision,
      superseded_by: b.id,
      target_revision: b.revision,
      operation_id: crypto.randomUUID(),
    },
    "PATCH",
  );
  assert.equal(merged.superseded_by, b.id);
  assert.equal(merged.state, "archived");
  assert.equal((await call("/context/" + b.id)).body, "Canonical body");
  const expired = await mutate("/context", {
    ...blankContext(),
    title: "Expired",
    body: "Old decision",
    state: "active",
    valid_until: "2020-01-01",
    operation_id: crypto.randomUUID(),
  });
  assert.equal((await call("/context/" + expired.id)).state, "expired");
});
test("original task changes mark linked knowledge for review; offline paths perform no network requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("Demo must not use network");
  };
  try {
    const task = await mutate("/todos", {
      title: "Synthetic Context source",
      column_id: "backlog",
      operation_id: crypto.randomUUID(),
      source_id: crypto.randomUUID(),
    });
    const entry = await mutate("/context", {
      ...blankContext(),
      title: "Linked fact",
      body: "Observed task",
      sources: [
        {
          kind: "todo",
          id: task.id,
          revision: String(task.revision),
          quote: "Observed excerpt",
        },
      ],
      operation_id: crypto.randomUUID(),
    });
    await mutate(
      "/todos/" + task.id,
      {
        title: "Original changed",
        expected_revision: task.revision,
        operation_id: crypto.randomUUID(),
      },
      "PATCH",
    );
    assert.equal((await call("/context/" + entry.id)).needs_review, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("dependency completion guard and Context navigation preserve original module behavior", async () => {
  const create = (title) =>
    mutate("/todos", {
      title,
      column_id: "backlog",
      operation_id: crypto.randomUUID(),
      source_id: crypto.randomUUID(),
    });
  const a = await create("Upstream"),
    b = await create("Downstream");
  const dependent = await mutate(
    "/todos/" + b.id,
    {
      blockers: [
        {
          id: "dep",
          todo_id: a.id,
          waiting_member_id: "",
          condition: "Prerequisite accepted",
        },
      ],
      expected_revision: b.revision,
      operation_id: crypto.randomUUID(),
    },
    "PATCH",
  );
  assert.equal((await call("/todos/" + b.id)).blocked, true);
  const board = await call("/todo-board");
  await assert.rejects(
    mutate(
      "/todos/" + b.id,
      {
        action: "complete",
        expected_revision: dependent.revision,
        board_revision: board.revision,
        operation_id: crypto.randomUUID(),
      },
      "PATCH",
    ),
    /阻塞/,
  );
  await assert.rejects(
    mutate(
      "/todos/" + a.id,
      {
        blockers: [{ id: "cycle", todo_id: b.id, condition: "Cycle" }],
        expected_revision: a.revision,
        operation_id: crypto.randomUUID(),
      },
      "PATCH",
    ),
    /循环/,
  );
  await mutate(
    "/todos/" + a.id,
    {
      action: "complete",
      expected_revision: a.revision,
      board_revision: board.revision,
      operation_id: crypto.randomUUID(),
    },
    "PATCH",
  );
  assert.equal((await call("/todos/" + b.id)).blocked, false);
  assert.equal(sharedFilterPage("/context/"), true);
  assert.match(
    sharedFilterURL("/context?state=active", {
      project: "project-a",
      domain: "engineering",
      member: "member-a",
    }),
    /state=active.*filters=1.*project=project-a/,
  );
});

test("captured multilingual excerpts honor byte limits without splitting characters", async () => {
  const { contextExcerpt } = await import("../apps/web/lib/context.ts");
  for (const text of [
    "汉字决定".repeat(1000),
    "🦀协作".repeat(1000),
    "ASCII".repeat(1000),
  ]) {
    const clipped = contextExcerpt(text, 2000);
    assert(Buffer.byteLength(clipped) <= 2000);
    assert(!clipped.includes("\ufffd"));
    assert(text.startsWith(clipped));
  }
});

test("Context initialization demo exposes a bounded template without inventing or saving knowledge", async () => {
  const templates = (await call("/assistant/templates")).items;
  const template = templates.find((x) => x.id === "builtin-context-init");
  assert(template.parameters.find((x) => x.name === "project").required);
  const before = (await call("/context")).total;
  const result = await mutate("/assistant/chat", {
    message: "Initialize project knowledge",
    config_id: "demo-ai",
    request_id: crypto.randomUUID(),
    template_id: template.id,
    template_version: template.version,
    parameters: { project: "Synthetic project" },
    locale: "en",
  });
  assert.equal(result.turn.actions.length, 0);
  assert.match(result.turn.reply, /Nothing has been saved/);
  assert.equal((await call("/context")).total, before);
});

test("Wiki directory omits bodies; documents retain hierarchy, citations and review signals", async () => {
  const first = await call("/context-tree");
  assert(first.items.some((x) => x.kind === "document"));
  assert(first.items.every((x) => !("body" in x) && !("history" in x)));
  const root = await mutate("/context", {
    ...blankContext(),
    operation_id: crypto.randomUUID(),
    title: "Synthetic Wiki root",
    body: "# Overview",
    kind: "document",
  });
  const child = await mutate("/context", {
    ...blankContext(),
    operation_id: crypto.randomUUID(),
    title: "Synthetic Wiki child",
    body: "# Working agreements",
    kind: "document",
    parent_id: root.id,
  });
  assert.equal(
    (await call("/context-tree")).items.find((x) => x.id === child.id)
      .parent_id,
    root.id,
  );
  await assert.rejects(
    mutate(
      "/context/" + root.id,
      {
        ...root,
        parent_id: child.id,
        expected_revision: root.revision,
        operation_id: crypto.randomUUID(),
      },
      "PATCH",
    ),
    /循环/,
  );
  const active = await mutate(
    "/context/" + child.id,
    {
      ...child,
      action: "confirm",
      expected_revision: child.revision,
      operation_id: crypto.randomUUID(),
    },
    "PATCH",
  );
  const guide = await mutate("/context", {
    ...blankContext(),
    operation_id: crypto.randomUUID(),
    title: "Synthetic compiled article",
    body: "A referenced fact",
    kind: "document",
    sources: [
      {
        kind: "context",
        id: active.id,
        revision: String(active.revision),
        quote: "Working agreements",
      },
    ],
  });
  assert(
    (await call("/context-tree")).items
      .find((x) => x.id === guide.id)
      .reference_ids.includes(child.id),
  );
  await mutate(
    "/context/" + child.id,
    {
      ...active,
      body: "Revised agreement",
      expected_revision: active.revision,
      operation_id: crypto.randomUUID(),
    },
    "PATCH",
  );
  assert.equal((await call("/context/" + guide.id)).needs_review, true);
  const fresh = await call("/context/" + child.id);
  await assert.rejects(
    mutate(
      "/context/" + child.id,
      {
        ...fresh,
        sources: [
          {
            kind: "context",
            id: guide.id,
            revision: String(guide.revision),
            quote: "",
          },
        ],
        expected_revision: fresh.revision,
        operation_id: crypto.randomUUID(),
      },
      "PATCH",
    ),
    /循环/,
  );
});

test("one-click demo extraction saves a source-backed record without a confirmation card and reuses retries", async () => {
  const task = await mutate("/todos", {
    title: "Synthetic one-click source",
    body: "A concise source",
    column_id: "backlog",
    source_id: crypto.randomUUID(),
    operation_id: crypto.randomUUID(),
  });
  const input = {
    request_id: crypto.randomUUID(),
    config_id: "demo-ai",
    source_kind: "todo",
    source_id: task.id,
    mode: "extract",
  };
  const first = await mutate("/assistant/context-auto", input);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].state, "active");
  assert.equal(first.items[0].sources[0].id, task.id);
  const retry = await mutate("/assistant/context-auto", input);
  assert.equal(retry.items[0].id, first.items[0].id);
  const next = await mutate("/assistant/context-auto", {
    ...input,
    request_id: crypto.randomUUID(),
  });
  assert.equal(next.items[0].id, first.items[0].id);
});

test("graph shows actual cross-module metadata without body snapshots or dangling edges", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw Error("offline graph must not fetch");
  };
  try {
    const graph = await call("/context-graph");
    for (const kind of [
      "context",
      "project",
      "domain",
      "todo",
      "report",
      "calendar",
    ])
      assert(
        graph.nodes.some((n) => n.kind === kind),
        kind,
      );
    assert(
      graph.nodes.every(
        (n) => !("body" in n) && !("quote" in n) && !("history" in n),
      ),
    );
    const ids = new Set(graph.nodes.map((n) => n.key));
    assert(graph.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
    assert(graph.edges.some((e) => e.kind === "calendar_todo"));
    assert(graph.edges.some((e) => e.kind === "calendar_report"));
    assert.equal(
      (await call("/context-graph?project=synthetic-unrelated")).nodes.length,
      0,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("graph layout and type filters preserve stable endpoints and directional relation labels", async () => {
  const { layoutKnowledgeGraph, visibleKnowledgeGraph, graphRelationLabel } =
    await import("../apps/web/lib/context-graph.ts");
  const data = await call("/context-graph");
  const a = layoutKnowledgeGraph(data.nodes, data.edges),
    b = layoutKnowledgeGraph(
      [...data.nodes].reverse(),
      [...data.edges].reverse(),
    );
  assert.deepEqual(a, b);
  assert(
    Object.values(a).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
  const filtered = visibleKnowledgeGraph(data, new Set(["context", "todo"])),
    ids = new Set(filtered.nodes.map((n) => n.key));
  assert(
    filtered.nodes.every((n) => n.kind === "context" || n.kind === "todo"),
  );
  assert(filtered.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
  assert.equal(
    graphRelationLabel(
      { from: "child", to: "parent", kind: "parent" },
      "parent",
    ),
    "子文档",
  );
  assert.equal(
    graphRelationLabel(
      { from: "knowledge", to: "source", kind: "source" },
      "source",
    ),
    "被知识引用",
  );
});

test("exploration starts with broad topics and drills through only immediate actual children", async () => {
  const { exploreTopics, exploreChildren, explorePath, exploreDescendants } =
    await import("../apps/web/lib/context-explore.ts");
  const tree = (await call("/context-tree")).items,
    meta = await call("/meta"),
    topics = exploreTopics(tree, meta);
  const project = topics.find((t) => t.key === "project:demo-launch");
  assert(project);
  const roots = exploreChildren(project);
  assert(roots.some((n) => n.id === "demo-wiki-project"));
  assert(!roots.some((n) => n.id === "demo-context-1"));
  const level = exploreChildren(project, "demo-wiki-project");
  assert(level.some((n) => n.id === "demo-wiki-guide"));
  assert(level.some((n) => n.id === "demo-context-1"));
  assert.deepEqual(
    explorePath(project, "demo-wiki-guide").map((n) => n.id),
    ["demo-wiki-project", "demo-wiki-guide"],
  );
  assert(
    exploreDescendants(project, "demo-wiki-project").has("demo-context-1"),
  );
  const filtered = exploreTopics(tree, meta, ["demo-wiki-guide"]).find(
    (t) => t.key === "project:demo-launch",
  );
  assert.equal(filtered.matches.size, 1);
  assert.deepEqual(
    exploreChildren(filtered).map((n) => n.id),
    ["demo-wiki-project"],
  );
  assert.deepEqual(
    exploreChildren(filtered, "demo-wiki-project").map((n) => n.id),
    ["demo-wiki-guide"],
  );
  assert.equal(exploreTopics(tree, meta, []).length, 0);
  const matches = await call(
    "/context-tree?q=" + encodeURIComponent("验收指南") + "&kind=document",
  );
  assert(matches.items.some((n) => n.id === "demo-wiki-guide"));
  for (const node of matches.items) {
    const original = await call("/context/" + node.id);
    assert((original.title + " " + original.body).includes("验收指南"));
  }
});

test("exploration handles wide directories and never reconstructs an unavailable parent", async () => {
  const { exploreTopics, exploreChildren, explorePath } =
    await import("../apps/web/lib/context-explore.ts");
  const { demoMeta } = await import("../apps/web/lib/public-demo.ts");
  const nodes = Array.from({ length: 1000 }, (_, i) => ({
    id: "wide-" + i,
    parent_id: i === 0 ? "unavailable-parent" : "",
    title: "Wide topic " + i,
    kind: "document",
    state: "active",
    visibility: "team",
    project_id: "demo-launch",
    domains: [],
    creator_id: "demo-alice",
    revision: 1,
    needs_review: false,
    updated_at: "",
  }));
  const topic = exploreTopics(nodes, demoMeta)[0];
  assert.equal(exploreChildren(topic).length, 1000);
  assert.deepEqual(
    explorePath(topic, "wide-0").map((n) => n.id),
    ["wide-0"],
  );
  assert(!topic.nodes.some((n) => n.id === "unavailable-parent"));
});
