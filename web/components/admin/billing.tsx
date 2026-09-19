"use client"

// Polar billing state: a status badge (Settings → Plan and the admin workspace page) and the
// admin's read-only Billing card.
import { ExternalLinkIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Ltr } from "@/components/copy-field"
import { POLAR_CUSTOMER_URL, type Billing } from "@/lib/admin"
import { formatDay, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const DOT: Record<string, string> = {
  active: "bg-grid-ok",
  past_due: "bg-grid-warn",
  canceled: "bg-grid-warn",
  revoked: "bg-grid-danger",
  expired: "bg-grid-danger",
  none: "bg-grid-muted",
}

export function BillingStatusBadge({ billing }: { billing: Billing | null | undefined }) {
  const { t, locale } = useTranslations()
  const status = billing?.status ?? "none"
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-billing-status={status}>
      <Badge variant="outline" className="gap-1.5">
        <span aria-hidden className={cn("size-1.5 rounded-full", DOT[status] ?? DOT.none)} />
        {t(`billing.status.${status}`)}
      </Badge>
      {billing?.period_end && (billing.cancel_at_period_end || status === "canceled") ? (
        <span className="text-xs text-(--grid-warn-text)">{t("billing.cancelsOn", { date: formatDay(billing.period_end, locale) })}</span>
      ) : billing?.period_end && status === "active" ? (
        <span className="text-xs text-grid-muted">{t("billing.renewsOn", { date: formatDay(billing.period_end, locale) })}</span>
      ) : null}
    </span>
  )
}

export function BillingCard({ billing }: { billing: Billing | null | undefined }) {
  const { t, locale } = useTranslations()
  const b = billing
  const rows: [string, React.ReactNode][] = [
    [t("billing.status"), <BillingStatusBadge key="s" billing={b} />],
    [t("billing.periodEnd"), b?.period_end ? <Ltr>{formatDay(b.period_end, locale)}</Ltr> : "—"],
    [t("billing.cancelAtEnd"), b?.cancel_at_period_end ? t("billing.yes") : t("billing.no")],
    [
      t("billing.customer"),
      b?.polar_customer_id ? (
        <a href={POLAR_CUSTOMER_URL(b.polar_customer_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
          <Ltr mono className="text-xs">
            {b.polar_customer_id}
          </Ltr>
          <ExternalLinkIcon className="size-3" />
        </a>
      ) : (
        "—"
      ),
    ],
    [t("billing.subscription"), b?.polar_subscription_id ? <Ltr mono className="text-xs">{b.polar_subscription_id}</Ltr> : "—"],
    [
      t("billing.lastWebhook"),
      b?.last_webhook_at ? (
        <span>
          <Ltr mono className="text-xs">
            {b.last_webhook_type ?? "—"}
          </Ltr>{" "}
          <span className="text-grid-muted">· {timeAgo(b.last_webhook_at, locale)}</span>
        </span>
      ) : (
        "—"
      ),
    ],
  ]
  return (
    <section className="space-y-3 py-6" data-billing-card>
      <h2 className="px-6 text-sm font-medium text-grid-fg">{t("billing.title")}</h2>
      <dl className="grid grid-cols-1 gap-px border-y border-line bg-line text-sm sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="bg-grid-card px-6 py-3">
            <dt className="grid-micro">{k}</dt>
            <dd className="mt-1 text-grid-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
