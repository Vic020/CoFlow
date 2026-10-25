import english from "./messages/en.json" with { type: "json" };

export const locales = ["en", "zh-CN"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const localeNames: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};
export type Values = Record<string, string | number | undefined>;
export type Message = string | { one: string; other: string };
const catalogs: Record<Locale, Record<string, Message>> = {
  en: english,
  "zh-CN": {},
};

export function isLocale(value: unknown): value is Locale {
  return locales.includes(value as Locale);
}

/** Source-language strings are stable message IDs; unknown/user content is preserved. */
export function translate(
  locale: Locale,
  message: string,
  values: Values = {},
): string {
  const catalog = catalogs[locale];
  let result: Message = Object.prototype.hasOwnProperty.call(catalog, message)
    ? catalog[message]
    : message;
  // Legacy API notifications/errors may already contain interpolated source text.
  // Match only catalogued templates, retaining captured user content verbatim.
  if (locale !== "zh-CN" && result === message && !Object.keys(values).length) {
    for (const [source, translated] of Object.entries(catalogs[locale])) {
      if (!source.includes("{")) continue;
      const names: string[] = [];
      const pattern = source
        .split(/(\{\w+\})/g)
        .map((part) => {
          if (/^\{\w+\}$/.test(part)) {
            names.push(part.slice(1, -1));
            return "([\\s\\S]*?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      const match = message.match(new RegExp(`^${pattern}$`));
      if (!match) continue;
      values = Object.fromEntries(
        names.map((name, index) => [name, match[index + 1]]),
      );
      result = translated;
      break;
    }
  }
  if (typeof result !== "string") {
    result =
      new Intl.PluralRules(locale).select(Number(values.count ?? 0)) === "one"
        ? result.one
        : result.other;
  }
  return result.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined
      ? match
      : typeof value === "number"
        ? new Intl.NumberFormat(locale).format(value)
        : value;
  });
}

export function formatDate(
  locale: string,
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Shanghai",
    ...options,
  }).format(date);
}

export const defaultTimeZone = "Asia/Shanghai";
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value === "Local") return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
export function calendarDateKey(value: string | Date, timeZone = defaultTimeZone) {
  return formatDate("en-CA", value, { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
}
