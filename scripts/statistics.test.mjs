import assert from "node:assert/strict";
import test from "node:test";
import { statisticsDemo } from "../apps/web/lib/statistics-demo.ts";
import { publicDemoRequest } from "../apps/web/lib/public-demo.ts";
import { cacheableRead } from "../apps/web/lib/read-cache.ts";
import { sharedFilterPage } from "../apps/web/lib/shared-filters.ts";
const at = "2026-11-01T01:00:00Z",
  end = "2026-11-02T02:00:00Z",
  now = new Date("2026-11-08T01:00:00Z");
const q = "/statistics?from=2026-11-01&to=2026-11-08&timezone=Asia%2FShanghai";
const report = {
  id: "report",
  author_id: "alice",
  project_id: "one",
  title: "Synthetic",
  domains: ["design", "code"],
  links: [
    { url: "https://EXAMPLE.test/result#one" },
    { url: "https://example.test/result#two" },
  ],
  status: "delivered",
  created_at: at,
};
const start = {
  id: "task",
  title: "Synthetic",
  project_id: "one",
  assignee_id: "alice",
  domains: ["design", "code"],
  created_at: at,
};
const finished = { ...start, completed_at: end };
const task = {
  ...finished,
  archived: true,
  history: [
    { before: {}, after: start, created_at: at },
    { before: start, after: finished, created_at: end },
  ],
};
test("offline ledger mirrors Go manual sample: distinct links, sources, events and cycle duration", () => {
  const v = statisticsDemo(
    q + "&metric=todos_completed",
    [report],
    [task],
    [],
    now,
  );
  const count = (k) => v.metrics.find((m) => m.key === k)?.count;
  assert.equal(count("reports_created"), 1);
  assert.equal(count("delivery_links"), 1);
  assert.equal(count("todos_open"), 0);
  assert.equal(count("todos_completed"), 1);
  assert.equal(v.duration.one_to_seven_days, 1);
  assert.equal(v.details[0].id, "task");
  assert.equal(v.groups[0].values.todos_completed, 1);
  assert.equal(v.trend[0].values.reports_created, 1);
});
test("offline filters, revision binding, zero samples and permissions are explicit", () => {
  const v = statisticsDemo(q + "&project=other", [report], [task], [], now);
  assert.equal(v.metrics.find((m) => m.key === "reports_created").count, 0);
  assert(v.coverage.includes("no_collaboration_samples"));
  assert.throws(
    () => statisticsDemo(q + "&revision=stale", [report], [], [], now),
    /统计数据已变化/,
  );
  assert.throws(
    () => statisticsDemo(q + "&metric=unknown", [], [], [], now),
    /统计指标无效/,
  );
  assert.throws(
    () =>
      statisticsDemo(
        "/statistics?from=2026-11-01&to=2027-11-01",
        [],
        [],
        [],
        now,
      ),
    /日期范围/,
  );
});
test("statistics uses shared filters/cache and public adapter never needs a real backend", async () => {
  assert(sharedFilterPage("/statistics/"));
  assert(cacheableRead("/statistics?from=2026-11-01"));
  const v = await publicDemoRequest(q);
  assert(v.capabilities.reports);
  assert(v.coverage.includes("synthetic_offline_demo"));
  await assert.rejects(
    publicDemoRequest(q, { method: "POST" }),
    /统计只支持读取/,
  );
});

test("assistant statistics links only allow the scoped internal query contract", async () => {
  const { safeAssistantLink } = await import("../apps/web/lib/assistant.ts");
  assert(
    safeAssistantLink(
      "/statistics?from=2026-11-01&to=2026-11-08&timezone=UTC&project=synthetic&filters=1",
    ),
  );
  for (const url of [
    "https://elsewhere.example/statistics?from=2026-11-01&to=2026-11-08",
    "/statistics?from=invalid&to=2026-11-08",
    "/statistics?from=2026-11-01&to=2026-11-08&redirect=https://elsewhere.example",
    "/statistics?from=2026-11-01&to=2026-11-08#external",
  ])
    assert.equal(safeAssistantLink(url), false);
});
