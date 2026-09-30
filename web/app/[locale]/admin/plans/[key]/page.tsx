"use client"

// Create (/admin/plans/new) or edit a plan: names, prices, and a rule per catalog key + features.
import Link from "next/link"
import { useState, type FormEvent } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button, Field, FieldDescription, FieldError, FieldLabel, Input, Switch, Textarea } from "@fadymondy/nasaq/web"





import { IntegrationPicker, RuleFields, RuleHeader, fromDraft, toDraft, type RuleDraft } from "@/components/admin/limit-editor"
import { SectionHeader } from "@/components/public-frame"
import { ErrorState, LoadingRows } from "@/components/states"
import { NotFoundState } from "@/components/not-found-state"
import {
  BOOL_FEATURES,
  INTEGRATIONS,
  LIMIT_KEYS,
  LIMIT_KINDS,
  adminApi,
  emptyFeatures,
  planName,
  useAdminPlans,
  type Features,
  type LimitRule,
  type Plan,
} from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

const NEW = "new"

export default function AdminPlanPage() {
  const { key } = useParams<{ key: string }>()
  const planKey = decodeURIComponent(key)
  const { t, locale } = useTranslations()
  const plans = useAdminPlans()
  const creating = planKey === NEW
  const plan = creating ? undefined : plans.data?.plans?.find((p) => p.key === planKey)
  useDocumentTitle(`${creating ? t("admin.plans.create") : plan ? planName(plan, locale) : t("admin.nav.plans")} · ${t("admin.title")}`)

  if (plans.error) return <ErrorState error={plans.error} />
  if (!plans.data) return <LoadingRows rows={6} />
  if (!creating && !plan) return <NotFoundState backHref={`/${locale}/admin/plans`} backLabel={t("admin.nav.plans")} />
  const catalog = plans.data.catalog?.map((c) => c.key) ?? [...LIMIT_KEYS]
  const integrations = plans.data.integrations ?? [...INTEGRATIONS]
  return (
    <>
      <SectionHeader
        micro={
          <Link href={`/${locale}/admin/plans`} className="hover:underline">
            {t("admin.nav.plans")}
          </Link>
        }
        title={creating ? t("admin.plans.create") : planName(plan, locale)}
      />
      <PlanForm plan={plan} catalog={catalog} integrations={integrations} onSaved={() => plans.mutate()} />
    </>
  )
}

function PlanForm({ plan, catalog, integrations, onSaved }: { plan?: Plan; catalog: string[]; integrations: string[]; onSaved: () => void }) {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const [f, setF] = useState({
    key: plan?.key ?? "",
    name_en: plan?.name_en ?? "",
    name_ar: plan?.name_ar ?? "",
    description_en: plan?.description_en ?? "",
    description_ar: plan?.description_ar ?? "",
    price_label_en: plan?.price_label_en ?? "",
    price_label_ar: plan?.price_label_ar ?? "",
    currency: plan?.currency ?? "USD",
    base_fee: plan ? String(plan.base_fee_minor / 100) : "0",
    active: plan?.active ?? true,
    sort: String(plan?.sort ?? 0),
  })
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>(() => Object.fromEntries(catalog.map((k) => [k, toDraft(plan?.limits?.[k])])))
  const [features, setFeatures] = useState<Features>(() => ({ ...emptyFeatures(), ...(plan?.features ?? {}) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(f.key) || f.key === NEW) return setError(t("admin.plans.invalidKey"))
    if (!f.name_en.trim()) return setError(t("admin.plans.nameRequired"))
    const fee = Math.round(Number(f.base_fee || "0") * 100)
    const sort = Number(f.sort || "0")
    if (Number.isNaN(fee) || fee < 0) return setError(t("admin.limit.invalidPrice"))
    if (!Number.isInteger(sort)) return setError(t("admin.plans.invalidSort"))
    const limits: Record<string, LimitRule> = {}
    for (const k of catalog) {
      const r = fromDraft(drafts[k])
      if ("error" in r) return setError(`${t(`plan.limit.${k}`)}: ${t(r.error)}`)
      limits[k] = r.rule
    }
    const body: Omit<Plan, "workspaces"> = {
      key: f.key,
      name_en: f.name_en.trim(),
      name_ar: f.name_ar.trim(),
      description_en: f.description_en,
      description_ar: f.description_ar,
      price_label_en: f.price_label_en,
      price_label_ar: f.price_label_ar,
      currency: f.currency.trim().toUpperCase(),
      base_fee_minor: fee,
      active: f.active,
      sort,
      limits,
      features,
    }
    setBusy(true)
    try {
      if (plan) await adminApi.updatePlan(plan.key, body)
      else await adminApi.createPlan(body)
      toast.success(t("admin.plans.saved"))
      onSaved()
      router.push(`/${locale}/admin/plans`)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  const text = (k: keyof typeof f, label: string, opts: { dir?: "ltr" | "rtl"; hint?: string; disabled?: boolean } = {}) => (
    <Field>
      <FieldLabel htmlFor={`plan-${k}`}>{label}</FieldLabel>
      <Input id={`plan-${k}`} dir={opts.dir} disabled={opts.disabled} value={String(f[k])} onChange={(e) => set(k, e.target.value)} />
      {opts.hint ? <FieldDescription>{opts.hint}</FieldDescription> : null}
    </Field>
  )

  return (
    <form onSubmit={submit} noValidate className="space-y-8 pb-10" data-plan-form>
      <div className="grid gap-4 border-y border-line px-6 py-6 sm:grid-cols-2">
        {text("key", t("admin.plans.key"), { dir: "ltr", disabled: !!plan, hint: t("admin.plans.keyHint") })}
        <Field>
          <FieldLabel htmlFor="plan-active">{t("admin.plans.active")}</FieldLabel>
          <Switch id="plan-active" checked={f.active} onCheckedChange={(c) => set("active", !!c)} />
        </Field>
        {text("name_en", t("admin.plans.nameEn"), { dir: "ltr" })}
        {text("name_ar", t("admin.plans.nameAr"), { dir: "rtl" })}
        <Field>
          <FieldLabel htmlFor="plan-desc-en">{t("admin.plans.descEn")}</FieldLabel>
          <Textarea id="plan-desc-en" dir="ltr" rows={2} value={f.description_en} onChange={(e) => set("description_en", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="plan-desc-ar">{t("admin.plans.descAr")}</FieldLabel>
          <Textarea id="plan-desc-ar" dir="rtl" rows={2} value={f.description_ar} onChange={(e) => set("description_ar", e.target.value)} />
        </Field>
        {text("price_label_en", t("admin.plans.priceLabelEn"), { dir: "ltr" })}
        {text("price_label_ar", t("admin.plans.priceLabelAr"), { dir: "rtl" })}
        {text("currency", t("admin.plans.currency"), { dir: "ltr" })}
        {text("base_fee", t("admin.plans.baseFee", { currency: f.currency }), { dir: "ltr" })}
        {text("sort", t("admin.plans.sort"), { dir: "ltr" })}
      </div>

      <section className="space-y-3">
        <div className="space-y-1 px-6">
          <h2 className="text-sm font-medium text-grid-fg">{t("admin.plans.limits")}</h2>
          <p className="text-sm text-grid-muted">{t("admin.plans.limitsHint")}</p>
        </div>
        <div className="divide-y divide-line border-y border-line">
          <div className="hidden gap-3 px-6 py-2 md:grid md:grid-cols-[12rem_1fr]">
            <span className="text-meta text-grid-muted">{t("plan.col.limit")}</span>
            <RuleHeader currency={f.currency} />
          </div>
          {catalog.map((k) => (
            <div key={k} className="grid gap-2 px-6 py-2.5 md:grid-cols-[12rem_1fr] md:items-center md:gap-3" data-plan-limit={k}>
              <span className="text-sm">
                {t(`plan.limit.${k}`)}
                <span className="block text-meta text-grid-muted">{t(`plan.kind.${kindOf(k)}`)}</span>
              </span>
              <RuleFields id={k} draft={drafts[k]} currency={f.currency} onChange={(d) => setDrafts({ ...drafts, [k]: d })} />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="px-6 text-sm font-medium text-grid-fg">{t("admin.workspaces.features")}</h2>
        <div className="divide-y divide-line border-y border-line">
          {BOOL_FEATURES.map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 px-6 py-2.5 text-sm">
              {t(`plan.feature.${k}`)}
              <Switch checked={features[k]} onCheckedChange={(c) => setFeatures({ ...features, [k]: !!c })} />
            </label>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 text-sm">
            {t("plan.feature.integrations")}
            <IntegrationPicker value={features.integrations ?? []} options={integrations} onChange={(v) => setFeatures({ ...features, integrations: v })} />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 px-6">
        {error ? <FieldError>{error}</FieldError> : null}
        <Button type="button" variant="secondary" nativeButton={false} render={<Link href={`/${locale}/admin/plans`} />}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? t("common.working") : t("common.save")}
        </Button>
      </div>
    </form>
  )
}

function kindOf(k: string): string {
  return (LIMIT_KINDS as Record<string, string>)[k] ?? "count"
}
