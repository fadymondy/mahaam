// en / ar strings. Language, theme and layout direction are the grid's (PrefsProvider): one source
// of truth, so switching to Arabic flips the whole app to RTL — immediately through `direction` on
// the root view, and natively through I18nManager.forceRTL plus one controlled reload.
//
// Mahaam's dictionaries stay nested and typed here; they are flattened into dotted keys and merged
// over the grid's own strings (StringsProvider), so grid components and Mahaam screens share them.
import { useMemo } from "react";

import { useT as useGridT, usePrefs, type GridKey, type Locale } from "@/grid";

import { type Dict } from "./en";
import { fill } from "./strings";

export type { Locale };

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
/** Mahaam's keys plus the grid's own (auth.strengthHint, settings.theme.dark, …). */
export type TKey = Paths<Dict> | GridKey;
export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

export { strings, translate } from "./strings";

export function useT(): TFn {
  const t = useGridT<string>();
  // The grid's t() fills each {var} once; ours fills every occurrence.
  return (key, vars) => fill(t(key), vars);
}

export function useI18n() {
  const { locale, isRTL, setLocale } = usePrefs();
  const t = useT();
  return { locale: locale ?? "en", rtl: isRTL, t, setLocale };
}

/** Locale-aware short date / time. */
export function useFormat() {
  const { locale } = useI18n();
  const tag = locale === "ar" ? "ar-EG" : "en-GB";
  return useMemo(
    () => ({
      date: (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" }),
      day: (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(tag, { weekday: "short", day: "numeric" }),
      time: (iso: string) => new Date(iso).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" }),
      money: (minor: number, currency: string) => {
        try {
          return new Intl.NumberFormat(tag, { style: "currency", currency }).format(minor / 100);
        } catch {
          return `${(minor / 100).toFixed(2)} ${currency}`;
        }
      },
      number: (n: number) => n.toLocaleString(tag),
    }),
    [tag],
  );
}
