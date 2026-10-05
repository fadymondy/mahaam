"use client"

// Settings → Plan & usage: the workspace's plan, this month's usage against its limits, the
// overage so far and the features it includes. Read-only; owners/admins (the API answers 403 to
// everyone else). Changing plan is a conversation with us for now — see the CTA below.
import { useEffect, useState } from "react"
import { CircleCheckIcon, CreditCardIcon, MailIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button } from "@fadymondy/nasaq/web"

import { EstimateStrip, FeatureList, UsageTable } from "@/components/admin/usage"
import { Ltr } from "@/components/copy-field"
import { Panel, SectionTitle } from "@/components/page"
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
    body = <p className="text-sm text-muted-foreground" data-plan-forbidden>{t("plan.noPermission")}</p>
  else if (plan.error) body = <ErrorState error={plan.error} />
  else if (!plan.data) body = <LoadingRows rows={5} />
  else body = <PlanBody r={plan.data} workspaceId={ws.id} />

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title={t("plan.title")} description={t("plan.hint")} />
      {body}
    </div>
  )
}

// The shared usage blocks run edge to edge with their own top/bottom rule; inside a card the card is the rule.
const EDGE = "*:border-y-0"

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
    <div className="flex flex-col gap-6" data-plan-page>
      {paid ? (
        <p role="status" className="flex items-center gap-2 rounded-card bg-muted/50 px-4 py-3 text-sm text-(--nq-ok-text)" data-paid>
          <CircleCheckIcon className="size-4 shrink-0" />
          {t("billing.paid")}
        </p>
      ) : null}
      <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-eyebrow uppercase">{t("plan.current")}</p>
          <p className="text-lg font-semibold text-foreground" data-plan-name={r.plan.key}>
            {planName(r.plan, locale)}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("plan.baseFee")}: <Ltr>{money(r.base_fee_minor, r.currency, locale)}</Ltr> · {t("plan.period", { month: formatDay(r.period, locale) })}
          </p>
        </div>
        {href ? (
          <Button variant="primary" nativeButton={false} render={<a href={href} target={href.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer" />} data-upgrade>
            <MailIcon />
            {t("plan.contactUpgrade")}
          </Button>
        ) : null}
      </div>
      </Panel>

      <BillingSection workspaceId={workspaceId} current={r.plan.key} contact={href} billing={billing} />

      <Panel flush title={t("plan.thisMonth")} description={t("plan.estimateHint")} contentClassName={EDGE}>
        <EstimateStrip report={r} />
      </Panel>

      <Panel flush title={t("plan.usage")} contentClassName={EDGE}>
        <UsageTable report={r} />
      </Panel>

      <Panel flush title={t("plan.features")} contentClassName={EDGE}>
        <FeatureList features={r.features} />
      </Panel>
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

  if (data.hub_linked) {
    return (
      <Panel
        data-billing
        data-billing-hub
        title={t("billing.title")}
        description={t("plan.hubBilling")}
        actions={
          data.hub_billing_url ? (
            <Button variant="secondary" size="sm" nativeButton={false} render={<a href={data.hub_billing_url} target="_blank" rel="noreferrer" />} data-manage-billing>
              <CreditCardIcon />
              {t("plan.hubBillingOpen")}
            </Button>
          ) : null
        }
      />
    )
  }

  return (
    <Panel
      flush
      data-billing
      title={
        <span className="flex flex-wrap items-center gap-3">
          {t("billing.title")}
          <BillingStatusBadge billing={b} />
        </span>
      }
      description={!data.configured ? t("billing.notConfigured") : undefined}
      actions={
        b?.polar_customer_id ? (
          <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => go("portal", () => billingApi.portal(workspaceId))} data-manage-billing>
            <CreditCardIcon />
            {busy === "portal" ? t("common.working") : t("billing.manage")}
          </Button>
        ) : null
      }
    >
      {plans.length ? (
        <ul className="divide-y divide-line" data-billing-plans>
          {plans.map((p) => {
            const isCurrent = p.key === current
            return (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-billing-plan={p.key}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {planName(p, locale)}
                    {isCurrent ? <span className="ms-2 text-caption font-normal text-muted-foreground">{t("billing.currentPlan")}</span> : null}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {(locale === "ar" ? p.price_label_ar : p.price_label_en) || <Ltr>{money(p.base_fee_minor, p.currency, locale)}</Ltr>}
                  </p>
                </div>
                {isCurrent ? null : p.purchasable && data.configured ? (
                  <Button variant="primary" size="sm" disabled={!!busy} onClick={() => go(p.key, () => billingApi.checkout(workspaceId, p.key, locale))}>
                    {busy === p.key ? t("common.working") : b?.status === "active" ? t("billing.switch") : t("billing.upgrade")}
                  </Button>
                ) : contact ? (
                  <Button size="sm" variant="secondary" nativeButton={false} render={<a href={contact} target={contact.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer" />}>
                    <MailIcon />
                    {t("plan.contactUs")}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </Panel>
  )
}
