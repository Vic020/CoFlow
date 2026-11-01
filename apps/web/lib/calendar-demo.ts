import {
  addDays,
  civilDay,
  onDay,
  validSchedule,
  type CalendarEvent,
  type CalendarItem,
} from "./calendar.ts";
import type { Todo } from "./todo";
import type { Report } from "./types";

const today = civilDay(new Date(), "Asia/Shanghai");
const events: CalendarEvent[] = (["phase", "big_day", "version"] as const).map(
  (kind, i) => ({
    id: `demo-event-${i + 1}`,
    source_id: `demo-calendar-source-${i + 1}`,
    creator_id: "demo-alice",
    assignee_id: i === 0 ? "demo-bob" : "demo-alice",
    project_id: "demo-launch",
    domains: ["产品"],
    kind,
    title: ["发布验收阶段", "产品演示日", "下一版本计划节点"][i],
    body: "虚构的协作计划；实际进展与交付证据见关联任务和简报。",
    schedule: {
      kind: "date-range",
      start_date: addDays(today, i === 0 ? -3 : i + 2),
      end_date: addDays(today, i === 0 ? 5 : i + 2),
    },
    todo_ids: [`demo-todo-${i + 1}`],
    report_ids: [`demo-report-${i + 1}`],
    links: [],
    agent: "",
    model: "",
    revision: 1,
    archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    history: [],
  }),
);
const operations = new Map<string, { hash: string; result: CalendarEvent }>();
function revision(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 14695981039346656037n;
  for (const c of text)
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(c.charCodeAt(0))) * 1099511628211n,
    );
  return hash.toString(16);
}
// The demo adapter deliberately uses no fetch, tokens, account state or storage.
export function calendarDemo(
  path: string,
  method: string,
  payload: Record<string, any>,
  reports: Report[],
  tasks: Todo[],
) {
  const [base, query] = path.split("?");
  const q = new URLSearchParams(query);
  const zone = q.get("timezone") || "UTC";
  const from = q.get("from") || "";
  const to = q.get("to") || "";
  const limit = Math.min(200, Math.max(1, Number(q.get("limit") || 100)));
  function paginate<T>(items: T[], stamp: string) {
    if (q.get("revision") && q.get("revision") !== stamp)
      throw new Error("日历数据已变化，请刷新后重试");
    const start = Number(q.get("cursor") || 0);
    if (
      !Number.isInteger(start) ||
      start < 0 ||
      start > items.length ||
      (start && !q.get("revision"))
    )
      throw new Error("分页标识无效");
    return {
      items: structuredClone(items.slice(start, start + limit)),
      next_cursor: start + limit < items.length ? String(start + limit) : "",
      revision: stamp,
    };
  }
  const match = (
    x: { project_id: string; domains?: string[]; title: string },
    member: string,
  ) =>
    (!q.get("project") || q.get("project") === x.project_id) &&
    (!q.get("domain") || x.domains?.includes(q.get("domain")!)) &&
    (!q.get("member") || q.get("member") === member) &&
    (!q.get("q") || x.title.toLowerCase().includes(q.get("q")!.toLowerCase()));
  if (method === "GET" && base === "/calendar/reports") {
    const all = reports
      .filter((r) => {
        const day = civilDay(r.created_at, zone);
        return (
          day >= from &&
          day < to &&
          match({ ...r, title: `${r.title} ${r.body}` }, r.author_id) &&
          (!q.get("agent") || q.get("agent") === r.agent) &&
          (!q.get("model") || q.get("model") === r.model) &&
          (!q.get("status") || q.get("status") === r.status)
        );
      })
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
    const days: Record<string, number> = {};
    all.forEach((r) => {
      const d = civilDay(r.created_at, zone);
      days[d] = (days[d] || 0) + 1;
    });
    const items = all.filter(
      (r) => !q.get("day") || civilDay(r.created_at, zone) === q.get("day"),
    );
    const signature = new URLSearchParams(q);
    signature.delete("cursor");
    signature.delete("revision");
    signature.delete("limit");
    return {
      ...paginate(
        items,
        revision([signature.toString(), all.map((r) => [r.id, r.updated_at])]),
      ),
      total: items.length,
      days,
      previews: Object.fromEntries(
        Object.keys(days).map((d) => [
          d,
          all
            .filter((r) => civilDay(r.created_at, zone) === d)
            .slice(0, 3)
            .map((r) => ({ id: r.id, title: r.title })),
        ]),
      ),
      timezone: zone,
    };
  }
  if (method === "GET" && base === "/calendar/schedule") {
    const items: CalendarItem[] = [
      ...tasks
        .filter(
          (t) =>
            t.archived === (q.get("archived") === "true") &&
            (q.get("task_status") !== "open" || !t.completed_at) &&
            (q.get("task_status") !== "completed" || !!t.completed_at),
        )
        .map((t) => ({
          id: t.id,
          key: `todo:${t.id}`,
          creator_id: t.creator_id,
          source: "todo" as const,
          kind: "todo",
          title: t.title,
          project_id: t.project_id,
          domains: t.domains,
          member_id: t.assignee_id,
          schedule: t.schedule || null,
          due_date: t.due_date,
          completed: !!t.completed_at,
          revision: t.revision,
        })),
      ...events
        .filter((e) => e.archived === (q.get("archived") === "true"))
        .map((e) => ({
          id: e.id,
          key: `event:${e.id}`,
          creator_id: e.creator_id,
          source: "event" as const,
          kind: e.kind,
          title: e.title,
          project_id: e.project_id,
          domains: e.domains,
          member_id: e.assignee_id,
          schedule: e.schedule,
          completed: false,
          revision: e.revision,
        })),
    ]
      .filter((i) => {
        if (
          !match(i, i.member_id) ||
          (q.get("kind") && q.get("kind") !== i.kind)
        )
          return false;
        if (q.get("unscheduled") === "true")
          return i.source === "todo" && !i.schedule && !i.due_date;
        for (let d = from; d < to; d = addDays(d, 1))
          if (onDay(i, d, zone)) return true;
        return false;
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    const signature = new URLSearchParams(q);
    signature.delete("cursor");
    signature.delete("revision");
    signature.delete("limit");
    return {
      ...paginate(items, revision([signature.toString(), items])),
      total: items.length,
      capabilities: { todos: true, events: true, reports: true },
    };
  }
  const id = base.split("/")[3];
  const found = events.find((e) => e.id === id);
  if (method === "GET" && found) return structuredClone(found);
  if (method !== "POST" && method !== "PATCH") throw new Error("日历操作无效");
  if (!payload.operation_id) throw new Error("操作标识无效");
  const hash = revision([base, payload]);
  const replay = operations.get(payload.operation_id);
  if (replay) {
    if (replay.hash !== hash) throw new Error("日历数据已变化，请刷新后重试");
    return structuredClone(replay.result);
  }
  const existing = id
    ? found
    : events.find((e) => e.source_id === payload.source_id);
  if (id && !existing) throw new Error("日历事件不存在");
  if (!id && existing) {
    operations.set(payload.operation_id, {
      hash,
      result: structuredClone(existing),
    });
    return structuredClone(existing);
  }
  if (existing && existing.revision !== payload.expected_revision)
    throw new Error("日历数据已变化，请刷新后重试");
  const now = new Date().toISOString();
  const event: CalendarEvent = existing
    ? structuredClone(existing)
    : {
        id: crypto.randomUUID(),
        creator_id: "demo-alice",
        created_at: now,
        revision: 0,
        archived: false,
        history: [],
        todo_ids: [],
        report_ids: [],
        links: [],
        domains: [],
        assignee_id: "",
        project_id: "",
        agent: "",
        model: "",
        body: "",
        source_id: payload.source_id,
        title: "",
        kind: "phase",
        schedule: payload.schedule,
        updated_at: now,
      };
  const before = structuredClone(event);
  before.history = [];
  if (payload.action === "archive") event.archived = true;
  else if (payload.action === "restore") event.archived = false;
  else {
    if (event.archived) throw new Error("请先恢复归档事件");
    for (const key of [
      "title",
      "body",
      "kind",
      "schedule",
      "assignee_id",
      "project_id",
      "domains",
      "todo_ids",
      "report_ids",
      "links",
      "agent",
      "model",
    ] as const)
      if (payload[key] !== undefined)
        Object.assign(event, { [key]: payload[key] });
    if (
      !event.title.trim() ||
      !event.source_id ||
      !["phase", "big_day", "version"].includes(event.kind) ||
      !event.schedule ||
      !validSchedule(event.schedule, event.kind !== "phase")
    )
      throw new Error("日历字段无效");
    if (
      event.kind !== "phase" &&
      (event.schedule.kind === "date-range"
        ? event.schedule.start_date !== event.schedule.end_date
        : event.schedule.start_at !== event.schedule.end_at)
    )
      throw new Error("里程碑需要单日或单个时刻");
    if (
      event.todo_ids.some((id) => !tasks.some((t) => t.id === id)) ||
      event.report_ids.some((id) => !reports.some((r) => r.id === id))
    )
      throw new Error("关联对象不存在");
  }
  event.revision++;
  event.updated_at = now;
  const after = structuredClone(event);
  after.history = [];
  event.history.push({
    id: crypto.randomUUID(),
    actor_id: "demo-alice",
    agent: "",
    model: "",
    action: payload.action || "edit",
    before: before as unknown as Partial<Todo>,
    after: after as unknown as Partial<Todo>,
    created_at: now,
  });
  if (existing) events[events.indexOf(existing)] = event;
  else events.push(event);
  operations.set(payload.operation_id, {
    hash,
    result: structuredClone(event),
  });
  return structuredClone(event);
}
