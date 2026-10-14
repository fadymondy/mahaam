"use client"

// Frontend i18n: flat key dictionaries per locale under web/lang/<locale>.json.
// Adding a language: add lang/<code>.json with the same keys as en.json,
// register it in DICTIONARIES and add the code to LOCALES in ./i18n-locale.ts.
import { createContext, useContext, useMemo, type ReactNode } from "react"
import { dirForLocale, intlTag, isLocale, type Locale } from "@/lib/i18n-locale"
import en from "@/lang/en.json"
import ar from "@/lang/ar.json"
// P1 (projects, tasks, clients, teams, labels, activity) keeps its keys in its own files; they
// are merged over the base dictionaries, so a key here overrides the same key in en/ar.json.
import workEn from "@/lang/work.en.json"
import workAr from "@/lang/work.ar.json"
// P2 (time tracking, rates, notifications) — merged last, so it may override a P1 key (dev.*, nav.comingNext).
import timeEn from "@/lang/time.en.json"
import timeAr from "@/lang/time.ar.json"
// P5 (reports, budgets, saved views, notification settings, new inbox kinds) — merged after P2.
import reportsEn from "@/lang/reports.en.json"
import reportsAr from "@/lang/reports.ar.json"

import invoicesEn from "@/lang/invoices.en.json"
import invoicesAr from "@/lang/invoices.ar.json"
// Integrations (GitHub / Jira / Linear) and the project GitHub tab.
import integrationsEn from "@/lang/integrations.en.json"
import integrationsAr from "@/lang/integrations.ar.json"
// Roadmap 5: the customer portal, the request portal and the staff Requests inbox.
import portalEn from "@/lang/portal.en.json"
import portalAr from "@/lang/portal.ar.json"
// Roadmap 10: the employee KPI, manager reviews and per-user GitHub accounts.
import kpiEn from "@/lang/kpi.en.json"
import kpiAr from "@/lang/kpi.ar.json"
// The platform admin panel, Settings → Plan & usage and the suspension states.
import adminEn from "@/lang/admin.en.json"
import adminAr from "@/lang/admin.ar.json"

// The rebuilt app shell and home dashboard.
import homeEn from "@/lang/home.en.json"
import homeAr from "@/lang/home.ar.json"

export { LOCALES, dirForLocale, isLocale } from "@/lib/i18n-locale"
export type { Locale } from "@/lib/i18n-locale"

type Dict = Record<string, string>
const DICTIONARIES: Record<Locale, Dict> = {
  en: { ...en, ...workEn, ...timeEn, ...reportsEn, ...invoicesEn, ...integrationsEn, ...portalEn, ...kpiEn, ...adminEn, ...homeEn },
  ar: { ...ar, ...workAr, ...timeAr, ...reportsAr, ...invoicesAr, ...integrationsAr, ...portalAr, ...kpiAr, ...adminAr, ...homeAr },
}

/** Non-reactive lookup — for use outside React. */
export function trans(key: string, locale: string = "en"): string {
  const dict = DICTIONARIES[isLocale(locale) ? locale : "en"]
  return dict[key] ?? DICTIONARIES.en[key] ?? key
}

const I18nContext = createContext<Locale | null>(null)

export function I18nProvider({ locale: raw, children }: { locale: string; children: ReactNode }) {
  const locale = isLocale(raw) ? raw : "en"
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>
}

export function useTranslations() {
  const locale = useContext(I18nContext)
  if (!locale) throw new Error("useTranslations must be used inside <I18nProvider>")
  const dict = DICTIONARIES[locale]

  const t = useMemo(
    () => (key: string, vars?: Record<string, string | number>) => {
      let str = dict[key] ?? DICTIONARIES.en[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v))
      return str
    },
    [dict],
  )

  const formatDate = useMemo(
    () => (value: string | null | undefined) => {
      if (!value) return "—"
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) return "—"
      return new Intl.DateTimeFormat(intlTag(locale), { dateStyle: "medium" }).format(d)
    },
    [locale],
  )

  const dir = dirForLocale(locale)
  return { t, locale, dir, isRtl: dir === "rtl", formatDate }
}
