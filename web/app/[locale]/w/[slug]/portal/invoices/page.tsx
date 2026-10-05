"use client"

import { useMemo } from "react"
import { BanknoteIcon, CircleAlertIcon, ReceiptTextIcon } from "lucide-react"

import { Badge } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { StatTile } from "@/components/home/panels"
import { PortalEmpty } from "@/components/portal/portal-bits"
import { SectionHeader } from "@/components/public-frame"
import { ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { usePortalInvoices, type PortalInvoice } from "@/lib/portal"
import { useDocumentTitle } from "@/lib/title"

type Totals = { billed: number; paid: number; due: number }

/*
The customer's invoices and payments (MH-1167, GET /api/w/portal/invoices): what was billed, what
was paid and what is still due, per currency, and each invoice with its balance. Drafts never
show. The wallet (deposits that invoices are paid from) is MH-1168.
*/
export default function PortalInvoicesPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("portal.nav.billing")} · ${ws.summary.name}`)
  const invoices = usePortalInvoices(ws.id)
  const list = useMemo(() => (invoices.data?.invoices ?? []).filter((iv) => iv.status !== "void"), [invoices.data])

  // Totals per currency, so mixed-currency clients never see one meaningless sum.
  const totals = useMemo(() => {
    const m = new Map<string, Totals>()
    for (const iv of list) {
      const x = m.get(iv.currency) ?? { billed: 0, paid: 0, due: 0 }
      x.billed += iv.total_minor
      x.paid += iv.paid_minor
      x.due += balance(iv)
      m.set(iv.currency, x)
    }
    return [...m.entries()]
  }, [list])
  const sum = (k: keyof Totals) => totals.map(([cur, x]) => money(x[k], cur, locale)).join(" · ") || "—"
  const unpaid = list.filter((iv) => balance(iv) > 0).length

  return (
    <>
      <SectionHeader title={t("portal.nav.billing")} description={t("portal.billing.hint")} />
      <div className="flex flex-col gap-6 px-6 pb-6" data-portal-invoices>
        {invoices.error ? (
          <ErrorState error={invoices.error} />
        ) : !invoices.data ? (
          <LoadingRows rows={5} />
        ) : invoices.data.invoices.length === 0 ? (
          <PortalEmpty icon={<ReceiptTextIcon />} title={t("portal.noInvoices")} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile icon={<ReceiptTextIcon />} label={t("portal.billing.billed")} value={<Ltr>{sum("billed")}</Ltr>} sub={t("portal.billing.count", { n: list.length })} />
              <StatTile icon={<BanknoteIcon />} label={t("portal.billing.paid")} value={<Ltr>{sum("paid")}</Ltr>} sub={t("portal.billing.paidSub")} />
              <StatTile
                icon={<CircleAlertIcon />}
                tone={unpaid > 0 ? "danger" : undefined}
                label={t("portal.billing.due")}
                value={<Ltr>{sum("due")}</Ltr>}
                sub={unpaid > 0 ? t("portal.home.unpaid", { n: unpaid }) : t("portal.billing.allPaid")}
              />
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-caption text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-medium">{t("portal.billing.number")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("portal.billing.issued")}</th>
                    <th className="px-4 py-2.5 text-start font-medium">{t("portal.billing.dueOn")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("portal.billing.total")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("portal.billing.paid")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("portal.billing.balance")}</th>
                    <th className="px-4 py-2.5 text-end font-medium">{t("portal.billing.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {invoices.data.invoices.map((iv) => {
                    const overdue = balance(iv) > 0 && !!iv.due_date && new Date(iv.due_date) < new Date()
                    return (
                      <tr key={iv.id} data-invoice={iv.number}>
                        <td className="px-4 py-3 font-medium">
                          <Ltr mono>{iv.number}</Ltr>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDay(iv.issue_date, locale)}</td>
                        <td className={overdue ? "px-4 py-3 text-nq-danger-text" : "px-4 py-3 text-muted-foreground"}>{iv.due_date ? formatDay(iv.due_date, locale) : "—"}</td>
                        <td className="px-4 py-3 text-end tabular-nums" dir="ltr">
                          {money(iv.total_minor, iv.currency, locale)}
                        </td>
                        <td className="px-4 py-3 text-end tabular-nums text-muted-foreground" dir="ltr">
                          {money(iv.paid_minor, iv.currency, locale)}
                        </td>
                        <td className="px-4 py-3 text-end font-medium tabular-nums" dir="ltr">
                          {money(balance(iv), iv.currency, locale)}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <Badge variant={iv.status === "paid" ? "success" : overdue ? "danger" : "neutral"}>{overdue ? t("portal.billing.overdue") : t(`invoices.status.${iv.status}`)}</Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function balance(iv: PortalInvoice): number {
  if (iv.status === "void" || iv.status === "paid") return 0
  return Math.max(0, iv.total_minor - iv.paid_minor)
}
