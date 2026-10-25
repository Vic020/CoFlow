"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronRight, Languages, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth-gate";
import { useI18n } from "@/components/i18n-provider";
import { localeNames, locales, type Locale } from "@/lib/i18n/core";
import { request } from "@/lib/types";

export function AccountLanguage() {
  const auth = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    selected.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  async function choose(next: Locale) {
    setOpen(false);
    trigger.current?.focus();
    if (next === locale) return;
    const previous = locale;
    setLocale(next);
    setBusy(true);
    setError("");
    try {
      if (auth.mode !== "local-demo") {
        await request("/auth/preferences", {
          method: "PATCH",
          body: JSON.stringify({ locale: next }),
        });
        await auth.refresh();
      }
    } catch (e) {
      setLocale(previous);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={root} className="account-language-control" onKeyDown={(event) => {
      if (open && event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <button ref={trigger} type="button" className="account-language-row"
        aria-expanded={open} aria-controls={panelId} aria-busy={busy}
        disabled={busy} onClick={() => setOpen((value) => !value)}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
        <span>{t("语言")}</span>
        <ChevronRight size={14} className="account-language-chevron" />
      </button>
      {open && <div id={panelId} className="account-language-popover" role="group" aria-label={t("语言")}>
        {locales.map((value) => <button key={value} type="button"
          ref={value === locale ? selected : undefined}
          aria-pressed={value === locale} onClick={() => void choose(value)}>
          <span>{localeNames[value]}</span>
          {value === locale && <Check size={14} />}
        </button>)}
      </div>}
      {error && <p className="error-text" role="alert">{t(error)}</p>}
    </div>
  );
}
