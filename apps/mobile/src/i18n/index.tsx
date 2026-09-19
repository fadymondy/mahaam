// en / ar strings and layout direction. Arabic flips the layout: immediately through a `direction`
// style on the root view (and `dir` on web), and persistently through I18nManager.forceRTL, which
// React Native applies from the next launch.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nManager, Platform } from "react-native";

import ar from "./ar";
import en, { type Dict } from "./en";

export type Locale = "en" | "ar";
const KEY = "mahaam.locale";
const dicts: Record<Locale, unknown> = { en, ar };

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type TKey = Paths<Dict>;
export type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const walk = (d: unknown) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], d);
  let s = walk(dicts[locale]) ?? walk(dicts.en);
  if (typeof s !== "string") return key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = (s as string).split(`{${k}}`).join(String(v));
  return s as string;
}

interface I18nCtx {
  locale: Locale;
  rtl: boolean;
  t: TFn;
  setLocale(l: Locale): void;
  /** True when the native layout direction only fully applies after a restart. */
  needsRestart: boolean;
}

const Ctx = createContext<I18nCtx | null>(null);

const deviceLocale = (): Locale => (getLocales()[0]?.languageCode === "ar" ? "ar" : "en");

function applyDirection(l: Locale) {
  const rtl = l === "ar";
  if (Platform.OS === "web") {
    if (typeof document !== "undefined") {
      document.documentElement.dir = rtl ? "rtl" : "ltr";
      document.documentElement.lang = l;
    }
    return false;
  }
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.forceRTL(rtl);
    return true;
  }
  return false;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      const l = v === "ar" || v === "en" ? v : deviceLocale();
      setLocaleState(l);
      applyDirection(l);
    });
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    void AsyncStorage.setItem(KEY, l);
    setNeedsRestart(applyDirection(l));
  }, []);

  const value = useMemo<I18nCtx>(
    () => ({ locale, rtl: locale === "ar", t: (k, v) => translate(locale, k, v), setLocale, needsRestart }),
    [locale, setLocale, needsRestart],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}

export function useT(): TFn {
  return useI18n().t;
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
