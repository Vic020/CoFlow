"use client";
import { useState } from "react";
import { useI18n } from "./i18n-provider";
import {
  localTime,
  wallTimeCandidates,
  validSchedule,
  type Schedule,
} from "@/lib/calendar";

export function ScheduleEditor({
  value,
  onChange,
  point = false,
}: {
  value: Schedule | null | undefined;
  onChange: (s: Schedule | null) => void;
  point?: boolean;
}) {
  const { t: tr, timeZone } = useI18n();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    field: "start_at" | "end_at";
    choices: string[];
  } | null>(null);
  const zone = value?.timezone || timeZone;
  function instant(field: "start_at" | "end_at", text: string) {
    setError("");
    setPending(null);
    try {
      if (value?.[field] && text === localTime(value[field]!, zone)) return;
      const choices = wallTimeCandidates(text, zone);
      if (!choices.length) {
        onChange({ ...value!, [field]: "" });
        setError(tr("该本地时间不存在，请重新选择"));
        return;
      }
      if (choices.length > 1) {
        onChange({ ...value!, [field]: "" });
        setPending({ field, choices });
        return;
      }
      apply(field, choices[0]);
    } catch {
      setError(tr("时区无效"));
    }
  }
  function apply(field: "start_at" | "end_at", at: string) {
    onChange({
      ...value!,
      [field]: at,
      ...(point ? { start_at: at, end_at: at } : {}),
    });
    setPending(null);
  }
  return (
    <div className="schedule-editor">
      <select
        aria-label={tr("排期类型")}
        value={value?.kind || ""}
        onChange={(e) => {
          setError("");
          setPending(null);
          onChange(
            e.target.value === "date-range"
              ? { kind: "date-range", start_date: "", end_date: "" }
              : e.target.value
                ? {
                    kind: "time-range",
                    start_at: "",
                    end_at: "",
                    timezone: timeZone,
                  }
                : null,
          );
        }}
      >
        <option value="">{tr("未排期")}</option>
        <option value="date-range">{tr("全天日期")}</option>
        <option value="time-range">{tr("具体时间")}</option>
      </select>
      {value?.kind === "date-range" && (
        <div className="calendar-input-row">
          <label>
            {tr("开始日期")}
            <input
              required
              type="date"
              value={value.start_date || ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  start_date: e.target.value,
                  ...(point ? { end_date: e.target.value } : {}),
                })
              }
            />
          </label>
          {!point && (
            <label>
              {tr("结束日期")}
              <input
                required
                type="date"
                min={value.start_date}
                value={value.end_date || ""}
                onChange={(e) =>
                  onChange({ ...value, end_date: e.target.value })
                }
              />
            </label>
          )}
        </div>
      )}
      {value?.kind === "time-range" && (
        <>
          <label>
            {tr("时区")}
            <input
              required
              value={zone}
              onChange={(e) => {
                setPending(null);
                onChange({ ...value, timezone: e.target.value });
              }}
            />
          </label>
          <div className="calendar-input-row">
            {(["start_at", "end_at"] as const)
              .filter((f) => !point || f === "start_at")
              .map((field) => {
                let display = "";
                try {
                  display = value[field] ? localTime(value[field]!, zone) : "";
                } catch {
                  /* Invalid zone stays editable. */
                }
                return (
                  <label key={field}>
                    {tr(field === "start_at" ? "开始时间" : "结束时间")}
                    <input
                      required
                      type="datetime-local"
                      defaultValue={display}
                      key={`${field}:${zone}:${value[field]}`}
                      onBlur={(e) => instant(field, e.target.value)}
                    />
                  </label>
                );
              })}
          </div>
          {pending && (
            <label>
              {tr("此时间出现两次，请选择时刻")}
              <select
                required
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) apply(pending.field, e.target.value);
                }}
              >
                <option value="">{tr("请选择")}</option>
                {pending.choices.map((at) => (
                  <option key={at} value={at}>
                    {at}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {value && !validSchedule(value, point) && (
        <p className="muted">{tr("请填写完整且有效的时间范围")}</p>
      )}
      {(error || pending || (value && !validSchedule(value, point))) && (
        <input
          className="calendar-validity"
          aria-label={tr("请修正时间")}
          required
          value=""
          onChange={() => {}}
          tabIndex={-1}
        />
      )}
    </div>
  );
}

export function ScheduleText({ value }: { value?: Schedule | null }) {
  const { t: tr, date, timeZone } = useI18n();
  if (!value) return <span className="muted">{tr("未排期")}</span>;
  const format = (day: string) =>
    date(`${day}T12:00:00Z`, { timeZone: "UTC", dateStyle: "medium" });
  if (value.kind === "date-range")
    return (
      <>
        {format(value.start_date!)}
        {value.start_date !== value.end_date && ` → ${format(value.end_date!)}`}
      </>
    );
  return (
    <>
      {date(value.start_at!, { dateStyle: "medium", timeStyle: "short" })}
      {value.start_at !== value.end_at &&
        ` → ${date(value.end_at!, { dateStyle: "medium", timeStyle: "short" })}`}{" "}
      <small>
        {timeZone}
        {value.timezone !== timeZone &&
          ` (${tr("排期时区")}: ${value.timezone})`}
      </small>
    </>
  );
}
