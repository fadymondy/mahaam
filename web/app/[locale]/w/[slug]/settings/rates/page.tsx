"use client"

// Members' rates: effective-dated hourly bill and cost rates (minor units of the workspace currency).
// A new time entry copies the rate in force when it starts; editing a rate never changes an entry
// already logged. Managers read; admins set and delete.
import Link from "next/link"
import { useMemo, useState, type FormEvent } from "react"
import { HistoryIcon, PencilIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import { FormError } from "@/components/form-text"

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldDescription, FieldLabel, Input, DataTableFacetFilter, useDataTable, type DataTableColumn } from "@fadymondy/nasaq/web"

import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { DataView } from "@/components/data-view"
import { SectionTitle } from "@/components/page"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { DateField } from "@/components/work/fields"
import { PersonAvatar, useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { timeApi, useRates, type MemberRates, type RateSheet } from "@/lib/time"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

export default function RatesPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  useDocumentTitle(`${t("rates.title")} · ${ws.summary.name}`)
  const canRead = ws.can("rates:read")
  const sheet = useRates(ws.id, canRead)
  const [editing, setEditing] = useState<MemberRates | null>(null)
  const [history, setHistory] = useState<MemberRates | null>(null)

  const rs = sheet.data
  const rate = (v: number | null | undefined, cur: string) =>
    v != null ? (
      <Ltr>
        {money(v, cur, locale)}
        {t("rates.perHour")}
      </Ltr>
    ) : (
      <span className="text-muted-foreground">{t("rates.none")}</span>
    )
  const members = useMemo(() => rs?.members ?? [], [rs])
  const roles = useMemo(() => [...new Set(members.map((m) => m.role))], [members])
  const cur = rs?.currency ?? ""
  const today = rs?.today ?? ""
  const canManage = !!rs?.can_manage
  const columns = useMemo<DataTableColumn<MemberRates>[]>(() => {
    const rateCell = (v: number | null | undefined) =>
      v != null ? (
        <Ltr>
          {money(v, cur, locale)}
          {t("rates.perHour")}
        </Ltr>
      ) : (
        <span className="text-muted-foreground">{t("rates.none")}</span>
      )
    return [
      {
        id: "member",
        header: t("rates.member"),
        hideable: false,
        sortValue: (m) => dir.name(m.user_id).toLowerCase(),
        searchValue: (m) => dir.name(m.user_id),
        filterValue: (m) => m.role,
        className: "max-w-0",
        cell: (m) => (
          <span className="flex min-w-0 items-center gap-2.5" data-rate-member={m.user_id}>
            <PersonAvatar id={m.user_id} dir={dir} />
            <span className="min-w-0">
              <Ltr className="block truncate">{dir.name(m.user_id)}</Ltr>
              <span className="text-caption text-muted-foreground">{t(`role.${m.role}`)}</span>
            </span>
          </span>
        ),
      },
      { id: "bill", header: t("rates.bill"), sortValue: (m) => m.current?.bill_rate_minor ?? null, cell: (m) => <span data-rate-bill>{rateCell(m.current?.bill_rate_minor)}</span> },
      { id: "cost", header: t("rates.cost"), sortValue: (m) => m.current?.cost_rate_minor ?? null, cell: (m) => rateCell(m.current?.cost_rate_minor) },
      {
        id: "since",
        header: t("rates.since"),
        sortValue: (m) => m.current?.effective_from ?? null,
        className: "text-muted-foreground",
        cell: (m) => {
          const next = m.history.find((h) => h.effective_from > today)
          return (
            <>
              {m.current ? <Ltr>{formatDay(m.current.effective_from, locale)}</Ltr> : "—"}
              {next ? (
                <Badge variant="outline" className="ms-2">
                  {t("rates.upcoming", { day: formatDay(next.effective_from, locale, "short") })}
                </Badge>
              ) : null}
            </>
          )
        },
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("common.actions")}</span>,
        label: t("common.actions"),
        hideable: false,
        align: "end",
        cell: (m) => (
          <div className="flex justify-end gap-1">
            {m.history.length ? (
              <Button variant="ghost" size="sm" onClick={() => setHistory(m)}>
                <HistoryIcon />
                <span className="hidden md:inline">{t("rates.history")}</span>
                <Ltr className="text-muted-foreground">{m.history.length}</Ltr>
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(m)} data-set-rate={m.user_id}>
                <PencilIcon />
                <span className="hidden sm:inline">{t("rates.set")}</span>
              </Button>
            ) : null}
          </div>
        ),
      },
    ]
  }, [t, locale, dir, cur, today, canManage])
  const table = useDataTable({ data: members, columns, getRowId: (m) => m.user_id, pageSize: 25, defaultSort: { id: "member", direction: "asc" } })

  if (ws.current && !canRead) return <p className="text-sm text-muted-foreground">{t("rates.noPermission")}</p>

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title={t("rates.title")} description={t("rates.hint")} />
      {sheet.error ? (
        <ErrorState error={sheet.error} />
      ) : !rs ? (
        <LoadingRows />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-muted/50 px-4 py-3 text-sm" data-rate-defaults>
            <span className="text-nq-fg-body">
              <span className="font-medium text-foreground">{t("rates.defaults")}: </span>
              {t("rates.defaultsHint", {
                bill: rs.default_bill_rate_minor != null ? money(rs.default_bill_rate_minor, rs.currency, locale) : "—",
                cost: rs.default_cost_rate_minor != null ? money(rs.default_cost_rate_minor, rs.currency, locale) : "—",
              })}
            </span>
            <Link href={`/${locale}/w/${ws.slug}/settings/time`} className="text-sm font-medium underline-offset-4 hover:underline">
              {t("rates.defaultsLink")}
            </Link>
          </div>
          {!rs.can_manage ? <p className="text-sm text-muted-foreground">{t("rates.readOnly")}</p> : null}
          <DataView
            table={table}
            label={t("rates.title")}
            rowLabel={(m) => dir.name(m.user_id)}
            empty={<EmptyState title={t("team.empty")} />}
            search={t("members.search")}
            filters={<DataTableFacetFilter table={table} column="member" title={t("members.role")} options={roles.map((r) => ({ value: r, label: t(`role.${r}`) }))} />}
          />
        </>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("rates.setTitle", { name: dir.name(editing.user_id) }) : ""}</DialogTitle>
            <DialogDescription>{t("rates.hint")}</DialogDescription>
          </DialogHeader>
          {editing && rs ? (
            <RateForm
              member={editing}
              sheet={rs}
              onDone={() => {
                setEditing(null)
                void sheet.mutate()
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{history ? t("rates.historyTitle", { name: dir.name(history.user_id) }) : ""}</DialogTitle>
            <DialogDescription>{t("rates.deleteBody")}</DialogDescription>
          </DialogHeader>
          {history && rs ? (
            <ul className="divide-y divide-line border-y border-border" data-rate-history>
              {history.history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Ltr className="w-28 shrink-0 text-muted-foreground">{formatDay(h.effective_from, locale)}</Ltr>
                  <span className="min-w-0 flex-1">
                    {t("rates.bill")}: {rate(h.bill_rate_minor, h.currency)} · {t("rates.cost")}: {rate(h.cost_rate_minor, h.currency)}
                  </span>
                  {rs.can_manage ? (
                    <ConfirmButton
                      label={t("common.delete")}
                      title={t("rates.deleteTitle")}
                      description={t("rates.deleteBody")}
                      confirmLabel={t("common.delete")}
                      onConfirm={async () => {
                        try {
                          await timeApi.deleteRate(ws.id, h.id)
                          const fresh = await sheet.mutate()
                          setHistory(fresh?.members.find((m) => m.user_id === history.user_id) ?? null)
                        } catch (err) {
                          toast.error(errorText(err, t("common.networkError")))
                        }
                      }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RateForm({ member, sheet, onDone }: { member: MemberRates; sheet: RateSheet; onDone: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const major = (v?: number | null) => (v != null ? String(v / 100) : "")
  const [day, setDay] = useState(sheet.today)
  const [bill, setBill] = useState(major(member.current?.bill_rate_minor))
  const [cost, setCost] = useState(major(member.current?.cost_rate_minor))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const parse = (s: string) => (s.trim() === "" ? undefined : Math.round(Number(s) * 100))
    const b = parse(bill)
    const c = parse(cost)
    if ((b !== undefined && (Number.isNaN(b) || b < 0)) || (c !== undefined && (Number.isNaN(c) || c < 0))) return setError(t("rates.invalid"))
    if (b === undefined && c === undefined) return setError(t("rates.needOne"))
    setBusy(true)
    try {
      await timeApi.setRate(ws.id, member.user_id, { effective_from: day, bill_rate_minor: b, cost_rate_minor: c })
      toast.success(t("rates.saved"))
      onDone()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate data-rate-form>
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="r-day">{t("rates.effective")}</FieldLabel>
          <DateField id="r-day" value={day} onChange={(v) => v && setDay(v)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="r-bill">{t("rates.bill")}</FieldLabel>
            <Input id="r-bill" dir="ltr" inputMode="decimal" value={bill} onChange={(e) => setBill(e.target.value)} placeholder="0.00" />
            <FieldDescription>{t("rates.billHint", { currency: sheet.currency })}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="r-cost">{t("rates.cost")}</FieldLabel>
            <Input id="r-cost" dir="ltr" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
            <FieldDescription>{t("rates.costHint", { currency: sheet.currency })}</FieldDescription>
          </Field>
        </div>
        {error ? <FormError>{error}</FormError> : null}
        <div className="flex justify-end">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t("common.working") : t("common.save")}
          </Button>
        </div>
      </div>
    </form>
  )
}
