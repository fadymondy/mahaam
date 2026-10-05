"use client"

import { useState, type FormEvent } from "react"
import { PencilIcon, PlusIcon, ServerIcon } from "lucide-react"
import useSWR from "swr"

import {
  AiUsageCost,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  SectionHeader,
  Switch,
  toast,
} from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState } from "@/components/states"
import { RowsSkeleton } from "@/components/work/project/project-skeletons"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { formatDay, money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText, w } from "@/lib/work"

/*
A project's billing sources besides time (internal/work/billing_sources.go): its AI usage
(pushed daily by agents over MCP record_ai_usage) with the markup it is invoiced at, in Nasaq's
AiUsageCost, and its subscriptions (infrastructure, AI, marketing tools, …). Drafting an invoice
for the client bills unbilled AI usage and every due subscription period next to the time. Manager+.
*/

type UsageRow = {
  key: string
  input_tokens: number
  output_tokens: number
  cache_tokens: number
  requests: number
  cost_minor: number
  billed_minor: number
  unbilled_cost_minor: number
  currency: string
}

type Sub = {
  id: string
  name: string
  category: string
  vendor: string | null
  price_minor: number
  cost_minor: number
  currency: string
  interval: string
  starts_on: string
  ends_on: string | null
  billable: boolean
  active: boolean
  billed_until: string | null
  next_period: string | null
}

const CATEGORIES = ["infrastructure", "ai", "marketing", "software", "domain", "support", "other"]
const INTERVALS = ["month", "quarter", "year", "one_time"]

export default function BillingPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const { project } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.billing")} · ${project.name}`)
  const fetcher = <T,>([p, id]: [string, string]) => api<T>(p, { workspaceId: id })
  const usage = useSWR<{ rows: UsageRow[] | null }>([`/api/w/ai-usage?project=${project.id}&group_by=model`, ws.id], fetcher<any>)
  const daily = useSWR<{ rows: UsageRow[] | null }>([`/api/w/ai-usage?project=${project.id}&group_by=day`, ws.id], fetcher<any>)
  const subs = useSWR<{ subscriptions: Sub[] | null }>([`/api/w/subscriptions?project=${project.id}`, ws.id], fetcher<any>)
  const markupNow = useSWR<{ ai_markup_bp: number }>([`/api/w/projects/${project.id}/ai-markup`, ws.id], fetcher<any>)
  const [markup, setMarkup] = useState<string | null>(null)
  const markupValue = markup ?? (markupNow.data ? String(markupNow.data.ai_markup_bp / 100) : "")
  const [editing, setEditing] = useState<(Partial<Sub> & { price?: string; cost?: string }) | null>(null)

  const saveMarkup = async () => {
    try {
      await w.put(ws.id, `/api/w/projects/${project.id}/ai-markup`, { percent: markupValue })
      setMarkup(null)
      void markupNow.mutate()
      toast.success(t("billing.markupSaved"))
      void usage.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  const rows = usage.data?.rows ?? []
  // AiUsageCost works in major units of one currency: the usage's own, else the project's.
  const currency = rows[0]?.currency || project.currency || "USD"
  const major = (minor: number) => minor / 100
  const days = (daily.data?.rows ?? [])
    .filter((d) => d.currency === currency)
    .slice(-30)
    .map((d) => ({ date: d.key.slice(0, 10), billed: major(d.cost_minor - d.unbilled_cost_minor), unbilled: major(d.unbilled_cost_minor) }))
  const byModel = rows
    .filter((r) => r.currency === currency)
    .map((r) => ({ id: r.key, label: r.key, tokensIn: r.input_tokens + r.cache_tokens, tokensOut: r.output_tokens, cost: major(r.cost_minor) }))
  const list = subs.data?.subscriptions ?? []

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 p-4 sm:p-6" data-billing-page>
      <section className="space-y-4" aria-labelledby="billing-ai">
        <SectionHeader
          headingId="billing-ai"
          title={t("billing.aiTitle")}
          description={t("billing.aiHint")}
          action={
            <div className="flex items-end gap-2">
              <Field>
                <FieldLabel htmlFor="markup">{t("billing.markup")}</FieldLabel>
                <Input id="markup" dir="ltr" inputMode="decimal" className="w-24" placeholder="0" value={markupValue} onChange={(e) => setMarkup(e.target.value)} />
              </Field>
              <Button variant="secondary" onClick={() => void saveMarkup()} disabled={markup === null || !markup.trim()}>
                {t("billing.saveMarkup")}
              </Button>
            </div>
          }
        />
        {usage.error ? (
          <ErrorState error={usage.error} />
        ) : usage.data && rows.length === 0 ? (
          <EmptyState title={t("billing.noUsage")} body={t("billing.noUsageBody")} />
        ) : (
          <AiUsageCost
            days={days}
            byModel={byModel}
            markup={markupNow.data ? markupNow.data.ai_markup_bp / 10000 : undefined}
            currency={currency}
            loading={!usage.data || !daily.data}
            data-ai-usage
          />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="billing-subs">
        <SectionHeader
          headingId="billing-subs"
          title={t("billing.subsTitle")}
          description={t("billing.subsHint")}
          action={
            <Button
              variant="primary"
              onClick={() => setEditing({ category: "infrastructure", interval: "month", billable: true, active: true, currency: project.currency || "USD" })}
            >
              <PlusIcon /> {t("billing.addSub")}
            </Button>
          }
        />
        {subs.error ? (
          <ErrorState error={subs.error} />
        ) : !subs.data ? (
          <RowsSkeleton rows={2} />
        ) : list.length === 0 ? (
          <EmptyState title={t("billing.noSubs")} />
        ) : (
          <Card className="gap-0 border-transparent py-0" data-subscriptions>
            <ul className="divide-y divide-border">
              {list.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-subscription={x.id}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
                    <ServerIcon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" dir="auto">
                        {x.name}
                      </span>
                      <Badge variant="neutral">{t(`billing.cat.${x.category}`)}</Badge>
                      {!x.active ? <Badge variant="outline">{t("billing.inactive")}</Badge> : null}
                      {!x.billable ? <Badge variant="outline">{t("billing.notBillable")}</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {x.vendor ? <span dir="auto">{x.vendor} · </span> : null}
                      {x.next_period ? t("billing.nextPeriod", { date: formatDay(x.next_period, locale) }) : t("billing.fullyBilled")}
                      {x.billed_until ? ` · ${t("billing.billedUntil", { date: formatDay(x.billed_until, locale) })}` : ""}
                    </p>
                  </div>
                  <div className="text-end">
                    <div className="font-medium tabular-nums">
                      <Ltr>{money(x.price_minor, x.currency, locale)}</Ltr>
                      <span className="text-caption font-normal text-muted-foreground"> / {t(`billing.int.${x.interval}`)}</span>
                    </div>
                    <div className="text-caption text-muted-foreground">{t("billing.costIs", { cost: money(x.cost_minor, x.currency, locale) })}</div>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("billing.edit")}
                    onClick={() => setEditing({ ...x, price: (x.price_minor / 100).toFixed(2), cost: (x.cost_minor / 100).toFixed(2) })}
                  >
                    <PencilIcon />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <SubDialog projectId={project.id} value={editing} onClose={() => setEditing(null)} onSaved={() => void subs.mutate()} />
    </div>
  )
}

function SubDialog({
  projectId,
  value,
  onClose,
  onSaved,
}: {
  projectId: string
  value: (Partial<Sub> & { price?: string; cost?: string }) | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  if (!value) return null
  const v = value
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body = {
      name: String(f.get("name") ?? ""),
      category: String(f.get("category")),
      vendor: String(f.get("vendor") ?? ""),
      price: String(f.get("price") ?? "0"),
      cost: String(f.get("cost") ?? "0"),
      currency: String(f.get("currency") ?? "USD").toUpperCase(),
      interval: String(f.get("interval")),
      starts_on: String(f.get("starts_on") || "") || undefined,
      ends_on: String(f.get("ends_on") ?? ""),
      billable: f.get("billable") === "on",
      active: f.get("active") === "on",
    }
    setBusy(true)
    try {
      if (v.id) await w.patch(ws.id, `/api/w/subscriptions/${v.id}`, body)
      else await w.post(ws.id, `/api/w/projects/${projectId}/subscriptions`, body)
      toast.success(t("billing.saved"))
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{v.id ? t("billing.editSub") : t("billing.addSub")}</DialogTitle>
            <DialogDescription>{t("billing.subDialogHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="s-name">{t("billing.name")}</FieldLabel>
              <Input id="s-name" name="name" dir="auto" required defaultValue={v.name ?? ""} placeholder="Hetzner server" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="s-cat">{t("billing.category")}</FieldLabel>
                <NativeSelect id="s-cat" name="category" defaultValue={v.category} options={CATEGORIES.map((c) => ({ value: c, label: t(`billing.cat.${c}`) }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-vendor">{t("billing.vendor")}</FieldLabel>
                <Input id="s-vendor" name="vendor" dir="auto" defaultValue={v.vendor ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-price">{t("billing.price")}</FieldLabel>
                <Input id="s-price" name="price" dir="ltr" inputMode="decimal" required defaultValue={v.price ?? ""} placeholder="49.00" />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-cost">{t("billing.ourCost")}</FieldLabel>
                <Input id="s-cost" name="cost" dir="ltr" inputMode="decimal" defaultValue={v.cost ?? ""} placeholder="30.00" />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-cur">{t("billing.currency")}</FieldLabel>
                <Input id="s-cur" name="currency" dir="ltr" maxLength={3} defaultValue={v.currency ?? "USD"} />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-int">{t("billing.interval")}</FieldLabel>
                <NativeSelect id="s-int" name="interval" defaultValue={v.interval} options={INTERVALS.map((c) => ({ value: c, label: t(`billing.int.${c}`) }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-start">{t("billing.starts")}</FieldLabel>
                <Input id="s-start" name="starts_on" type="date" dir="ltr" defaultValue={v.starts_on ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="s-end">{t("billing.ends")}</FieldLabel>
                <Input id="s-end" name="ends_on" type="date" dir="ltr" defaultValue={v.ends_on ?? ""} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch name="billable" defaultChecked={v.billable ?? true} /> {t("billing.billable")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch name="active" defaultChecked={v.active ?? true} /> {t("billing.active")}
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("billing.cancel")}
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {t("billing.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
