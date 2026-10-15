"use client"

// Settings → Sponsor. Mahaam is free and open source (2026-10-15): there are no plans, limits or
// checkout. This page says so, links to the sponsor pages (from lib/sponsor, env-configured) and,
// for a workspace that still has a legacy Polar subscription, keeps the portal so it can be canceled.
import { useState } from "react"
import { CreditCardIcon, HeartIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button } from "@fadymondy/nasaq/web"

import { Panel, SectionTitle } from "@/components/page"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { BillingStatusBadge } from "@/components/admin/billing"
import { billingApi, useWorkspaceBilling } from "@/lib/admin"
import { errorText } from "@/lib/work"
import { useTranslations } from "@/lib/i18n"
import { sponsorLinks } from "@/lib/sponsor"
import { useDocumentTitle } from "@/lib/title"

export default function SponsorSettingsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("plan.title")} · ${ws.summary.name}`)
  const links = sponsorLinks(locale === "ar")

  return (
    <div className="flex flex-col gap-6" data-sponsor-page>
      <SectionTitle title={t("plan.title")} description={t("plan.hint")} />
      <Panel title={t("plan.free")} description={t("plan.body")}>
        <div className="flex flex-col gap-4">
          {links.length ? (
            <div className="flex flex-wrap gap-2" data-sponsor-links>
              {links.map((l, i) => (
                <Button
                  key={l.key}
                  variant={i === 0 ? "primary" : "secondary"}
                  nativeButton={false}
                  render={<a href={l.href} target="_blank" rel="noreferrer" />}
                  data-sponsor={l.key}
                >
                  {i === 0 ? <HeartIcon /> : null}
                  {l.label}
                </Button>
              ))}
            </div>
          ) : null}
          <p className="text-caption text-muted-foreground">{t("plan.voluntary")}</p>
        </div>
      </Panel>
      <LegacySubscription workspaceId={ws.id} />
    </div>
  )
}

/**
 * A workspace that paid before 2026-10-15 can still open the Polar portal to cancel. Nothing shows
 * for everyone else (and nothing if the billing endpoint is forbidden or down).
 */
function LegacySubscription({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslations()
  const billing = useWorkspaceBilling(workspaceId)
  const [busy, setBusy] = useState(false)
  const data = billing.data
  if (!data) return null

  if (data.hub_linked && data.hub_billing_url) {
    return (
      <Panel
        data-billing-hub
        title={t("billing.title")}
        description={t("plan.hubBilling")}
        actions={
          <Button variant="secondary" size="sm" nativeButton={false} render={<a href={data.hub_billing_url} target="_blank" rel="noreferrer" />} data-manage-billing>
            <CreditCardIcon />
            {t("plan.hubBillingOpen")}
          </Button>
        }
      />
    )
  }

  const b = data.billing
  if (!b?.polar_customer_id) return null
  async function portal() {
    setBusy(true)
    try {
      const { url } = await billingApi.portal(workspaceId)
      window.location.assign(url)
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      setBusy(false)
    }
  }
  return (
    <Panel
      data-billing
      title={
        <span className="flex flex-wrap items-center gap-3">
          {t("billing.title")}
          <BillingStatusBadge billing={b} />
        </span>
      }
      description={t("plan.legacy")}
      actions={
        <Button variant="secondary" size="sm" disabled={busy} onClick={portal} data-manage-billing>
          <CreditCardIcon />
          {busy ? t("common.working") : t("billing.manage")}
        </Button>
      }
    />
  )
}
