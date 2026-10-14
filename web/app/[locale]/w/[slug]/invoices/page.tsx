"use client"

import { useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import { FormError } from "@/components/form-text"

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, DataTableFacetFilter, useDataTable, type DataTableColumn } from "@fadymondy/nasaq/web"

import { DateField } from "@/components/work/fields"
import { DataView } from "@/components/data-view"
import { Page, PageHeader } from "@/components/page"
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

const STATUS_VARIANT: Record<InvoiceStatus, "neutral" | "info" | "success" | "outline"> = {
  draft: "neutral",
  sent: "info",
  paid: "success",
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
  const [creating, setCreating] = useState(false)
  const invoices = useInvoices(ws.id, {}, canRead)
  const all = useMemo(() => invoices.data?.invoices ?? [], [invoices.data])
  const clientOptions = useMemo(() => {
    const m = new Map<string, string>()
    for (const iv of all) if (iv.client_name) m.set(iv.client_id, iv.client_name)
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [all])
  const columns = useMemo<DataTableColumn<Invoice>[]>(() => {
    const today = new Date().toISOString().slice(0, 10)
    return [
      {
        id: "number",
        header: t("invoices.col.number"),
        hideable: false,
        sortValue: (iv) => iv.number,
        searchValue: (iv) => `${iv.number} ${iv.client_name ?? ""} ${iv.notes ?? ""}`,
        cell: (iv) => (
          <Link href={`/${locale}/w/${ws.slug}/invoices/${iv.number}`} className="font-medium hover:underline" data-invoice={iv.number}>
            <Ltr mono>{iv.number}</Ltr>
          </Link>
        ),
      },
      {
        id: "client",
        header: t("invoices.col.client"),
        sortValue: (iv) => iv.client_name ?? null,
        filterValue: (iv) => iv.client_id,
        className: "text-nq-fg-body",
        cell: (iv) => iv.client_name ?? "—",
      },
      {
        id: "status",
        header: t("invoices.col.status"),
        sortValue: (iv) => INVOICE_STATUSES.indexOf(iv.status),
        filterValue: (iv) => iv.status,
        cell: (iv) => <StatusBadge status={iv.status} />,
      },
      {
        id: "issued",
        header: t("invoices.col.issued"),
        sortValue: (iv) => iv.issue_date,
        className: "text-muted-foreground",
        cell: (iv) => <Ltr mono>{iv.issue_date}</Ltr>,
      },
      {
        id: "total",
        header: t("invoices.col.total"),
        align: "end",
        sortValue: (iv) => iv.total_minor,
        // sent and not fully paid: overdue once the due date has passed
        filterValue: (iv) =>
          iv.status === "sent" && iv.paid_minor < iv.total_minor ? (iv.due_date && iv.due_date.slice(0, 10) < today ? "overdue" : "unpaid") : "settled",
        className: "tabular-nums",
        cell: (iv) => <Ltr>{money(iv.total_minor, iv.currency, locale)}</Ltr>,
      },
    ]
  }, [t, locale, ws.slug])
  const table = useDataTable({ data: all, columns, getRowId: (iv) => iv.id, pageSize: 25, defaultSort: { id: "issued", direction: "desc" } })

  if (ws.current && !canRead) return (
      <Page>
        <p className="text-sm text-muted-foreground">{t("invoices.noPermission")}</p>
      </Page>
    )

  return (
    <Page wide>
      <PageHeader
        title={t("invoices.title")}
        description={t("invoices.hint")}
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setCreating(true)} data-new-invoice>
              <PlusIcon />
              {t("invoices.new")}
            </Button>
          ) : null
        }
      />
      {invoices.error ? (
        <ErrorState error={invoices.error} />
      ) : (
        <DataView
          table={table}
          label={t("invoices.title")}
          rowLabel={(iv) => iv.number}
          loading={invoices.isLoading}
          empty={<EmptyState title={t("invoices.none")} body={canWrite ? t("invoices.noneHint") : undefined} />}
          onRowClick={(iv) => router.push(`/${locale}/w/${ws.slug}/invoices/${iv.number}`)}
          search={t("invoices.search")}
          filters={
            <>
              <DataTableFacetFilter
                table={table}
                column="status"
                title={t("invoices.col.status")}
                options={INVOICE_STATUSES.map((s) => ({ value: s, label: t(`invoices.status.${s}`) }))}
              />
              <DataTableFacetFilter table={table} column="client" title={t("invoices.col.client")} options={clientOptions} />
              <DataTableFacetFilter
                table={table}
                column="total"
                title={t("invoices.filter.payment")}
                options={[
                  { value: "unpaid", label: t("invoices.filter.unpaid") },
                  { value: "overdue", label: t("invoices.filter.overdue") },
                ]}
              />
            </>
          }
        />
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
    </Page>
  )
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
      <div className="flex flex-col gap-4">
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
            <p className="mt-1 text-caption text-muted-foreground" data-unbilled-preview>
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
        {error ? <FormError>{error}</FormError> : null}
        <div className="flex justify-end">
          <Button variant="primary" type="submit" disabled={busy || !v.client} data-create-invoice>
            {busy ? t("common.working") : t("newInvoice.create")}
          </Button>
        </div>
      </div>
    </form>
  )
}
