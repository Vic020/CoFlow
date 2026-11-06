"use client";
import { AssistantCalendarPlans } from "./assistant-manager";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  LoaderCircle,
  X,
  Pencil,
  CalendarDays,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSharedFilters } from "./shared-filters";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { GanttCreateRow } from "./gantt-create-row";
import { ReportDetailDialog } from "./report-detail-dialog";
import { CalendarWeekView } from "./calendar-week-view";
import { CalendarMiniMonth } from "./calendar-mini-month";
import { TimezonePicker } from "./timezone-picker";
import { ScheduleEditor, ScheduleText } from "./schedule-editor";
import {
  calendarPresentation,
  calendarReportHref,
  quickCalendarSchedule,
  addDays,
  calendarDays,
  civilDay,
  monthShift,
  onDay,
  pastDeadline,
  validSchedule,
  validCivilDay,
  type CalendarEvent,
  type CalendarItem,
  type ReportPage,
  type SchedulePage,
  type Schedule,
} from "@/lib/calendar";
import {
  invalidateReadCache,
  peekCalendarView,
  readCalendarView,
  request,
  statuses,
  type Meta,
  type Report,
} from "@/lib/types";
import type { Todo } from "@/lib/todo";

const emptyPage: ReportPage = {
  items: [],
  days: {},
  total: 0,
  next_cursor: "",
  revision: "",
  timezone: "UTC",
};
const emptySchedule: SchedulePage = {
  items: [],
  total: 0,
  revision: "",
  next_cursor: "",
  capabilities: {},
};
const labels: Record<string, string> = {
  todo: "任务",
  phase: "项目阶段",
  big_day: "Big Day",
  version: "版本节点",
};

export function CalendarWorkspace({ meta }: { meta: Meta }) {
  const { t: tr, timeZone, date, locale } = useI18n();
  const shared = useSharedFilters();
  const router = useRouter();
  const search = useSearchParams();
  const paramsKey = search.toString();
  const { tab: primaryTab, source: mode, view } = calendarPresentation(search);
  const zone = search.get("timezone") || timeZone;
  const validZone = (() => {
    try {
      new Intl.DateTimeFormat(locale, { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  })();
  const today = civilDay(new Date(), validZone ? zone : timeZone);
  const dayParam = search.get("date") || today;
  const anchor = validCivilDay(dayParam) ? dayParam : today;
  const days = useMemo(
    () => calendarDays(anchor, view === "gantt" ? "month" : view),
    [anchor, view],
  );
  const selected = days.includes(search.get("day") || "")
    ? search.get("day")!
    : days.includes(anchor)
      ? anchor
      : days[0];
  const [storedReports, setReports] = useState<ReportPage>(emptyPage);
  const [storedSchedule, setSchedule] = useState<SchedulePage>(emptySchedule);
  const [reportContext, setReportContext] = useState({ key: "", range: "" });
  const [scheduleContext, setScheduleContext] = useState("");
  const [unscheduled, setUnscheduled] = useState<CalendarItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [editor, setEditor] = useState<CalendarEvent | "new" | null>(null);
  const [createDraft, setCreateDraft] = useState<{
    day: string;
    schedule: Schedule;
    warning: string;
    key: string;
  } | null>(null);
  const [ganttCreating, setGanttCreating] = useState(false);
  const [quickTip, setQuickTip] = useState(false);
  const [createNotice, setCreateNotice] = useState("");
  useEffect(() => {
    if (!createNotice) return;
    const timer = setTimeout(() => setCreateNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [createNotice]);
  const quickTipShown = useRef(false);
  useEffect(() => {
    if (
      !validZone ||
      view === "gantt" ||
      search.get("report") ||
      search.get("event") ||
      quickTipShown.current
    )
      return;
    quickTipShown.current = true;
    try {
      if (localStorage.getItem("coflow-calendar-quick-create-tip-v1")) return;
      localStorage.setItem("coflow-calendar-quick-create-tip-v1", "seen");
    } catch {
      /* Optional UI preference; creation never depends on storage. */
    }
    setQuickTip(true);
  }, [view, paramsKey, validZone]);
  const [taskEditing, setTaskEditing] = useState(false);
  const [latestTask, setLatestTask] = useState<Todo | null>(null);
  const [task, setTask] = useState<Todo | null>(null);
  const [taskSchedule, setTaskSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const drag = useRef<{ item: CalendarItem; edge: "move" | "end" } | null>(
    null,
  );
  const refresh = useCallback(() => {
    invalidateReadCache();
    setTick((v) => v + 1);
  }, []);
  function navigate(patch: Record<string, string>) {
    const next = new URLSearchParams(paramsKey);
    for (const [key, value] of Object.entries(patch))
      value ? next.set(key, value) : next.delete(key);
    router.push(shared.href(`/calendar?${next}`), { scroll: false });
  }
  const reportHref = (id: string) =>
    shared.href(calendarReportHref(paramsKey, id));
  const closeReport = () => router.replace(reportHref(""), { scroll: false });
  const reportDay = mode === "reports" && view !== "week" ? selected : "";
  const baseQuery = useMemo(() => {
    const q = new URLSearchParams({
      from: days[0],
      to: addDays(days[days.length - 1], 1),
      timezone: zone,
      limit: "200",
    });
    for (const key of [
      "q",
      ...(mode === "reports"
        ? ["agent", "model", "status"]
        : ["kind", "task_status", "archived"]),
    ])
      if (search.get(key)) q.set(key, search.get(key)!);
    for (const key of ["project", "domain", "member"] as const)
      if (shared.filters[key]) q.set(key, shared.filters[key]);
    return q.toString();
  }, [
    days,
    zone,
    paramsKey,
    mode,
    shared.filters.project,
    shared.filters.domain,
    shared.filters.member,
  ]); // URL is the source of truth, including Back.
  const identity = JSON.stringify([meta.team.id, meta.current_user, meta.role]);
  const reportRange = identity + ":" + baseQuery;
  const reportQuery = new URLSearchParams(baseQuery);
  if (view !== "week") reportQuery.set("day", selected);
  const reportKey = "/calendar/reports?" + reportQuery + "&layout=" + view;
  const scheduleKey = "/calendar/schedule?" + baseQuery;
  const reportIdentity = identity + ":" + reportKey;
  const scheduleIdentity = identity + ":" + scheduleKey;
  const cachedReports = peekCalendarView<ReportPage>(reportKey);
  const cachedSchedule = peekCalendarView<SchedulePage>(scheduleKey);
  // Keep the visible range's counts/previews while a different day's detail loads.
  // Never present the previous day's items under the newly selected date.
  const reports =
    reportContext.key === reportIdentity
      ? storedReports
      : (cachedReports ??
        (reportContext.range === reportRange
          ? { ...storedReports, items: [], next_cursor: "" }
          : emptyPage));
  const schedule =
    scheduleContext === scheduleIdentity
      ? storedSchedule
      : (cachedSchedule ?? emptySchedule);
  useEffect(() => {
    const n = ++generation.current;
    const cached =
      mode === "reports"
        ? peekCalendarView<ReportPage>(reportKey)
        : peekCalendarView<SchedulePage>(scheduleKey);
    setLoading(!cached);
    setError("");
    setUnscheduled(null);
    if (!validZone) {
      setError(tr("时区无效"));
      setLoading(false);
      return;
    }
    async function load() {
      try {
        if (mode === "reports") {
          const result = await readCalendarView<ReportPage>(
            reportKey,
            async () => {
              const q = new URLSearchParams(baseQuery);
              if (view !== "week") q.set("day", selected);
              const first = await request<ReportPage>(`/calendar/reports?${q}`);
              let page = first;
              const items = [...first.items];
              const seen = new Set<string>();
              if (view === "week")
                while (page.next_cursor) {
                  if (seen.has(page.next_cursor))
                    throw new Error(tr("日历数据已变化，请刷新后重试"));
                  seen.add(page.next_cursor);
                  q.set("cursor", page.next_cursor);
                  q.set("revision", first.revision);
                  page = await request<ReportPage>(`/calendar/reports?${q}`);
                  items.push(...page.items);
                }
              return view === "week"
                ? { ...first, items, next_cursor: "" }
                : first;
            },
          );
          if (generation.current === n) {
            setReports(result);
            setReportContext({ key: reportIdentity, range: reportRange });
          }
        } else {
          const result = await readCalendarView<SchedulePage>(
            scheduleKey,
            async () => {
              const q = new URLSearchParams(baseQuery);
              const first = await request<SchedulePage>(
                `/calendar/schedule?${q}`,
              );
              let page = first;
              const items = [...first.items];
              const seen = new Set<string>();
              while (page.next_cursor) {
                if (seen.has(page.next_cursor))
                  throw new Error(tr("日历数据已变化，请刷新后重试"));
                seen.add(page.next_cursor);
                q.set("cursor", page.next_cursor);
                q.set("revision", first.revision);
                page = await request<SchedulePage>(`/calendar/schedule?${q}`);
                items.push(...page.items);
              }
              return { ...first, items, next_cursor: "" };
            },
          );
          if (generation.current === n) {
            setSchedule(result);
            setScheduleContext(scheduleIdentity);
          }
        }
      } catch (e) {
        if (generation.current === n) setError((e as Error).message);
      } finally {
        if (generation.current === n) setLoading(false);
      }
    }
    void load();
    return () => {
      generation.current++;
    };
  }, [baseQuery, reportDay, mode, view, validZone, tick, tr, identity]);
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("coflow-cache");
      channel.onmessage = (e) => {
        if (e.data === "data") refresh();
      };
    } catch {
      /* Focus is the fallback. */
    }
    window.addEventListener("focus", focus);
    window.addEventListener("coflow:assistant-change", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("coflow:assistant-change", focus);
      document.removeEventListener("visibilitychange", focus);
      channel?.close();
    };
  }, [refresh]);
  const eventId = search.get("event");
  useEffect(() => {
    if (!eventId) {
      setEditor((value) => (value === "new" ? value : null));
      return;
    }
    let current = true;
    request<CalendarEvent>(`/calendar/events/${encodeURIComponent(eventId)}`)
      .then((v) => {
        if (current) setEditor(v);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [eventId]);
  function beginCreate(day: string, minute?: number, endMinute?: number) {
    if (!validZone || busy) return;
    const seed = quickCalendarSchedule(day, minute, zone, endMinute);
    openCreate(
      day,
      seed.schedule,
      seed.needsTimeChoice
        ? "该时段受夏令时影响，请明确选择开始与结束时间。"
        : "",
    );
  }
  function openCreate(day: string, schedule: Schedule, warning = "") {
    setQuickTip(false);
    setCreateDraft({ day, schedule, warning, key: crypto.randomUUID() });
    setEditor("new");
  }
  function closeEvent() {
    setCreateDraft(null);
    setEditor(null);
    if (eventId) navigate({ event: "" });
  }
  async function open(item: CalendarItem) {
    setError("");
    try {
      if (item.source === "todo") {
        const value = await request<Todo>(`/todos/${item.id}`);
        setTask(value);
        setLatestTask(null);
        setTaskEditing(false);
        setTaskSchedule(value.schedule || null);
      } else navigate({ event: item.id });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveTask() {
    if (!task || busy) return;
    if (!validSchedule(taskSchedule)) {
      setError(tr("日期范围无效"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request(`/todos/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          schedule: taskSchedule,
          expected_revision: task.revision,
          operation_id: crypto.randomUUID(),
        }),
      });
      setTask(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function drop(day: string) {
    const source = drag.current;
    drag.current = null;
    if (!source || busy) return;
    const s = source.item.schedule;
    // Timed work is edited explicitly so DST/time-zone changes cannot silently
    // alter its wall time or duration through a date-cell gesture.
    if (s?.kind === "time-range") {
      await open(source.item);
      return;
    }
    const start = s?.start_date || source.item.due_date || day;
    const duration = s
      ? Math.round((Date.parse(s.end_date!) - Date.parse(start)) / 86400000)
      : 0;
    const next: Schedule =
      source.edge === "end"
        ? {
            kind: "date-range",
            start_date: start,
            end_date: day < start ? start : day,
          }
        : {
            kind: "date-range",
            start_date: day,
            end_date: addDays(day, duration),
          };
    setBusy(true);
    setError("");
    try {
      await request(
        source.item.source === "todo"
          ? `/todos/${source.item.id}`
          : `/calendar/events/${source.item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            schedule: next,
            expected_revision: source.item.revision,
            operation_id: crypto.randomUUID(),
          }),
        },
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function moreReports() {
    const n = generation.current;
    setBusy(true);
    try {
      const q = new URLSearchParams(baseQuery);
      q.set("day", selected);
      q.set("cursor", reports.next_cursor);
      q.set("revision", reports.revision);
      const page = await request<ReportPage>(`/calendar/reports?${q}`);
      if (n === generation.current)
        setReports((old) => ({
          ...page,
          items: [...old.items, ...page.items],
        }));
    } catch (e) {
      if (n === generation.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadUnscheduled() {
    const n = generation.current;
    setBusy(true);
    try {
      const q = new URLSearchParams(baseQuery);
      q.set("unscheduled", "true");
      q.delete("kind");
      const first = await request<SchedulePage>(`/calendar/schedule?${q}`);
      const items = [...first.items];
      let page = first;
      while (page.next_cursor) {
        q.set("cursor", page.next_cursor);
        q.set("revision", first.revision);
        page = await request<SchedulePage>(`/calendar/schedule?${q}`);
        items.push(...page.items);
      }
      if (n === generation.current) setUnscheduled(items);
    } catch (e) {
      if (n === generation.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const dayReports =
    view === "week" && validZone
      ? reports.items.filter(
          (report) => civilDay(report.created_at, zone) === selected,
        )
      : reports.items;
  const dayItems = schedule.items.filter((item) => onDay(item, selected, zone));
  const groupBy = search.get("group") === "domain" ? "domain" : "project";
  const ganttRows = schedule.items
    .flatMap((item) => {
      const groups =
        groupBy === "domain"
          ? item.domains?.length
            ? item.domains
            : [tr("未归属")]
          : [
              meta.projects.find((p) => p.id === item.project_id)?.name ||
                tr("未归属"),
            ];
      return groups.map((group) => ({ item, group }));
    })
    .sort(
      (a, b) =>
        a.group.localeCompare(b.group, locale) ||
        a.item.kind.localeCompare(b.item.kind),
    );
  const dayLabel = (
    d: string,
    options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  ) => date(`${d}T12:00:00Z`, { ...options, timeZone: "UTC" });
  const canEdit = (creator: string, assignee: string) =>
    meta.mode === "local-demo" ||
    meta.role === "admin" ||
    creator === meta.current_user ||
    assignee === meta.current_user;
  function chip(item: CalendarItem, resize = false, contextDay?: string) {
    return (
      <div
        key={item.key}
        className={`calendar-entry calendar-kind-${item.kind}${item.completed ? " is-completed" : ""}`}
        draggable={
          !busy &&
          search.get("archived") !== "true" &&
          canEdit(item.creator_id, item.member_id) &&
          !!item.schedule &&
          item.schedule.kind !== "time-range"
        }
        onDragStart={() => {
          drag.current = { item, edge: "move" };
        }}
        onDragEnd={() => {
          drag.current = null;
        }}
      >
        <button onClick={() => void open(item)} title={item.title}>
          {contextDay && item.due_date === contextDay && (
            <span className="calendar-deadline-label">{tr("截止日期")} - </span>
          )}
          {item.completed && <span aria-label={tr("已完成")}>✓ </span>}
          {item.title}
        </button>
        {resize &&
          canEdit(item.creator_id, item.member_id) &&
          search.get("archived") !== "true" &&
          item.schedule?.kind === "date-range" &&
          item.kind !== "big_day" &&
          item.kind !== "version" && (
            <button
              className="calendar-resize"
              draggable
              aria-label={tr("调整结束日期")}
              title={tr("拖动调整结束日期，或点击编辑排期")}
              onClick={() => void open(item)}
              onDragStart={(e) => {
                e.stopPropagation();
                drag.current = { item, edge: "end" };
              }}
            >
              ⋮
            </button>
          )}
      </div>
    );
  }
  return (
    <section className="calendar-workspace">
      <AssistantCalendarPlans />
      <div className="calendar-toolbar">
        <div className="view-tabs" aria-label={tr("日历内容")}>
          {(["progress", "schedule", "gantt"] as const).map((v) => (
            <button
              key={v}
              className={primaryTab === v ? "active" : ""}
              aria-pressed={primaryTab === v}
              onClick={() =>
                navigate({
                  mode: v,
                  view: v === "gantt" ? "" : view === "gantt" ? "month" : view,
                  ...((v === "progress") !== (primaryTab === "progress")
                    ? {
                        status: "",
                        kind: "",
                        agent: "",
                        model: "",
                        task_status: "",
                      }
                    : {}),
                })
              }
            >
              {tr(
                v === "progress" ? "进度" : v === "schedule" ? "排期" : "甘特",
              )}
            </button>
          ))}
        </div>
        <div className="calendar-navigation">
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr("上一页")}
            onClick={() =>
              navigate({
                date:
                  view === "week"
                    ? addDays(anchor, -7)
                    : monthShift(anchor, -1),
                day: "",
              })
            }
          >
            <ChevronLeft size={16} />
          </Button>
          <input
            className="calendar-date-jump"
            type="date"
            aria-label={tr("日期定位")}
            value={anchor}
            onChange={(e) => {
              if (e.target.value)
                navigate({ date: e.target.value, day: e.target.value });
            }}
          />
          <h2 data-layout={view}>
            {view === "week"
              ? `${dayLabel(days[0], { month: "numeric", day: "numeric" })} – ${dayLabel(days[6], { month: "numeric", day: "numeric" })}`
              : dayLabel(anchor, { year: "numeric", month: "long" })}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr("下一页")}
            onClick={() =>
              navigate({
                date:
                  view === "week" ? addDays(anchor, 7) : monthShift(anchor, 1),
                day: "",
              })
            }
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ date: today, day: today })}
          >
            {tr("今天")}
          </Button>
        </div>
        <div className="calendar-actions">
          {quickTip && view !== "gantt" && (
            <div role="note" className="calendar-quick-tip">
              <span>{tr("双击空白日期，快速创建节点")}</span>
              <button
                type="button"
                aria-label={tr("关闭提示")}
                onClick={() => setQuickTip(false)}
              >
                <X size={13} />
              </button>
            </div>
          )}
          {primaryTab !== "gantt" && (
            <div className="view-tabs">
              {["month", "week"].map((v) => (
                <button
                  key={v}
                  className={view === v ? "active" : ""}
                  aria-pressed={view === v}
                  onClick={() => navigate({ view: v })}
                >
                  {tr(v === "month" ? "月" : "周")}
                </button>
              ))}
            </div>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label={tr("刷新")}
            title={loading ? tr("加载中…") : tr("刷新")}
            className="calendar-refresh"
            onClick={refresh}
          >
            {loading ? (
              <span role="status" aria-label={tr("加载中…")}>
                <LoaderCircle size={16} className="calendar-loading-icon" />
              </span>
            ) : (
              <RefreshCw size={16} />
            )}
          </Button>
          {mode === "schedule" && (
            <Button
              className="calendar-new-event"
              aria-label={tr("新建节点")}
              title={tr("新建节点")}
              onClick={() => beginCreate(selected)}
            >
              <Plus size={15} />
              <span className="calendar-new-node-label">{tr("新建节点")}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="calendar-filters">
        <input
          type="search"
          aria-label={tr("搜索")}
          placeholder={tr("搜索")}
          defaultValue={search.get("q") || ""}
          key={`q:${search.get("q")}`}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate({ q: e.currentTarget.value });
          }}
          onBlur={(e) => {
            if (e.target.value !== (search.get("q") || ""))
              navigate({ q: e.target.value });
          }}
        />
        {mode === "reports" ? (
          <>
            <select
              aria-label={tr("状态")}
              value={search.get("status") || ""}
              onChange={(e) => navigate({ status: e.target.value })}
            >
              <option value="">{tr("全部状态")}</option>
              {Object.entries(statuses).map(([key, s]) => (
                <option value={key} key={key}>
                  {tr(s.label)}
                </option>
              ))}
            </select>
            {["agent", "model"].map((key) => (
              <input
                key={`${key}:${search.get(key)}`}
                aria-label={key === "agent" ? "Agent" : "Model"}
                placeholder={key === "agent" ? "Agent" : "Model"}
                defaultValue={search.get(key) || ""}
                onBlur={(e) => {
                  if (e.target.value !== (search.get(key) || ""))
                    navigate({ [key]: e.target.value });
                }}
              />
            ))}
          </>
        ) : (
          <>
            <select
              aria-label={tr("类型")}
              value={search.get("kind") || ""}
              onChange={(e) => navigate({ kind: e.target.value })}
            >
              <option value="">{tr("全部类型")}</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {tr(label)}
                </option>
              ))}
            </select>
            <select
              aria-label={tr("任务状态")}
              value={search.get("task_status") || ""}
              onChange={(e) => navigate({ task_status: e.target.value })}
            >
              <option value="">{tr("全部任务状态")}</option>
              <option value="open">{tr("未完成")}</option>
              <option value="completed">{tr("已完成")}</option>
            </select>
            <Button
              size="sm"
              variant={search.get("archived") === "true" ? "outline" : "ghost"}
              aria-pressed={search.get("archived") === "true"}
              onClick={() =>
                navigate({
                  archived: search.get("archived") === "true" ? "" : "true",
                })
              }
            >
              {tr("已归档")}
            </Button>
            {view === "gantt" && (
              <select
                aria-label={tr("分组")}
                value={groupBy}
                onChange={(e) => navigate({ group: e.target.value })}
              >
                <option value="project">{tr("项目")}</option>
                <option value="domain">{tr("领域")}</option>
              </select>
            )}
          </>
        )}
        <div
          className="calendar-zone"
          title={tr("按显示时区归日；全天排期不转换日期")}
        >
          <TimezonePicker
            value={zone}
            zones={["UTC", ...Intl.supportedValuesOf("timeZone")]}
            onSelect={(z) => navigate({ timezone: z })}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            navigate({
              q: "",
              agent: "",
              model: "",
              status: "",
              kind: "",
              task_status: "",
              archived: "",
            })
          }
        >
          {tr("重置本页")}
        </Button>
      </div>
      <p className="calendar-caption">
        {tr(
          mode === "reports"
            ? "按真实上报时间展示；没有上报不代表没有工作。"
            : "计划与截止日期独立，调整排期不会完成任务或生成上报。",
        )}
      </p>
      {error && (
        <div role="alert" className="calendar-error">
          {tr(error)}{" "}
          <Button size="sm" variant="outline" onClick={refresh}>
            {tr("重试")}
          </Button>
        </div>
      )}
      {!error && (
        <div
          aria-busy={loading}
          className={`calendar-layout${view === "gantt" ? " calendar-layout-gantt" : ""}${view === "week" ? " calendar-layout-week" : ""}`}
        >
          {mode === "schedule" &&
            Object.values(schedule.capabilities).includes(false) && (
              <p className="muted">{tr("部分来源无读取权限，未计入日历。")}</p>
            )}
          {view === "gantt" ? (
            <div className="calendar-gantt" aria-label={tr("甘特")}>
              <div
                className="gantt-canvas"
                style={{ minWidth: 260 + days.length * 30 }}
              >
                <div className="gantt-head">
                  <span>{tr("项目 / 任务")}</span>
                  <div
                    className="gantt-dates"
                    style={{
                      gridTemplateColumns: `repeat(${days.length}, 1fr)`,
                    }}
                  >
                    {days.map((d) => (
                      <span key={d}>{d.slice(8)}</span>
                    ))}
                  </div>
                </div>
                {ganttRows.map(({ item, group }) => {
                  const occupied = days
                    .map((d, i) =>
                      onDay({ schedule: item.schedule }, d, zone) ? i : -1,
                    )
                    .filter((i) => i >= 0);
                  return (
                    <div className="gantt-row" key={`${group}:${item.key}`}>
                      <div className="gantt-label">
                        <small>
                          {group} · {tr(labels[item.kind] || item.kind)}
                        </small>
                        <button onClick={() => void open(item)}>
                          {item.title}
                        </button>
                      </div>
                      <div
                        className="gantt-track"
                        style={{
                          gridTemplateColumns: `repeat(${days.length}, 1fr)`,
                        }}
                      >
                        {days.map((d, i) => (
                          <div
                            key={d}
                            style={{ gridColumn: i + 1, gridRow: 1 }}
                            className="gantt-drop"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              void drop(d);
                            }}
                          />
                        ))}
                        {item.due_date && days.includes(item.due_date) && (
                          <button
                            className="gantt-deadline"
                            style={{
                              gridColumn: days.indexOf(item.due_date) + 1,
                              gridRow: 1,
                            }}
                            title={`${tr("截止日期")} ${item.due_date}`}
                            aria-label={`${tr("截止日期")} ${item.title}`}
                            onClick={() => void open(item)}
                          >
                            ◆
                          </button>
                        )}
                        {occupied.length > 0 && (
                          <div
                            className="gantt-bar"
                            style={{
                              gridColumn: `${occupied[0] + 1} / ${occupied[occupied.length - 1] + 1 + 1}`,
                              gridRow: 1,
                            }}
                          >
                            {chip(item, true)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="gantt-row gantt-add-row">
                  <button
                    type="button"
                    className="gantt-add-button"
                    aria-label={tr("添加节点行")}
                    onClick={() => setGanttCreating(true)}
                  >
                    <Plus size={16} />
                    {tr("新建节点")}
                  </button>
                  <div />
                </div>
                {ganttCreating && (
                  <GanttCreateRow
                    key={baseQuery}
                    days={days}
                    disabled={busy || !validZone}
                    onDismiss={() => setGanttCreating(false)}
                    onCreate={(schedule) =>
                      openCreate(schedule.start_date!, schedule)
                    }
                  />
                )}
                {!loading && !schedule.items.length && (
                  <p className="calendar-empty">{tr("当前范围没有排期")}</p>
                )}
              </div>
            </div>
          ) : view === "week" && validZone ? (
            <CalendarWeekView
              days={days}
              selected={selected}
              zone={zone}
              mode={mode}
              reports={reports.items}
              reportHref={reportHref}
              items={schedule.items}
              meta={meta}
              loading={loading}
              onSelect={(day) =>
                navigate({ day, ...(!days.includes(day) ? { date: day } : {}) })
              }
              onOpen={(item) => void open(item)}
              onCreate={beginCreate}
            />
          ) : (
            <div
              className={`calendar-grid calendar-${view}`}
              role="group"
              aria-label={tr(mode === "reports" ? "进度日历" : "排期日历")}
            >
              {days.slice(0, 7).map((d) => (
                <div className="calendar-weekday" key={d}>
                  {dayLabel(d, { weekday: "short" })}
                </div>
              ))}
              {days.map((d) => {
                const items = schedule.items.filter((item) =>
                  onDay(item, d, zone),
                );
                return (
                  <div
                    key={d}
                    className={`calendar-cell${d === selected ? " selected" : ""}${d.slice(0, 7) !== anchor.slice(0, 7) ? " outside" : ""}${d === today ? " today" : ""}`}
                    onDragOver={(e) => {
                      if (mode === "schedule") e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (mode === "schedule") void drop(d);
                    }}
                  >
                    <button
                      className="calendar-day"
                      onDoubleClick={() => beginCreate(d)}
                      aria-pressed={d === selected}
                      aria-label={`${dayLabel(d)} · ${loading ? "…" : mode === "reports" ? reports.days[d] || 0 : items.length}`}
                      onKeyDown={(e) => {
                        const delta = (
                          {
                            ArrowLeft: -1,
                            ArrowRight: 1,
                            ArrowUp: -7,
                            ArrowDown: 7,
                          } as Record<string, number>
                        )[e.key];
                        if (delta) {
                          e.preventDefault();
                          const next = addDays(d, delta);
                          if (days.includes(next)) {
                            e.currentTarget
                              .closest(".calendar-grid")
                              ?.querySelector<HTMLButtonElement>(
                                `[data-date="${next}"]`,
                              )
                              ?.focus();
                            navigate({ day: next });
                          } else navigate({ date: next, day: next });
                        }
                      }}
                      data-date={d}
                      onClick={() => navigate({ day: d })}
                    >
                      <time dateTime={d}>
                        {view === "week"
                          ? dayLabel(d, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })
                          : Number(d.slice(8))}
                      </time>
                      {mode === "reports" && !!reports.days[d] && (
                        <span>{reports.days[d]}</span>
                      )}
                      {mode === "schedule" && items.length > 0 && (
                        <span>{items.length}</span>
                      )}
                    </button>
                    {mode === "reports" &&
                      (reports.previews?.[d] || []).map((r) => (
                        <Link
                          key={r.id}
                          className="calendar-report-preview"
                          scroll={false}
                          href={reportHref(r.id)}
                          title={r.title}
                        >
                          {r.title}
                        </Link>
                      ))}
                    {mode === "schedule" &&
                      items
                        .slice(0, view === "week" ? 8 : 3)
                        .map((item) => chip(item, false, d))}
                    {mode === "schedule" &&
                      items.length > (view === "week" ? 8 : 3) && (
                        <button
                          className="calendar-overflow"
                          onClick={() => navigate({ day: d })}
                        >
                          {tr("另有 {count} 项", {
                            count: items.length - (view === "week" ? 8 : 3),
                          })}
                        </button>
                      )}
                  </div>
                );
              })}
            </div>
          )}
          <aside className="calendar-side-panel">
            {view === "week" && (
              <CalendarMiniMonth
                anchor={anchor}
                selected={selected}
                today={today}
                week={days}
                onSelect={(day) => navigate({ date: day, day })}
              />
            )}
            <section className="calendar-agenda">
              <h3>{dayLabel(selected, { dateStyle: "full" })}</h3>
              {mode === "reports" ? (
                <>
                  {dayReports.map((r: Report) => (
                    <Link
                      key={r.id}
                      scroll={false}
                      href={reportHref(r.id)}
                      className="calendar-agenda-report"
                    >
                      <span
                        className={`status ${statuses[r.status]?.className || ""}`}
                      >
                        {tr(statuses[r.status]?.label || r.status)}
                      </span>
                      <strong>{r.title}</strong>
                      <small>
                        {meta.members.find((m) => m.id === r.author_id)?.name} ·{" "}
                        {date(r.created_at, { timeStyle: "short" })} · {r.agent}
                      </small>
                    </Link>
                  ))}
                  {!loading && !dayReports.length && (
                    <p className="muted">{tr("当天没有进度简报")}</p>
                  )}
                  {reports.next_cursor && (
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() => void moreReports()}
                    >
                      {tr("加载更多")}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {dayItems.map((item) => (
                    <div className="calendar-agenda-item" key={item.key}>
                      <span>{tr(labels[item.kind] || item.kind)}</span>
                      {chip(item)}
                      <span>
                        <ScheduleText value={item.schedule} />
                        {item.due_date && (
                          <>
                            {" "}
                            · {tr("截止日期")} {dayLabel(item.due_date)}
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                  {!loading && !dayItems.length && (
                    <p className="muted">{tr("当天没有排期")}</p>
                  )}
                  <Button
                    disabled={busy}
                    variant="ghost"
                    onClick={() => void loadUnscheduled()}
                  >
                    <CalendarDays size={14} />
                    {tr("查看未排期任务")}
                  </Button>
                  {unscheduled && (
                    <div className="calendar-unscheduled">
                      {unscheduled.length ? (
                        unscheduled.map((item) => chip(item))
                      ) : (
                        <p className="muted">{tr("没有未排期任务")}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </aside>
        </div>
      )}
      <Dialog
        open={!!task}
        onOpenChange={(open) => {
          if (!open && !busy) setTask(null);
        }}
      >
        <DialogContent className="info-dialog calendar-dialog">
          <DialogTitle className="modal-title">{task?.title}</DialogTitle>
          <DialogDescription className="modal-description">
            {tr("调整计划时间，任务进度保持独立。")}
          </DialogDescription>
          {taskEditing ? (
            <form
              className="workspace-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveTask();
              }}
            >
              <ScheduleEditor value={taskSchedule} onChange={setTaskSchedule} />
              {task && pastDeadline(taskSchedule, task.due_date) && (
                <p className="calendar-risk">
                  {tr("计划晚于截止日期；保存不会移动截止日期。")}
                </p>
              )}
              {error && (
                <>
                  <p role="alert">{tr(error)}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      if (!task) return;
                      try {
                        const latest = await request<Todo>(`/todos/${task.id}`);
                        setTask(latest);
                        setLatestTask(latest);
                        setError("");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {tr("重新读取，保留草稿")}
                  </Button>
                </>
              )}
              {latestTask && (
                <p>
                  {tr("已重新读取，请核对当前排期后保存。")}{" "}
                  <ScheduleText value={latestTask.schedule} />
                </p>
              )}
              <div className="calendar-actions">
                <Button disabled={busy}>{tr("保存")}</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setTaskEditing(false)}
                >
                  {tr("取消")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="calendar-event-detail">
              <p>
                <ScheduleText value={task?.schedule} />
              </p>
              {task?.due_date && (
                <p>
                  {tr("截止日期")} {dayLabel(task.due_date)}
                </p>
              )}
              <div className="calendar-actions">
                <Button
                  variant="outline"
                  disabled={
                    task?.archived ||
                    !task ||
                    !canEdit(task.creator_id, task.assignee_id)
                  }
                  onClick={() => setTaskEditing(true)}
                >
                  <Pencil size={14} />
                  {tr("编辑")}
                </Button>
                <Link href={`/todo?todo=${task?.id}`}>
                  {tr("查看任务与关联上报")}
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {editor && (
        <CalendarEventDialog
          key={
            editor === "new"
              ? `new:${createDraft?.key || selected}`
              : `${editor.id}:${editor.revision}`
          }
          value={editor}
          day={createDraft?.day || selected}
          initialSchedule={createDraft?.schedule}
          initialWarning={createDraft?.warning}
          meta={meta}
          visibleReports={dayReports}
          reportHref={reportHref}
          onClose={closeEvent}
          onSaved={() => {
            if (editor === "new")
              setCreateNotice(
                mode === "reports"
                  ? "节点已创建，可在排期中查看"
                  : "节点已创建",
              );
            closeEvent();
            setGanttCreating(false);
            refresh();
          }}
        />
      )}
      {createNotice && (
        <div className="toast" role="status">
          {tr(createNotice)}
        </div>
      )}
      {search.get("report") && (
        <ReportDetailDialog
          key={identity + search.get("report")}
          reportId={search.get("report")!}
          meta={meta}
          onClose={closeReport}
          onChange={refresh}
        />
      )}
    </section>
  );
}

function CalendarEventDialog({
  value,
  day,
  meta,
  visibleReports,
  initialSchedule,
  initialWarning,
  reportHref,
  onClose,
  onSaved,
}: {
  value: CalendarEvent | "new";
  day: string;
  meta: Meta;
  visibleReports: Report[];
  initialSchedule?: Schedule;
  initialWarning?: string;
  reportHref: (id: string) => string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t: tr, date } = useI18n();
  const initial: CalendarEvent =
    value === "new"
      ? {
          id: "",
          source_id: crypto.randomUUID(),
          creator_id: meta.current_user,
          assignee_id: "",
          project_id: "",
          domains: [],
          kind: "phase",
          title: "",
          body: "",
          schedule: initialSchedule || {
            kind: "date-range",
            start_date: day,
            end_date: day,
          },
          todo_ids: [],
          report_ids: [],
          links: [],
          agent: "",
          model: "",
          revision: 0,
          archived: false,
          history: [],
          created_at: "",
          updated_at: "",
        }
      : value;
  const [draft, setDraft] = useState(initial);
  const writable =
    meta.mode === "local-demo" ||
    meta.role === "admin" ||
    initial.creator_id === meta.current_user ||
    initial.assignee_id === meta.current_user;
  const [baseRevision, setBaseRevision] = useState(initial.revision);
  const [latest, setLatest] = useState<CalendarEvent | null>(null);
  const [reportChoices, setReportChoices] = useState(visibleReports);
  const [editing, setEditing] = useState(value === "new");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<Todo[]>([]);
  async function findTasks() {
    try {
      const p = await request<{ items: Todo[] }>(
        `/todos?limit=20&q=${encodeURIComponent(query)}`,
      );
      setChoices(p.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function findReports() {
    try {
      const q = new URLSearchParams({
        from: addDays(day, -92),
        to: addDays(day, 1),
        timezone: "UTC",
        q: query,
        limit: "20",
      });
      const p = await request<ReportPage>(`/calendar/reports?${q}`);
      setReportChoices(p.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(action = "edit") {
    if (busy) return;
    if (
      action === "edit" &&
      (!draft.schedule ||
        !validSchedule(draft.schedule, draft.kind !== "phase"))
    ) {
      setError(tr("日期范围无效"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const {
        title,
        body,
        kind,
        schedule,
        project_id,
        assignee_id,
        domains,
        todo_ids,
        report_ids,
        links,
      } = draft;
      const fields = {
        title,
        body,
        kind,
        schedule,
        project_id,
        assignee_id,
        domains,
        todo_ids,
        report_ids,
        links,
      };
      const patch = initial.id
        ? Object.fromEntries(
            Object.entries(fields).filter(
              ([key, val]) =>
                JSON.stringify(val) !==
                JSON.stringify(initial[key as keyof CalendarEvent]),
            ),
          )
        : { ...fields, source_id: draft.source_id };
      await request(`/calendar/events${initial.id ? `/${initial.id}` : ""}`, {
        method: initial.id ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(action === "edit" ? patch : {}),
          action,
          expected_revision: baseRevision,
          operation_id: crypto.randomUUID(),
        }),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const set = <K extends keyof CalendarEvent>(key: K, val: CalendarEvent[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="info-dialog calendar-dialog">
        <DialogTitle className="modal-title">
          {initial.id ? initial.title : tr("新建节点")}
        </DialogTitle>
        <DialogDescription className="modal-description">
          {tr("阶段和节点记录计划，交付证据保留在 Todo 与 Timeline。")}
        </DialogDescription>
        {error && (
          <>
            <p role="alert">{tr(error)}</p>
            {initial.id && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  try {
                    const v = await request<CalendarEvent>(
                      `/calendar/events/${initial.id}`,
                    );
                    setBaseRevision(v.revision);
                    setLatest(v);
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {tr("重新读取，保留草稿")}
              </Button>
            )}
          </>
        )}
        {latest && (
          <p>
            {tr("已重新读取，请核对当前排期后保存。")}{" "}
            <strong>{latest.title}</strong> ·{" "}
            <ScheduleText value={latest.schedule} />
          </p>
        )}
        {editing ? (
          <form
            className="workspace-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              <label>
                {tr("标题")}
                <input
                  autoFocus
                  required
                  maxLength={500}
                  value={draft.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
              <div className="calendar-input-row">
                <label>
                  {tr("类型")}
                  <select
                    value={draft.kind}
                    onChange={(e) => {
                      const kind = e.target.value as CalendarEvent["kind"];
                      setDraft((d) => ({
                        ...d,
                        kind,
                        schedule: !d.schedule
                          ? {
                              kind: "date-range",
                              start_date: day,
                              end_date: day,
                            }
                          : kind === "phase"
                            ? d.schedule
                            : d.schedule.kind === "date-range"
                              ? {
                                  ...d.schedule,
                                  end_date: d.schedule.start_date,
                                }
                              : { ...d.schedule, end_at: d.schedule.start_at },
                      }));
                    }}
                  >
                    {Object.entries(labels)
                      .filter(([key]) => key !== "todo")
                      .map(([key, label]) => (
                        <option key={key} value={key}>
                          {tr(label)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {tr("项目")}
                  <select
                    value={draft.project_id}
                    onChange={(e) => set("project_id", e.target.value)}
                  >
                    <option value="">{tr("未归属")}</option>
                    {meta.projects
                      .filter(
                        (p) =>
                          p.status !== "archived" || p.id === draft.project_id,
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {tr("负责人")}
                  <select
                    value={draft.assignee_id}
                    onChange={(e) => set("assignee_id", e.target.value)}
                  >
                    <option value="">{tr("未分配")}</option>
                    {meta.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {initialWarning &&
                !validSchedule(draft.schedule, draft.kind !== "phase") && (
                  <p role="note" className="calendar-create-warning">
                    {tr(initialWarning)}
                  </p>
                )}
              <ScheduleEditor
                value={draft.schedule}
                point={draft.kind !== "phase"}
                onChange={(s) => set("schedule", s!)}
              />
              <label>
                {tr("描述")}
                <textarea
                  rows={4}
                  maxLength={50000}
                  value={draft.body}
                  onChange={(e) => set("body", e.target.value)}
                />
              </label>
              <div className="todo-domains">
                {meta.domains.map((domain) => (
                  <label key={domain}>
                    <input
                      type="checkbox"
                      checked={draft.domains.includes(domain)}
                      onChange={(e) =>
                        set(
                          "domains",
                          e.target.checked
                            ? [...draft.domains, domain]
                            : draft.domains.filter((d) => d !== domain),
                        )
                      }
                    />
                    {domain}
                  </label>
                ))}
              </div>
              <details>
                <summary>{tr("关联任务与上报")}</summary>
                <div className="calendar-input-row">
                  <input
                    aria-label={tr("搜索任务")}
                    placeholder={tr("搜索任务")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void findTasks()}
                  >
                    {tr("搜索")}
                  </Button>
                </div>
                {choices.map((todo) => (
                  <label className="calendar-check" key={todo.id}>
                    <input
                      type="checkbox"
                      checked={draft.todo_ids.includes(todo.id)}
                      onChange={(e) =>
                        set(
                          "todo_ids",
                          e.target.checked
                            ? [...draft.todo_ids, todo.id]
                            : draft.todo_ids.filter((id) => id !== todo.id),
                        )
                      }
                    />
                    {todo.title}
                  </label>
                ))}
                {draft.todo_ids
                  .filter((id) => !choices.some((c) => c.id === id))
                  .map((id) => (
                    <label className="calendar-check" key={id}>
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          set(
                            "todo_ids",
                            draft.todo_ids.filter((x) => x !== id),
                          )
                        }
                      />
                      <Link href={`/todo?todo=${id}`}>
                        {tr("查看关联任务")}
                      </Link>
                    </label>
                  ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void findReports()}
                >
                  {tr("搜索近期上报")}
                </Button>
                <p className="muted">
                  {tr("搜索所选日期及此前 92 天，历史关联保留原上报日期。")}
                </p>
                {reportChoices.map((r) => (
                  <label className="calendar-check" key={r.id}>
                    <input
                      type="checkbox"
                      checked={draft.report_ids.includes(r.id)}
                      onChange={(e) =>
                        set(
                          "report_ids",
                          e.target.checked
                            ? [...draft.report_ids, r.id]
                            : draft.report_ids.filter((id) => id !== r.id),
                        )
                      }
                    />
                    {r.title}
                  </label>
                ))}
                {draft.report_ids
                  .filter((id) => !reportChoices.some((r) => r.id === id))
                  .map((id) => (
                    <label className="calendar-check" key={id}>
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          set(
                            "report_ids",
                            draft.report_ids.filter((x) => x !== id),
                          )
                        }
                      />
                      <Link scroll={false} href={reportHref(id)}>
                        {tr("查看关联上报")}
                      </Link>
                    </label>
                  ))}
              </details>
            </fieldset>
            <div className="calendar-actions">
              <Button disabled={busy}>{tr("保存")}</Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => (initial.id ? setEditing(false) : onClose())}
              >
                {tr("取消")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="calendar-event-detail">
            <p>
              {tr(labels[initial.kind])} ·{" "}
              <ScheduleText value={initial.schedule} />
            </p>
            <p>
              {meta.projects.find((p) => p.id === initial.project_id)?.name} ·{" "}
              {meta.members.find((m) => m.id === initial.assignee_id)?.name ||
                tr("未分配")}
            </p>
            <div className="todo-detail-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {initial.body}
              </ReactMarkdown>
            </div>
            <div className="calendar-related">
              {(initial.todo_ids || []).map((id) => (
                <Link key={id} href={`/todo?todo=${id}`}>
                  {tr("查看关联任务")}
                </Link>
              ))}
              {(initial.report_ids || []).map((id) => (
                <Link key={id} scroll={false} href={reportHref(id)}>
                  {tr("查看关联上报")}
                </Link>
              ))}
              {initial.links.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.title || link.url}
                </a>
              ))}
            </div>
            <div className="calendar-actions">
              <Button
                variant="outline"
                disabled={busy || initial.archived || !writable}
                onClick={() => setEditing(true)}
              >
                <Pencil size={14} />
                {tr("编辑")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !writable}
                onClick={() =>
                  void save(initial.archived ? "restore" : "archive")
                }
              >
                {tr(initial.archived ? "恢复" : "归档")}
              </Button>
            </div>
            <details>
              <summary>{tr("修改历史")}</summary>
              {initial.history.map((e) => (
                <p key={e.id}>
                  {date(e.created_at, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  · {meta.members.find((m) => m.id === e.actor_id)?.name} ·{" "}
                  {e.action || tr("创建")}
                </p>
              ))}
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
