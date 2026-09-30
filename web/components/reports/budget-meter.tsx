"use client"

// Budget burn: a level badge and progress bars for hours (and money, finance only). Shared by the
// Budgets report and the project overview panel. Colours are the grid's status tokens.
import { Badge, Progress } from "@fadymondy/nasaq/web"


import { Ltr } from "@/components/copy-field"
import { useTranslations } from "@/lib/i18n"
import { hmCell, moneyCell, type Budget, type BudgetLevel } from "@/lib/reports"
import { cn } from "@/lib/utils"

const levelOf = (pct: number | null | undefined): BudgetLevel => (pct == null ? "none" : pct >= 100 ? "over" : pct >= 80 ? "warning" : "ok")

const BAR: Record<BudgetLevel, string> = {
  none: "bg-nq-fg-muted",
  ok: "bg-nq-ok",
  warning: "bg-nq-warn",
  over: "bg-nq-danger",
}

// Full class strings (Tailwind only generates what it can read literally).
const INDICATOR: Record<BudgetLevel, string> = {
  none: "[&_[data-slot=progress-indicator]]:bg-nq-fg-muted",
  ok: "[&_[data-slot=progress-indicator]]:bg-nq-ok",
  warning: "[&_[data-slot=progress-indicator]]:bg-nq-warn",
  over: "[&_[data-slot=progress-indicator]]:bg-nq-danger",
}

const TEXT: Record<BudgetLevel, string> = {
  none: "text-muted-foreground",
  ok: "text-(--nq-ok-text)",
  warning: "text-(--nq-warn-text)",
  over: "text-(--nq-danger-text)",
}

export function LevelBadge({ level }: { level: BudgetLevel }) {
  const { t } = useTranslations()
  return (
    <Badge variant="outline" className={cn("gap-1.5 whitespace-nowrap", TEXT[level])} data-level={level}>
      <span aria-hidden className={cn("size-1.5 rounded-full", BAR[level])} />
      {t(`budget.level.${level}`)}
    </Badge>
  )
}

export function Meter({
  label,
  percent,
  spent,
  budget,
  data,
}: {
  label: string
  percent: number | null | undefined
  spent: string
  budget: string
  data?: string
}) {
  const { t } = useTranslations()
  const level = levelOf(percent)
  const pct = percent ?? 0
  return (
    <div className="min-w-0 space-y-1.5" data-meter={data} data-percent={percent != null ? pct.toFixed(1) : ""}>
      <div className="flex items-baseline justify-between gap-3 text-caption">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium tabular-nums", TEXT[level])}>
          <Ltr>{pct.toFixed(0)}%</Ltr>
        </span>
      </div>
      <Progress
        value={Math.min(100, pct)}
        aria-label={label}
        className={cn(
          "gap-0 [&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-track]]:rounded-none [&_[data-slot=progress-track]]:bg-muted",
          INDICATOR[level],
        )}
      />
      <p className="text-caption text-nq-fg-body">
        {t("budget.spentOf", { spent: "⁨" + spent + "⁩", budget: "⁨" + budget + "⁩" })}
      </p>
    </div>
  )
}

/** Hours (+ money) meters of one budget. */
export function BudgetMeters({ b, finance, className }: { b: Budget; finance: boolean; className?: string }) {
  const { t } = useTranslations()
  const cur = b.currency
  return (
    <div className={cn("grid gap-4", finance ? "sm:grid-cols-2" : "", className)}>
      {b.budget_minutes ? (
        <Meter label={t("budget.hours")} percent={b.hours_percent} spent={hmCell(b.spent_s)} budget={hmCell(b.budget_minutes * 60)} data="hours" />
      ) : (
        <p className="self-center text-caption text-muted-foreground">{t("budget.noHours")}</p>
      )}
      {finance ? (
        b.budget_minor ? (
          <Meter
            label={t("budget.money")}
            percent={b.money_percent}
            spent={`${moneyCell(b.spent_minor ?? 0)} ${cur}`}
            budget={`${moneyCell(b.budget_minor)} ${cur}`}
            data="money"
          />
        ) : (
          <p className="self-center text-caption text-muted-foreground">{t("budget.noMoney")}</p>
        )
      ) : null}
    </div>
  )
}
