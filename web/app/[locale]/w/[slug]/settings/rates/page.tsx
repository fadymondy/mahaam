"use client"

// Members' rates: effective-dated hourly bill and cost rates (minor units of the workspace currency).
// A new time entry copies the rate in force when it starts; editing a rate never changes an entry
// already logged. Managers read; admins set and delete.
import Link from "next/link"
import { useState, type FormEvent } from "react"
import { HistoryIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
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

  if (ws.current && !canRead) return <p className="px-6 py-6 text-sm text-grid-muted">{t("rates.noPermission")}</p>

  const rs = sheet.data
  const rate = (v: number | null | undefined, cur: string) =>
    v != null ? (
      <Ltr>
        {money(v, cur, locale)}
        {t("rates.perHour")}
      </Ltr>
    ) : (
      <span className="text-grid-muted">{t("rates.none")}</span>
    )
  const upcoming = (m: MemberRates, today: string) => m.history.find((h) => h.effective_from > today)

  return (
    <>
      <SectionHeader micro={ws.summary.name} title={t("rates.title")} description={t("rates.hint")} />
      {sheet.error ? (
        <ErrorState error={sheet.error} />
      ) : !rs ? (
        <LoadingRows />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-grid-soft/50 px-6 py-3 text-sm" data-rate-defaults>
            <span className="text-grid-body">
              <span className="font-medium text-grid-fg">{t("rates.defaults")}: </span>
              {t("rates.defaultsHint", {
                bill: rs.default_bill_rate_minor != null ? money(rs.default_bill_rate_minor, rs.currency, locale) : "—",
                cost: rs.default_cost_rate_minor != null ? money(rs.default_cost_rate_minor, rs.currency, locale) : "—",
              })}
            </span>
            <Link href={`/${locale}/w/${ws.slug}/settings/time`} className="text-sm font-medium underline-offset-4 hover:underline">
              {t("rates.defaultsLink")}
            </Link>
          </div>
          {!rs.can_manage ? <p className="border-t border-line px-6 py-3 text-sm text-grid-muted">{t("rates.readOnly")}</p> : null}
          {rs.members.length === 0 ? (
            <EmptyState title={t("team.empty")} />
          ) : (
            <div className="border-y border-line">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-6">{t("rates.member")}</TableHead>
                    <TableHead>{t("rates.bill")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("rates.cost")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("rates.since")}</TableHead>
                    <TableHead className="pe-6 text-end">
                      <span className="sr-only">{t("common.actions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rs.members.map((m) => {
                    const next = upcoming(m, rs.today)
                    return (
                      <TableRow key={m.user_id} data-rate-member={m.user_id}>
                        <TableCell className="max-w-0 ps-6">
                          <span className="flex min-w-0 items-center gap-2.5">
                            <PersonAvatar id={m.user_id} dir={dir} />
                            <span className="min-w-0">
                              <Ltr className="block truncate">{dir.name(m.user_id)}</Ltr>
                              <span className="text-xs text-grid-muted">{t(`role.${m.role}`)}</span>
                            </span>
                          </span>
                        </TableCell>
                        <TableCell data-rate-bill>{rate(m.current?.bill_rate_minor, rs.currency)}</TableCell>
                        <TableCell className="hidden sm:table-cell">{rate(m.current?.cost_rate_minor, rs.currency)}</TableCell>
                        <TableCell className="hidden text-grid-muted md:table-cell">
                          {m.current ? <Ltr>{formatDay(m.current.effective_from, locale)}</Ltr> : "—"}
                          {next ? (
                            <Badge variant="outline" className="ms-2">
                              {t("rates.upcoming", { day: formatDay(next.effective_from, locale, "short") })}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="pe-6 text-end">
                          <div className="flex justify-end gap-1">
                            {m.history.length ? (
                              <Button variant="ghost" size="sm" onClick={() => setHistory(m)}>
                                <HistoryIcon />
                                <span className="hidden md:inline">{t("rates.history")}</span>
                                <Ltr className="text-grid-muted">{m.history.length}</Ltr>
                              </Button>
                            ) : null}
                            {rs.can_manage ? (
                              <Button variant="outline" size="sm" onClick={() => setEditing(m)} data-set-rate={m.user_id}>
                                <PencilIcon />
                                <span className="hidden sm:inline">{t("rates.set")}</span>
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
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
            <ul className="divide-y divide-line border-y border-line" data-rate-history>
              {history.history.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Ltr className="w-28 shrink-0 text-grid-muted">{formatDay(h.effective_from, locale)}</Ltr>
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
    </>
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
      <FieldGroup>
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
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? t("common.working") : t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
