"use client"

// Clients → Import: CSV / XLSX (incl. a Google Contacts CSV export), Google Contacts (OAuth) and a
// WhatsApp / phone contacts vCard. Every source goes preview → (mapping) → commit through
// /api/w/clients/import/*; the server re-plans on commit, so the preview is only what the user saw.
import { useEffect, useMemo, useState } from "react"
import { FileUpIcon, LoaderIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsList, TabsTab } from "@fadymondy/nasaq/web"







import { Ltr } from "@/components/copy-field"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { errorText } from "@/lib/work"

type Source = "csv" | "xlsx" | "google_csv" | "vcard" | "google" | "whatsapp_api"
type RowError = { row: number; column?: string; message: string }
type Row = {
  row: number
  action: "create" | "update" | "skip" | "invalid"
  client_id?: string
  match?: "email" | "phone"
  name: string
  email?: string
  phone?: string
  company?: string
  changes?: string[]
  reason?: string
  errors?: RowError[]
}
type Counts = { total: number; create: number; update: number; skip: number; invalid: number }
type Preview = { headers: string[]; header_row: number; mapping: Record<string, string>; fields: string[]; rows: Row[]; counts: Counts }
type Result = { rows: Row[]; counts: Counts }
type Sources = { google: boolean; whatsapp_api: boolean; max_rows: number; max_bytes: number }
type Input = { source: Source; content?: string; content_base64?: string; session?: string; mapping?: Record<string, string>; update_existing?: boolean }

const IGNORE = "__ignore"
const FIELDS = ["name", "first_name", "last_name", "email", "phone", "company", "notes"] as const
const SHOWN = 200

async function readFile(file: File): Promise<Pick<Input, "source" | "content" | "content_base64">> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".vcf") || name.endsWith(".vcard")) return { source: "vcard", content: await file.text() }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = new Uint8Array(await file.arrayBuffer())
    let bin = ""
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { source: "xlsx", content_base64: btoa(bin) }
  }
  return { source: "csv", content: await file.text() }
}

export function ClientImportDialog({
  open,
  onOpenChange,
  onImported,
  googleSession,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
  /** Set when the Google callback redirected back here with a ready session. */
  googleSession?: string | null
}) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [tab, setTab] = useState<"file" | "google" | "whatsapp">("file")
  const [sources, setSources] = useState<Sources | null>(null)
  const [input, setInput] = useState<Input | null>(null)
  const [fileName, setFileName] = useState("")
  const [updateExisting, setUpdateExisting] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<"preview" | "commit" | "google" | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || sources) return
    api<Sources>("/api/w/clients/import/sources", { workspaceId: ws.id })
      .then(setSources)
      .catch(() => setSources({ google: false, whatsapp_api: false, max_rows: 5000, max_bytes: 8 << 20 }))
  }, [open, sources, ws.id])

  // Back from Google: preview the session straight away.
  useEffect(() => {
    if (open && googleSession) {
      setTab("google")
      void runPreview({ source: "google", session: googleSession })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, googleSession])

  function reset() {
    setInput(null)
    setPreview(null)
    setFileName("")
    setError(null)
  }

  async function runPreview(next: Input, keepMapping = false) {
    setBusy("preview")
    setError(null)
    const body: Input = { ...next, update_existing: updateExisting }
    if (!keepMapping) delete body.mapping
    try {
      const p = await api<Preview>("/api/w/clients/import/preview", { method: "POST", json: body, workspaceId: ws.id })
      setInput(body)
      setPreview(p)
    } catch (err) {
      setPreview(null)
      setInput(next)
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(null)
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (sources && file.size > sources.max_bytes) {
      setError(t("clientImport.tooLarge", { mb: Math.round(sources.max_bytes / 1048576) }))
      return
    }
    reset()
    setFileName(file.name)
    await runPreview(await readFile(file))
  }

  function remap(header: string, field: string) {
    if (!input || !preview) return
    const mapping = { ...preview.mapping, [header]: field === IGNORE ? "" : field }
    void runPreview({ ...input, mapping }, true)
  }

  async function connectGoogle() {
    setBusy("google")
    try {
      const out = await api<{ url: string }>(`/api/w/clients/import/google/start?locale=${locale}`, { method: "POST", json: {}, workspaceId: ws.id })
      window.location.assign(out.url)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
      setBusy(null)
    }
  }

  async function commit() {
    if (!input) return
    setBusy("commit")
    setError(null)
    try {
      const r = await api<Result>("/api/w/clients/import/commit", { method: "POST", json: { ...input, update_existing: updateExisting }, workspaceId: ws.id })
      toast.success(t("clientImport.done", { create: r.counts.create, update: r.counts.update, invalid: r.counts.invalid }))
      onImported()
      onOpenChange(false)
      reset()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(null)
    }
  }

  const writes = preview ? preview.counts.create + preview.counts.update : 0
  const fieldItems = useMemo(
    () => [{ value: IGNORE, label: t("clientImport.ignore") }, ...FIELDS.map((f) => ({ value: f, label: t(`clientImport.field.${f}`) }))],
    [t],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl" data-client-import>
        <DialogHeader>
          <DialogTitle>{t("clientImport.title")}</DialogTitle>
          <DialogDescription>{t("clientImport.hint")}</DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as typeof tab)
            reset()
          }}
        >
          <TabsList>
            <TabsTab value="file" data-import-tab="file">
              {t("clientImport.tabFile")}
            </TabsTab>
            <TabsTab value="google" data-import-tab="google">
              {t("clientImport.tabGoogle")}
            </TabsTab>
            <TabsTab value="whatsapp" data-import-tab="whatsapp">
              {t("clientImport.tabWhatsApp")}
            </TabsTab>
          </TabsList>
        </Tabs>

        <div className="space-y-3 text-sm">
          {tab === "file" ? (
            <>
              <FilePick accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" label={t("clientImport.fileLabel")} name={fileName} onFile={onFile} />
              <p className="text-muted-foreground">{t("clientImport.fileHelp")}</p>
            </>
          ) : tab === "google" ? (
            <>
              <p className="text-muted-foreground">{t("clientImport.googleHelp")}</p>
              {sources?.google ? (
                <Button variant="primary" onClick={connectGoogle} disabled={!!busy} data-google-connect>
                  {busy === "google" ? <LoaderIcon className="animate-spin" /> : null}
                  {t("clientImport.googleConnect")}
                </Button>
              ) : sources ? (
                <p className="text-muted-foreground" data-not-configured="google">
                  {t("clientImport.notConfigured")}
                </p>
              ) : null}
              <p className="text-muted-foreground">{t("clientImport.googleCsv")}</p>
            </>
          ) : (
            <>
              <FilePick accept=".vcf,text/vcard,text/x-vcard" label={t("clientImport.waVcf")} name={fileName} onFile={onFile} />
              <p className="text-muted-foreground">{t("clientImport.waHelp")}</p>
              {sources?.whatsapp_api ? (
                <Button variant="secondary" disabled={!!busy} onClick={() => runPreview({ source: "whatsapp_api" })} data-whatsapp-api>
                  <RefreshCwIcon />
                  {t("clientImport.waApi")}
                </Button>
              ) : sources ? (
                <p className="text-muted-foreground" data-not-configured="whatsapp">
                  {t("clientImport.waApi")}: {t("clientImport.notConfigured")}
                </p>
              ) : null}
            </>
          )}

          <label className="flex items-center gap-2 text-nq-fg-body">
            <Switch
              checked={updateExisting}
              onCheckedChange={(v) => {
                setUpdateExisting(v)
                if (input) void runPreview({ ...input, update_existing: v }, true)
              }}
            />
            {t("clientImport.updateExisting")}
          </label>

          {error ? (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {busy === "preview" ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin" />
              {t("clientImport.previewing")}
            </p>
          ) : null}
        </div>

        {preview && preview.headers.length > 0 ? (
          <section className="space-y-2" aria-label={t("clientImport.mapping")}>
            <h3 className="text-sm font-medium">{t("clientImport.mapping")}</h3>
            <p className="text-caption text-muted-foreground">{preview.header_row > 0 ? t("clientImport.headerRow", { n: preview.header_row }) : t("clientImport.noHeader")}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {preview.headers.map((h) => (
                <label key={h} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={h}>
                    {h}
                  </span>
                  <Select items={fieldItems} value={preview.mapping[h] || IGNORE} onValueChange={(v) => v && remap(h, String(v))}>
                    <SelectTrigger className="w-40" data-map-header={h}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldItems.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {preview ? (
          <section className="space-y-2" aria-label={t("clientImport.preview")}>
            <p className="text-sm" data-import-counts>
              {t("clientImport.counts", { ...preview.counts })}
            </p>
            <div className="max-h-80 overflow-auto border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">{t("clientImport.col.row")}</TableHead>
                    <TableHead className="w-24">{t("clientImport.col.action")}</TableHead>
                    <TableHead>{t("clients.name")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("clients.email")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("clients.phone")}</TableHead>
                    <TableHead>{t("clientImport.col.details")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.slice(0, SHOWN).map((r) => (
                    <TableRow key={r.row} data-import-row={r.row} data-action={r.action}>
                      <TableCell>
                        <Ltr>{r.row}</Ltr>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.action === "invalid" ? "danger" : r.action === "create" ? "success" : r.action === "update" ? "info" : "outline"}>
                          {t(`clientImport.action.${r.action}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-48 truncate">{r.name || "—"}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{r.email ? <Ltr>{r.email}</Ltr> : "—"}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{r.phone ? <Ltr>{r.phone}</Ltr> : "—"}</TableCell>
                      <TableCell className="text-caption text-muted-foreground">
                        {r.errors?.length
                          ? r.errors.map((e, i) => (
                              <span key={i} className="block text-destructive">
                                {e.column ? `${t(`clientImport.field.${e.column}`)}: ` : ""}
                                {e.message}
                              </span>
                            ))
                          : null}
                        {r.match ? <span className="block">{t("clientImport.matched", { by: t(`clientImport.field.${r.match}`) })}</span> : null}
                        {r.changes?.length ? (
                          <span className="block">{t("clientImport.fills", { fields: r.changes.map((c) => t(`clientImport.field.${c}`)).join("، ") })}</span>
                        ) : null}
                        {r.reason ? <span className="block">{r.reason}</span> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {preview.rows.length > SHOWN ? <p className="text-caption text-muted-foreground">{t("clientImport.more", { n: preview.rows.length - SHOWN })}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                {t("clientImport.back")}
              </Button>
              <Button variant="primary" onClick={commit} disabled={!!busy || writes === 0} data-import-commit>
                {busy === "commit" ? <LoaderIcon className="animate-spin" /> : null}
                {t("clientImport.commit", { n: writes })}
              </Button>
            </div>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function FilePick({ accept, label, name, onFile }: { accept: string; label: string; name: string; onFile: (f: File | undefined) => void }) {
  const { t } = useTranslations()
  return (
    <label className="flex cursor-pointer items-center gap-3 border border-dashed border-border px-4 py-3 hover:bg-nq-hover">
      <FileUpIcon className="size-5 text-muted-foreground" />
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-caption text-muted-foreground">{name || t("clientImport.choose")}</span>
      </span>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        data-import-file
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ""
        }}
      />
    </label>
  )
}
