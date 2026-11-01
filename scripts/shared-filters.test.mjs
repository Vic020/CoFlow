import assert from "node:assert/strict";
import test from "node:test";
import {
  emptySharedFilters,
  readSharedFilters,
  sharedFilterURL,
  storedSharedFilters,
  sharedFilterPage,
  restoreSharedFilters,
} from "../apps/web/lib/shared-filters.ts";
test("shared scope follows module links and preserves page-specific navigation", () => {
  const filters = {
    project: "synthetic-project",
    domain: "研发 & 设计",
    member: "synthetic-member",
  };
  for (const path of [
    "/",
    "/todo?todo=synthetic-task",
    "/calendar?mode=schedule&view=week&date=2026-11-01",
  ]) {
    const url = new URL(
      sharedFilterURL(path, filters),
      "https://coflow.example.test",
    );
    assert.deepEqual(readSharedFilters(url.searchParams), filters);
    if (path.startsWith("/todo"))
      assert.equal(url.searchParams.get("todo"), "synthetic-task");
    if (path.startsWith("/calendar")) {
      assert.equal(url.searchParams.get("mode"), "schedule");
      assert.equal(url.searchParams.get("date"), "2026-11-01");
    }
  }
});
test("explicit reset differs from inheriting context and retains local filters", () => {
  assert.equal(readSharedFilters(new URLSearchParams("mode=schedule")), null);
  const url = new URL(
    sharedFilterURL(
      "/calendar?mode=schedule&kind=phase&project=old",
      emptySharedFilters,
    ),
    "https://coflow.example.test",
  );
  assert.deepEqual(readSharedFilters(url.searchParams), emptySharedFilters);
  assert.equal(url.searchParams.get("kind"), "phase");
  assert.equal(url.searchParams.get("mode"), "schedule");
  assert.deepEqual(readSharedFilters(new URLSearchParams("project=shared")), {
    project: "shared",
    domain: "",
    member: "",
  });
});
test("stored scope rejects malformed values and stays limited to shared fields", () => {
  for (const raw of [null, "{", "[]", '"text"'])
    assert.deepEqual(storedSharedFilters(raw), emptySharedFilters);
  assert.deepEqual(
    storedSharedFilters(
      JSON.stringify({
        project: 4,
        domain: "design",
        member: null,
        token: "never retained",
      }),
    ),
    { project: "", domain: "design", member: "" },
  );
  assert.equal(
    storedSharedFilters(JSON.stringify({ project: "x".repeat(500) })).project
      .length,
    160,
  );
  for (const path of ["/", "/todo/", "/calendar/"])
    assert.equal(sharedFilterPage(path), true);
  for (const path of ["/settings", "/credentials", "/docs"])
    assert.equal(sharedFilterPage(path), false);
});

test("team/account changes restore only their own remembered scope", () => {
  const old = {
    project: "team-a-project",
    domain: "",
    member: "team-a-member",
  };
  const next = { project: "team-b-project", domain: "design", member: "" };
  assert.deepEqual(
    restoreSharedFilters("user:team-b", "user:team-a", next, old),
    next,
  );
  assert.deepEqual(
    restoreSharedFilters(
      "other:team-a",
      "user:team-a",
      emptySharedFilters,
      old,
    ),
    emptySharedFilters,
  );
  assert.deepEqual(
    restoreSharedFilters("user:team-a", "user:team-a", emptySharedFilters, old),
    old,
  );
  assert.deepEqual(
    restoreSharedFilters("user:team-a", null, emptySharedFilters, old),
    old,
  );
});
