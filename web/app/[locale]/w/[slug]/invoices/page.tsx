"use client"

import { useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DateField } from "@/components/work/fields"
import { SectionHeader } from "@/components/public-frame"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import {
  INVOICE_STATUSES,
  errorText,
  invoicesApi,
  useClientUnbilled,
  useClients,
  useInvoices,
  type Invoice,
  type InvoiceStatus,
} from "@/lib/work"

const STATUS_VARIANT: Record<InvoiceStatus, "secondary" | "default" | "outline"> = {
  draft: "secondary",
  sent: "default",
  paid: "outline",
  void: "outline",
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslations()
  return (
    <Badge variant={STATUS_VARIANT[status]} data-invoice-status={status} className={status === "void" ? "opacity-60" : undefined}>
      {t(`invoices.status.${status}`)}
    </Badge>
  )
}

export default function InvoicesPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useDocumentTitle(`${t("invoices.title")} · ${ws.summary.name}`)
  const canRead = ws.can("invoices:read")
  const canWrite = ws.can("invoices:write")
  const [status, setStatus] = useState<string>("")
  const [creating, setCreating] = useState(false)
  const invoices = useInvoices(ws.id, status ? { status } : {}, canRead)
  const list = invoices.data?.invoices ?? []

  if (ws.current && !canRead) return <p className="px-6 py-6 text-sm text-grid-muted">{t("invoices.noPermission")}</p>

  return (
    <>
      <SectionHeader
        micro={ws.summary.name}
        title={t("invoices.title")}
        description={t("invoices.hint")}
        action={
          canWrite ? (
            <Button onClick={() => setCreating(true)} data-new-invoice>
              <PlusIcon />
              {t("invoices.new")}
            </Button>
          ) : null
        }
      />
      <div className="flex items-center gap-2 border-t border-line px-6 py-3">
        <Select items={STATUS_ITEMS(t)} value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : (v ?? ""))}>
          <SelectTrigger className="w-48" data-status-filter>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ITEMS(t).map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {invoices.error ? (
        <ErrorState error={invoices.error} />
      ) : invoices.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={t("invoices.none")} body={canWrite ? t("invoices.noneHint") : undefined} />
      ) : (
        <div className="border-y border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("invoices.col.number")}</TableHead>
                <TableHead>{t("invoices.col.client")}</TableHead>
                <TableHead>{t("invoices.col.status")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("invoices.col.issued")}</TableHead>
                <TableHead className="pe-6 text-end">{t("invoices.col.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((iv) => (
                <TableRow key={iv.id} data-invoice={iv.number}>
                  <TableCell className="ps-6 font-medium">
                    <Link href={`/${locale}/w/${ws.slug}/invoices/${iv.number}`} className="hover:underline">
                      <Ltr mono>{iv.number}</Ltr>
                    </Link>
                  </TableCell>
                  <TableCell className="text-grid-body">{iv.client_name ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={iv.status} />
                  </TableCell>
                  <TableCell className="hidden text-grid-muted sm:table-cell">
                    <Ltr mono>{iv.issue_date}</Ltr>
                  </TableCell>
                  <TableCell className="pe-6 text-end tabular-nums">
                    <Ltr>{money(iv.total_minor, iv.currency, locale)}</Ltr>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("newInvoice.title")}</DialogTitle>
            <DialogDescription>{t("invoices.hint")}</DialogDescription>
          </DialogHeader>
          {creating ? (
            <NewInvoiceForm
              onDone={(iv?: Invoice) => {
                setCreating(false)
                void invoices.mutate()
                if (iv) router.push(`/${locale}/w/${ws.slug}/invoices/${iv.number}`)
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function STATUS_ITEMS(t: (k: string) => string) {
  return [{ value: "all", label: t("invoices.filter.allStatuses") }, ...INVOICE_STATUSES.map((s) => ({ value: s, label: t(`invoices.status.${s}`) }))]
}

function NewInvoiceForm({ onDone }: { onDone: (iv?: Invoice) => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const clients = useClients(ws.id, false, ws.can("clients:read"))
  const clientList = useMemo(() => clients.data?.clients ?? [], [clients.data])
  const [v, setV] = useState({ client: "", from: "", to: "", groupBy: "project", tax: "", due: "", notes: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }))
  const unbilled = useClientUnbilled(ws.id, v.client || null, !!v.client)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.client) {
      setError(t("newInvoice.selectClient"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const iv = await invoicesApi.draft(ws.id, {
        client_id: v.client,
        from: v.from || undefined,
        to: v.to || undefined,
        group_by: v.groupBy as "project" | "task",
        tax_rate: v.tax.trim() || undefined,
        due_date: v.due || undefined,
        notes: v.notes.trim() || undefined,
      })
      toast.success(t("newInvoice.create"))
      onDone(iv)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  const u = unbilled.data
  const clientItems = clientList.map((c) => ({ value: c.id, label: c.name }))

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ni-client">{t("newInvoice.client")}</FieldLabel>
          <Select items={clientItems} value={v.client} onValueChange={(val) => set("client", val ?? "")}>
            <SelectTrigger id="ni-client" className="w-full" data-invoice-client>
              <SelectValue placeholder={t("newInvoice.selectClient")} />
            </SelectTrigger>
            <SelectContent>
              {clientItems.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {v.client ? (
            <p className="mt-1 text-xs text-grid-muted" data-unbilled-preview>
              {u
                ? u.entry_count === 0
                  ? t("newInvoice.noUnbilled")
                  : t("newInvoice.unbilledValue", { hours: (u.seconds / 3600).toFixed(2), amount: money(u.amount_minor, u.currency, locale) })
                : "…"}
            </p>
          ) : null}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ni-from">{t("newInvoice.from")}</FieldLabel>
            <DateField id="ni-from" value={v.from || null} onChange={(val) => set("from", val ?? "")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ni-to">{t("newInvoice.to")}</FieldLabel>
            <DateField id="ni-to" value={v.to || null} onChange={(val) => set("to", val ?? "")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ni-group">{t("newInvoice.groupBy")}</FieldLabel>
            <Select
              items={[
                { value: "project", label: t("newInvoice.byProject") },
                { value: "task", label: t("newInvoice.byTask") },
              ]}
              value={v.groupBy}
              onValueChange={(val) => set("groupBy", val ?? "project")}
            >
              <SelectTrigger id="ni-group" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">{t("newInvoice.byProject")}</SelectItem>
                <SelectItem value="task">{t("newInvoice.byTask")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ni-tax">{t("newInvoice.taxRate")}</FieldLabel>
            <Input id="ni-tax" dir="ltr" inputMode="decimal" placeholder="0.14" value={v.tax} onChange={(e) => set("tax", e.target.value)} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ni-due">{t("newInvoice.dueDate")}</FieldLabel>
            <DateField id="ni-due" value={v.due || null} onChange={(val) => set("due", val ?? "")} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="ni-notes">{t("newInvoice.notes")}</FieldLabel>
          <Textarea id="ni-notes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !v.client} data-create-invoice>
            {busy ? t("common.working") : t("newInvoice.create")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
