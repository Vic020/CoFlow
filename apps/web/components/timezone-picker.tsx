"use client";

import { useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";
import { searchTimeZones } from "@/lib/time-zone-search";

export function TimezonePicker({ value, zones, disabled, onSelect }: {
  value: string; zones: string[]; disabled?: boolean; onSelect: (value: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const matches = searchTimeZones(zones, query);
  function choose(zone: string) { setOpen(false); setQuery(""); if (zone !== value) onSelect(zone); }
  return <div className="timezone-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <div className="timezone-picker-input">
      <input ref={input} id="display-timezone" role="combobox" autoComplete="off" spellCheck={false}
        aria-expanded={open} aria-controls={id} aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${id}-${active}` : undefined}
        value={open ? query : value} disabled={disabled} placeholder={t("搜索时区…")}
        onFocus={() => { setQuery(""); setActive(0); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); if (list.current) list.current.scrollTop = 0; }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
          if (event.key === "Enter" && open) { event.preventDefault(); if (matches[active]) choose(matches[active]); return; }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            if (!open && !["ArrowDown", "ArrowUp"].includes(event.key)) return;
            event.preventDefault();
            const next = !open ? 0 : event.key === "Home" ? 0 : event.key === "End" ? matches.length - 1 : Math.max(0, Math.min(matches.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
            setOpen(true); setActive(next);
            list.current?.querySelectorAll('[role="option"]')[next]?.scrollIntoView({ block: "nearest" });
          }
        }} />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label={t("展开时区")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { if (open) setOpen(false); else { input.current?.focus(); setQuery(""); setActive(0); setOpen(true); } }}><ChevronDown size={15} /></button>
    </div>
    {open && <div ref={list} id={id} className="timezone-picker-list" role="listbox" aria-label={t("展示时区")}>
      {matches.length ? matches.map((zone, index) => <button key={zone} id={`${id}-${index}`} type="button" role="option"
        tabIndex={-1} aria-selected={zone === value} data-active={index === active}
        onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(zone)}>
        <span>{zone}</span>{zone === value && <Check size={14} />}
      </button>) : <p role="status">{t("没有匹配的时区")}</p>}
    </div>}
  </div>;
}
