"use client"

// Settings → Plan & usage: the workspace's plan, this month's usage against its limits, the
// overage so far and the features it includes. Read-only; owners/admins (the API answers 403 to
// everyone else). Changing plan is a conversation with us for now — see the CTA below.
import { useEffect, useState } from "react"
import { CircleCheckIcon, CreditCardIcon, MailIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { EstimateStrip, FeatureList, UsageTable } from "@/components/admin/usage"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { BillingStatusBadge } from "@/components/admin/billing"
import { billingApi, planName, useWorkspaceBilling, useWorkspacePlan, type BillingResponse, type UsageReport } from "@/lib/admin"
import { errorText } from "@/lib/work"
import { ApiError } from "@/lib/api"
import { formatDay, money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function PlanSettingsPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("plan.title")} · ${ws.summary.name}`)
  const plan = useWorkspacePlan(ws.id)

  let body
  if (plan.error instanceof ApiError && plan.error.status === 403 && !plan.error.code)
    body = <p className="border-t border-line px-6 py-6 text-sm text-grid-muted" data-plan-forbidden>{t("plan.noPermission")}</p>
  else if (plan.error) body = <ErrorState error={plan.error} />
  else if (!plan.data) body = <LoadingRows rows={5} />
  else body = <PlanBody r={plan.data} workspaceId={ws.id} />

  return (
    <>
      <SectionHeader micro={ws.summary.name} title={t("plan.title")} description={t("plan.hint")} />
      {body}
    </>
  )
}

function upgradeHref(contact: string): string | null {
  const c = contact.trim()
  if (!c) return null
  if (/^mailto:/i.test(c) || /^https?:\/\//i.test(c)) return c
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return `mailto:${c}`
  return c
}

function PlanBody({ r, workspaceId }: { r: UsageReport; workspaceId: string }) {
  const { t, locale } = useTranslations()
  const href = upgradeHref(r.upgrade_contact ?? "")
  const billing = useWorkspaceBilling(workspaceId)
  const [paid, setPaid] = useState(false)
  // Polar sends the buyer back with ?paid=1; the webhook updates the plan a moment later.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("paid") !== "1") return
    setPaid(true)
    const id = window.setInterval(() => {
      void billing.mutate()
    }, 4000)
    const stop = window.setTimeout(() => window.clearInterval(id), 30000)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(stop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="space-y-8 pb-10" data-plan-page>
      {paid ? (
        <p role="status" className="flex items-center gap-2 border-y border-line bg-grid-soft/50 px-6 py-3 text-sm text-(--grid-ok-text)" data-paid>
          <CircleCheckIcon className="size-4 shrink-0" />
          {t("billing.paid")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-line bg-grid-soft/50 px-6 py-4">
        <div className="space-y-1">
          <p className="grid-micro">{t("plan.current")}</p>
          <p className="text-lg font-semibold text-grid-fg" data-plan-name={r.plan.key}>
            {planName(r.plan, locale)}
          </p>
          <p className="text-sm text-grid-muted">
            {t("plan.baseFee")}: <Ltr>{money(r.base_fee_minor, r.currency, locale)}</Ltr> · {t("plan.period", { month: formatDay(r.period, locale) })}
          </p>
        </div>
        {href ? (
          <Button nativeButton={false} render={<a href={href} target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer" />} data-upgrade>
            <MailIcon />
            {t("plan.contactUpgrade")}
          </Button>
        ) : null}
      </div>

      <BillingSection workspaceId={workspaceId} current={r.plan.key} contact={href} billing={billing} />

      <section className="space-y-3">
        <h2 className="px-6 text-sm font-medium text-grid-fg">{t("plan.thisMonth")}</h2>
        <EstimateStrip report={r} />
        <p className="px-6 text-meta text-grid-muted">{t("plan.estimateHint")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="px-6 text-sm font-medium text-grid-fg">{t("plan.usage")}</h2>
        <UsageTable report={r} />
      </section>

      <section className="space-y-3">
        <h2 className="px-6 text-sm font-medium text-grid-fg">{t("plan.features")}</h2>
        <FeatureList features={r.features} />
      </section>
    </div>
  )
}

/** Billing via Polar: status, the purchasable plans (checkout) and the customer portal. */
function BillingSection({
  workspaceId,
  current,
  contact,
  billing,
}: {
  workspaceId: string
  current: string
  contact: string | null
  billing: ReturnType<typeof useWorkspaceBilling>
}) {
  const { t, locale } = useTranslations()
  const [busy, setBusy] = useState<string | null>(null)

  async function go(key: string, fn: () => Promise<{ url: string }>) {
    setBusy(key)
    try {
      const { url } = await fn()
      window.location.assign(url)
    } catch (err) {
      // 503 not configured, 422 not purchasable, 502 provider error: the API's message says which.
      toast.error(errorText(err, t("common.networkError")))
      setBusy(null)
    }
  }

  if (billing.error) return <ErrorState error={billing.error} />
  if (!billing.data) return <LoadingRows rows={2} />
  const data: BillingResponse = billing.data
  const b = data.billing
  const plans = data.plans ?? []

  return (
    <section className="space-y-3" data-billing>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-medium text-grid-fg">{t("billing.title")}</h2>
          <BillingStatusBadge billing={b} />
        </div>
        {b?.polar_customer_id ? (
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => go("portal", () => billingApi.portal(workspaceId))} data-manage-billing>
            <CreditCardIcon />
            {busy === "portal" ? t("common.working") : t("billing.manage")}
          </Button>
        ) : null}
      </div>
      {!data.configured ? <p className="px-6 text-sm text-grid-muted">{t("billing.notConfigured")}</p> : null}
      {plans.length ? (
        <ul className="divide-y divide-line border-y border-line" data-billing-plans>
          {plans.map((p) => {
            const isCurrent = p.key === current
            return (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3" data-billing-plan={p.key}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-grid-fg">
                    {planName(p, locale)}
                    {isCurrent ? <span className="ms-2 text-meta font-normal text-grid-muted">{t("billing.currentPlan")}</span> : null}
                  </p>
                  <p className="text-meta text-grid-muted">
                    {(locale === "ar" ? p.price_label_ar : p.price_label_en) || <Ltr>{money(p.base_fee_minor, p.currency, locale)}</Ltr>}
                  </p>
                </div>
                {isCurrent ? null : p.purchasable && data.configured ? (
                  <Button size="sm" disabled={!!busy} onClick={() => go(p.key, () => billingApi.checkout(workspaceId, p.key, locale))}>
                    {busy === p.key ? t("common.working") : b?.status === "active" ? t("billing.switch") : t("billing.upgrade")}
                  </Button>
                ) : contact ? (
                  <Button size="sm" variant="outline" nativeButton={false} render={<a href={contact} target={contact.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer" />}>
                    <MailIcon />
                    {t("plan.contactUs")}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
