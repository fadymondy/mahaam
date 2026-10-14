// Clients → Import, as on the web: a CSV / XLSX (incl. a Google Contacts CSV export) or a vCard
// (WhatsApp / phone contacts) goes preview → (mapping) → commit through /api/w/clients/import/*.
// Google Contacts needs an OAuth round trip in a browser, so that tab opens the web console.
import { AlertCircleIcon, ExternalLinkIcon, FileUpIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ImportInput, ImportPreview, ImportSources } from "../../../main/api-clients";
import { LtrText, Spinner } from "@/components/kit";
import { Segmented } from "@/components/issues/controls";
import { fieldClass } from "@/components/time/TimeField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { api, desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { clientErrorText } from "./util";

const IGNORE = "__ignore";
const FIELDS = ["name", "first_name", "last_name", "email", "phone", "company", "notes"] as const;
const SHOWN = 200;
type Tab = "file" | "google" | "whatsapp";

async function readFile(file: File): Promise<Pick<ImportInput, "source" | "content" | "content_base64">> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".vcf") || name.endsWith(".vcard")) return { source: "vcard", content: await file.text() };
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { source: "xlsx", content_base64: btoa(bin) };
  }
  return { source: "csv", content: await file.text() };
}

const ACTION_TONE: Record<string, string> = {
  create: "bg-grid-action/15 text-grid-action",
  update: "bg-grid-soft text-grid-fg",
  skip: "border border-line text-grid-muted",
  invalid: "bg-grid-danger/15 text-grid-danger",
};

export function ClientImportDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (o: boolean) => void; onImported: () => void }) {
  const { t, number } = useI18n();
  const [tab, setTab] = useState<Tab>("file");
  const [sources, setSources] = useState<ImportSources | null>(null);
  const [input, setInput] = useState<ImportInput | null>(null);
  const [fileName, setFileName] = useState("");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || sources) return;
    api
      .clientImportSources()
      .then(setSources)
      .catch(() => setSources({ google: false, whatsapp_api: false, max_rows: 5000, max_bytes: 8 << 20 }));
  }, [open, sources]);

  function reset() {
    setInput(null);
    setPreview(null);
    setFileName("");
    setError(null);
  }

  async function runPreview(next: ImportInput, keepMapping = false, update = updateExisting) {
    setBusy("preview");
    setError(null);
    const body: ImportInput = { ...next, update_existing: update };
    if (!keepMapping) delete body.mapping;
    try {
      const p = await api.clientImportPreview(body);
      setInput(body);
      setPreview(p);
    } catch (err) {
      setPreview(null);
      setInput(next);
      setError(clientErrorText(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (sources && file.size > sources.max_bytes) {
      setError(t("clients.import.tooLarge", { mb: Math.round(sources.max_bytes / 1048576) }));
      return;
    }
    reset();
    setFileName(file.name);
    await runPreview(await readFile(file));
  }

  function remap(header: string, field: string) {
    if (!input || !preview) return;
    const mapping = { ...(preview.mapping ?? {}), [header]: field === IGNORE ? "" : field };
    void runPreview({ ...input, mapping }, true);
  }

  async function commit() {
    if (!input) return;
    setBusy("commit");
    setError(null);
    try {
      const r = await api.clientImportCommit({ ...input, update_existing: updateExisting });
      toast.success(t("clients.import.done", { create: number(r.counts.create), update: number(r.counts.update), invalid: number(r.counts.invalid) }));
      onImported();
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(clientErrorText(err, t));
    } finally {
      setBusy(null);
    }
  }

  const rows = preview?.rows ?? [];
  const headers = preview?.headers ?? [];
  const writes = preview ? preview.counts.create + preview.counts.update : 0;
  const fieldName = (f: string) => t(`clients.import.field.${f}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto p-0 sm:max-w-[820px]" data-client-import>
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-[14px]">{t("clients.import.title")}</DialogTitle>
          <DialogDescription className="text-[13px]">{t("clients.import.hint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-4 pb-4 text-[13.5px]">
          <Segmented<Tab>
            label={t("clients.import.title")}
            value={tab}
            onChange={(v) => {
              setTab(v);
              reset();
            }}
            options={[
              { value: "file", label: t("clients.import.tabFile") },
              { value: "google", label: t("clients.import.tabGoogle") },
              { value: "whatsapp", label: t("clients.import.tabWhatsApp") },
            ]}
          />

          {tab === "file" ? (
            <>
              <FilePick accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" label={t("clients.import.fileLabel")} name={fileName} onFile={onFile} />
              <p className="text-grid-muted">{t("clients.import.fileHelp")}</p>
            </>
          ) : tab === "google" ? (
            <>
              <p className="text-grid-muted">{t("clients.import.googleHelp")}</p>
              {sources && !sources.google ? (
                <p className="text-grid-muted">{t("clients.import.notConfigured")}</p>
              ) : (
                <div>
                  <Button size="sm" variant="outline" onClick={() => void desktop.openWeb("/clients")} data-google-open-web>
                    <ExternalLinkIcon />
                    {t("clients.import.googleBrowser")}
                  </Button>
                </div>
              )}
              <p className="text-grid-muted">{t("clients.import.googleCsv")}</p>
            </>
          ) : (
            <>
              <FilePick accept=".vcf,text/vcard,text/x-vcard" label={t("clients.import.waVcf")} name={fileName} onFile={onFile} />
              <p className="text-grid-muted">{t("clients.import.waHelp")}</p>
              {sources?.whatsapp_api ? (
                <div>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void runPreview({ source: "whatsapp_api" })}>
                    <RefreshCwIcon />
                    {t("clients.import.waApi")}
                  </Button>
                </div>
              ) : sources ? (
                <p className="text-grid-muted">
                  {t("clients.import.waApi")}: {t("clients.import.notConfigured")}
                </p>
              ) : null}
            </>
          )}

          <label className="flex items-center gap-2 text-grid-body">
            <Switch
              size="sm"
              checked={updateExisting}
              onCheckedChange={(v) => {
                setUpdateExisting(v);
                if (input) void runPreview({ ...input }, true, v);
              }}
            />
            {t("clients.import.updateExisting")}
          </label>

          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-grid-danger/40 bg-grid-danger/8 px-2.5 py-2 text-grid-fg">
              <AlertCircleIcon className="mt-px size-3.5 shrink-0 text-grid-danger" />
              <span className="min-w-0 flex-1">{error}</span>
            </div>
          ) : null}
          {busy === "preview" ? (
            <p className="flex items-center gap-2 text-grid-muted">
              <Spinner />
              {t("clients.import.previewing")}
            </p>
          ) : null}

          {preview && headers.length > 0 ? (
            <section className="flex flex-col gap-2" aria-label={t("clients.import.mapping")}>
              <h3 className="text-[13.5px] font-medium text-grid-fg">{t("clients.import.mapping")}</h3>
              <p className="text-[12.5px] text-grid-muted">
                {preview.header_row > 0 ? t("clients.import.headerRow", { n: number(preview.header_row) }) : t("clients.import.noHeader")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {headers.map((h) => (
                  <label key={h} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate" title={h} dir="auto">
                      {h}
                    </span>
                    <select value={preview.mapping?.[h] || IGNORE} onChange={(e) => remap(h, e.target.value)} className={cn(fieldClass, "w-36")} data-map-header={h}>
                      <option value={IGNORE}>{t("clients.import.ignore")}</option>
                      {FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {fieldName(f)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {preview ? (
            <section className="flex flex-col gap-2" aria-label={t("clients.import.preview")}>
              <p data-import-counts>
                {t("clients.import.counts", {
                  total: number(preview.counts.total),
                  create: number(preview.counts.create),
                  update: number(preview.counts.update),
                  skip: number(preview.counts.skip),
                  invalid: number(preview.counts.invalid),
                })}
              </p>
              <div className="max-h-80 overflow-auto rounded-md border border-line">
                <div className="sticky top-0 grid h-8 grid-cols-[48px_84px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-3 border-b border-line bg-background px-3 text-[12.5px] text-grid-muted">
                  <span>{t("clients.import.col.row")}</span>
                  <span>{t("clients.import.col.action")}</span>
                  <span>{t("clients.name")}</span>
                  <span>{t("clients.email")}</span>
                  <span>{t("clients.import.col.details")}</span>
                </div>
                {rows.slice(0, SHOWN).map((r) => (
                  <div key={r.row} data-import-row={r.row} data-action={r.action} className="grid min-h-8 grid-cols-[48px_84px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-3 border-b border-line/50 px-3 py-1">
                    <LtrText className="text-grid-muted tabular-nums">{r.row}</LtrText>
                    <span>
                      <span className={cn("rounded px-1.5 py-0.5 text-[12px]", ACTION_TONE[r.action])}>{t(`clients.import.action.${r.action}`)}</span>
                    </span>
                    <span className="truncate" dir="auto">
                      {r.name || "—"}
                    </span>
                    <span className="truncate text-grid-muted">{r.email ? <LtrText>{r.email}</LtrText> : r.phone ? <LtrText>{r.phone}</LtrText> : "—"}</span>
                    <span className="text-[12.5px] text-grid-muted">
                      {r.errors?.map((e, i) => (
                        <span key={i} className="block text-grid-danger">
                          {e.column ? `${fieldName(e.column)}: ` : ""}
                          {e.message}
                        </span>
                      ))}
                      {r.match ? <span className="block">{t("clients.import.matched", { by: fieldName(r.match) })}</span> : null}
                      {r.changes?.length ? <span className="block">{t("clients.import.fills", { fields: r.changes.map(fieldName).join("، ") })}</span> : null}
                      {r.reason ? <span className="block">{r.reason}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
              {rows.length > SHOWN ? <p className="text-[12.5px] text-grid-muted">{t("clients.import.more", { n: number(rows.length - SHOWN) })}</p> : null}
            </section>
          ) : null}
        </div>
        {preview ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
            <Button size="sm" variant="ghost" onClick={reset}>
              {t("clients.import.back")}
            </Button>
            <Button size="sm" onClick={() => void commit()} disabled={!!busy || writes === 0} data-import-commit>
              {busy === "commit" ? <Spinner className="border-primary-foreground border-t-transparent" /> : null}
              {t("clients.import.commit", { n: number(writes) })}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FilePick({ accept, label, name, onFile }: { accept: string; label: string; name: string; onFile: (f: File | undefined) => void }) {
  const { t } = useI18n();
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-line px-3 py-2.5 hover:bg-grid-soft">
      <FileUpIcon className="size-4 text-grid-muted" />
      <span className="flex-1">
        <span className="block font-medium text-grid-fg">{label}</span>
        <span className="block text-[12.5px] text-grid-muted">{name || t("clients.import.choose")}</span>
      </span>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        data-import-file
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}
