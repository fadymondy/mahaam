"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeftIcon, DownloadIcon, PrinterIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import { FormError } from "@/components/form-text"

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, FieldLabel, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"







import { DateField } from "@/components/work/fields"
import { SectionHeader } from "@/components/public-frame"
import { Ltr } from "@/components/copy-field"
import { ErrorState, LoadingRows } from "@/components/states"
import { NotFoundState } from "@/components/not-found-state"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { downloadInvoice, errorText, invoicesApi, openInvoicePrint, useInvoice, type InvoiceStatus } from "@/lib/work"

import { StatusBadge } from "../page"

export default function InvoiceDetailPage() {
  const { number } = useParams<{ number: string }>()
  const router = useRouter()
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const canRead = ws.can("invoices:read")
  const canWrite = ws.can("invoices:write")
  const invoice = useInvoice(ws.id, number, canRead)
  const [paying, setPaying] = useState(false)
  const [confirm, setConfirm] = useState<null | "void" | "delete">(null)
  const [busy, setBusy] = useState(false)
  const back = `/${locale}/w/${ws.slug}/invoices`

  const iv = invoice.data
  useDocumentTitle(`${iv?.number ?? t("invoices.title")} · ${ws.summary.name}`)

  if (ws.current && !canRead) return <p className="px-6 py-6 text-sm text-muted-foreground">{t("invoices.noPermission")}</p>

  if (invoice.error) {
    return invoice.error instanceof ApiError && invoice.error.status === 404 ? (
      <NotFoundState title={t("invoiceDetail.notFound")} body={t("invoiceDetail.notFoundBody")} backHref={back} backLabel={t("invoiceDetail.back")} />
    ) : (
      <ErrorState error={invoice.error} />
    )
  }
  if (!iv) return <LoadingRows rows={5} />

  const due = iv.total_minor - iv.paid_minor
  const lockedEntries = iv.lines.reduce((n, l) => n + l.source_time_entry_ids.length, 0)

  async function transition(status: InvoiceStatus) {
    setBusy(true)
    try {
      await invoicesApi.setStatus(ws.id, iv!.number, status)
      toast.success(t(`invoices.status.${status}`))
      void invoice.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await invoicesApi.del(ws.id, iv!.number)
      toast.success(t("invoiceDetail.delete"))
      router.push(back)
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <>
      <div className="px-6 pt-5">
        <Link href={back} className="inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
          {t("invoiceDetail.back")}
        </Link>
      </div>
      <SectionHeader
        micro={iv.client_name ?? ws.summary.name}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Ltr mono>{iv.number}</Ltr>
            <StatusBadge status={iv.status} />
          </span>
        }
        description={`${t("invoiceDetail.issued")} ${iv.issue_date}${iv.due_date ? ` · ${t("invoiceDetail.dueDate")} ${iv.due_date}` : ""}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="secondary" size="sm">
                    <DownloadIcon />
                    {t("invoiceDetail.export")}
                  </Button>
                }
              />
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => void downloadInvoice(ws.id, iv.number, "csv", locale)}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void downloadInvoice(ws.id, iv.number, "xlsx", locale)}>XLSX</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" size="sm" onClick={() => void openInvoicePrint(ws.id, iv.number, locale)} data-print-invoice>
              <PrinterIcon />
              {t("invoiceDetail.print")}
            </Button>
            {canWrite && iv.status === "draft" ? (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void transition("sent")} data-mark-sent>
                {t("invoiceDetail.markSent")}
              </Button>
            ) : null}
            {canWrite && iv.status === "sent" ? (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => setPaying(true)} data-record-payment>
                {t("invoiceDetail.recordPayment")}
              </Button>
            ) : null}
            {canWrite && (iv.status === "draft" || iv.status === "sent") ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirm("void")} data-void-invoice>
                {t("invoiceDetail.void")}
              </Button>
            ) : null}
            {canWrite && iv.status === "draft" ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm("delete")} data-delete-invoice>
                {t("invoiceDetail.delete")}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-px border-y border-border bg-border lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* lines + totals */}
        <div className="min-w-0 bg-background">
          <h2 className="px-6 pt-5 pb-3 text-base font-medium">{t("invoiceDetail.lines")}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("invoiceDetail.description")}</TableHead>
                <TableHead className="text-end">{t("invoiceDetail.hours")}</TableHead>
                <TableHead className="text-end">{t("invoiceDetail.unit")}</TableHead>
                <TableHead className="pe-6 text-end">{t("invoiceDetail.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {iv.lines.map((l) => (
                <TableRow key={l.id} data-invoice-line>
                  <TableCell className="ps-6">{l.description}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    <Ltr>{l.quantity}</Ltr>
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    <Ltr>{money(l.unit_minor, iv.currency, locale)}</Ltr>
                  </TableCell>
                  <TableCell className="pe-6 text-end tabular-nums">
                    <Ltr>{money(l.amount_minor, iv.currency, locale)}</Ltr>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <dl className="ms-auto grid max-w-sm gap-px border-t border-border bg-border text-sm">
            <TotalRow label={t("invoiceDetail.subtotal")} value={money(iv.subtotal_minor, iv.currency, locale)} />
            <TotalRow label={`${t("invoiceDetail.tax")} (${iv.tax_rate})`} value={money(iv.tax_minor, iv.currency, locale)} />
            <TotalRow label={t("invoiceDetail.total")} value={money(iv.total_minor, iv.currency, locale)} strong />
            {iv.paid_minor > 0 ? (
              <>
                <TotalRow label={t("invoiceDetail.paid")} value={money(iv.paid_minor, iv.currency, locale)} />
                <TotalRow label={t("invoiceDetail.due")} value={money(due, iv.currency, locale)} strong />
              </>
            ) : null}
          </dl>
          {iv.notes ? (
            <div className="border-t border-border px-6 py-4">
              <p className="text-eyebrow uppercase mb-1">{t("invoiceDetail.notes")}</p>
              <p className="text-sm whitespace-pre-wrap text-nq-fg-body">{iv.notes}</p>
            </div>
          ) : null}
        </div>

        {/* payments + info */}
        <aside className="min-w-0 bg-background">
          {lockedEntries > 0 ? (
            <p className="border-b border-border px-6 py-4 text-caption text-muted-foreground">{t("invoiceDetail.entriesLocked", { count: lockedEntries })}</p>
          ) : null}
          <h2 className="px-6 pt-5 pb-3 text-base font-medium">{t("invoiceDetail.payments")}</h2>
          {iv.payments.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t("invoiceDetail.noPayments")}</p>
          ) : (
            <ul className="divide-y divide-line border-y border-border">
              {iv.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-6 py-3 text-sm">
                  <span className="text-muted-foreground">
                    <Ltr mono>{p.paid_at.slice(0, 10)}</Ltr>
                    {p.ref ? <span className="ms-2">{p.ref}</span> : null}
                  </span>
                  <span className="tabular-nums">
                    <Ltr>{money(p.amount_minor, iv.currency, locale)}</Ltr>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <PaymentDialog open={paying} onOpenChange={setPaying} defaultAmount={due > 0 ? due : iv.total_minor} onDone={() => void invoice.mutate()} number={iv.number} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? t("invoiceDetail.delete") : t("invoiceDetail.void")}</AlertDialogTitle>
            <AlertDialogDescription>{confirm === "delete" ? t("invoiceDetail.deleteConfirm") : t("invoiceDetail.voidConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("newInvoice.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => (confirm === "delete" ? void remove() : void transition("void"))} disabled={busy}>
              {confirm === "delete" ? t("invoiceDetail.delete") : t("invoiceDetail.void")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-background px-6 py-2">
      <dt className={strong ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</dt>
      <dd className={strong ? "font-semibold tabular-nums" : "tabular-nums text-nq-fg-body"}>
        <Ltr>{value}</Ltr>
      </dd>
    </div>
  )
}

function PaymentDialog({
  open,
  onOpenChange,
  defaultAmount,
  number,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  defaultAmount: number
  number: string
  onDone: () => void
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [amount, setAmount] = useState("")
  const [ref, setRef] = useState("")
  const [paidAt, setPaidAt] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const amt = amount.trim() === "" ? defaultAmount : Math.round(Number(amount) * 100)
    if (Number.isNaN(amt) || amt <= 0) {
      setError(t("payment.amount"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoicesApi.pay(ws.id, number, { amount_minor: amt, ref: ref.trim() || undefined, paid_at: paidAt ? `${paidAt}T12:00:00Z` : undefined })
      toast.success(t("payment.submit"))
      onOpenChange(false)
      setAmount("")
      setRef("")
      setPaidAt("")
      onDone()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("invoiceDetail.recordPayment")}</DialogTitle>
          <DialogDescription>{t("payment.amountHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="pay-amount">{t("payment.amount")}</FieldLabel>
              <Input
                id="pay-amount"
                dir="ltr"
                inputMode="decimal"
                autoFocus
                placeholder={(defaultAmount / 100).toFixed(2)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="pay-date">{t("payment.paidAt")}</FieldLabel>
                <DateField id="pay-date" value={paidAt || null} onChange={(v) => setPaidAt(v ?? "")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="pay-ref">{t("payment.ref")}</FieldLabel>
                <Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
              </Field>
            </div>
            {error ? <FormError>{error}</FormError> : null}
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={busy} data-submit-payment>
                {busy ? t("common.working") : t("payment.submit")}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
