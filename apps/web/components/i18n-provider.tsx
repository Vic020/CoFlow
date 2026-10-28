"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  defaultLocale,
  defaultTimeZone,
  isTimeZone,
  formatDate,
  isLocale,
  localeNames,
  locales,
  translate,
  type Locale,
  type Values,
} from "@/lib/i18n/core";

const storageKey = "coflow-locale";
type I18n = {
  locale: Locale;
  timeZone: string;
  setTimeZone: (value: string) => void;
  setLocale: (locale: Locale) => void;
  t: (message: string, values?: Values) => string;
  date: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string;
};
const Context = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(defaultLocale);
  const [timeZone, updateTimeZone] = useState(defaultTimeZone);
  const pathname = usePathname();
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (isLocale(saved)) updateLocale(saved);
      const savedZone = localStorage.getItem("coflow-timezone");
      if (isTimeZone(savedZone)) updateTimeZone(savedZone);
    } catch {
      /* Storage may be disabled; the current session still works. */
    }
  }, []);
  const setLocale = useCallback((value: Locale) => {
    if (!isLocale(value)) return;
    updateLocale(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {}
  }, []);
  const setTimeZone = useCallback((value: string) => {
    if (!isTimeZone(value)) return;
    updateTimeZone(value);
    try {
      localStorage.setItem("coflow-timezone", value);
    } catch {}
  }, []);
  const t = useCallback(
    (message: string, values?: Values) => translate(locale, message, values),
    [locale],
  );
  const date = useCallback(
    (value: string | Date, options?: Intl.DateTimeFormatOptions) =>
      formatDate(locale, value, { timeZone, ...options }),
    [locale, timeZone],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const path = pathname.replace(/\/$/, "") || "/";
  const page = path.endsWith("/docs")
    ? "协作指南"
    : path.endsWith("/todo")
      ? "Todo"
      : path.endsWith("/teams/new")
        ? "新建团队"
        : path.endsWith("/credentials")
          ? "Agent 凭证"
          : path.endsWith("/settings")
            ? "团队设置"
            : path.endsWith("/invite")
              ? "加入团队"
              : "团队动态";
  const value = useMemo(
    () => ({ locale, setLocale, timeZone, setTimeZone, t, date }),
    [locale, setLocale, timeZone, setTimeZone, t, date],
  );
  return (
    <Context.Provider value={value}>
      <title>{`${t(page)} · CoFlow`}</title>
      {children}
    </Context.Provider>
  );
}

export function useI18n() {
  const context = useContext(Context);
  if (!context) throw new Error("I18nProvider is required");
  return context;
}

export function LanguageSwitcher({
  inline = false,
}: { inline?: boolean } = {}) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={inline ? "inline-language" : "account-language"}>
      <span className="sr-only">{t("语言")}</span>
      <select
        aria-label={t("语言")}
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) setLocale(e.target.value);
        }}
      >
        {locales.map((value) => (
          <option key={value} value={value}>
            {localeNames[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
