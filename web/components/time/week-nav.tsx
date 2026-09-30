"use client"

// Previous / this / next week, and the week's date range. Weeks are the workspace's (week_start,
// timezone): the server returns the 7 days, this only moves the reference day.
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { useTranslations } from "@/lib/i18n"
import { addDays, dayLabel } from "@/lib/time"

export function WeekNav({ days, onWeek, isCurrent }: { days: string[] | undefined; onWeek: (ref: string | null) => void; isCurrent: boolean }) {
  const { t, locale, isRtl } = useTranslations()
  const first = days?.[0]
  const last = days?.[6]
  return (
    <div className="flex flex-wrap items-center gap-2" data-week-nav>
      {first && last ? (
        <Ltr className="me-1 text-sm text-grid-body" data-week-range>
          {dayLabel(first, locale)} – {dayLabel(last, locale)}
        </Ltr>
      ) : null}
      <div className="flex items-center">
        <Button variant="secondary" size="icon-sm" aria-label={t("time.prevWeek")} title={t("time.prevWeek")} disabled={!first} onClick={() => first && onWeek(addDays(first, -7))}>
          {isRtl ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </Button>
        <Button variant="secondary" size="sm" className="-ms-px" disabled={isCurrent} onClick={() => onWeek(null)}>
          {t("time.thisWeek")}
        </Button>
        <Button variant="secondary" size="icon-sm" className="-ms-px" aria-label={t("time.nextWeek")} title={t("time.nextWeek")} disabled={!first} onClick={() => first && onWeek(addDays(first, 7))}>
          {isRtl ? <ChevronLeftIcon /> : <ChevronRightIcon />}
        </Button>
      </div>
    </div>
  )
}
