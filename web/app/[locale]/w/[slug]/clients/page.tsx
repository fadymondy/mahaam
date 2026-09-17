"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { SectionHeader } from "@/components/public-frame"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText, useClients, w, type Client } from "@/lib/work"

export default function ClientsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("nav.clients")} · ${ws.summary.name}`)
  const [archived, setArchived] = useState(false)
  const [editing, setEditing] = useState<Client | "new" | null>(null)
  const clients = useClients(ws.id, archived, ws.can("clients:read"))
  const canWrite = ws.can("clients:write")
  const list = clients.data?.clients ?? []

  if (ws.current && !ws.can("clients:read")) return <p className="px-6 py-6 text-sm text-grid-muted">{t("clients.noPermission")}</p>

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
    <>
      <SectionHeader
        micro={ws.summary.name}
        title={t("nav.clients")}
        description={t("clients.hint")}
        action={
          canWrite ? (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon />
              {t("clients.new")}
            </Button>
          ) : null
        }
      />
      <label className="flex items-center gap-2 border-t border-line px-6 py-3 text-sm text-grid-body">
        <Switch checked={archived} onCheckedChange={setArchived} />
        {t("clients.showArchived")}
      </label>

      {clients.error ? (
        <ErrorState error={clients.error} />
      ) : clients.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={t("clients.empty")} body={canWrite ? t("clients.emptyBody") : undefined} />
      ) : (
        <div className="border-y border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("clients.name")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("clients.email")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("clients.rate")}</TableHead>
                <TableHead>{t("clients.projects")}</TableHead>
                <TableHead className="pe-6 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((c) => (
                <TableRow key={c.id} data-client={c.id}>
                  <TableCell className="ps-6 font-medium">
                    <Link href={`/${locale}/w/${ws.slug}/clients/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                    {c.archived_at ? (
                      <Badge variant="secondary" className="ms-2">
                        {t("project.archivedBadge")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-grid-muted md:table-cell">{c.email ? <Ltr>{c.email}</Ltr> : "—"}</TableCell>
                  <TableCell className="hidden text-grid-muted sm:table-cell">
                    {c.default_rate_minor != null ? (
                      <Ltr>
                        {money(c.default_rate_minor, c.currency, locale)}/{t("clients.hourShort")}
                      </Ltr>
                    ) : (
                      <Ltr mono>{c.currency}</Ltr>
                    )}
                  </TableCell>
                  <TableCell className="text-grid-muted">
                    <Ltr>{c.project_count}</Ltr>
                  </TableCell>
                  <TableCell className="pe-6 text-end">
                    {canWrite ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                          {t("common.edit")}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleArchive(c)}>
                          {c.archived_at ? t("settings.restore") : t("settings.archive")}
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
    </>
  )
}

function ClientForm({ client, onDone }: { client?: Client; onDone: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [v, setV] = useState({
    name: client?.name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
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
      <FieldGroup>
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
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !v.name.trim()}>
            {busy ? t("common.working") : t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
