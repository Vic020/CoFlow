"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarDays, monthShift, addDays } from "@/lib/calendar";
import { isoWeek } from "@/lib/calendar-week";
import { useI18n } from "./i18n-provider";

export function CalendarMiniMonth({
  anchor,
  selected,
  today,
  week,
  onSelect,
}: {
  anchor: string;
  selected: string;
  today: string;
  week: string[];
  onSelect: (day: string) => void;
}) {
  const { t: tr, date, locale } = useI18n();
  const [month, setMonth] = useState(anchor.slice(0, 7));
  useEffect(() => setMonth(anchor.slice(0, 7)), [anchor]);
  const days = calendarDays(`${month}-01`, "month");
  const label = (day: string, options: Intl.DateTimeFormatOptions) =>
    date(`${day}T12:00:00Z`, { ...options, timeZone: "UTC" });
  return (
    <section className="calendar-mini-month" aria-label={tr("日期导航")}>
      <div className="mini-month-heading">
        <h3>{label(`${month}-01`, { year: "numeric", month: "long" })}</h3>
        <button
          aria-label={tr("上个月")}
          onClick={() => setMonth(monthShift(`${month}-01`, -1).slice(0, 7))}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          aria-label={tr("下个月")}
          onClick={() => setMonth(monthShift(`${month}-01`, 1).slice(0, 7))}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="mini-month-grid">
        <span className="mini-week-number" aria-label={tr("周数")}>
          #
        </span>
        {days.slice(0, 7).map((day) => (
          <span className="mini-weekday" key={day}>
            {label(day, { weekday: "narrow" })}
          </span>
        ))}
        {Array.from({ length: 6 }, (_, row) => (
          <div
            className={`mini-month-week${week.some((day) => days.slice(row * 7, row * 7 + 7).includes(day)) ? " is-active-week" : ""}`}
            key={row}
          >
            <span className="mini-week-number">
              {new Intl.NumberFormat(locale).format(isoWeek(days[row * 7]))}
            </span>
            {days.slice(row * 7, row * 7 + 7).map((day) => (
              <button
                key={day}
                type="button"
                data-mini-day={day}
                className={`${day.slice(0, 7) !== month ? "is-outside " : ""}${day === today ? "is-today " : ""}${day === selected ? "is-selected" : ""}`}
                aria-label={label(day, { dateStyle: "full" })}
                aria-pressed={day === selected}
                onClick={() => onSelect(day)}
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
                    const next = addDays(day, delta);
                    onSelect(next);
                    e.currentTarget
                      .closest(".calendar-mini-month")
                      ?.querySelector<HTMLButtonElement>(
                        `[data-mini-day="${next}"]`,
                      )
                      ?.focus();
                  }
                }}
              >
                {new Intl.NumberFormat(locale).format(Number(day.slice(8)))}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
