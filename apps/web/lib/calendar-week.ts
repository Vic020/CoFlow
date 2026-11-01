import { civilBounds } from "./calendar.ts";

export type WeekSegment = {
  key: string;
  start: number;
  end: number;
  startAt: string;
  endAt: string;
  point: boolean;
  continuation: boolean;
};
export type PositionedSegment<T extends WeekSegment> = T & {
  lane: number;
  lanes: number;
};
const formatters = new Map<string, Intl.DateTimeFormat>();
function wallEpoch(at: number, zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    if (formatters.size >= 32)
      formatters.delete(formatters.keys().next().value!);
    formatters.set(zone, f);
  }
  const p = f.formatToParts(new Date(at));
  const get = (type: string) => p.find((x) => x.type === type)!.value;
  return Date.parse(
    `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
  );
}
function offset(at: number, zone: string) {
  return (
    wallEpoch(Math.floor(at / 1000) * 1000, zone) - Math.floor(at / 1000) * 1000
  );
}

// A 00–24 wall-clock grid is not elapsed work time. Split at offset changes so
// a spring gap stays empty and a fall-back interval never becomes negative.
export function weekSegments(
  key: string,
  startAt: string,
  endAt: string,
  day: string,
  zone: string,
): WeekSegment[] {
  const start = Date.parse(startAt),
    end = Date.parse(endAt),
    [low, high] = civilBounds(day, zone),
    midnight = Date.parse(`${day}T00:00:00Z`);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    low === high
  )
    return [];
  const minute = (at: number, o: number) =>
    Math.max(0, Math.min(1440, (at + o - midnight) / 60000));
  if (start === end)
    return start >= low && start < high
      ? [
          {
            key,
            start: minute(start, offset(start, zone)),
            end: minute(start, offset(start, zone)),
            startAt,
            endAt,
            point: true,
            continuation: false,
          },
        ]
      : [];
  const a = Math.max(start, low),
    b = Math.min(end, high);
  if (a >= b) return [];
  const result: WeekSegment[] = [];
  let cursor = a,
    part = a,
    previous = offset(a, zone);
  function append(until: number) {
    result.push({
      key: `${key}:${part}`,
      start: minute(part, previous),
      end: minute(until, previous),
      startAt: new Date(part).toISOString(),
      endAt: new Date(until).toISOString(),
      point: false,
      continuation: part > start || until < end,
    });
    part = until;
  }
  while (cursor < b) {
    const next = Math.min(b, cursor + 3600000),
      o = offset(next === b ? Math.max(cursor, b - 1) : next, zone);
    if (o !== previous) {
      let left = Math.floor(cursor / 1000),
        right = Math.ceil(next / 1000);
      while (left < right) {
        const mid = left + Math.floor((right - left) / 2);
        if (offset(mid * 1000, zone) === previous) left = mid + 1;
        else right = mid;
      }
      const transition = left * 1000;
      if (transition > part) append(transition);
      previous = offset(transition, zone);
      part = transition;
      cursor = transition;
    } else cursor = next;
  }
  if (part < b) append(b);
  return result;
}

// Point markers need readable space but keep end===start in their data. Visual
// packing must never imply that a report took 40 minutes to produce.
export function positionWeekSegments<T extends WeekSegment>(
  items: T[],
): PositionedSegment<T>[] {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key),
  );
  const result: PositionedSegment<T>[] = [];
  let cluster: T[] = [];
  let until = -1;
  const finish = () => {
    const ends: number[] = [];
    const packed = cluster.map((item) => {
      let lane = ends.findIndex((end) => end <= item.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = Math.max(item.end, item.start + (item.point ? 42 : 26));
      return { ...item, lane, lanes: 0 };
    });
    for (const item of packed) result.push({ ...item, lanes: ends.length });
    cluster = [];
    until = -1;
  };
  for (const item of sorted) {
    if (cluster.length && item.start >= until) finish();
    cluster.push(item);
    until = Math.max(until, item.end, item.start + (item.point ? 42 : 26));
  }
  if (cluster.length) finish();
  return result;
}
export function isoWeek(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const first = new Date(
    `${String(d.getUTCFullYear()).padStart(4, "0")}-01-01T12:00:00Z`,
  );
  return Math.ceil(((d.getTime() - first.getTime()) / 86400000 + 1) / 7);
}
