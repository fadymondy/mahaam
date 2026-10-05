"use client"

import { useMemo, useState } from "react"
import {
  ActivityIcon,
  BotIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  MessageSquareIcon,
  PlusIcon,
  RotateCcwIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import useSWR from "swr"

import { api } from "@/lib/api"
import { Badge, Button, Field, FieldLabel, Input, Tabs, TabsList, TabsPanel, TabsTab } from "@fadymondy/nasaq/web"





import { ConfirmButton } from "@/components/confirm-button"
import { BrandLogo, LogoTile, STACK_BRAND } from "@/components/work/brand-logos"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { errorText, w } from "@/lib/work"

/*
The project-settings "Client access & SDKs" section (P7). Two distinct products live
here and the UI must keep them apart:

  - Feedback  — the *frontend* browser widget. Public key `pfk_…`, safe in client-side
                code; reports what a human chose to report.
  - Mahaam SDK — *backend* error monitoring, Sentry-shaped. Keyed by a DSN
                (`https://mdsn_…@host/monitor/<project>`); reports crashes from the
                server, no UI. The DSN is a server-side credential.

Plus portal contacts (the client's login to the portal). Manager+ only; the endpoints
enforce it too. Every string goes through work.{en,ar}.json under the `sdk.*` namespace.
*/

type FeedbackKey = {
  id: string
  project_id: string
  name: string
  public_key: string
  active: boolean
  allowed_origins: string[]
  widget: WidgetLook
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

type MonitorKey = {
  id: string
  project_id: string
  name: string
  public_key: string
  dsn: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

type WidgetLook = {
  color?: string
  text_color?: string
  icon?: string
  text?: string
  shape?: string
  position?: string
  theme?: string
  locale?: string
}

type Contact = { id: string; client_id: string; user_id: string; email: string | null; created_at: string }

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>
type Copy = (text: string, label: string) => void

export function FeedbackWidgetSection({
  projectId,
  clientId,
}: {
  projectId: string
  clientId: string | null
}) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const canManage = ws.can("feedback_keys:manage")

  const keys = useSWR<{ keys: FeedbackKey[] | null }>(
    [`/api/w/projects/${projectId}/feedback-keys`, ws.id],
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )
  const monitorKeys = useSWR<{ keys: MonitorKey[] | null }>(
    [`/api/w/projects/${projectId}/monitor-keys`, ws.id],
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )
  const contacts = useSWR<{ contacts: Contact[] | null }>(
    clientId ? [`/api/w/clients/${clientId}/contacts`, ws.id] : null,
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )

  const [busy, setBusy] = useState(false)
  const run: Run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(errorText(err, t("sdk.error.generic")))
    } finally {
      setBusy(false)
    }
  }

  const copy: Copy = (text, label) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(t("sdk.copied", { label })),
      () => toast.error(t("common.copyFailed")),
    )
  }

  return (
    <section className="overflow-hidden rounded-card bg-card">
      <div className="px-6 pt-5 pb-3">
        <h2 className="text-h3">{t("sdk.section.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("sdk.section.desc")}</p>
      </div>

      <div className="grid gap-4 px-6 pb-6">
        <ProductCard icon={UsersIcon} title={t("sdk.contacts.title")} data="contacts">
          {!clientId ? (
            <p className="text-sm text-muted-foreground">{t("sdk.contacts.needClient")}</p>
          ) : (
            <ContactManager
              clientId={clientId}
              contacts={contacts.data?.contacts ?? []}
              canManage={canManage}
              busy={busy}
              onChange={() => contacts.mutate()}
              run={run}
            />
          )}
        </ProductCard>

        <ProductCard
          icon={MessageSquareIcon}
          badge={t("sdk.feedback.badge")}
          title={t("sdk.feedback.title")}
          desc={t("sdk.feedback.desc")}
          stacks={FEEDBACK_STACKS}
          data="feedback"
        >
          <KeyManager
            projectId={projectId}
            keys={keys.data?.keys ?? []}
            canManage={canManage}
            busy={busy}
            onChange={() => keys.mutate()}
            run={run}
            copy={copy}
          />
        </ProductCard>

        <ProductCard
          icon={ActivityIcon}
          badge={t("sdk.monitor.badge")}
          title={t("sdk.monitor.title")}
          desc={t("sdk.monitor.desc")}
          stacks={MONITOR_STACKS}
          tone="monitor"
          data="monitor"
        >
          <MonitorKeyManager
            projectId={projectId}
            keys={monitorKeys.data?.keys ?? []}
            canManage={canManage}
            busy={busy}
            onChange={() => monitorKeys.mutate()}
            run={run}
            copy={copy}
          />
        </ProductCard>
      </div>
    </section>
  )
}

// Portal contacts and the two products each get a card: an icon tile, a badge that says where the
// code runs (browser vs server), one line on what it reports and the logos of the stacks it installs on.
function ProductCard({
  icon: Icon,
  badge,
  title,
  desc,
  stacks,
  tone = "feedback",
  data,
  children,
}: {
  icon: LucideIcon
  badge?: string
  title: string
  desc?: string
  stacks?: string[]
  tone?: "feedback" | "monitor"
  data: string
  children: React.ReactNode
}) {
  const { t } = useTranslations()
  const brands = (stacks ?? []).flatMap((s) => {
    const b = STACK_BRAND[s]
    return b ? [{ stack: s, brand: b }] : []
  })
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-card bg-muted/40 p-4" data-sdk={data}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            tone === "monitor" ? "bg-nq-danger/10 text-nq-danger-text" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{title}</h3>
            {badge ? <Badge variant={tone === "monitor" ? "outline" : "neutral"}>{badge}</Badge> : null}
          </div>
          {desc ? <p className="mt-1 text-caption text-muted-foreground">{desc}</p> : null}
          {brands.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("sdk.install.label")}>
              {brands.map(({ stack, brand }) => (
                <li key={stack} title={t(`sdk.stack.${stack}`)}>
                  <LogoTile brand={brand} className="size-7 rounded-md" logoClassName="size-4" />
                  <span className="sr-only">{t(`sdk.stack.${stack}`)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  )
}

function ContactManager({
  clientId,
  contacts,
  canManage,
  busy,
  onChange,
  run,
}: {
  clientId: string
  contacts: Contact[]
  canManage: boolean
  busy: boolean
  onChange: () => void
  run: Run
}) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const [email, setEmail] = useState("")
  return (
    <div className="space-y-2">
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sdk.contacts.empty")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-border">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-sm">{c.email ?? c.user_id}</span>
              {canManage ? (
                <ConfirmButton
                  label={t("common.remove")}
                  title={t("sdk.contacts.removeTitle")}
                  description={t("sdk.contacts.removeDesc")}
                  confirmLabel={t("common.remove")}
                  onConfirm={() =>
                    run(
                      () => w.del(ws.id, `/api/w/clients/${clientId}/contacts/${encodeURIComponent(c.user_id)}`),
                      t("sdk.contacts.removed"),
                    ).then(onChange)
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const value = email.trim()
            if (!value) return
            run(
              () => w.put(ws.id, `/api/w/clients/${clientId}/contacts/${encodeURIComponent(value)}`),
              t("sdk.contacts.shared"),
            ).then(() => {
              setEmail("")
              onChange()
            })
          }}
        >
          <Field className="flex-1">
            <FieldLabel>{t("sdk.contacts.addLabel")}</FieldLabel>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("sdk.contacts.addPlaceholder")}
            />
          </Field>
          <Button variant="primary" type="submit" disabled={busy || !email.trim()}>
            <PlusIcon /> {t("common.add")}
          </Button>
        </form>
      ) : null}
    </div>
  )
}

function KeyManager({
  projectId,
  keys,
  canManage,
  busy,
  onChange,
  run,
  copy,
}: {
  projectId: string
  keys: FeedbackKey[]
  canManage: boolean
  busy: boolean
  onChange: () => void
  run: Run
  copy: Copy
}) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return (
    <div className="space-y-3">
      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sdk.feedback.empty")}</p>
      ) : (
        keys.map((k) => (
          <KeyRow
            key={k.id}
            k={k}
            origin={origin}
            canManage={canManage}
            busy={busy}
            run={run}
            onChange={onChange}
            copy={copy}
          />
        ))
      )}
      {canManage ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                w.post(ws.id, `/api/w/projects/${projectId}/feedback-keys`, {
                  name: t("sdk.feedback.defaultName"),
                  allowed_origins: [],
                }),
              t("sdk.feedback.minted"),
            ).then(onChange)
          }
        >
          <PlusIcon /> {t("sdk.feedback.mint")}
        </Button>
      ) : null}
    </div>
  )
}

function KeyRow({
  k,
  origin,
  canManage,
  busy,
  run,
  onChange,
  copy,
}: {
  k: FeedbackKey
  origin: string
  canManage: boolean
  busy: boolean
  run: Run
  onChange: () => void
  copy: Copy
}) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const [origins, setOrigins] = useState(k.allowed_origins.join("\n"))
  const snippet = useMemo(
    () => `<script src="${origin}/embed/v1.js" data-key="${k.public_key}" defer></script>`,
    [origin, k.public_key],
  )
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <code className="truncate text-xs font-mono" dir="ltr" aria-label={t("sdk.feedback.publicKeyAria")}>
            {k.public_key}
          </code>
          <Badge variant={k.active ? "success" : "neutral"}>
            {k.active ? t("sdk.feedback.statusActive") : t("sdk.feedback.statusRevoked")}
          </Badge>
        </div>
        {canManage && k.active ? (
          <ConfirmButton
            label={
              <>
                <RotateCcwIcon /> {t("common.revoke")}
              </>
            }
            title={t("sdk.feedback.revokeTitle")}
            description={t("sdk.feedback.revokeDesc")}
            confirmLabel={t("common.revoke")}
            onConfirm={() =>
              run(() => w.post(ws.id, `/api/w/feedback-keys/${k.id}/revoke`), t("sdk.feedback.revoked")).then(onChange)
            }
          />
        ) : null}
      </div>
      <p className="text-caption text-muted-foreground">{t("sdk.feedback.publicSafe")}</p>

      <Field>
        <FieldLabel>{t("sdk.feedback.originsLabel")}</FieldLabel>
        <textarea
          className="min-h-[64px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          dir="ltr"
          value={origins}
          disabled={!canManage || busy}
          onChange={(e) => setOrigins(e.target.value)}
          placeholder={t("sdk.feedback.originsPlaceholder")}
          aria-label={t("sdk.feedback.originsLabel")}
        />
      </Field>
      {canManage ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                w.patch(ws.id, `/api/w/feedback-keys/${k.id}`, {
                  allowed_origins: origins
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }),
              t("sdk.feedback.originsSaved"),
            ).then(onChange)
          }
        >
          {t("sdk.feedback.saveOrigins")}
        </Button>
      ) : null}

      <Field>
        <FieldLabel>{t("sdk.feedback.snippet")}</FieldLabel>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-nq-fg-muted/10 px-2 py-1 text-xs" dir="ltr">
            {snippet}
          </code>
          <Button size="sm" variant="ghost" onClick={() => copy(snippet, t("sdk.feedback.snippetLabel"))}>
            <CopyIcon /> {t("common.copy")}
          </Button>
        </div>
      </Field>
      {k.active && canManage ? <WidgetLookEditor k={k} busy={busy} run={run} onChange={onChange} /> : null}
      {k.active ? (
        <InstallGuides
          path={`/api/w/projects/${k.project_id}/feedback-install?key=${encodeURIComponent(k.id)}`}
          stacks={FEEDBACK_STACKS}
          copy={copy}
          mcpHint={"get_feedback_install { project, stack }"}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ monitoring */

function MonitorKeyManager({
  projectId,
  keys,
  canManage,
  busy,
  onChange,
  run,
  copy,
}: {
  projectId: string
  keys: MonitorKey[]
  canManage: boolean
  busy: boolean
  onChange: () => void
  run: Run
  copy: Copy
}) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  return (
    <div className="space-y-3">
      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("sdk.monitor.empty")}</p>
      ) : (
        keys.map((k) => (
          <MonitorKeyRow
            key={k.id}
            k={k}
            projectId={projectId}
            canManage={canManage}
            busy={busy}
            run={run}
            onChange={onChange}
            copy={copy}
          />
        ))
      )}
      {canManage ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                w.post(ws.id, `/api/w/projects/${projectId}/monitor-keys`, { name: t("sdk.monitor.defaultName") }),
              t("sdk.monitor.created"),
            ).then(onChange)
          }
        >
          <PlusIcon /> {t("sdk.monitor.create")}
        </Button>
      ) : null}
    </div>
  )
}

// A monitor key is live while revoked_at is null (there is no `active` flag here).
function MonitorKeyRow({
  k,
  projectId,
  canManage,
  busy,
  run,
  onChange,
  copy,
}: {
  k: MonitorKey
  projectId: string
  canManage: boolean
  busy: boolean
  run: Run
  onChange: () => void
  copy: Copy
}) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const [shown, setShown] = useState(false)
  const live = k.revoked_at === null
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate text-sm">{k.name}</span>
          <Badge variant={live ? "success" : "neutral"}>
            {live ? t("sdk.monitor.statusLive") : t("sdk.monitor.statusRevoked")}
          </Badge>
        </div>
        {canManage && live ? (
          <ConfirmButton
            label={
              <>
                <RotateCcwIcon /> {t("common.revoke")}
              </>
            }
            title={t("sdk.monitor.revokeTitle")}
            description={t("sdk.monitor.revokeDesc")}
            confirmLabel={t("common.revoke")}
            onConfirm={() =>
              run(
                () => w.del(ws.id, `/api/w/projects/${projectId}/monitor-keys/${encodeURIComponent(k.id)}`),
                t("sdk.monitor.revoked"),
              ).then(onChange)
            }
          />
        ) : null}
      </div>

      <Field>
        <FieldLabel>{t("sdk.monitor.dsnLabel")}</FieldLabel>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-nq-fg-muted/10 px-2 py-1 text-xs font-mono" dir="ltr">
            {shown ? k.dsn : t("sdk.monitor.dsnHidden")}
          </code>
          <Button
            size="sm"
            variant="ghost"
            aria-label={shown ? t("sdk.monitor.hide") : t("sdk.monitor.show")}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeOffIcon /> : <EyeIcon />} {shown ? t("sdk.monitor.hide") : t("sdk.monitor.show")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => copy(k.dsn, t("sdk.monitor.dsnLabel"))}>
            <CopyIcon /> {t("common.copy")}
          </Button>
        </div>
      </Field>
      <p className="text-caption text-nq-danger-text">{t("sdk.monitor.secret")}</p>

      {live ? (
        <InstallGuides
          path={`/api/w/projects/${projectId}/monitor-install?key=${encodeURIComponent(k.id)}`}
          stacks={MONITOR_STACKS}
          copy={copy}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------- launcher */

const ICONS = ["bug", "message", "help", "lightbulb", "megaphone", "sparkles", "none"]
const SHAPES = ["pill", "circle", "square", "tab"]
const POSITIONS = ["bottom-end", "bottom-start", "top-end", "top-start", "middle-end", "middle-start"]
const THEMES = ["auto", "light", "dark"]
const LOCALES = ["auto", "en", "ar"]

// Option values are stored verbatim (bottom-end, …) but shown translated.
const optionKey = (group: string, value: string) =>
  `sdk.look.${group}.${value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`

// How this key's launcher looks on the customer's site (GET /api/feedback/embed/config).
// Visitors can still drag it, dock it to the edge or hide it from its right-click menu.
function WidgetLookEditor({
  k,
  busy,
  run,
  onChange,
}: {
  k: FeedbackKey
  busy: boolean
  run: Run
  onChange: () => void
}) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const [look, setLook] = useState<WidgetLook>(k.widget ?? {})
  const set = (f: keyof WidgetLook, v: string) => setLook((l) => ({ ...l, [f]: v === "default" ? undefined : v }))
  const sel = (f: keyof WidgetLook, label: string, group: string, options: string[]) => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <select
        className="h-8 w-full rounded-lg border border-border bg-transparent px-2 text-sm"
        value={look[f] ?? "default"}
        disabled={busy}
        aria-label={label}
        onChange={(e) => set(f, e.target.value)}
      >
        <option value="default">{t("sdk.look.default")}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {t(optionKey(group, o))}
          </option>
        ))}
      </select>
    </Field>
  )
  const bg = look.color || "#8c3fb5"
  const fg = look.text_color || "#f0ebe1"
  const iconOnly = look.shape === "circle" || look.shape === "square"
  return (
    <Field>
      <FieldLabel>{t("sdk.look.title")}</FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>{t("sdk.look.text")}</FieldLabel>
          <Input
            maxLength={40}
            value={look.text ?? ""}
            placeholder={t("sdk.look.textPlaceholder")}
            disabled={busy}
            onChange={(e) => set("text", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>{t("sdk.look.color")}</FieldLabel>
            <input
              type="color"
              className="h-8 w-full cursor-pointer rounded-lg border border-border bg-transparent"
              value={bg}
              disabled={busy}
              aria-label={t("sdk.look.color")}
              onChange={(e) => set("color", e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{t("sdk.look.textColor")}</FieldLabel>
            <input
              type="color"
              className="h-8 w-full cursor-pointer rounded-lg border border-border bg-transparent"
              value={fg}
              disabled={busy}
              aria-label={t("sdk.look.textColor")}
              onChange={(e) => set("text_color", e.target.value)}
            />
          </Field>
        </div>
        {sel("icon", t("sdk.look.icon"), "icon", ICONS)}
        {sel("shape", t("sdk.look.shape"), "shape", SHAPES)}
        {sel("position", t("sdk.look.position"), "position", POSITIONS)}
        <div className="grid grid-cols-2 gap-3">
          {sel("theme", t("sdk.look.theme"), "theme", THEMES)}
          {sel("locale", t("sdk.look.language"), "locale", LOCALES)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className={
            "inline-flex h-10 items-center gap-2 px-4 text-sm font-medium shadow-md " +
            (iconOnly ? "w-12 justify-center px-0 " : "") +
            (look.shape === "square" ? "rounded-xl" : "rounded-full")
          }
          style={{ background: bg, color: fg }}
        >
          {look.icon === "none" ? null : <span className="text-xs">●</span>}
          {iconOnly ? null : look.text || t("sdk.look.textPlaceholder")}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            run(() => w.patch(ws.id, `/api/w/feedback-keys/${k.id}`, { widget: look }), t("sdk.look.saved")).then(
              onChange,
            )
          }
        >
          {t("sdk.look.save")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLook({})}>
          {t("sdk.look.reset")}
        </Button>
      </div>
    </Field>
  )
}

/* --------------------------------------------------------------------- guides */

// Must match internal/work/feedback_install.go FeedbackStacks (frontend only now —
// the server-side feedback packages were retired) and monitor_install.go MonitorStacks.
const FEEDBACK_STACKS = ["agent", "html", "react", "next", "vue"]
const MONITOR_STACKS = ["agent", "go", "node", "python", "php", "react-native", "flutter", "kotlin", "swift"]

// One tab per stack; "AI agent" is a complete prompt to paste into a coding agent in
// the target repo. Serves both /feedback-install and /monitor-install — same shape.
function InstallGuides({
  path,
  stacks,
  copy,
  mcpHint,
}: {
  path: string
  stacks: string[]
  copy: Copy
  mcpHint?: string
}) {
  const ws = useWorkspace()
  const { t } = useTranslations()
  const { data } = useSWR<{ guides: Record<string, string> }>(
    [path, ws.id],
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  )
  if (!data?.guides) return null
  const available = stacks.filter((s) => data.guides[s])
  if (available.length === 0) return null
  const label = (s: string) => t(`sdk.stack.${s}`)
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>{t("sdk.install.label")}</FieldLabel>
        {data.guides.agent ? (
          <Button size="sm" variant="secondary" onClick={() => copy(data.guides.agent, t("sdk.install.agentLabel"))}>
            <BotIcon /> {t("sdk.install.copyAgent")}
          </Button>
        ) : null}
      </div>
      <Tabs defaultValue={available[0]}>
        <TabsList className="flex-wrap">
          {available.map((s) => (
            <TabsTab key={s} value={s} className="gap-1.5">
              {STACK_BRAND[s] ? <BrandLogo brand={STACK_BRAND[s]} className="size-4" /> : <BotIcon className="size-4" aria-hidden />}
              {label(s)}
            </TabsTab>
          ))}
        </TabsList>
        {available.map((s) => (
          <TabsPanel key={s} value={s} className="relative">
            <pre
              dir="ltr"
              className="max-h-72 overflow-auto rounded-md border border-border bg-nq-fg-muted/10 p-3 pe-20 font-mono text-xs whitespace-pre-wrap"
            >
              {data.guides[s]}
            </pre>
            <Button
              size="sm"
              variant="ghost"
              className="absolute top-1.5 end-1.5"
              aria-label={t("common.copy")}
              onClick={() => copy(data.guides[s], label(s))}
            >
              <CopyIcon /> {t("common.copy")}
            </Button>
          </TabsPanel>
        ))}
      </Tabs>
      {mcpHint ? (
        <p className="text-caption text-muted-foreground">
          {t("sdk.install.mcpHint")} <code dir="ltr">{mcpHint}</code>
        </p>
      ) : null}
    </Field>
  )
}
