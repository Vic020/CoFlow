"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  civilBounds,
  civilDay,
  onDay,
  addDays,
  type CalendarItem,
} from "@/lib/calendar";
import {
  weekSegments,
  positionWeekSegments,
  weekTimeSelection,
  type WeekSegment,
} from "@/lib/calendar-week";
import type { Report, Meta } from "@/lib/types";
import { useI18n } from "./i18n-provider";

type Timed = WeekSegment & {
  title: string;
  report?: Report;
  item?: CalendarItem;
};
const hourHeight = 52;
export function CalendarWeekView({
  days,
  selected,
  zone,
  mode,
  reports,
  reportHref,
  items,
  meta,
  loading,
  onSelect,
  onOpen,
  onCreate,
}: {
  days: string[];
  selected: string;
  zone: string;
  mode: "reports" | "schedule";
  reports: Report[];
  reportHref: (id: string) => string;
  items: CalendarItem[];
  meta: Meta;
  loading: boolean;
  onSelect: (day: string) => void;
  onOpen: (item: CalendarItem) => void;
  onCreate: (day: string, minute?: number, endMinute?: number) => void;
}) {
  const { t: tr, date, locale } = useI18n();
  const scroll = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const dayKey = days.join(",");
  const [timeSelection, setTimeSelection] = useState<{
    day: string;
    start: number;
    end: number;
  } | null>(null);
  const gesture = useRef<{
    day: string;
    anchor: number;
    y: number;
    pointer: number;
    moved: boolean;
    target: HTMLDivElement;
  } | null>(null);
  const keyboardSelection = useRef<{
    day: string;
    anchor: number;
    caret: number;
  } | null>(null);
  const suppressClickUntil = useRef(0);
  function cancelSelection() {
    const current = gesture.current;
    gesture.current = null;
    keyboardSelection.current = null;
    setTimeSelection(null);
    if (current?.target.hasPointerCapture(current.pointer))
      current.target.releasePointerCapture(current.pointer);
  }
  useEffect(() => {
    cancelSelection();
  }, [dayKey, zone, mode]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelSelection();
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      gesture.current = null;
    };
  }, []);
  const minuteAt = (target: HTMLDivElement, y: number) =>
    Math.max(
      0,
      Math.min(
        1440,
        ((y - target.getBoundingClientRect().top) / hourHeight) * 60,
      ),
    );
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const number = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumIntegerDigits: 2,
        useGrouping: false,
      }),
    [locale],
  );
  const minuteLabel = (minute: number) =>
    `${number.format(Math.floor(minute / 60))}:${number.format(Math.floor(minute % 60))}`;
  const offsetLabel = (at: string | Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date(at))
      .find((p) => p.type === "timeZoneName")?.value || zone;
  const columns = useMemo(
    () =>
      days.map((day) => {
        const timed: Timed[] =
          mode === "reports"
            ? reports.flatMap((report) =>
                weekSegments(
                  `report:${report.id}`,
                  report.created_at,
                  report.created_at,
                  day,
                  zone,
                ).map((segment) => ({
                  ...segment,
                  title: report.title,
                  report,
                })),
              )
            : items.flatMap((item) =>
                item.schedule?.kind === "time-range"
                  ? weekSegments(
                      item.key,
                      item.schedule.start_at!,
                      item.schedule.end_at!,
                      day,
                      zone,
                    ).map((segment) => ({
                      ...segment,
                      title: item.title,
                      item,
                    }))
                  : [],
              );
        const allDay =
          mode === "schedule"
            ? items.filter(
                (item) =>
                  (item.schedule?.kind === "date-range" &&
                    onDay({ schedule: item.schedule }, day, zone)) ||
                  item.due_date === day,
              )
            : [];
        return {
          day,
          timed: positionWeekSegments(timed),
          allDay,
          count: new Set([
            ...timed.map((e) => e.report?.id || e.item!.key),
            ...allDay.map((item) => item.key),
          ]).size,
          hours:
            (civilBounds(day, zone)[1] - civilBounds(day, zone)[0]) / 3600000,
        };
      }),
    [dayKey, zone, mode, reports, items],
  );
  const today = civilDay(now, zone);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const nowMinute =
    Number(clock.find((p) => p.type === "hour")?.value) * 60 +
    Number(clock.find((p) => p.type === "minute")?.value);
  useEffect(() => {
    if (loading || !scroll.current) return;
    const starts = columns.flatMap((column) =>
      column.timed.map((event) => event.start),
    );
    const first = starts.length
      ? Math.max(0, Math.min(...starts) - 60)
      : days.includes(civilDay(new Date(), zone))
        ? Math.max(0, nowMinute - 60)
        : 8 * 60;
    scroll.current.scrollTop = (first / 60) * hourHeight;
    // Reposition when a range loads, never on the minute clock or day selection.
  }, [dayKey, zone, loading]);
  useEffect(() => {
    const container = scroll.current;
    const day = container?.querySelector<HTMLElement>(
      `[data-week-day="${selected}"]`,
    );
    if (container && day) {
      const left = day.offsetLeft,
        right = left + day.offsetWidth;
      if (left < container.scrollLeft + 52)
        container.scrollLeft = Math.max(0, left - 52);
      else if (right > container.scrollLeft + container.clientWidth)
        container.scrollLeft = right - container.clientWidth;
    }
  }, [selected, dayKey]);
  function eventTitle(event: Timed) {
    const member = meta.members.find(
      (member) =>
        member.id === (event.report?.author_id || event.item?.member_id),
    );
    return `${event.title}${member ? ` · ${member.name}` : ""}\n${date(event.startAt, { dateStyle: "medium", timeStyle: "short", timeZone: zone })} ${offsetLabel(event.startAt)}${event.point ? "" : ` → ${date(event.endAt, { dateStyle: "medium", timeStyle: "short", timeZone: zone })} ${offsetLabel(event.endAt)}`}${event.continuation ? `\n${tr("跨日或时区切换的延续")}` : ""}`;
  }
  return (
    <section
      className="calendar-time-week"
      aria-label={tr(mode === "reports" ? "进度周视图" : "排期周视图")}
    >
      <div
        className="week-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label={tr("周时间网格，可上下和左右滚动")}
      >
        <div className="week-canvas">
          <div className="week-header">
            <div className="week-timezone" title={zone}>
              {offsetLabel(now)}
            </div>
            {columns.map((column) => (
              <button
                key={column.day}
                data-week-day={column.day}
                className={`week-date${column.day === today ? " is-today" : ""}${column.day === selected ? " is-selected" : ""}`}
                aria-pressed={column.day === selected}
                aria-label={`${date(`${column.day}T12:00:00Z`, { dateStyle: "full", timeZone: "UTC" })} · ${column.count}`}
                onClick={() => onSelect(column.day)}
                onDoubleClick={() => onCreate(column.day)}
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
                    const next = addDays(column.day, delta);
                    onSelect(next);
                    scroll.current
                      ?.querySelector<HTMLButtonElement>(
                        `[data-week-day="${next}"]`,
                      )
                      ?.focus();
                  }
                }}
              >
                <span>
                  {date(`${column.day}T12:00:00Z`, {
                    weekday: "short",
                    timeZone: "UTC",
                  })}
                </span>
                <strong>
                  {new Intl.NumberFormat(locale).format(
                    Number(column.day.slice(8)),
                  )}
                </strong>
                {column.count > 0 && <small>{column.count}</small>}
                {column.hours !== 24 && (
                  <em title={tr("按当地时刻展示，夏令时日期长度可能不同")}>
                    {tr("{count} 小时", { count: column.hours })}
                  </em>
                )}
              </button>
            ))}
          </div>
          {mode === "schedule" && (
            <div className="week-all-day">
              <div className="week-all-day-label">{tr("全天")}</div>
              {columns.map((column) => (
                <div
                  className="week-all-day-cell"
                  key={column.day}
                  onDoubleClick={(e) => {
                    if (e.target === e.currentTarget) onCreate(column.day);
                  }}
                >
                  {column.allDay.slice(0, 4).map((item) => (
                    <button
                      className={`week-all-day-event calendar-kind-${item.kind}`}
                      key={item.key}
                      onClick={() => onOpen(item)}
                      title={item.title}
                    >
                      {item.due_date === column.day && (
                        <span>{tr("截止日期")} · </span>
                      )}
                      {item.blocked && (
                        <span
                          className="context-warning"
                          title={tr("等待解除阻塞")}
                        >
                          !{" "}
                        </span>
                      )}
                      {item.title}
                    </button>
                  ))}
                  {column.allDay.length > 4 && (
                    <button
                      className="week-more"
                      onClick={() => onSelect(column.day)}
                    >
                      {tr("另有 {count} 项", {
                        count: column.allDay.length - 4,
                      })}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="week-hours" style={{ height: 24 * hourHeight }}>
            <div className="week-hour-axis">
              {Array.from({ length: 24 }, (_, hour) => (
                <span
                  key={hour}
                  data-hour={hour}
                  style={{ top: hour * hourHeight }}
                >
                  {minuteLabel(hour * 60)}
                </span>
              ))}
              {days.includes(today) && (
                <span
                  className="week-current-label"
                  style={{ top: (nowMinute / 60) * hourHeight }}
                  aria-hidden="true"
                >
                  {minuteLabel(nowMinute)}
                </span>
              )}
            </div>
            {columns.map((column) => (
              <div
                className={`week-day-track${column.day === today ? " is-today" : ""}${column.day === selected ? " is-selected" : ""}`}
                key={column.day}
                data-week-track={column.day}
                role="group"
                title={tr("拖选时间创建节点")}
                tabIndex={0}
                aria-label={
                  date(column.day + "T12:00:00Z", {
                    dateStyle: "full",
                    timeZone: "UTC",
                  }) +
                  " · " +
                  tr("拖选时间创建节点")
                }
                onPointerDown={(e) => {
                  if (
                    e.target !== e.currentTarget ||
                    e.button !== 0 ||
                    !e.isPrimary ||
                    e.pointerType === "touch"
                  )
                    return;
                  e.preventDefault();
                  keyboardSelection.current = null;
                  setTimeSelection(null);
                  gesture.current = {
                    day: column.day,
                    anchor: minuteAt(e.currentTarget, e.clientY),
                    y: e.clientY,
                    pointer: e.pointerId,
                    moved: false,
                    target: e.currentTarget,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const current = gesture.current;
                  if (!current || current.pointer !== e.pointerId) return;
                  if (Math.abs(e.clientY - current.y) >= 6)
                    current.moved = true;
                  if (!current.moved) return;
                  const viewport = scroll.current;
                  if (viewport) {
                    const rect = viewport.getBoundingClientRect();
                    const top =
                      rect.top +
                      (viewport.querySelector<HTMLElement>(".week-header")
                        ?.offsetHeight || 0) +
                      (viewport.querySelector<HTMLElement>(".week-all-day")
                        ?.offsetHeight || 0);
                    if (e.clientY > rect.bottom - 20) viewport.scrollTop += 12;
                    else if (e.clientY < top + 20) viewport.scrollTop -= 12;
                  }
                  setTimeSelection({
                    day: current.day,
                    ...weekTimeSelection(
                      current.anchor,
                      minuteAt(current.target, e.clientY),
                    ),
                  });
                }}
                onPointerUp={(e) => {
                  const current = gesture.current;
                  if (!current || current.pointer !== e.pointerId) return;
                  gesture.current = null;
                  if (current.target.hasPointerCapture(e.pointerId))
                    current.target.releasePointerCapture(e.pointerId);
                  if (!current.moved) return;
                  e.preventDefault();
                  const range = weekTimeSelection(
                    current.anchor,
                    minuteAt(current.target, e.clientY),
                  );
                  setTimeSelection(null);
                  suppressClickUntil.current = performance.now() + 400;
                  onSelect(current.day);
                  onCreate(current.day, range.start, range.end);
                }}
                onPointerCancel={cancelSelection}
                onLostPointerCapture={() => {
                  gesture.current = null;
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" && timeSelection?.day === column.day) {
                    e.preventDefault();
                    onSelect(column.day);
                    onCreate(
                      column.day,
                      timeSelection.start,
                      timeSelection.end,
                    );
                    cancelSelection();
                    return;
                  }
                  const step =
                    e.key === "ArrowUp" ? -30 : e.key === "ArrowDown" ? 30 : 0;
                  if (!step) return;
                  e.preventDefault();
                  const old =
                    keyboardSelection.current?.day === column.day
                      ? keyboardSelection.current
                      : null;
                  const caret = Math.max(
                    0,
                    Math.min(1410, old ? old.caret + step : 8 * 60),
                  );
                  const anchor = e.shiftKey && old ? old.anchor : caret;
                  keyboardSelection.current = {
                    day: column.day,
                    caret,
                    anchor,
                  };
                  const range = weekTimeSelection(
                    Math.min(anchor, caret),
                    Math.max(anchor, caret) + 30,
                  );
                  setTimeSelection({ day: column.day, ...range });
                  const viewport = scroll.current;
                  if (viewport) {
                    const rect = viewport.getBoundingClientRect(),
                      track = e.currentTarget.getBoundingClientRect();
                    const top =
                      rect.top +
                      (viewport.querySelector<HTMLElement>(".week-header")
                        ?.offsetHeight || 0) +
                      (viewport.querySelector<HTMLElement>(".week-all-day")
                        ?.offsetHeight || 0) +
                      6;
                    const start = track.top + (range.start / 60) * hourHeight,
                      end = track.top + (range.end / 60) * hourHeight;
                    if (start < top) viewport.scrollTop -= top - start;
                    else if (end > rect.bottom - 6)
                      viewport.scrollTop += end - rect.bottom + 6;
                  }
                }}
                onDoubleClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const minute =
                    ((e.clientY - e.currentTarget.getBoundingClientRect().top) /
                      hourHeight) *
                    60;
                  onCreate(column.day, minute);
                }}
                onClick={() => {
                  if (performance.now() >= suppressClickUntil.current)
                    onSelect(column.day);
                }}
              >
                {timeSelection?.day === column.day && (
                  <div
                    className="week-time-selection"
                    role="status"
                    style={{
                      top: (timeSelection.start / 60) * hourHeight,
                      height:
                        ((timeSelection.end - timeSelection.start) / 60) *
                        hourHeight,
                    }}
                  >
                    {timeSelection.end - timeSelection.start >= 60 && (
                      <strong>{tr("新建节点")}</strong>
                    )}
                    <time>
                      {minuteLabel(timeSelection.start)}–
                      {minuteLabel(timeSelection.end)}
                    </time>
                  </div>
                )}
                {column.timed.map((event) => {
                  const style = {
                    top: (event.start / 60) * hourHeight,
                    height: Math.max(
                      event.point ? 34 : 22,
                      ((event.end - event.start) / 60) * hourHeight - 2,
                    ),
                    left: `calc(${(event.lane / event.lanes) * 100}% + 3px)`,
                    width: `calc(${100 / event.lanes}% - 6px)`,
                  };
                  const content = (
                    <>
                      <time>
                        {minuteLabel(event.start)}
                        {event.point ? "" : `–${minuteLabel(event.end)}`}
                        {column.hours !== 24 &&
                          ` ${offsetLabel(event.startAt)}`}
                      </time>
                      <span>
                        {event.item && event.item.kind !== "todo" && event.point
                          ? "◆ "
                          : ""}
                        {event.item?.blocked && (
                          <span
                            className="context-warning"
                            title={tr("等待解除阻塞")}
                          >
                            !{" "}
                          </span>
                        )}
                        {event.title}
                      </span>
                    </>
                  );
                  const cls = `week-event ${event.point ? "is-point" : "is-range"} calendar-kind-${event.item?.kind || "report"}${event.item?.completed ? " is-completed" : ""}`;
                  return event.report ? (
                    <Link
                      key={event.key}
                      className={cls}
                      style={style}
                      scroll={false}
                      href={reportHref(event.report.id)}
                      title={eventTitle(event)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      key={event.key}
                      className={cls}
                      style={style}
                      title={eventTitle(event)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(event.item!);
                      }}
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            ))}
            {days.includes(today) && (
              <div
                className="week-now"
                style={{ top: (nowMinute / 60) * hourHeight }}
                aria-hidden="true"
              >
                <i />
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="week-footnote">
        {tr(
          mode === "reports"
            ? "简报按真实上报时刻定位，不表示工作时长。"
            : "全天安排与截止日期在顶部，具体时间按显示时区定位。",
        )}
      </p>
    </section>
  );
}
