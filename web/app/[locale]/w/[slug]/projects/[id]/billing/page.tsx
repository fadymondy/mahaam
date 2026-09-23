"use client"

import { useState, type FormEvent } from "react"
import { PlusIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import useSWR from "swr"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText, w } from "@/lib/work"

/*
A project's billing sources besides time (internal/work/billing_sources.go): its AI usage
(pushed daily by agents over MCP record_ai_usage) with the markup it is invoiced at, and its
subscriptions (infrastructure, AI, marketing tools, …). Drafting an invoice for the client
bills unbilled AI usage and every due subscription period next to the time. Manager+.
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
const selectCls = "h-8 w-full rounded-lg border border-line bg-transparent px-2 text-sm"

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))

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
  const [editing, setEditing] = useState<Partial<Sub> & { price?: string; cost?: string } | null>(null)

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
  const days = (daily.data?.rows ?? []).slice(-30)
  const maxCost = Math.max(1, ...days.map((d) => d.cost_minor))

  return (
    <div className="space-y-8 p-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-medium">
              <SparklesIcon className="size-4" aria-hidden /> {t("billing.aiTitle")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-grid-muted">{t("billing.aiHint")}</p>
          </div>
          <div className="flex items-end gap-2">
            <Field>
              <FieldLabel htmlFor="markup">{t("billing.markup")}</FieldLabel>
              <Input id="markup" dir="ltr" inputMode="decimal" className="w-24" placeholder="0" value={markupValue} onChange={(e) => setMarkup(e.target.value)} />
            </Field>
            <Button variant="outline" onClick={() => void saveMarkup()} disabled={markup === null || !markup.trim()}>
              {t("billing.saveMarkup")}
            </Button>
          </div>
        </div>
        {usage.error ? (
          <ErrorState error={usage.error} />
        ) : !usage.data ? (
          <LoadingRows rows={2} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("billing.noUsage")} body={t("billing.noUsageBody")} />
        ) : (
          <>
            {days.length > 1 ? (
              <div className="flex h-24 items-end gap-1 border-b border-line" role="img" aria-label={t("billing.dailyCost")}>
                {days.map((d) => (
                  <div
                    key={d.key}
                    title={`${d.key}: ${money(d.cost_minor, d.currency, locale)}`}
                    className="min-w-1 flex-1 bg-grid-action/70"
                    style={{ height: `${Math.max(4, (d.cost_minor / maxCost) * 100)}%` }}
                  />
                ))}
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-start text-meta text-grid-muted">
                  <tr>
                    <th className="py-2 text-start font-medium">{t("billing.model")}</th>
                    <th className="py-2 text-end font-medium">{t("billing.input")}</th>
                    <th className="py-2 text-end font-medium">{t("billing.output")}</th>
                    <th className="py-2 text-end font-medium">{t("billing.cache")}</th>
                    <th className="py-2 text-end font-medium">{t("billing.cost")}</th>
                    <th className="py-2 text-end font-medium">{t("billing.billed")}</th>
                    <th className="py-2 text-end font-medium">{t("billing.unbilled")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.key + r.currency}>
                      <td className="py-2" dir="ltr">
                        {r.key}
                      </td>
                      <td className="py-2 text-end tabular-nums">{tokens(r.input_tokens)}</td>
                      <td className="py-2 text-end tabular-nums">{tokens(r.output_tokens)}</td>
                      <td className="py-2 text-end tabular-nums">{tokens(r.cache_tokens)}</td>
                      <td className="py-2 text-end tabular-nums">{money(r.cost_minor, r.currency, locale)}</td>
                      <td className="py-2 text-end tabular-nums">{money(r.billed_minor, r.currency, locale)}</td>
                      <td className="py-2 text-end tabular-nums">{money(r.unbilled_cost_minor, r.currency, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">{t("billing.subsTitle")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-grid-muted">{t("billing.subsHint")}</p>
          </div>
          <Button onClick={() => setEditing({ category: "infrastructure", interval: "month", billable: true, active: true, currency: "USD" })}>
            <PlusIcon /> {t("billing.addSub")}
          </Button>
        </div>
        {subs.error ? (
          <ErrorState error={subs.error} />
        ) : !subs.data ? (
          <LoadingRows rows={2} />
        ) : (subs.data.subscriptions ?? []).length === 0 ? (
          <EmptyState title={t("billing.noSubs")} />
        ) : (
          <ul className="divide-y divide-line border border-line">
            {(subs.data.subscriptions ?? []).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="font-medium" dir="auto">
                  {x.name}
                </span>
                <Badge variant="secondary">{t(`billing.cat.${x.category}`)}</Badge>
                {x.vendor ? <span className="text-grid-muted">{x.vendor}</span> : null}
                {!x.active ? <Badge variant="outline">{t("billing.inactive")}</Badge> : null}
                {!x.billable ? <Badge variant="outline">{t("billing.notBillable")}</Badge> : null}
                <span className="ms-auto tabular-nums">
                  {money(x.price_minor, x.currency, locale)} / {t(`billing.int.${x.interval}`)}
                  <span className="ms-2 text-meta text-grid-muted">
                    {t("billing.costIs", { cost: money(x.cost_minor, x.currency, locale) })}
                  </span>
                </span>
                <span className="w-full text-meta text-grid-muted">
                  {x.next_period ? t("billing.nextPeriod", { date: x.next_period }) : t("billing.fullyBilled")}
                  {x.billed_until ? ` · ${t("billing.billedUntil", { date: x.billed_until })}` : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing({ ...x, price: (x.price_minor / 100).toFixed(2), cost: (x.cost_minor / 100).toFixed(2) })}
                >
                  {t("billing.edit")}
                </Button>
              </li>
            ))}
          </ul>
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
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="s-name">{t("billing.name")}</FieldLabel>
              <Input id="s-name" name="name" dir="auto" required defaultValue={v.name ?? ""} placeholder="Hetzner server" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="s-cat">{t("billing.category")}</FieldLabel>
                <select id="s-cat" name="category" className={selectCls} defaultValue={v.category}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`billing.cat.${c}`)}
                    </option>
                  ))}
                </select>
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
                <select id="s-int" name="interval" className={selectCls} defaultValue={v.interval}>
                  {INTERVALS.map((c) => (
                    <option key={c} value={c}>
                      {t(`billing.int.${c}`)}
                    </option>
                  ))}
                </select>
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
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch name="billable" defaultChecked={v.billable ?? true} /> {t("billing.billable")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch name="active" defaultChecked={v.active ?? true} /> {t("billing.active")}
              </label>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("billing.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("billing.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
