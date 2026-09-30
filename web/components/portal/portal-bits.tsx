"use client"

// Shared pieces of the customer portal (roadmap 5): the progress bar, request state badge, the
// weekly-hours chart (the registry's shadcn chart, like the reports page) and the request dialog.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { toast } from "@fadymondy/nasaq/web"

import { Badge, Button, type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@fadymondy/nasaq/web"








import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { REQUEST_KINDS, hours, portalApi, type PortalWeek, type RequestState } from "@/lib/portal"
import { cn } from "@/lib/utils"
import { errorText } from "@/lib/work"

/** A labelled progress bar; value 0–100. `warn` paints it in the danger colour (over budget). */
export function Meter({ value, label, warn }: { value: number; label?: string; warn?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className={cn("h-full rounded-full transition-[width]", warn ? "bg-destructive" : "bg-primary")} style={{ width: `${v}%` }} />
    </div>
  )
}

export function RequestStateBadge({ state }: { state: RequestState }) {
  const { t } = useTranslations()
  const variant = state === "declined" ? "danger" : state === "pending" ? "outline" : "success"
  return (
    <Badge variant={variant} data-request-state={state}>
      {t(`portal.request.state.${state}`)}
    </Badge>
  )
}

export function WeeksChart({ weeks }: { weeks: PortalWeek[] }) {
  const { t, locale, isRtl } = useTranslations()
  const config = { hours: { label: t("portal.budget"), color: "var(--nq-action)" } } satisfies ChartConfig
  const data = weeks.map((w) => ({ week: w.week, hours: hours(w.minutes) }))
  return (
    <ChartContainer config={config} className="aspect-auto h-48 w-full" role="img" aria-label={t("portal.hoursByWeek")}>
      <BarChart data={data} margin={{ top: 8, left: 4, right: 4, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="week"
          reversed={isRtl}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={8}
          tickFormatter={(d: string) => formatDay(d, locale, "short")}
        />
        <YAxis orientation={isRtl ? "right" : "left"} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => (label ? formatDay(String(label), locale) : "")}
            />
          }
        />
        <Bar dataKey="hours" fill="var(--color-hours)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

/** The customer's "New request" dialog: project, kind, summary, details, wanted-by date, image. */
export function NewRequestDialog({
  projects,
  defaultProject,
  onClose,
  onFiled,
}: {
  projects: { id: string; name: string }[]
  defaultProject?: string
  onClose: () => void
  onFiled: () => void
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [projectId, setProjectId] = useState(defaultProject ?? projects[0]?.id ?? "")
  const [kind, setKind] = useState<string>("feature")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [desired, setDesired] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim() || !projectId) return
    setBusy(true)
    try {
      const form = new FormData()
      form.set("project_id", projectId)
      form.set("kind", kind)
      form.set("title", title.trim())
      form.set("body", body.trim())
      if (desired) form.set("desired_on", desired)
      if (file) form.set("screenshot", file, file.name)
      await portalApi.fileRequest(ws.id, form)
      toast.success(t("portal.request.filed"))
      onFiled()
    } catch (err) {
      toast.error(errorText(err, t("portal.request.failed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("portal.newRequest")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {projects.length > 1 || !defaultProject ? (
            <Field>
              <FieldLabel>{t("portal.request.project")}</FieldLabel>
              <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue>{projects.find((p) => p.id === projectId)?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel>{t("portal.request.kind")}</FieldLabel>
            <Select value={kind} onValueChange={(v) => setKind(v ?? "feature")}>
              <SelectTrigger>
                <SelectValue>{t(`portal.request.kind.${kind}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUEST_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`portal.request.kind.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>{t("portal.request.title")}</FieldLabel>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </Field>
          <Field>
            <FieldLabel>{t("portal.request.details")}</FieldLabel>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-24" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("portal.request.desired")}</FieldLabel>
              <Input type="date" dir="ltr" value={desired} onChange={(e) => setDesired(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>{t("portal.request.attachment")}</FieldLabel>
              <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("portal.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !title.trim() || !projectId}>
            {busy ? t("portal.sending") : t("portal.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A one-field confirm dialog (decline reason, accept note). */
export function PromptDialog({
  title,
  hint,
  label,
  required,
  confirm,
  destructive,
  children,
  onClose,
  onConfirm,
}: {
  title: string
  hint?: string
  label: string
  required?: boolean
  confirm: string
  destructive?: boolean
  children?: React.ReactNode
  onClose: () => void
  onConfirm: (text: string) => Promise<void>
}) {
  const { t } = useTranslations()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {hint ? <DialogDescription>{hint}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4">
          {children}
          <Field>
            <FieldLabel>{label}</FieldLabel>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-20" maxLength={2000} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("portal.cancel")}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            disabled={busy || (required && !text.trim())}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm(text.trim())
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A horizontal tab bar that scrolls sideways on small screens and follows the text direction (the
 * owner saw the old tabs as a tall vertical box beside the content in RTL). Buttons with
 * role=tab; the active one is scrolled into view.
 */
export function ScrollTabs({
  value,
  onChange,
  items,
  label,
}: {
  value: string
  onChange: (v: string) => void
  items: { value: string; label: string; count?: number; icon?: ReactNode }[]
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [value])
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      className="-mx-4 flex w-auto snap-x gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      data-scroll-tabs
    >
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-tab={it.value}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative inline-flex shrink-0 snap-start items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-nq-action",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {it.icon}
            {it.label}
            {it.count !== undefined ? (
              <span
                className={cn(
                  "min-w-5 rounded-full px-1.5 text-center text-xs leading-5 tabular-nums",
                  active ? "bg-nq-action text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {it.count}
              </span>
            ) : null}
            <span aria-hidden className={cn("absolute inset-x-2 -bottom-px h-0.5 rounded-full", active ? "bg-nq-action" : "bg-transparent")} />
          </button>
        )
      })}
    </div>
  )
}

/** An image behind the session + X-Workspace-ID (issue / request screenshots), shown from a blob URL. */
export function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const ws = useWorkspace()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    let made: string | null = null
    fetch(src, { headers: { "X-Workspace-ID": ws.id }, credentials: "same-origin" })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((b) => {
        if (gone) return
        made = URL.createObjectURL(b)
        setUrl(made)
      })
      .catch(() => undefined)
    return () => {
      gone = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [src, ws.id])
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="mt-2 block w-fit">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className={cn("max-h-80 w-auto rounded-md border border-border", className)} />
    </a>
  )
}

/** Initials in a brand-tinted circle (the portal never has avatars or ids of staff — names only). */
export function PersonBadge({ name, initials, size = "md", ring }: { name: string; initials: string; size?: "sm" | "md"; ring?: boolean }) {
  return (
    <span
      title={name}
      aria-label={name}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-nq-action/15 font-semibold text-nq-accent-text",
        size === "sm" ? "size-6 text-xs" : "size-8 text-xs",
        ring && "ring-2 ring-background",
      )}
    >
      {initials}
    </span>
  )
}

/** A progress ring (0–100) with the value in the middle. */
export function ProgressRing({ value, size = 64, label }: { value: number; size?: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)))
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${v}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * v) / 100}
          className="stroke-nq-action transition-[stroke-dashoffset]"
        />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums" dir="ltr">
        {v}%
      </span>
    </span>
  )
}

/** A stat tile: label, big value, optional footer. */
export function StatTile({ label, value, children, icon }: { label: string; value: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {children}
    </div>
  )
}

/** A friendly empty state for a portal section. */
export function PortalEmpty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-nq-action/10 text-nq-accent-text [&_svg]:size-5">{icon}</span>
      <p className="font-medium">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  )
}
