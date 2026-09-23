// en/ar strings, direction and formatters. The locale is a preference held by the main process
// (it also drives the native menu and the menu-bar timer), so switching it switches everything.
import { createContext, useContext, useMemo, type ReactNode } from "react";

import * as core from "../lang/core";
import * as inbox from "../lang/inbox";
import * as issues from "../lang/issues";
import * as settings from "../lang/settings";
import * as time from "../lang/time";

const EN = { ...core.en, ...issues.en, ...time.en, ...inbox.en, ...settings.en };
const AR = { ...core.ar, ...issues.ar, ...time.ar, ...inbox.ar, ...settings.ar } as Record<string, string>;

export type Locale = "en" | "ar";
export type TKey = keyof typeof core.en | (string & {});

export function translate(locale: Locale, key: TKey, vars?: Record<string, string | number>): string {
  let s = (locale === "ar" ? AR[key] : undefined) ?? (EN as Record<string, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

interface I18n {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  /** 12 Mar, 14:05 — in the locale's digits and calendar words. */
  date: (iso: string | number | Date, opts?: Intl.DateTimeFormatOptions) => string;
  /** "3m ago", "in 2d". */
  relative: (iso: string | number | Date) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const tag = locale === "ar" ? "ar-EG" : "en-GB";
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: "short" });
    return {
      locale,
      dir: locale === "ar" ? "rtl" : "ltr",
      t: (key, vars) => translate(locale, key, vars),
      date: (iso, opts) => new Intl.DateTimeFormat(tag, opts ?? { day: "numeric", month: "short" }).format(new Date(iso)),
      relative: (iso) => {
        const diff = (new Date(iso).getTime() - Date.now()) / 1000;
        const abs = Math.abs(diff);
        if (abs < 60) return rtf.format(Math.round(diff), "second");
        if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
        if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
        if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
        return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
      },
      number: (n, opts) => new Intl.NumberFormat(tag, opts).format(n),
    };
  }, [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}

export const useT = () => useI18n().t;
