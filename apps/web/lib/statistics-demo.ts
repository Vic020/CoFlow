// Public offline demo only. Team statistics are always computed by Go.
import { addDays, civilDay, onDay } from "./calendar.ts";
import type { CalendarEvent } from "./calendar";
import type { Todo } from "./todo";
import type { Report } from "./types";
import {
  statisticLabels,
  type StatisticRecord,
  type StatisticsResult,
} from "./statistics.ts";
export function statisticsDemo(
  path: string,
  reports: Report[],
  tasks: Todo[],
  events: CalendarEvent[],
  now = new Date(),
): StatisticsResult {
  const q = new URLSearchParams(path.split("?")[1]),
    from = q.get("from") || "",
    to = q.get("to") || "",
    zone = q.get("timezone") || "UTC",
    by = q.get("group_by") || "project";
  const dateValid = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  try {
    civilDay(now, zone);
  } catch {
    throw Error("时区无效");
  }
  if (
    zone === "Local" ||
    !dateValid(from) ||
    !dateValid(to) ||
    to <= from ||
    Date.parse(to) - Date.parse(from) > 93 * 86400000
  )
    throw Error("日期范围需为 1–93 天");
  if (!["project", "domain", "member", "agent", "model"].includes(by))
    throw Error("统计分组无效");
  const metric = q.get("metric") || "",
    offset = Number(q.get("offset") || 0);
  if (metric && !(metric in statisticLabels)) throw Error("统计指标无效");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw Error("统计分页无效");
  if (offset > 0 && !q.get("revision")) throw Error("统计分页需要 revision");
  const records: Record<string, StatisticRecord[]> = {},
    days: Record<string, Record<string, number>> = {};
  for (let d = from; d < to; d = addDays(d, 1)) days[d] = {};
  const match = (r: StatisticRecord, keys: (keyof StatisticRecord)[]) =>
    keys.every(
      (k) => !q.get(k) || q.get(k) === r[k as keyof StatisticRecord],
    ) &&
    (!q.get("domain") || r.domains.includes(q.get("domain")!));
  const inside = (at: string) => {
    const d = civilDay(at, zone);
    return d >= from && d < to;
  };
  const agents = new Set<string>(), models = new Set<string>();
  const includeSources = q.get("include_sources") === "true";
  const add = (key: string, r: StatisticRecord) => {
    if (includeSources && match(r, ["project", "member"])) {
      if (r.agent) agents.add(r.agent);
      if (r.model) models.add(r.model);
    }
    if (match(r, ["project", "member", "agent", "model"])) (records[key] ??= []).push(r);
  };
  const taskRecord = (t: Partial<Todo>, at: string): StatisticRecord => ({
    id: t.id || "",
    title: t.title || "",
    url: "/todo?todo=" + encodeURIComponent(t.id || ""),
    at,
    project: t.project_id || "",
    domains: t.domains || [],
    member: t.assignee_id || "",
    agent: t.agent || "",
    model: t.model || "",
  });
  const overlaps = (s: Todo["schedule"]) =>
    !!s && Object.keys(days).some((d) => onDay({ schedule: s }, d, zone));
  for (const r of reports) {
    if (r.deleted_at || !inside(r.created_at)) continue;
    const x: StatisticRecord = {
      id: r.id,
      title: r.title,
      url: "/?report=" + encodeURIComponent(r.id),
      at: r.created_at,
      project: r.project_id,
      domains: r.domains || [],
      member: r.author_id,
      agent: r.agent,
      model: r.model,
    };
    add("reports_created", x);
    if (r.status === "delivered") add("reports_delivered", x);
    add("reporters", { ...x, id: r.author_id });
    for (const link of r.links) {
      try {
        const u = new URL(link.url);
        if (!["http:", "https:"].includes(u.protocol)) continue;
        u.hash = "";
        add("delivery_links", { ...x, id: r.id + ":" + u.toString() });
      } catch {}
    }
  }
  for (const t of tasks) {
    const r = taskRecord(t, t.created_at);
    if (!t.archived) {
      if (!t.completed_at) {
        add("todos_open", r);
        if (t.column_id === "review" || t.review?.state === "pending")
          add("todos_review", r);
        if (t.due_date && t.due_date < civilDay(now, zone))
          add("todos_overdue", r);
        if (!t.schedule && !t.due_date) add("todos_unscheduled", r);
      }
      if (
        overlaps(t.schedule) ||
        (!t.schedule && t.due_date && t.due_date >= from && t.due_date < to)
      ) {
        add("scheduled_todos", r);
        if (t.completed_at) add("scheduled_completed", r);
      }
    }
    const history = [...t.history].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    const creation = history.find((h) => !h.before.id && h.after.id === t.id);
    if (inside(t.created_at))
      add(
        "todos_created",
        creation
          ? {
              ...taskRecord(creation.after, t.created_at),
              agent: creation.agent,
              model: creation.model,
            }
          : r,
      );
    let cycle: string | undefined;
    for (const h of history) {
      if (!h.after.id) continue;
      if (!h.before.id && !h.after.completed_at) cycle = h.after.created_at;
      if (h.before.completed_at && !h.after.completed_at) {
        cycle = h.created_at;
        if (inside(h.created_at))
          add("todos_reopened", {
            ...taskRecord(h.after, h.created_at),
            agent: h.agent,
            model: h.model,
          });
      }
      if (!h.before.completed_at && h.after.completed_at) {
        if (inside(h.created_at)) {
          const record = {
            ...taskRecord(h.after, h.created_at),
            agent: h.agent,
            model: h.model,
          };
          if (cycle && cycle <= h.created_at)
            record.hours =
              (Date.parse(h.created_at) - Date.parse(cycle)) / 3600000;
          add("todos_completed", record);
        }
        cycle = undefined;
      }
    }
  }
  for (const e of events)
    if (!e.archived && overlaps(e.schedule))
      add("calendar_nodes", {
        id: e.id,
        title: e.title,
        url: "/calendar?mode=schedule&event=" + encodeURIComponent(e.id),
        at: e.created_at,
        project: e.project_id,
        domains: e.domains,
        member: e.assignee_id,
        agent: e.agent,
        model: e.model,
      });
  const unique = (xs: StatisticRecord[]) => [
    ...new Map(xs.map((r) => [r.id, r])).values(),
  ]; // Counts deduplicate; detail below retains the first dated event.
  const firstUnique = (xs: StatisticRecord[]) => {
    const seen = new Set<string>();
    return xs.filter((r) => !seen.has(r.id) && !!seen.add(r.id));
  };
  for (const k of Object.keys(records))
    if (k !== "reporters") records[k] = firstUnique(records[k]);
  const groupKeys = (r: StatisticRecord) =>
    by === "domain"
      ? r.domains.length
        ? r.domains
        : [""]
      : [
          by === "project"
            ? r.project
            : by === "member"
              ? r.member
              : by === "agent"
                ? r.agent
                : r.model,
        ];
  const basis = (k: string) =>
    ["reports_delivered", "delivery_links"].includes(k)
      ? "period_current_status"
      : k.startsWith("scheduled")
        ? "overlapping_plan_current_status"
        : k === "calendar_nodes"
          ? "overlapping_plan"
          : [
                "todos_open",
                "todos_review",
                "todos_overdue",
                "todos_unscheduled",
                "collaborations_open",
                "collaborations_transferred",
              ].includes(k)
            ? "current"
            : [
                  "todos_completed",
                  "todos_reopened",
                  "collaborations_completed",
                ].includes(k)
              ? "period_event"
              : "period";
  const groups: Record<string, Record<string, number>> = {};
  for (const k of Object.keys(statisticLabels)) {
    const xs = records[k] || [];
    const byGroup: Record<string, StatisticRecord[]> = {};
    for (const r of xs)
      for (const g of new Set(groupKeys(r))) (byGroup[g] ??= []).push(r);
    for (const [g, rs] of Object.entries(byGroup)) {
      groups[g] ??= {};
      groups[g][k] = unique(rs).length;
    }
    if (
      [
        "reports_created",
        "todos_created",
        "todos_completed",
        "todos_reopened",
        "collaborations_created",
        "collaborations_completed",
        "reporters",
      ].includes(k)
    )
      for (const d of Object.keys(days))
        days[d][k] = unique(
          xs.filter((r) => civilDay(r.at, zone) === d),
        ).length;
  }
  const signature = JSON.stringify([
    from,
    to,
    zone,
    by,
    ["project", "domain", "member", "agent", "model"].map((k) => q.get(k)),
    records,
    civilDay(now, zone),
  ]);
  let hash = 0;
  for (const ch of signature)
    hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  const revision = String(hash);
  if (q.get("revision") && q.get("revision") !== revision)
    throw Error("统计数据已变化，请刷新后重试");
  const details = firstUnique(
    (records[metric] || []).filter(
      (r) =>
        !q.has("group") ||
        groupKeys(r).includes(
          q.get("group") === "__unassigned__" ? "" : q.get("group")!,
        ),
    ),
  ).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const duration = {
    under_day: 0,
    one_to_seven_days: 0,
    over_seven_days: 0,
    missing: 0,
  };
  for (const r of records.todos_completed || [])
    duration[
      r.hours === undefined
        ? "missing"
        : r.hours < 24
          ? "under_day"
          : r.hours <= 168
            ? "one_to_seven_days"
            : "over_seven_days"
    ]++;
  return {
    from,
    to,
    timezone: zone,
    generated_at: now.toISOString(),
    revision,
    capabilities: { reports: true, todos: true, calendar: true },
    metrics: Object.keys(statisticLabels).map((key) => ({
      key,
      basis: basis(key),
      count: unique(records[key] || []).length,
    })),
    trend: Object.entries(days).map(([day, values]) => ({ day, values })),
    groups: Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => ({ key, values })),
    details: details.slice(offset, offset + 50),
    detail_total: details.length,
    next_offset: Math.min(details.length, offset + 50),
    has_more: offset + 50 < details.length,
    duration,
    ...(includeSources ? { sources: { agents: [...agents].sort(), models: [...models].sort() } } : {}),
    coverage: ["synthetic_offline_demo", "no_collaboration_samples"],
  };
}
