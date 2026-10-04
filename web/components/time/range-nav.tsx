"use client"

// The page's date range: week / month switch, previous / next, and the range itself. The URL holds
// the state (?range=month&ref=2026-09-01), so a range is shareable and reloadable.
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button, Tabs, TabsList, TabsTab } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { useTranslations } from "@/lib/i18n"
import { intlTag, type Locale } from "@/lib/i18n-locale"
import type { Period, RangeKind } from "@/lib/time-range"

/** "1 – 30 Sep 2026", Latin digits, formatted as calendar days (UTC). */
export function rangeLabel(p: Period, locale: Locale) {
  const f = new Intl.DateTimeFormat(intlTag(locale), { timeZone: "UTC", numberingSystem: "latn", day: "numeric", month: "short", year: "numeric" })
  return f.formatRange(new Date(p.from + "T00:00:00Z"), new Date(p.to + "T00:00:00Z"))
}

export function RangeNav({
  kind,
  period,
  isCurrent,
  onKind,
  onShift,
  onToday,
}: {
  kind: RangeKind
  period: Period | undefined
  isCurrent: boolean
  onKind: (k: RangeKind) => void
  onShift: (dir: -1 | 1) => void
  onToday: () => void
}) {
  const { t, locale, isRtl } = useTranslations()
  const prev = isRtl ? <ChevronRightIcon /> : <ChevronLeftIcon />
  const next = isRtl ? <ChevronLeftIcon /> : <ChevronRightIcon />
  return (
    <div className="flex flex-wrap items-center gap-2" data-range-nav>
      <Tabs value={kind} onValueChange={(v) => onKind(v as RangeKind)}>
        <TabsList>
          <TabsTab value="week" data-range="week">
            {t("time.range.week")}
          </TabsTab>
          <TabsTab value="month" data-range="month">
            {t("time.range.month")}
          </TabsTab>
        </TabsList>
      </Tabs>
      <div className="flex items-center">
        <Button variant="secondary" size="icon" aria-label={t("time.range.prev")} title={t("time.range.prev")} onClick={() => onShift(-1)}>
          {prev}
        </Button>
        <div className="-ms-px flex h-9 min-w-48 items-center justify-center gap-2 border border-border bg-card px-3 text-sm" data-range-label>
          <CalendarDaysIcon className="size-4 text-muted-foreground" />
          <Ltr className="tabular-nums">{period ? rangeLabel(period, locale) : "…"}</Ltr>
        </div>
        <Button variant="secondary" size="icon" className="-ms-px" aria-label={t("time.range.next")} title={t("time.range.next")} onClick={() => onShift(1)}>
          {next}
        </Button>
      </div>
      <Button variant="secondary" disabled={isCurrent} onClick={onToday} data-range-today>
        {t(kind === "week" ? "time.thisWeek" : "time.range.thisMonth")}
      </Button>
    </div>
  )
}
