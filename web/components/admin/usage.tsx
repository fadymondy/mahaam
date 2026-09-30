"use client"

// Usage vs plan limits: a compact bar (admin workspace list), the full usage table (admin
// workspace detail and the workspace's own Settings → Plan page) and the feature list.
import { CheckIcon, MinusIcon } from "lucide-react"

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"


import { Ltr } from "@/components/copy-field"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { BOOL_FEATURES, usageAmount, usagePercent, type Features, type UsageItem, type UsageReport } from "@/lib/admin"
import { cn } from "@/lib/utils"

type Level = "none" | "ok" | "warning" | "over"
const levelOf = (pct: number | null): Level => (pct == null ? "none" : pct > 100 ? "over" : pct >= 80 ? "warning" : "ok")

const BAR: Record<Level, string> = {
  none: "bg-grid-muted/40",
  ok: "bg-grid-ok",
  warning: "bg-grid-warn",
  over: "bg-grid-danger",
}

/** One usage bar: `usage / limit`, coloured by level; unlimited shows an empty track. */
export function UsageBar({ item, compact = false }: { item: UsageItem; compact?: boolean }) {
  const { t, locale } = useTranslations()
  const pct = usagePercent(item)
  const level = levelOf(pct)
  const width = pct == null ? 0 : Math.max(pct > 0 ? 2 : 0, Math.min(100, pct))
  const label = `${t(`plan.limit.${item.key}`)}: ${usageAmount(item.kind, item.usage, locale)} / ${
    item.limit == null ? t("plan.unlimited") : usageAmount(item.kind, item.limit, locale)
  }`
  return (
    <div className={cn("min-w-0", compact ? "space-y-0.5" : "space-y-1")} data-usage={item.key} data-level={level}>
      <div className="flex items-baseline justify-between gap-2 text-meta">
        {compact ? <span className="truncate text-grid-muted">{t(`plan.limit.${item.key}`)}</span> : null}
        <Ltr className={cn("tabular-nums", level === "over" ? "text-grid-danger-text" : "text-grid-body")}>
          {usageAmount(item.kind, item.usage, locale)}
          <span className="text-grid-muted"> / {item.limit == null ? "∞" : usageAmount(item.kind, item.limit, locale)}</span>
        </Ltr>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct == null ? undefined : Math.round(Math.min(100, pct))}
        className={cn("w-full overflow-hidden rounded-full bg-grid-soft", compact ? "h-1" : "h-1.5")}
      >
        <div className={cn("h-full rounded-full", BAR[level])} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

/** The full per-limit table for a month. */
export function UsageTable({ report }: { report: UsageReport }) {
  const { t, locale } = useTranslations()
  return (
    <div className="border-y border-line">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="ps-6">{t("plan.col.limit")}</TableHead>
            <TableHead className="w-[40%]">{t("plan.col.usage")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("plan.col.policy")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("plan.col.over")}</TableHead>
            <TableHead className="pe-6 text-end">{t("plan.col.overageCost")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.items.map((item) => (
            <TableRow key={item.key}>
              <TableCell className="ps-6">
                <span className="text-sm font-medium text-grid-fg">{t(`plan.limit.${item.key}`)}</span>
                <span className="block text-meta text-grid-muted">{t(`plan.kind.${item.kind}`)}</span>
                {item.overridden ? (
                  <Badge variant="outline" className="mt-1">
                    {t("plan.overridden")}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <UsageBar item={item} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {item.limit == null ? (
                  <span className="text-grid-muted">—</span>
                ) : (
                  <span className="text-sm">
                    {t(`plan.policy.${item.policy}`)}
                    {item.policy === "overage" && item.unit_price_minor > 0 ? (
                      <Ltr className="block text-meta text-grid-muted">
                        {t("plan.unitPrice", {
                          price: money(item.unit_price_minor, report.currency, locale),
                          size: usageAmount(item.kind, item.unit_size || 1, locale),
                        })}
                      </Ltr>
                    ) : null}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {item.over > 0 ? (
                  <Ltr className="text-grid-danger-text tabular-nums">{usageAmount(item.kind, item.over, locale)}</Ltr>
                ) : (
                  <span className="text-grid-muted">—</span>
                )}
              </TableCell>
              <TableCell className="pe-6 text-end">
                {item.overage_minor > 0 ? <Ltr className="tabular-nums">{money(item.overage_minor, report.currency, locale)}</Ltr> : <span className="text-grid-muted">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Base fee + overage = this month so far. */
export function EstimateStrip({ report }: { report: UsageReport }) {
  const { t, locale } = useTranslations()
  const cell = (label: string, value: number, strong = false) => (
    <div className="space-y-1 px-6 py-4">
      <p className="grid-micro">{label}</p>
      <Ltr className={cn("block text-lg tabular-nums", strong ? "font-semibold text-grid-fg" : "text-grid-body")}>{money(value, report.currency, locale)}</Ltr>
    </div>
  )
  return (
    <div className="grid grid-cols-1 divide-y divide-line border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse" data-estimate>
      {cell(t("plan.baseFee"), report.base_fee_minor)}
      {cell(t("plan.overageSoFar"), report.overage_minor)}
      {cell(t("plan.estimate"), report.estimate_minor, true)}
    </div>
  )
}

export function FeatureList({ features, overridden = [] }: { features: Features; overridden?: string[] }) {
  const { t } = useTranslations()
  const row = (key: string, on: boolean, extra?: string) => (
    <li key={key} className="flex items-center gap-2.5 px-6 py-2.5 text-sm">
      {on ? <CheckIcon className="size-4 shrink-0 text-(--grid-ok-text)" /> : <MinusIcon className="size-4 shrink-0 text-grid-muted" />}
      <span className={on ? "text-grid-fg" : "text-grid-muted"}>{t(`plan.feature.${key}`)}</span>
      {extra ? <span className="text-meta text-grid-muted">{extra}</span> : null}
      {overridden.includes(key) ? (
        <Badge variant="outline" className="ms-auto">
          {t("plan.overridden")}
        </Badge>
      ) : null}
    </li>
  )
  const ints = features.integrations ?? []
  return (
    <ul className="divide-y divide-line border-y border-line" data-features>
      {BOOL_FEATURES.map((k) => row(k, !!features[k]))}
      {row("integrations", ints.length > 0, ints.length ? ints.map((i) => t(`plan.integration.${i}`)).join(" · ") : undefined)}
    </ul>
  )
}
