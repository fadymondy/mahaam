"use client"

// The report filter bar and the URL-backed filter state shared by the Time and Profitability tabs.
import { useMemo, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FileCodeIcon, FileSpreadsheetIcon, FileTextIcon, FileTypeIcon, LoaderIcon, PrinterIcon, RotateCcwIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@fadymondy/nasaq/web"


import { MultiSelect, type Option } from "@/components/reports/multi-select"
import { ColorDot } from "@/components/work/palette"
import { useDirectory } from "@/components/work/people"
import { DateField } from "@/components/work/fields"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { GROUPS, PRESETS, downloadExport, filterQuery, filtersFrom, presetOf, presetRange, type Filters, type GroupBy, type Preset } from "@/lib/reports"
import { dayIn, useTimeSettings } from "@/lib/time"
import { errorText, useClients, useLabels, useProjects } from "@/lib/work"
import { cn } from "@/lib/utils"

const ROUNDINGS = [-1, 0, 1, 5, 6, 10, 15, 30, 60]

/** Filters from the URL, with the range defaulting to this month (workspace timezone). */
export function useReportFilters() {
  const ws = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const settings = useTimeSettings(ws.id)
  const tz = settings.data?.timezone ?? ws.current?.workspace.timezone ?? "UTC"
  const weekStart = settings.data?.week_start ?? 1
  const today = dayIn(Date.now(), tz)
  const raw = useMemo(() => filtersFrom(new URLSearchParams(params.toString())), [params])
  const filters: Filters = useMemo(() => {
    if (raw.from && raw.to) return raw
    return { ...raw, ...presetRange("this_month", today, weekStart) }
  }, [raw, today, weekStart])

  const set = (next: Partial<Filters>) => {
    const q = filterQuery({ ...filters, ...next })
    router.replace(`${pathname}?${q}`, { scroll: false })
  }
  const reset = () => router.replace(pathname, { scroll: false })
  return { filters, set, reset, ready: !!settings.data, settings: settings.data, tz, weekStart, today, viewId: params.get("view") }
}

function Control({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-eyebrow uppercase">
        {label}
      </label>
      {children}
    </div>
  )
}

export function FilterBar({
  state,
  group = true,
  labels = true,
  billable = true,
  members = true,
}: {
  state: ReturnType<typeof useReportFilters>
  group?: boolean
  labels?: boolean
  billable?: boolean
  members?: boolean
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const { filters: f, set, today, weekStart, settings } = state
  const canAll = ws.can("reports:all")
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const projects = useProjects(ws.id)
  const archived = useProjects(ws.id, true)
  const clients = useClients(ws.id, false, ws.can("clients:read"))
  const labelList = useLabels(ws.id)

  const preset = presetOf(f.from, f.to, today, weekStart)
  const presets = PRESETS.map((p) => ({ value: p, label: t(`reports.preset.${p}`) }))
  const groups = GROUPS.map((g) => ({ value: g, label: t(`reports.group.${g}`) }))
  const billables = (["", "billable", "non_billable"] as const).map((b) => ({ value: b || "all", label: t(`reports.billable.${b || "all"}`) }))
  const wsRounding = settings?.rounding_minutes ?? 0
  const roundLabel = (n: number) => (n === 0 ? t("reports.rounding.none") : t("reports.rounding.minutes", { n }))
  const roundings = ROUNDINGS.map((n) => ({ value: String(n), label: n < 0 ? t("reports.rounding.default", { n: roundLabel(wsRounding) }) : roundLabel(n) }))

  const projectOptions: Option[] = [...(projects.data?.projects ?? []), ...(archived.data?.projects ?? [])]
    .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i)
    .map((p) => ({ value: p.id, label: p.name, icon: <ColorDot color={p.color} /> }))
  const clientOptions: Option[] = (clients.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name }))
  const labelOptions: Option[] = (labelList.data?.labels ?? []).map((l) => ({ value: l.id, label: l.name, icon: <ColorDot color={l.color} square /> }))
  const memberOptions: Option[] = dir.members.map((m) => ({ value: m.user_id, label: m.email, ltr: true }))

  return (
    <section
      aria-label={t("reports.filters")}
      className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-card border border-border bg-card p-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      data-print-hide
      data-filter-bar
    >
      <Control label={t("reports.range")} htmlFor="rf-preset">
        <Select
          items={presets}
          value={preset}
          onValueChange={(v) => {
            if (!v || v === "custom") return
            set(presetRange(v as Exclude<Preset, "custom">, today, weekStart))
          }}
        >
          <SelectTrigger id="rf-preset" className="w-full" data-range-preset={preset}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((p) => (
              <SelectItem key={p.value} value={p.value} disabled={p.value === "custom"}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Control>
      <Control label={t("reports.from")} htmlFor="rf-from">
        <DateField id="rf-from" value={f.from ?? null} onChange={(v) => v && set({ from: v, ...(f.to && v > f.to ? { to: v } : {}) })} />
      </Control>
      <Control label={t("reports.to")} htmlFor="rf-to">
        <DateField id="rf-to" value={f.to ?? null} onChange={(v) => v && set({ to: v, ...(f.from && v < f.from ? { from: v } : {}) })} />
      </Control>
      {group ? (
        <Control label={t("reports.groupBy")} htmlFor="rf-group">
          <Select items={groups} value={f.group_by ?? "project"} onValueChange={(v) => v && set({ group_by: v as GroupBy })}>
            <SelectTrigger id="rf-group" className="w-full" data-group-by={f.group_by}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.value} value={g.value} data-group-option={g.value}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
      ) : null}
      <MultiSelect id="rf-projects" label={t("reports.projects")} options={projectOptions} value={f.projects ?? []} onChange={(v) => set({ projects: v })} />
      {ws.can("clients:read") ? (
        <MultiSelect id="rf-clients" label={t("reports.clients")} options={clientOptions} value={f.clients ?? []} onChange={(v) => set({ clients: v })} />
      ) : null}
      {labels ? <MultiSelect id="rf-labels" label={t("reports.labels")} options={labelOptions} value={f.labels ?? []} onChange={(v) => set({ labels: v })} /> : null}
      {members && canAll && dir.members.length ? (
        <MultiSelect id="rf-members" label={t("reports.members")} options={memberOptions} value={f.users ?? []} onChange={(v) => set({ users: v })} />
      ) : null}
      {billable ? (
        <Control label={t("reports.billableFilter")} htmlFor="rf-billable">
          <Select items={billables} value={f.billable || "all"} onValueChange={(v) => set({ billable: v === "all" || !v ? "" : (v as Filters["billable"]) })}>
            <SelectTrigger id="rf-billable" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {billables.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
      ) : null}
      <Control label={t("reports.rounding")} htmlFor="rf-round">
        <Select items={roundings} value={String(f.rounding ?? -1)} onValueChange={(v) => set({ rounding: v == null || Number(v) < 0 ? null : Number(v) })}>
          <SelectTrigger id="rf-round" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roundings.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Control>
    </section>
  )
}

export function ResetButton({ onReset }: { onReset: () => void }) {
  const { t } = useTranslations()
  return (
    <Button variant="ghost" onClick={onReset} data-reset-filters>
      <RotateCcwIcon />
      {t("reports.reset")}
    </Button>
  )
}

/** CSV, XLSX, PDF and Markdown of the current table. `query` is the full export query minus format. */
export function ExportButtons({ query, label, id }: { query: string; label?: string; id?: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState<string | null>(null)
  async function run(format: ExportFormat) {
    setBusy(format)
    try {
      const name = await downloadExport(ws.id, `${query}&format=${format}`)
      toast.success(t("reports.exported", { name }))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label ? `${t("reports.export")} · ${label}` : t("reports.export")}>
      {label ? <span className="me-1 text-caption text-muted-foreground">{label}</span> : null}
      {EXPORT_FORMATS.map((f) => {
        const Icon = EXPORT_ICONS[f]
        return (
          <Button key={f} variant="secondary" disabled={!!busy} onClick={() => run(f)} data-export={f} data-export-id={id}>
            {busy === f ? <LoaderIcon className="animate-spin" /> : <Icon />}
            {t(EXPORT_LABELS[f])}
          </Button>
        )
      })}
    </div>
  )
}

type ExportFormat = "csv" | "xlsx" | "pdf" | "md"
const EXPORT_FORMATS: ExportFormat[] = ["csv", "xlsx", "pdf", "md"]
const EXPORT_ICONS = { csv: FileTextIcon, xlsx: FileSpreadsheetIcon, pdf: FileTypeIcon, md: FileCodeIcon } as const
const EXPORT_LABELS = { csv: "reports.exportCsv", xlsx: "reports.exportXlsx", pdf: "reports.exportPdf", md: "reports.exportMd" } as const

export function PrintButton() {
  const { t } = useTranslations()
  return (
    <Button variant="secondary" onClick={() => window.print()} data-print>
      <PrinterIcon />
      {t("reports.print")}
    </Button>
  )
}

/** Shown only on paper: what the report covers. */
export function PrintHeader({ title, meta }: { title: string; meta: string }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const now = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(new Date())
  return (
    <div className="hidden print:block" data-print-only data-print-header>
      <p className="text-caption">{ws.summary.name}</p>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm">{meta}</p>
      <p className="text-caption">{t("reports.printedAt", { date: now })}</p>
    </div>
  )
}
