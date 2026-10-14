"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import Link from "next/link"
import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon, PlusIcon, UploadIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "@fadymondy/nasaq/web"
import { FormError } from "@/components/form-text"

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldLabel, Input, Switch, Textarea, DataTableFacetFilter, useDataTable, type DataTableColumn } from "@fadymondy/nasaq/web"

import { DataView } from "@/components/data-view"
import { Page, PageHeader } from "@/components/page"
import { Ltr } from "@/components/copy-field"
import { ClientImportDialog } from "@/components/work/client-import-dialog"
import { EmptyState, ErrorState } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText, useClients, w, type Client } from "@/lib/work"

export default function ClientsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useDocumentTitle(`${t("nav.clients")} · ${ws.summary.name}`)
  const [archived, setArchived] = useState(false)
  const [editing, setEditing] = useState<Client | "new" | null>(null)
  const [importing, setImporting] = useState(false)
  const [googleSession, setGoogleSession] = useState<string | null>(null)
  const clients = useClients(ws.id, archived, ws.can("clients:read"))
  const canWrite = ws.can("clients:write")
  const all = useMemo(() => clients.data?.clients ?? [], [clients.data])
  const currencies = useMemo(() => [...new Set(all.map((c) => c.currency).filter(Boolean))].sort(), [all])
  const columns = useMemo<DataTableColumn<Client>[]>(
    () => [
      {
        id: "name",
        header: t("clients.name"),
        hideable: false,
        sortValue: (c) => c.name.toLowerCase(),
        searchValue: (c) => `${c.name} ${c.email ?? ""} ${c.phone ?? ""} ${c.company ?? ""} ${c.country ?? ""}`,
        cell: (c) => (
          <span className="font-medium" data-client={c.id}>
            <Link href={`/${locale}/w/${ws.slug}/clients/${c.id}`} className="hover:underline">
              {c.name}
            </Link>
            {c.archived_at ? (
              <Badge variant="neutral" className="ms-2">
                {t("project.archivedBadge")}
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        id: "email",
        header: t("clients.email"),
        sortValue: (c) => c.email ?? null,
        className: "text-muted-foreground",
        cell: (c) => (c.email ? <Ltr>{c.email}</Ltr> : "—"),
      },
      {
        id: "rate",
        header: t("clients.rate"),
        sortValue: (c) => c.default_rate_minor ?? null,
        filterValue: (c) => c.currency,
        className: "text-muted-foreground",
        cell: (c) =>
          c.default_rate_minor != null ? (
            <Ltr>
              {money(c.default_rate_minor, c.currency, locale)}/{t("clients.hourShort")}
            </Ltr>
          ) : (
            <Ltr mono>{c.currency}</Ltr>
          ),
      },
      {
        id: "projects",
        header: t("clients.projects"),
        align: "end",
        sortValue: (c) => c.project_count,
        filterValue: (c) => (c.project_count ? "with" : "without"),
        className: "text-muted-foreground tabular-nums",
        cell: (c) => <Ltr>{c.project_count}</Ltr>,
      },
    ],
    [t, locale, ws.slug],
  )
  const table = useDataTable({ data: all, columns, getRowId: (c) => c.id, pageSize: 25, defaultSort: { id: "name", direction: "asc" } })

  // Back from the Google Contacts consent screen: ?import=google&session=… (or &error=…).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get("import") !== "google") return
    const session = q.get("session")
    const err = q.get("error")
    window.history.replaceState(null, "", window.location.pathname)
    if (err) toast.error(err)
    if (session) {
      setGoogleSession(session)
      setImporting(true)
    }
  }, [])

  if (ws.current && !ws.can("clients:read")) return (
      <Page>
        <p className="text-sm text-muted-foreground">{t("clients.noPermission")}</p>
      </Page>
    )

  async function toggleArchive(c: Client) {
    try {
      await w.post(ws.id, `/api/w/clients/${c.id}/${c.archived_at ? "restore" : "archive"}`)
      toast.success(c.archived_at ? t("clients.restored") : t("clients.archived"))
      void clients.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  return (
    <Page wide>
      <PageHeader
        title={t("nav.clients")}
        description={t("clients.hint")}
        actions={
          canWrite ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImporting(true)} data-client-import-open>
                <UploadIcon />
                {t("clientImport.button")}
              </Button>
              <Button variant="primary" onClick={() => setEditing("new")}>
                <PlusIcon />
                {t("clients.new")}
              </Button>
            </div>
          ) : null
        }
      />
      {clients.error ? (
        <ErrorState error={clients.error} />
      ) : (
        <DataView
          table={table}
          label={t("nav.clients")}
          rowLabel={(c) => c.name}
          loading={clients.isLoading}
          empty={<EmptyState title={t("clients.empty")} body={canWrite ? t("clients.emptyBody") : undefined} />}
          onRowClick={(c) => router.push(`/${locale}/w/${ws.slug}/clients/${c.id}`)}
          rowActions={
            canWrite
              ? (c) => [
                  { id: "edit", label: t("common.edit"), icon: PencilIcon, onSelect: () => setEditing(c) },
                  {
                    id: "archive",
                    label: c.archived_at ? t("settings.restore") : t("settings.archive"),
                    icon: c.archived_at ? ArchiveRestoreIcon : ArchiveIcon,
                    onSelect: () => void toggleArchive(c),
                  },
                ]
              : undefined
          }
          search={t("clients.search")}
          filters={
            <>
              <DataTableFacetFilter table={table} column="rate" title={t("clients.filterCurrency")} options={currencies.map((c) => ({ value: c, label: c }))} />
              <DataTableFacetFilter
                table={table}
                column="projects"
                title={t("clients.filterWork")}
                options={[
                  { value: "with", label: t("clients.withProjects") },
                  { value: "without", label: t("clients.withoutProjects") },
                ]}
              />
            </>
          }
          toolbarEnd={
            <label className="flex items-center gap-2 text-sm text-nq-fg-body">
              <Switch checked={archived} onCheckedChange={setArchived} />
              {t("clients.showArchived")}
            </label>
          }
        />
      )}

      {canWrite ? (
        <ClientImportDialog
          open={importing}
          onOpenChange={(o) => {
            setImporting(o)
            if (!o) setGoogleSession(null)
          }}
          googleSession={googleSession}
          onImported={() => void clients.mutate()}
        />
      ) : null}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t("clients.new") : t("clients.edit")}</DialogTitle>
            <DialogDescription>{t("clients.formHint")}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <ClientForm
              client={editing === "new" ? undefined : editing}
              onDone={() => {
                setEditing(null)
                void clients.mutate()
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  )
}

function ClientForm({ client, onDone }: { client?: Client; onDone: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [v, setV] = useState({
    name: client?.name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    company: client?.company ?? "",
    country: client?.country ?? "",
    currency: client?.currency ?? "",
    rate: client?.default_rate_minor != null ? String(client.default_rate_minor / 100) : "",
    notes: client?.notes ?? "",
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const rate = v.rate.trim() === "" ? -1 : Math.round(Number(v.rate) * 100)
    if (Number.isNaN(rate)) {
      setError(t("clients.rateInvalid"))
      return
    }
    const body: Record<string, unknown> = {
      name: v.name,
      email: v.email,
      phone: v.phone,
      company: v.company,
      country: v.country.toUpperCase(),
      notes: v.notes,
      default_rate_minor: rate,
    }
    if (v.currency.trim()) body.currency = v.currency.trim().toUpperCase()
    setBusy(true)
    setError(null)
    try {
      if (client) await w.patch(ws.id, `/api/w/clients/${client.id}`, body)
      else await w.post(ws.id, "/api/w/clients", body)
      toast.success(t("common.saved"))
      onDone()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="c-name">{t("clients.name")}</FieldLabel>
          <Input id="c-name" autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="c-email">{t("clients.email")}</FieldLabel>
            <Input id="c-email" type="email" dir="ltr" value={v.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-phone">{t("clients.phone")}</FieldLabel>
            <Input id="c-phone" dir="ltr" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="c-company">{t("clients.company")}</FieldLabel>
            <Input id="c-company" value={v.company} onChange={(e) => set("company", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-country">{t("clients.country")}</FieldLabel>
            <Input id="c-country" dir="ltr" maxLength={2} className="uppercase" placeholder="EG" value={v.country} onChange={(e) => set("country", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-currency">{t("project.currency")}</FieldLabel>
            <Input id="c-currency" dir="ltr" maxLength={3} className="uppercase" placeholder={ws.current?.workspace.currency ?? "USD"} value={v.currency} onChange={(e) => set("currency", e.target.value)} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="c-rate">{t("clients.rateLabel")}</FieldLabel>
            <Input id="c-rate" dir="ltr" inputMode="decimal" value={v.rate} onChange={(e) => set("rate", e.target.value)} placeholder="0.00" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="c-notes">{t("clients.notes")}</FieldLabel>
          <Textarea id="c-notes" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        {error ? <FormError>{error}</FormError> : null}
        <div className="flex justify-end">
          <Button variant="primary" type="submit" disabled={busy || !v.name.trim()}>
            {busy ? t("common.working") : t("common.save")}
          </Button>
        </div>
      </div>
    </form>
  )
}
