import test from "node:test";
import assert from "node:assert/strict";
import { calendarPresentation } from "../apps/web/lib/calendar.ts";
import {
  weekSegments,
  positionWeekSegments,
  isoWeek,
  weekTimeSelection,
} from "../apps/web/lib/calendar-week.ts";

test("primary Calendar tabs preserve legacy links and use the right data source", () => {
  for (const query of ["", "mode=reports", "mode=progress"]) {
    assert.equal(
      calendarPresentation(new URLSearchParams(query)).tab,
      "progress",
    );
    assert.equal(
      calendarPresentation(new URLSearchParams(query)).source,
      "reports",
    );
  }
  assert.deepEqual(
    calendarPresentation(new URLSearchParams("mode=gantt&view=week")),
    { tab: "gantt", source: "schedule", view: "gantt" },
  );
  assert.deepEqual(
    calendarPresentation(new URLSearchParams("mode=schedule&view=gantt")),
    { tab: "gantt", source: "schedule", view: "gantt" },
  );
  assert.deepEqual(
    calendarPresentation(new URLSearchParams("mode=schedule&view=week")),
    { tab: "schedule", source: "schedule", view: "week" },
  );
});
test("timed ranges clip at midnight while reports and milestones remain instants", () => {
  const a = weekSegments(
    "task",
    "2026-11-01T23:30:00Z",
    "2026-11-02T01:00:00Z",
    "2026-11-01",
    "UTC",
  );
  assert.deepEqual(
    a.map((s) => [s.start, s.end, s.continuation]),
    [[1410, 1440, true]],
  );
  const b = weekSegments(
    "task",
    "2026-11-01T23:30:00Z",
    "2026-11-02T01:00:00Z",
    "2026-11-02",
    "UTC",
  );
  assert.deepEqual(
    b.map((s) => [s.start, s.end]),
    [[0, 60]],
  );
  const point = weekSegments(
    "report",
    "2026-11-01T10:15:00Z",
    "2026-11-01T10:15:00Z",
    "2026-11-01",
    "UTC",
  )[0];
  assert.equal(point.point, true);
  assert.equal(point.start, 615);
  assert.equal(point.end, 615);
  assert.equal(
    weekSegments(
      "end",
      "2026-10-31T23:00:00Z",
      "2026-11-01T00:00:00Z",
      "2026-11-01",
      "UTC",
    ).length,
    0,
  );
});
test("week grid preserves DST gaps, repeated hours and skipped dates", () => {
  const spring = weekSegments(
    "spring",
    "2026-03-08T06:30:00Z",
    "2026-03-08T07:30:00Z",
    "2026-03-08",
    "America/New_York",
  );
  assert.deepEqual(
    spring.map((s) => [s.start, s.end]),
    [
      [90, 120],
      [180, 210],
    ],
  );
  const fall = weekSegments(
    "fall",
    "2026-11-01T05:30:00Z",
    "2026-11-01T06:30:00Z",
    "2026-11-01",
    "America/New_York",
  );
  assert.deepEqual(
    fall.map((s) => [s.start, s.end]),
    [
      [90, 120],
      [60, 90],
    ],
  );
  assert.ok([...spring, ...fall].every((s) => s.end >= s.start));
  assert.equal(
    weekSegments(
      "skip",
      "2011-12-29T00:00:00Z",
      "2012-01-01T00:00:00Z",
      "2011-12-30",
      "Pacific/Apia",
    ).length,
    0,
  );
});
test("overlapping events get distinct lanes without changing point durations", () => {
  const a = weekSegments(
    "a",
    "2026-11-01T10:00:00Z",
    "2026-11-01T11:00:00Z",
    "2026-11-01",
    "UTC",
  )[0];
  const b = weekSegments(
    "b",
    "2026-11-01T10:30:00Z",
    "2026-11-01T10:30:00Z",
    "2026-11-01",
    "UTC",
  )[0];
  const c = weekSegments(
    "c",
    "2026-11-01T13:00:00Z",
    "2026-11-01T14:00:00Z",
    "2026-11-01",
    "UTC",
  )[0];
  const packed = positionWeekSegments([c, b, a]);
  assert.equal(packed[0].lanes, 2);
  assert.notEqual(packed[0].lane, packed[1].lane);
  assert.equal(packed[1].start, packed[1].end);
  assert.equal(packed[2].lanes, 1);
  assert.equal(b.end, b.start);
});
test("mini month week numbers retain ISO year boundaries", () => {
  assert.equal(isoWeek("2021-01-01"), 53);
  assert.equal(isoWeek("2021-01-04"), 1);
  assert.equal(isoWeek("2026-11-02"), 45);
});

test("week drag ranges snap in either direction, keep exact ends and clamp at midnight", () => {
  assert.deepEqual(weekTimeSelection(480, 630), { start: 480, end: 630 });
  assert.deepEqual(weekTimeSelection(620, 490), { start: 480, end: 630 });
  assert.deepEqual(weekTimeSelection(480, 480), { start: 480, end: 510 });
  assert.deepEqual(weekTimeSelection(1439, 1500), { start: 1410, end: 1440 });
  assert.deepEqual(weekTimeSelection(-10, 15), { start: 0, end: 30 });
  assert.throws(() => weekTimeSelection(NaN, 600), /日期范围无效/);
});
