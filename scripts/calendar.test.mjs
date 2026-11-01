import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  calendarDays,
  civilDay,
  onDay,
  validSchedule,
  wallTimeCandidates,
} from "../apps/web/lib/calendar.ts";
import { publicDemoRequest } from "../apps/web/lib/public-demo.ts";

test("civil month/week ranges and leap/year boundaries", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  const month = calendarDays("2026-11-15", "month");
  assert.equal(month.length, 42);
  assert.equal(month[0], "2026-10-26");
  assert.equal(calendarDays("2026-11-01", "week")[0], "2026-10-26");
  assert.equal(
    validSchedule({
      kind: "date-range",
      start_date: "2026-02-30",
      end_date: "2026-03-03",
    }),
    false,
  );
});
test("DST gaps and folds require explicit choices", () => {
  assert.deepEqual(
    wallTimeCandidates("2026-03-08T02:30", "America/New_York"),
    [],
  );
  assert.deepEqual(wallTimeCandidates("2026-11-01T01:30", "America/New_York"), [
    "2026-11-01T05:30:00.000Z",
    "2026-11-01T06:30:00.000Z",
  ]);
  assert.deepEqual(wallTimeCandidates("2026-11-01T09:00", "Asia/Shanghai"), [
    "2026-11-01T01:00:00.000Z",
  ]);
  const item = {
    schedule: {
      kind: "time-range",
      start_at: "2026-03-08T05:00:00Z",
      end_at: "2026-03-09T04:00:00Z",
      timezone: "America/New_York",
    },
  };
  assert.equal(onDay(item, "2026-03-08", "America/New_York"), true);
  assert.equal(onDay(item, "2026-03-09", "America/New_York"), false);
  assert.equal(
    onDay(
      {
        schedule: {
          kind: "time-range",
          start_at: "2011-12-29T12:00:00Z",
          end_at: "2012-01-01T12:00:00Z",
          timezone: "Pacific/Apia",
        },
      },
      "2011-12-30",
      "Pacific/Apia",
    ),
    false,
  );
  assert.equal(
    civilDay("2026-10-31T00:30:00Z", "America/Los_Angeles"),
    "2026-10-30",
  );
  for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati"])
    assert.equal(
      onDay(
        {
          schedule: {
            kind: "date-range",
            start_date: "2026-10-31",
            end_date: "2026-10-31",
          },
        },
        "2026-10-31",
        zone,
      ),
      true,
    );
});
test("offline calendar projects original reports and shares Todo plans", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("unexpected network");
  };
  try {
    const d = civilDay(new Date(), "Asia/Shanghai");
    const q = `?from=${addDays(d, -30)}&to=${addDays(d, 30)}&timezone=Asia%2FShanghai&limit=1`;
    const reports = await publicDemoRequest(`/calendar/reports${q}`);
    assert.equal(reports.total, 6);
    assert.equal(
      Object.values(reports.days).reduce((a, b) => a + b, 0),
      6,
    );
    assert.ok(reports.next_cursor);
    assert.ok(Object.values(reports.previews).every((xs) => xs.length <= 3));
    const next = await publicDemoRequest(
      `/calendar/reports${q}&cursor=${reports.next_cursor}&revision=${encodeURIComponent(reports.revision)}`,
    );
    assert.notEqual(next.items[0].id, reports.items[0].id);
    const task = await publicDemoRequest("/todos/demo-todo-1");
    await publicDemoRequest(`/todos/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        schedule: {
          kind: "date-range",
          start_date: d,
          end_date: addDays(d, 2),
        },
        operation_id: "calendar-schedule-test",
        expected_revision: task.revision,
      }),
    });
    const changed = await publicDemoRequest(`/todos/${task.id}`);
    assert.equal(changed.due_date, task.due_date);
    assert.equal(changed.column_id, task.column_id);
    const page = await publicDemoRequest(
      `/calendar/schedule${q.replace("limit=1", "limit=200")}`,
    );
    assert.ok(
      page.items.some((i) => i.id === task.id && i.schedule.start_date === d),
    );
    const input = {
      title: "Synthetic milestone",
      kind: "version",
      source_id: "demo-calendar-test",
      schedule: { kind: "date-range", start_date: d, end_date: d },
      operation_id: "calendar-create-test",
      todo_ids: [task.id],
      report_ids: [reports.items[0].id],
    };
    const event = await publicDemoRequest("/calendar/events", {
      method: "POST",
      body: JSON.stringify(input),
    });
    assert.equal(
      (
        await publicDemoRequest("/calendar/events", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).revision,
      event.revision,
    );
    await assert.rejects(
      publicDemoRequest(`/calendar/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: "Stale",
          expected_revision: 0,
          operation_id: "stale-event",
        }),
      }),
    );
    assert.equal(
      (await publicDemoRequest(`/calendar/events/${event.id}`)).report_ids
        .length,
      1,
    );
    assert.equal((await publicDemoRequest("/reports")).items.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
