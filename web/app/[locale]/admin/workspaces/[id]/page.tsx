"use client"

// One workspace, as a platform admin sees it: usage by month, plan, per-workspace overrides,
// members, suspension and deletion.
import Link from "next/link"
import { useEffect, useState, type FormEvent } from "react"
import { useParams, useRouter } from "next/navigation"
import { Building2Icon, TrashIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IntegrationPicker, RuleFields, RuleHeader, fromDraft, toDraft, type RuleDraft } from "@/components/admin/limit-editor"
import { BillingCard } from "@/components/admin/billing"
import { ReasonDialog, StatusBadge } from "@/components/admin/reason-dialog"
import { EstimateStrip, FeatureList, UsageTable } from "@/components/admin/usage"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { ErrorState, LoadingRows } from "@/components/states"
import {
  BOOL_FEATURES,
  INTEGRATIONS,
  LIMIT_KEYS,
  adminApi,
  planName,
  thisMonth,
  useAdminPlans,
  useAdminWorkspace,
  useAdminWorkspaceUsage,
  type Features,
  type LimitRule,
  type Overrides,
  type Plan,
  type WorkspaceDetail,
} from "@/lib/admin"
import { formatDay } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

export default function AdminWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale } = useTranslations()
  const detail = useAdminWorkspace(id)
  const plans = useAdminPlans()
  const [month, setMonth] = useState(thisMonth())
  const history = useAdminWorkspaceUsage(id, month !== thisMonth() ? month : null)
  const [suspending, setSuspending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const d = detail.data
  useDocumentTitle(`${d?.workspace.name ?? t("admin.nav.workspaces")} · ${t("admin.title")}`)

  if (detail.error) return <ErrorState error={detail.error} />
  if (!d) return <LoadingRows rows={5} />
  const ws = d.workspace
  const report = month === thisMonth() ? d.usage : history.data

  return (
    <>
      <SectionHeader
        micro={
          <Link href={`/${locale}/admin/workspaces`} className="hover:underline">
            {t("admin.nav.workspaces")}
          </Link>
        }
        title={ws.name}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <Ltr className="text-grid-muted">{ws.slug}</Ltr>
            <StatusBadge status={ws.status} />
            <span className="text-xs text-grid-muted">
              {t("admin.col.owner")}: <Ltr>{ws.owner_email ?? "—"}</Ltr> · {t("admin.col.created")}: {formatDay(ws.created_at, locale)}
            </span>
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            {ws.status === "suspended" ? (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await adminApi.reactivateWorkspace(ws.id)
                    toast.success(t("admin.workspaces.reactivated"))
                    await detail.mutate()
                  } catch (err) {
                    toast.error(errorText(err, t("common.networkError")))
                  }
                }}
              >
                {t("admin.reactivate")}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setSuspending(true)}>
                {t("admin.suspend")}
              </Button>
            )}
            <Button variant="destructive" onClick={() => setDeleting(true)}>
              <TrashIcon />
              {t("common.delete")}
            </Button>
          </div>
        }
      />
      {ws.status === "suspended" && ws.suspended_reason ? (
        <p className="border-t border-line bg-grid-soft/50 px-6 py-3 text-sm text-grid-danger-text">{t("admin.suspendedBecause", { reason: ws.suspended_reason })}</p>
      ) : null}

      <PlanPicker detail={d} plans={plans.data?.plans ?? []} onSaved={() => detail.mutate()} />

      <section className="space-y-3 py-6" data-usage-section>
        <div className="flex flex-wrap items-end justify-between gap-3 px-6">
          <h2 className="text-sm font-medium text-grid-fg">{t("admin.workspaces.usage")}</h2>
          <label className="flex items-center gap-2 text-sm text-grid-muted">
            {t("admin.workspaces.month")}
            <Input type="month" dir="ltr" className="h-8 w-40" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
        {history.error && month !== thisMonth() ? (
          <ErrorState error={history.error} />
        ) : !report ? (
          <LoadingRows rows={4} />
        ) : (
          <>
            <EstimateStrip report={report} />
            <UsageTable report={report} />
          </>
        )}
      </section>

      <BillingCard billing={d.billing} />

      <OverridesEditor key={JSON.stringify(d.overrides)} detail={d} onSaved={() => detail.mutate()} />

      <section className="space-y-3 py-6">
        <h2 className="px-6 text-sm font-medium text-grid-fg">{t("admin.workspaces.features")}</h2>
        <FeatureList features={d.usage.features} overridden={d.usage.features_overridden ?? []} />
      </section>

      <section className="space-y-3 pb-10">
        <h2 className="px-6 text-sm font-medium text-grid-fg">
          {t("admin.col.members")} <Ltr className="text-grid-muted">({(d.members ?? []).length})</Ltr>
        </h2>
        <div className="border-y border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("admin.col.email")}</TableHead>
                <TableHead>{t("admin.col.role")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("admin.col.status")}</TableHead>
                <TableHead className="hidden pe-6 md:table-cell">{t("admin.col.joined")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d.members ?? []).map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="max-w-0 ps-6">
                    <Link href={`/${locale}/admin/users/${m.user_id}`} className="block truncate hover:underline">
                      <Ltr>{m.email}</Ltr>
                    </Link>
                  </TableCell>
                  <TableCell>{t(`role.${m.role}`)}</TableCell>
                  <TableCell className="hidden text-grid-muted sm:table-cell">{m.status}</TableCell>
                  <TableCell className="hidden pe-6 text-grid-muted md:table-cell">{formatDay(m.joined_at, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <ReasonDialog
        open={suspending}
        onOpenChange={setSuspending}
        title={t("admin.workspaces.suspendTitle")}
        description={t("admin.workspaces.suspendBody", { name: ws.name })}
        confirmLabel={t("admin.suspend")}
        onSubmit={async (reason) => {
          await adminApi.suspendWorkspace(ws.id, reason)
          toast.success(t("admin.workspaces.suspended"))
          await detail.mutate()
        }}
      />
      <DeleteDialog open={deleting} onOpenChange={setDeleting} id={ws.id} slug={ws.slug} />
    </>
  )
}

function PlanPicker({ detail, plans, onSaved }: { detail: WorkspaceDetail; plans: Plan[]; onSaved: () => void }) {
  const { t, locale } = useTranslations()
  const [plan, setPlan] = useState(detail.workspace.plan)
  const [busy, setBusy] = useState(false)
  useEffect(() => setPlan(detail.workspace.plan), [detail.workspace.plan])
  const items = plans.map((p) => ({ value: p.key, label: `${planName(p, locale)}${p.active ? "" : ` (${t("admin.plans.inactive")})`}` }))
  if (!items.some((i) => i.value === detail.workspace.plan)) items.unshift({ value: detail.workspace.plan, label: detail.workspace.plan })
  return (
    <div className="flex flex-wrap items-center gap-3 border-y border-line bg-grid-soft/50 px-6 py-3" data-plan-picker>
      <Building2Icon className="size-4 text-grid-muted" />
      <span className="text-sm font-medium">{t("admin.col.plan")}</span>
      <Select items={items} value={plan} onValueChange={(v) => setPlan(String(v ?? ""))}>
        <SelectTrigger className="h-8 w-56" aria-label={t("admin.col.plan")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        disabled={busy || plan === detail.workspace.plan}
        onClick={async () => {
          setBusy(true)
          try {
            await adminApi.setPlan(detail.workspace.id, plan)
            toast.success(t("admin.workspaces.planChanged"))
            onSaved()
          } catch (err) {
            toast.error(errorText(err, t("common.networkError")))
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? t("common.working") : t("admin.workspaces.changePlan")}
      </Button>
    </div>
  )
}

type Mode = "inherit" | "custom"
type Tri = "inherit" | "on" | "off"

function OverridesEditor({ detail, onSaved }: { detail: WorkspaceDetail; onSaved: () => void }) {
  const { t } = useTranslations()
  const currency = detail.usage.currency
  const o = detail.overrides ?? { limits: {}, features: {} }
  const planRule = (k: string): LimitRule | undefined => {
    const item = detail.usage.items.find((i) => i.key === k)
    return item ? { limit: item.limit, policy: item.policy, unit_price_minor: item.unit_price_minor, unit_size: item.unit_size } : undefined
  }
  const [modes, setModes] = useState<Record<string, Mode>>(() => Object.fromEntries(LIMIT_KEYS.map((k) => [k, o.limits?.[k] ? "custom" : "inherit"])))
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>(() => Object.fromEntries(LIMIT_KEYS.map((k) => [k, toDraft(o.limits?.[k] ?? planRule(k))])))
  const tri = (v: boolean | undefined): Tri => (v === undefined ? "inherit" : v ? "on" : "off")
  const [feat, setFeat] = useState<Record<string, Tri>>(() => Object.fromEntries(BOOL_FEATURES.map((k) => [k, tri(o.features?.[k])])))
  const [ints, setInts] = useState<string[] | null>(o.features?.integrations ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const limits: Record<string, LimitRule> = {}
    for (const k of LIMIT_KEYS) {
      if (modes[k] !== "custom") continue
      const r = fromDraft(drafts[k])
      if ("error" in r) return setError(`${t(`plan.limit.${k}`)}: ${t(r.error)}`)
      limits[k] = r.rule
    }
    const features: Partial<Features> = {}
    for (const k of BOOL_FEATURES) if (feat[k] !== "inherit") features[k] = feat[k] === "on"
    if (ints) features.integrations = ints
    const body: Overrides = { limits, features }
    setBusy(true)
    try {
      await adminApi.setOverrides(detail.workspace.id, body)
      toast.success(t("admin.overrides.saved"))
      onSaved()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  const modeItems = [
    { value: "inherit", label: t("admin.overrides.inherit") },
    { value: "custom", label: t("admin.overrides.custom") },
  ]
  const triItems = [
    { value: "inherit", label: t("admin.overrides.inherit") },
    { value: "on", label: t("admin.overrides.on") },
    { value: "off", label: t("admin.overrides.off") },
  ]

  return (
    <form onSubmit={save} noValidate className="space-y-3 py-6" data-overrides>
      <div className="space-y-1 px-6">
        <h2 className="text-sm font-medium text-grid-fg">{t("admin.overrides.title")}</h2>
        <p className="text-sm text-grid-muted">{t("admin.overrides.hint")}</p>
      </div>
      <div className="divide-y divide-line border-y border-line">
        <div className="hidden gap-3 px-6 py-2 md:grid md:grid-cols-[12rem_8rem_1fr]">
          <span className="text-xs text-grid-muted">{t("plan.col.limit")}</span>
          <span />
          <RuleHeader currency={currency} />
        </div>
        {LIMIT_KEYS.map((k) => (
          <div key={k} className="grid gap-2 px-6 py-2.5 md:grid-cols-[12rem_8rem_1fr] md:items-center md:gap-3" data-override={k}>
            <span className="text-sm">{t(`plan.limit.${k}`)}</span>
            <Select items={modeItems} value={modes[k]} onValueChange={(v) => setModes({ ...modes, [k]: (v as Mode) ?? "inherit" })}>
              <SelectTrigger className="h-8 w-full" aria-label={t(`plan.limit.${k}`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {modes[k] === "custom" ? (
              <RuleFields id={k} draft={drafts[k]} currency={currency} onChange={(dr) => setDrafts({ ...drafts, [k]: dr })} />
            ) : (
              <span className="text-xs text-grid-muted">{t("admin.overrides.fromPlan")}</span>
            )}
          </div>
        ))}
        {BOOL_FEATURES.map((k) => (
          <div key={k} className="grid gap-2 px-6 py-2.5 md:grid-cols-[12rem_8rem_1fr] md:items-center md:gap-3" data-override-feature={k}>
            <span className="text-sm">{t(`plan.feature.${k}`)}</span>
            <Select items={triItems} value={feat[k]} onValueChange={(v) => setFeat({ ...feat, [k]: (v as Tri) ?? "inherit" })}>
              <SelectTrigger className="h-8 w-full" aria-label={t(`plan.feature.${k}`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {triItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span />
          </div>
        ))}
        <div className="grid gap-2 px-6 py-2.5 md:grid-cols-[12rem_8rem_1fr] md:items-center md:gap-3">
          <span className="text-sm">{t("plan.feature.integrations")}</span>
          <Select
            items={modeItems}
            value={ints ? "custom" : "inherit"}
            onValueChange={(v) => setInts(v === "custom" ? [...(detail.usage.features.integrations ?? [])] : null)}
          >
            <SelectTrigger className="h-8 w-full" aria-label={t("plan.feature.integrations")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modeItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <IntegrationPicker value={ints ?? detail.usage.features.integrations ?? []} onChange={setInts} options={INTEGRATIONS} disabled={!ints} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 px-6">
        {error ? <FieldError>{error}</FieldError> : null}
        <Button type="submit" disabled={busy}>
          {busy ? t("common.working") : t("admin.overrides.save")}
        </Button>
      </div>
    </form>
  )
}

function DeleteDialog({ open, onOpenChange, id, slug }: { open: boolean; onOpenChange: (o: boolean) => void; id: string; slug: string }) {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (confirm !== slug) return
    setBusy(true)
    setError(null)
    try {
      await adminApi.deleteWorkspace(id, confirm)
      toast.success(t("admin.workspaces.deleted"))
      onOpenChange(false)
      router.replace(`/${locale}/admin/workspaces`)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("admin.workspaces.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("admin.workspaces.deleteBody")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ws-delete">{t("admin.workspaces.typeSlug", { slug })}</FieldLabel>
            <Input id="ws-delete" dir="ltr" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <FieldDescription>
              <Ltr mono>{slug}</Ltr>
            </FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || confirm !== slug}>
              {busy ? t("common.working") : t("common.delete")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
