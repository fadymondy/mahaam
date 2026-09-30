"use client"

import Link from "next/link"
import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"




import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { adminApi, billingApi, planName, useAdminPlans, usageAmount, LIMIT_KINDS, type LimitKey } from "@/lib/admin"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

const SUMMARY: LimitKey[] = ["members", "projects", "storage_mb", "issues_per_month"]

export default function AdminPlansPage() {
  const { t, locale } = useTranslations()
  useDocumentTitle(`${t("admin.nav.plans")} · ${t("admin.title")}`)
  const plans = useAdminPlans()
  const rows = [...(plans.data?.plans ?? [])].sort((a, b) => a.sort - b.sort)
  return (
    <>
      <SectionHeader
        micro={t("admin.title")}
        title={t("admin.nav.plans")}
        description={t("admin.plans.hint")}
        action={
          <Button variant="primary" nativeButton={false} render={<Link href={`/${locale}/admin/plans/new`} />}>
            <PlusIcon />
            {t("admin.plans.create")}
          </Button>
        }
      />
      {plans.error ? (
        <ErrorState error={plans.error} />
      ) : !plans.data ? (
        <LoadingRows rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("admin.plans.empty")} />
      ) : (
        <div className="border-y border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("admin.col.plan")}</TableHead>
                <TableHead>{t("plan.baseFee")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("admin.plans.limits")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("billing.polarProduct")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("admin.col.workspaces")}</TableHead>
                <TableHead className="pe-6 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.key} data-plan={p.key}>
                  <TableCell className="ps-6">
                    <Link href={`/${locale}/admin/plans/${encodeURIComponent(p.key)}`} className="font-medium hover:underline">
                      {planName(p, locale)}
                    </Link>{" "}
                    <Ltr className="text-meta text-grid-muted">{p.key}</Ltr>
                    {!p.active ? (
                      <Badge variant="outline" className="ms-2">
                        {t("admin.plans.inactive")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Ltr>{money(p.base_fee_minor, p.currency, locale)}</Ltr>
                    <span className="block text-meta text-grid-muted">{locale === "ar" ? p.price_label_ar : p.price_label_en}</span>
                  </TableCell>
                  <TableCell className="hidden text-meta text-grid-body lg:table-cell">
                    {SUMMARY.map((k) => {
                      const r = p.limits?.[k]
                      return (
                        <span key={k} className="me-3 inline-block">
                          {t(`plan.limit.${k}`)}: <Ltr>{r?.limit == null ? "∞" : usageAmount(LIMIT_KINDS[k], r.limit, locale)}</Ltr>
                        </span>
                      )
                    })}
                  </TableCell>
                  <TableCell className="hidden max-w-0 md:table-cell">
                    {plans.data?.polar_products?.[p.key] ? (
                      <Ltr mono className="block truncate text-xs">
                        {plans.data.polar_products[p.key]}
                      </Ltr>
                    ) : (
                      <span className="text-meta text-grid-muted">{t("billing.notSynced")}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Ltr className="tabular-nums">{p.workspaces}</Ltr>
                  </TableCell>
                  <TableCell className="pe-6 text-end">
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" size="sm" nativeButton={false} render={<Link href={`/${locale}/admin/plans/${encodeURIComponent(p.key)}`} />}>
                        {t("admin.edit")}
                      </Button>
                      {p.active ? (
                        <ConfirmButton
                          label={t("admin.plans.deactivate")}
                          title={t("admin.plans.deactivateTitle", { name: planName(p, locale) })}
                          description={t("admin.plans.deactivateBody")}
                          confirmLabel={t("admin.plans.deactivate")}
                          onConfirm={async () => {
                            try {
                              await adminApi.deactivatePlan(p.key)
                              toast.success(t("admin.plans.deactivated"))
                              await plans.mutate()
                            } catch (err) {
                              toast.error(errorText(err, t("common.networkError")))
                            }
                          }}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PolarSync onApplied={() => plans.mutate()} />
    </>
  )
}

/** Push plans to Polar as products: preview the actions first, then apply them. */
function PolarSync({ onApplied }: { onApplied: () => void }) {
  const { t } = useTranslations()
  const [actions, setActions] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function run(dryRun: boolean) {
    setBusy(true)
    setError(null)
    try {
      const r = await billingApi.polarSync(dryRun)
      setActions(r.actions ?? [])
      if (!dryRun) {
        toast.success(t("billing.sync.applied"))
        onApplied()
      }
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 py-8" data-polar-sync>
      <div className="flex flex-wrap items-end justify-between gap-3 px-6">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-grid-fg">{t("billing.sync.title")}</h2>
          <p className="text-sm text-grid-muted">{t("billing.sync.hint")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => run(true)}>
            {t("billing.sync.preview")}
          </Button>
          <Button variant="primary" disabled={busy || actions === null} onClick={() => setConfirming(true)}>
            {t("billing.sync.apply")}
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="border-y border-line px-6 py-3 text-sm text-grid-danger-text">
          {error}
        </p>
      ) : actions === null ? null : actions.length === 0 ? (
        <p className="border-y border-line px-6 py-3 text-sm text-grid-muted">{t("billing.sync.nothing")}</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {actions.map((a, i) => (
            <li key={i} className="px-6 py-2">
              <Ltr mono className="text-xs">
                {a}
              </Ltr>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("billing.sync.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("billing.sync.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async () => {
                setConfirming(false)
                await run(false)
              }}
            >
              {t("billing.sync.apply")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
