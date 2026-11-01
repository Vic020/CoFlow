"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { calendarDateSelection, type Schedule } from "@/lib/calendar";
import { useI18n } from "./i18n-provider";

type Selection = { start: number; end: number };
export function GanttCreateRow({
  days,
  disabled,
  onCreate,
  onDismiss,
}: {
  days: string[];
  disabled: boolean;
  onCreate: (schedule: Schedule) => void;
  onDismiss: () => void;
}) {
  const { t: tr, date } = useI18n();
  const [selection, setSelection] = useState<Selection | null>(null);
  const gesture = useRef<(Selection & { pointer: number }) | null>(null);
  const track = useRef<HTMLDivElement>(null);
  function indexAt(clientX: number) {
    const rect = track.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        days.length - 1,
        Math.floor(((clientX - rect.left) / rect.width) * days.length),
      ),
    );
  }
  function create(value: Selection) {
    if (!disabled)
      onCreate(calendarDateSelection(days, value.start, value.end));
  }
  const label = (day: string) =>
    date(`${day}T12:00:00Z`, { dateStyle: "medium", timeZone: "UTC" });
  return (
    <div className="gantt-row gantt-create-row">
      <div className="gantt-create-label">
        <span>{tr("新节点")}</span>
        <button type="button" onClick={onDismiss} aria-label={tr("取消新建行")}>
          <X size={14} />
        </button>
        <small>{tr("拖选日期，松开创建")}</small>
      </div>
      <div
        className="gantt-create-track"
        ref={track}
        role="group"
        aria-label={tr("选择节点日期范围")}
        style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0 || !e.isPrimary) return;
          e.preventDefault();
          const index = indexAt(e.clientX);
          const value = {
            start: e.shiftKey && selection ? selection.start : index,
            end: index,
            pointer: e.pointerId,
          };
          gesture.current = value;
          setSelection(value);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const current = gesture.current;
          if (!current || current.pointer !== e.pointerId) return;
          current.end = indexAt(e.clientX);
          setSelection({ start: current.start, end: current.end });
        }}
        onPointerUp={(e) => {
          const current = gesture.current;
          if (!current || current.pointer !== e.pointerId) return;
          current.end = indexAt(e.clientX);
          gesture.current = null;
          setSelection({ start: current.start, end: current.end });
          e.currentTarget.releasePointerCapture(e.pointerId);
          create(current);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setSelection(null);
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
        }}
      >
        {days.map((day, index) => (
          <button
            type="button"
            key={day}
            data-create-day={day}
            tabIndex={index === (selection?.end ?? 0) ? 0 : -1}
            disabled={disabled}
            aria-label={label(day)}
            aria-pressed={
              !!selection &&
              index >= Math.min(selection.start, selection.end) &&
              index <= Math.max(selection.start, selection.end)
            }
            onClick={(e) => {
              if (e.detail === 0)
                create(selection || { start: index, end: index });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                gesture.current = null;
                setSelection(null);
                return;
              }
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                create(selection || { start: index, end: index });
                return;
              }
              const step =
                e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = Math.max(0, Math.min(days.length - 1, index + step));
              setSelection({
                start: e.shiftKey ? (selection?.start ?? index) : next,
                end: next,
              });
              track.current
                ?.querySelector<HTMLButtonElement>(
                  `[data-create-day="${days[next]}"]`,
                )
                ?.focus();
            }}
          >
            <span className="sr-only">{day}</span>
          </button>
        ))}
        {!selection && (
          <span className="gantt-create-instruction">
            <Plus size={13} />
            {tr("拖选日期创建节点")}
          </span>
        )}
      </div>
    </div>
  );
}
