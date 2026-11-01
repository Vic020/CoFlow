import type { Report } from "./types";
import type { TodoEvent } from "./todo";

export type Schedule = {
  kind: "date-range" | "time-range";
  start_date?: string;
  end_date?: string;
  start_at?: string;
  end_at?: string;
  timezone?: string;
};
export type CalendarEvent = {
  id: string;
  source_id: string;
  creator_id: string;
  assignee_id: string;
  project_id: string;
  domains: string[];
  kind: "phase" | "big_day" | "version";
  title: string;
  body: string;
  schedule: Schedule;
  todo_ids: string[];
  report_ids: string[];
  links: { title: string; url: string }[];
  agent: string;
  model: string;
  revision: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
  history: TodoEvent[];
};
export type CalendarItem = {
  creator_id: string;
  id: string;
  key: string;
  source: "todo" | "event";
  kind: string;
  title: string;
  project_id: string;
  domains: string[];
  member_id: string;
  schedule: Schedule | null;
  due_date?: string;
  completed: boolean;
  revision: number;
};
export type ReportPage = {
  items: Report[];
  days: Record<string, number>;
  previews?: Record<string, { id: string; title: string }[]>;
  total: number;
  revision: string;
  next_cursor: string;
  timezone: string;
};
export type SchedulePage = {
  items: CalendarItem[];
  capabilities: Record<string, boolean>;
  total: number;
  revision: string;
  next_cursor: string;
};

export function calendarPresentation(params: Pick<URLSearchParams, "get">) {
  const mode = params.get("mode"),
    view = params.get("view");
  const tab =
    mode === "gantt" || (mode === "schedule" && view === "gantt")
      ? "gantt"
      : mode === "schedule"
        ? "schedule"
        : "progress";
  return {
    tab,
    source: tab === "progress" ? "reports" : "schedule",
    view: tab === "gantt" ? "gantt" : view === "week" ? "week" : "month",
  } as const;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dayBounds = new Map<string, [number, number]>();
export function civilDay(value: string | Date, zone: string) {
  let formatter = dateFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (dateFormatters.size >= 32)
      dateFormatters.delete(dateFormatters.keys().next().value!);
    dateFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`;
}
// Cache only public calendar math, never a report/task or identity. Midnight can
// be skipped by DST; a date-line jump can leave an entire civil date empty.
export function civilBounds(day: string, zone: string): [number, number] {
  const key = `${zone}/${day}`;
  const cached = dayBounds.get(key);
  if (cached) return cached;
  function boundary(d: string) {
    const at = Date.parse(`${d}T00:00:00Z`) / 1000;
    let low = at - 48 * 3600,
      high = at + 48 * 3600;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (civilDay(new Date(mid * 1000), zone) < d) low = mid + 1;
      else high = mid;
    }
    return low * 1000;
  }
  const result: [number, number] = [boundary(day), boundary(addDays(day, 1))];
  if (dayBounds.size >= 400) dayBounds.delete(dayBounds.keys().next().value!);
  dayBounds.set(key, result);
  return result;
}
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function validCivilDay(day: string) {
  try {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      day.slice(0, 4) !== "0000" &&
      addDays(day, 0) === day
    );
  } catch {
    return false;
  }
}
export function monthShift(day: string, n: number) {
  const d = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
export function calendarDays(day: string, view: string) {
  const first = view === "month" ? `${day.slice(0, 7)}-01` : day;
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = addDays(first, -(weekday + 6) % 7);
  return Array.from({ length: view === "month" ? 42 : 7 }, (_, n) =>
    addDays(start, n),
  );
}
export function onDay(
  item: Pick<CalendarItem, "schedule" | "due_date">,
  day: string,
  zone: string,
) {
  const s = item.schedule;
  if (item.due_date === day) return true;
  if (!s) return false;
  if (s.kind === "date-range")
    return s.start_date! <= day && s.end_date! >= day;
  const [low, high] = civilBounds(day, zone),
    start = Date.parse(s.start_at!),
    end = Date.parse(s.end_at!);
  return (
    low < high && start < high && (end > low || (start === end && start >= low))
  );
}
export function localTime(instant: string, zone: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
// Return both choices during a DST fold, none during a gap. Never silently
// normalize a nonexistent wall time or choose an ambiguous instant.
export function wallTimeCandidates(value: string, zone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const naive = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(naive)) return [];
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 6) {
    const at = naive + hour * 3600000;
    offsets.add(
      Date.parse(`${localTime(new Date(at).toISOString(), zone)}:00Z`) - at,
    );
  }
  return [...offsets]
    .map((offset) => new Date(naive - offset).toISOString())
    .filter((at) => localTime(at, zone) === value)
    .sort();
}
export function validSchedule(s: Schedule | null | undefined, point = false) {
  if (!s) return true;
  if (s.kind === "date-range")
    return (
      validCivilDay(s.start_date || "") &&
      validCivilDay(s.end_date || "") &&
      s.start_date! <= s.end_date! &&
      !s.start_at &&
      !s.end_at &&
      !s.timezone
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: s.timezone });
  } catch {
    return false;
  }
  return (
    s.kind === "time-range" &&
    !!s.timezone &&
    !!s.start_at &&
    !!s.end_at &&
    Number.isFinite(Date.parse(s.start_at)) &&
    Number.isFinite(Date.parse(s.end_at)) &&
    (point
      ? Date.parse(s.start_at) <= Date.parse(s.end_at)
      : Date.parse(s.start_at) < Date.parse(s.end_at)) &&
    !s.start_date &&
    !s.end_date
  );
}

export function pastDeadline(s: Schedule | null | undefined, due: string) {
  if (!s || !due) return false;
  try {
    return (
      (s.kind === "date-range"
        ? s.end_date!
        : civilDay(new Date(Date.parse(s.end_at!) - 1), s.timezone!)) > due
    );
  } catch {
    return false;
  }
}

// A report is an overlay on the current Calendar context, not a module switch.
export function calendarReportHref(params: string, id: string) {
  const next = new URLSearchParams(params);
  if (id) next.set("report", id);
  else next.delete("report");
  return "/calendar" + (next.size ? "?" + next : "");
}

export function calendarDateSelection(
  days: string[],
  start: number,
  end: number,
): Schedule {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    !days[start] ||
    !days[end]
  )
    throw new RangeError("日期范围无效");
  const [low, high] = [Math.min(start, end), Math.max(start, end)];
  return { kind: "date-range", start_date: days[low], end_date: days[high] };
}

// A quick-create seed is a user-editable plan, never a report or an immediate write.
export function quickCalendarSchedule(
  day: string,
  minute: number | undefined,
  zone: string,
  endMinute?: number,
) {
  if (!validCivilDay(day)) throw new RangeError("日期范围无效");
  if (minute === undefined)
    return {
      schedule: {
        kind: "date-range",
        start_date: day,
        end_date: day,
      } as Schedule,
      needsTimeChoice: false,
    };
  if (!Number.isFinite(minute)) throw new RangeError("日期范围无效");
  const start = Math.max(0, Math.min(1410, Math.floor(minute / 30) * 30));
  if (
    endMinute !== undefined &&
    (!Number.isFinite(endMinute) || endMinute <= start || endMinute > 1440)
  )
    throw new RangeError("日期范围无效");
  const end =
    endMinute === undefined ? start + 30 : Math.ceil(endMinute / 30) * 30;
  const wall = (value: number) =>
    `${addDays(day, Math.floor(value / 1440))}T${String(Math.floor((value % 1440) / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  const starts = wallTimeCandidates(wall(start), zone),
    ends = wallTimeCandidates(wall(end), zone);
  const certain =
    starts.length === 1 &&
    ends.length === 1 &&
    Date.parse(ends[0]) > Date.parse(starts[0]);
  return {
    schedule: {
      kind: "time-range",
      start_at: certain ? starts[0] : "",
      end_at: certain ? ends[0] : "",
      timezone: zone,
    } as Schedule,
    needsTimeChoice: !certain,
  };
}
