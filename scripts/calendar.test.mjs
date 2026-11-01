import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  calendarReportHref,
  calendarDateSelection,
  quickCalendarSchedule,
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

test("Calendar report overlays retain date, view, source, scope and node context", () => {
  const context =
    "date=2026-11-01&day=2026-11-02&mode=schedule&view=week&project=sample&domain=Design&member=alice&event=phase-1&filters=1";
  const href = calendarReportHref(context, "report + /&");
  assert.equal(href.split("?")[0], "/calendar");
  const opened = new URLSearchParams(href.split("?")[1]);
  assert.equal(opened.get("report"), "report + /&");
  for (const [key, value] of new URLSearchParams(context))
    assert.equal(opened.get(key), value);
  const closed = new URLSearchParams(
    calendarReportHref(opened.toString(), "").split("?")[1],
  );
  assert.equal(closed.has("report"), false);
  assert.equal(closed.toString(), new URLSearchParams(context).toString());
  assert.equal(calendarReportHref("", ""), "/calendar");
});

test("quick creation keeps inclusive dates and reverses a backwards Gantt selection", () => {
  const days = ["2026-10-31", "2026-11-01", "2026-11-02"];
  assert.deepEqual(calendarDateSelection(days, 2, 0), {
    kind: "date-range",
    start_date: days[0],
    end_date: days[2],
  });
  assert.equal(calendarDateSelection(days, 1, 1).end_date, days[1]);
  assert.throws(() => calendarDateSelection(days, -1, 2), /日期范围无效/);
  assert.deepEqual(
    quickCalendarSchedule(days[0], undefined, "Asia/Shanghai").schedule,
    { kind: "date-range", start_date: days[0], end_date: days[0] },
  );
});

test("week quick creation snaps to half-hour slots and handles midnight without date drift", () => {
  const seed = quickCalendarSchedule(
    "2026-11-01",
    9 * 60 + 17,
    "Asia/Shanghai",
  );
  assert.equal(seed.needsTimeChoice, false);
  assert.equal(seed.schedule.start_at, "2026-11-01T01:00:00.000Z");
  assert.equal(seed.schedule.end_at, "2026-11-01T01:30:00.000Z");
  const late = quickCalendarSchedule("2026-11-01", 1439, "Asia/Shanghai");
  assert.equal(late.schedule.start_at, "2026-11-01T15:30:00.000Z");
  assert.equal(late.schedule.end_at, "2026-11-01T16:00:00.000Z");
  assert.ok(validSchedule(late.schedule));
});

test("quick creation leaves DST gaps and folds unresolved for explicit editing", () => {
  for (const [day, minute] of [
    ["2026-03-08", 120],
    ["2026-11-01", 90],
  ]) {
    const seed = quickCalendarSchedule(day, minute, "America/New_York");
    assert.equal(seed.needsTimeChoice, true);
    assert.equal(seed.schedule.kind, "time-range");
    assert.equal(seed.schedule.start_at, "");
    assert.equal(validSchedule(seed.schedule), false);
  }
});

test("week dragged durations survive into the event seed and use the display zone", () => {
  const seed = quickCalendarSchedule("2026-11-01", 480, "Asia/Shanghai", 630);
  assert.equal(seed.schedule.start_at, "2026-11-01T00:00:00.000Z");
  assert.equal(seed.schedule.end_at, "2026-11-01T02:30:00.000Z");
  assert.ok(validSchedule(seed.schedule));
  const midnight = quickCalendarSchedule(
    "2026-11-01",
    1410,
    "Asia/Shanghai",
    1440,
  );
  assert.equal(midnight.schedule.end_at, "2026-11-01T16:00:00.000Z");
  assert.equal(
    quickCalendarSchedule("2026-11-01", 0, "America/New_York", 90)
      .needsTimeChoice,
    true,
  );
  assert.throws(
    () => quickCalendarSchedule("2026-11-01", 600, "UTC", 540),
    /日期范围无效/,
  );
});
