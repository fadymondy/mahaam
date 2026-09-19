"use client"

// One issue, inside its project (/w/{slug}/projects/{id}/issues/{key}). The same item is the
// project's card (same key): planning, checklist and time live on its task page.

// The issue's own agent strategy, read by the /issues loop (fadymondy's issue-agent-settings).
const DEFAULT = "__default"
const AI_MODELS = ["opus", "sonnet", "haiku", "fable"]
const AI_EFFORTS = ["low", "medium", "high", "xhigh", "max"]

import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { BotIcon, ChevronLeftIcon, ExternalLinkIcon, PencilIcon, SendIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Ltr } from "@/components/copy-field"
import { NotFoundState } from "@/components/not-found-state"
import { ErrorState, LoadingRows } from "@/components/states"
import { PersonAvatar, useDirectory } from "@/components/work/people"
import { AuthorKindBadge, HumanOnlyMark, IssuePriorityMark, IssueTypeIcon, agentTime } from "@/components/work/issues/issue-bits"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { formatDay, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  errorText,
  issuesApi,
  useIssue,
  useProjects,
  type IssueComment,
  type IssueDetail,
  type IssuePatch,
} from "@/lib/work"

export function IssueDetailView({ issueKey: key, back, backLabel }: { issueKey: string; back: string; backLabel: string }) {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const issue = useIssue(ws.id, key)
  const i = issue.data
  const canWrite = ws.can("feedback:write")
  useDocumentTitle(`${i ? `${i.key} · ${i.title}` : t("issues.title")} · ${ws.summary.name}`)

  if (issue.error) {
    return issue.error instanceof ApiError && issue.error.status === 404 ? (
      <NotFoundState title={t("issues.notFound")} body={t("issues.notFoundBody")} backHref={back} backLabel={backLabel} />
    ) : (
      <ErrorState error={issue.error} />
    )
  }
  if (!i) return <LoadingRows rows={5} />

  // One save path for every field: PATCH, then take the server's copy.
  const save = async (patch: IssuePatch) => {
    try {
      const next = await issuesApi.patch(ws.id, i.key, patch)
      await issue.mutate(next, { revalidate: false })
      return true
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      return false
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 px-6 pt-5 text-xs text-grid-muted">
        <Link href={back} className="inline-flex items-center gap-1 hover:text-grid-fg">
          <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
          {backLabel}
        </Link>
        <span aria-hidden>/</span>
        <IssueTypeIcon type={i.issue_type} />
        <Ltr mono>{i.key}</Ltr>
        {i.human_only ? <HumanOnlyMark className="ms-1" /> : null}
        {i.project_id && ws.can("tasks:read") ? (
          <Link
            href={`/${locale}/w/${ws.slug}/projects/${i.project_id}/board?task=${encodeURIComponent(i.key)}`}
            className="ms-auto inline-flex items-center gap-1 text-grid-action hover:underline"
          >
            <ExternalLinkIcon className="size-3.5" />
            {t("issues.openOnBoard")}
          </Link>
        ) : null}
      </div>

      {i.request_state && ws.can("requests:manage") ? (
        <div className="mx-6 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-grid-action/5 px-3 py-2 text-sm" data-request-banner={i.request_state}>
          <span>{t(`requests.banner.${i.request_state}`)}</span>
          <Link href={`/${locale}/w/${ws.slug}/requests?state=all&key=${i.key}`} className="font-medium text-grid-action hover:underline">
            {t("requests.openRequest")}
          </Link>
        </div>
      ) : null}

      <TitleEditor issue={i} canWrite={canWrite} onSave={(title) => save({ title })} />

      <div className="grid gap-px border-y border-line bg-grid-line lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 bg-grid-bg">
          <BodyEditor issue={i} canWrite={canWrite} onSave={(body) => save({ body })} />
          {i.resolution ? (
            <div className="border-b border-line px-6 py-4">
              <p className="grid-micro mb-1">{t("issues.resolution")}</p>
              <p className="text-sm whitespace-pre-wrap text-grid-body" dir="auto">{i.resolution}</p>
            </div>
          ) : null}
          <CommentThread issue={i} onChanged={() => void issue.mutate()} />
        </div>

        <aside className="min-w-0 bg-grid-bg">
          <Fields issue={i} canWrite={canWrite} onSave={save} />
          <ContextPanel issue={i} />
        </aside>
      </div>
    </>
  )
}

function TitleEditor({ issue, canWrite, onSave }: { issue: IssueDetail; canWrite: boolean; onSave: (title: string) => Promise<boolean> }) {
  const { t } = useTranslations()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(issue.title)
  useEffect(() => setValue(issue.title), [issue.title])

  const commit = async () => {
    const v = value.trim()
    if (!v || v === issue.title) {
      setValue(issue.title)
      setEditing(false)
      return
    }
    if (await onSave(v)) setEditing(false)
  }

  return (
    <div className="px-6 pt-3 pb-5">
      {editing ? (
        <Input
          autoFocus
          dir="auto"
          maxLength={300}
          value={value}
          aria-label={t("issues.fieldTitle")}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit()
            if (e.key === "Escape") {
              setValue(issue.title)
              setEditing(false)
            }
          }}
          className="h-auto py-1 text-2xl font-semibold"
        />
      ) : (
        <h1 className="group flex items-start gap-2 text-2xl font-semibold text-grid-fg" dir="auto">
          <span className={cn("min-w-0 break-words", issue.status === "done" && "text-grid-muted")}>{issue.title}</span>
          {canWrite ? (
            <Button variant="ghost" size="icon-sm" className="mt-1 shrink-0 opacity-60 group-hover:opacity-100" aria-label={t("issues.editTitle")} onClick={() => setEditing(true)}>
              <PencilIcon />
            </Button>
          ) : null}
        </h1>
      )}
    </div>
  )
}

function BodyEditor({ issue, canWrite, onSave }: { issue: IssueDetail; canWrite: boolean; onSave: (body: string) => Promise<boolean> }) {
  const { t } = useTranslations()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(issue.body ?? "")
  const [busy, setBusy] = useState(false)

  return (
    <section className="border-b border-line px-6 py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="grid-micro">{t("issues.fieldBody")}</h2>
        {canWrite && !editing ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setValue(issue.body ?? "")
              setEditing(true)
            }}
          >
            <PencilIcon />
            {t("issues.edit")}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea autoFocus rows={8} dir="auto" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("issues.bodyPlaceholder")} disabled={busy} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                if (await onSave(value)) setEditing(false)
                setBusy(false)
              }}
            >
              {busy ? t("common.working") : t("common.save")}
            </Button>
          </div>
        </div>
      ) : issue.body ? (
        <p className="text-sm whitespace-pre-wrap text-grid-body" dir="auto">{issue.body}</p>
      ) : (
        <p className="text-sm text-grid-muted">{t("issues.noBody")}</p>
      )}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 bg-grid-bg px-6 py-3">
      <dt className="grid-micro">{label}</dt>
      <dd className="text-sm text-grid-body">{children}</dd>
    </div>
  )
}

function Fields({ issue, canWrite, onSave, compact }: { issue: IssueDetail; canWrite: boolean; onSave: (p: IssuePatch) => Promise<boolean>; compact?: boolean }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const projects = useProjects(ws.id)
  const [busy, setBusy] = useState(false)
  const project = issue.project_id ? projects.data?.projects.find((p) => p.id === issue.project_id) : undefined

  const run = async (p: IssuePatch) => {
    setBusy(true)
    await onSave(p)
    setBusy(false)
  }

  const picker = (label: string, value: string, items: { value: string; label: string }[], field: "status" | "priority" | "issue_type" | "ai_model" | "ai_effort", render?: (v: string) => ReactNode) => (
    <Row label={label}>
      {canWrite ? (
        <Select items={items} value={value} onValueChange={(v) => v && v !== value && void run({ [field]: v === DEFAULT ? "" : v } as IssuePatch)} disabled={busy}>
          <SelectTrigger className="w-full" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        (render?.(value) ?? items.find((s) => s.value === value)?.label ?? value)
      )}
    </Row>
  )

  const spent = agentTime(issue.agent_seconds)

  return (
    <dl className="grid grid-cols-1 gap-px border-b border-line bg-grid-line sm:grid-cols-2 lg:grid-cols-1">
      {compact ? null : picker(t("issues.statusLabel"), issue.status, ISSUE_STATUSES.map((s) => ({ value: s, label: t(`issues.status.${s}`) })), "status")}
      {compact ? null : picker(
        t("issues.priorityLabel"),
        issue.priority,
        ISSUE_PRIORITIES.map((p) => ({ value: p, label: t(`issues.priority.${p}`) })),
        "priority",
        (v) => <IssuePriorityMark priority={v} withLabel />,
      )}
      {picker(t("issues.typeLabel"), issue.issue_type, ISSUE_TYPES.map((p) => ({ value: p, label: t(`issues.type.${p}`) })), "issue_type")}
      <Row label={t("issues.humanOnly")}>
        <label className="flex items-start gap-3">
          <Switch checked={issue.human_only} disabled={!canWrite || busy} onCheckedChange={(v) => void run({ human_only: v })} className="mt-0.5" />
          <span className="text-xs text-grid-muted">{t("issues.humanOnlyHint")}</span>
        </label>
      </Row>
      {picker(
        t("issues.aiModel"),
        issue.ai_model || DEFAULT,
        [DEFAULT, ...AI_MODELS].map((m) => ({ value: m, label: m === DEFAULT ? t("issues.aiDefault") : m })),
        "ai_model",
      )}
      {picker(
        t("issues.aiEffort"),
        issue.ai_effort || DEFAULT,
        [DEFAULT, ...AI_EFFORTS].map((m) => ({ value: m, label: m === DEFAULT ? t("issues.aiDefault") : m })),
        "ai_effort",
      )}
      {(["agent", "skill"] as const).map((f) => (
        <Row key={f} label={t(f === "agent" ? "issues.aiAgent" : "issues.aiSkill")}>
          {canWrite ? (
            <Input
              key={issue[f] ?? ""}
              dir="ltr"
              defaultValue={issue[f] ?? ""}
              placeholder={t("issues.aiDefault")}
              disabled={busy}
              maxLength={100}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v !== (issue[f] ?? "")) void run({ [f]: v })
              }}
            />
          ) : (
            <Ltr>{issue[f] || t("issues.aiDefault")}</Ltr>
          )}
        </Row>
      ))}
      <Row label={t("issues.agentTime")}>
        <span className="inline-flex items-center gap-1.5">
          <BotIcon className="size-3.5 text-grid-muted" aria-hidden />
          {spent ? <Ltr>{spent}</Ltr> : <span className="text-grid-muted">{t("issues.noAgentTime")}</span>}
        </span>
        {issue.started_at ? (
          <span className="mt-1 block text-xs text-grid-muted">
            {t("issues.startedAt", { when: timeAgo(issue.started_at, locale) })}
            {issue.finished_at ? ` · ${t("issues.finishedAt", { when: timeAgo(issue.finished_at, locale) })}` : null}
          </span>
        ) : null}
      </Row>
      {project && !compact ? (
        <Row label={t("issues.projectLabel")}>
          <Link href={`/${locale}/w/${ws.slug}/projects/${project.id}`} className="hover:underline" dir="auto">
            {project.name}
          </Link>
        </Row>
      ) : null}
      <Row label={t("issues.reporter")}>
        {issue.reporter_id ? (
          <span className="inline-flex items-center gap-2">
            <PersonAvatar id={issue.reporter_id} dir={dir} />
            <Ltr>{dir.name(issue.reporter_id)}</Ltr>
          </span>
        ) : (
          <span className="text-grid-muted">{t("issues.anonymous")}</span>
        )}
        <span className="mt-1 block text-xs text-grid-muted">
          {t(`issues.source.${["portal", "embed", "mcp", "github", "jira", "linear"].includes(issue.source) ? issue.source : "app"}`)} · {formatDay(issue.created_at, locale)}
        </span>
      </Row>
    </dl>
  )
}

/** What the feedback SDK captured: page, picked component, viewport, browser, screenshot, logs. */
export function ContextPanel({ issue }: { issue: Pick<IssueDetail, "route" | "selector" | "viewport" | "user_agent" | "page_url" | "screenshot" | "console_log" | "network_log"> }) {
  const { t } = useTranslations()
  const rows: [string, string | null][] = [
    [t("issues.ctx.route"), issue.route],
    [t("issues.ctx.selector"), issue.selector],
    [t("issues.ctx.viewport"), issue.viewport],
    [t("issues.ctx.userAgent"), issue.user_agent],
  ]
  const hasAny = rows.some(([, v]) => v) || issue.page_url || issue.screenshot || issue.console_log || issue.network_log
  if (!hasAny) return null
  const safeUrl = issue.page_url && /^https?:\/\//i.test(issue.page_url) ? issue.page_url : null

  return (
    <details className="group border-b border-line bg-grid-bg" open>
      <summary className="grid-micro cursor-pointer px-6 py-3 hover:bg-grid-soft">{t("issues.ctx.title")}</summary>
      <div className="space-y-4 px-6 pb-5">
        {issue.page_url ? (
          <div className="text-xs">
            <p className="grid-micro mb-1">{t("issues.ctx.pageUrl")}</p>
            {safeUrl ? (
              <a href={safeUrl} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 break-all text-grid-action hover:underline">
                <Ltr mono>{issue.page_url}</Ltr>
                <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
              </a>
            ) : (
              <Ltr mono className="break-all text-grid-body">{issue.page_url}</Ltr>
            )}
          </div>
        ) : null}
        <dl className="space-y-2 text-xs">
          {rows.map(([label, value]) =>
            value ? (
              <div key={label}>
                <dt className="grid-micro">{label}</dt>
                <dd className="break-all">
                  <Ltr mono className="text-grid-body">{value}</Ltr>
                </dd>
              </div>
            ) : null,
          )}
        </dl>
        {issue.screenshot ? (
          <div>
            <p className="grid-micro mb-1">{t("issues.ctx.screenshot")}</p>
            <a href={/^(https?:\/\/|data:image\/)/i.test(issue.screenshot) ? issue.screenshot : undefined} target="_blank" rel="noreferrer noopener">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={issue.screenshot} alt={t("issues.ctx.screenshot")} className="max-w-full border border-line" />
            </a>
          </div>
        ) : null}
        {issue.console_log ? <LogBlock label={t("issues.ctx.consoleLog")} value={issue.console_log} /> : null}
        {issue.network_log ? <LogBlock label={t("issues.ctx.networkLog")} value={issue.network_log} /> : null}
      </div>
    </details>
  )
}

function LogBlock({ label, value }: { label: string; value: string }) {
  const lines = value.split("\n").filter(Boolean).length
  return (
    <details className="border border-line">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-grid-soft">
        <span className="grid-micro">{label}</span>
        <Ltr className="text-grid-muted tabular-nums">{lines}</Ltr>
      </summary>
      <pre dir="ltr" className="ltr-isolate max-h-72 overflow-auto border-t border-line bg-grid-card p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-grid-body">
        {value}
      </pre>
    </details>
  )
}

function CommentThread({ issue, onChanged }: { issue: IssueDetail; onChanged: () => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const [body, setBody] = useState("")
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const comments = issue.comments ?? []

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setPosting(true)
    setError(null)
    try {
      await issuesApi.comment(ws.id, issue.key, body.trim())
      setBody("")
      onChanged()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setPosting(false)
    }
  }

  return (
    <section>
      <h2 className="flex items-baseline justify-between gap-3 border-b border-line px-6 py-3 grid-micro">
        {t("issues.comments")}
        <Ltr className="tabular-nums text-grid-muted">{comments.length}</Ltr>
      </h2>
      {comments.length === 0 ? (
        <p className="px-6 py-6 text-sm text-grid-muted">{t("issues.noComments")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} dir={dir} locale={locale} />
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line px-6 py-4" noValidate>
        <Textarea
          rows={3}
          dir="auto"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e)
          }}
          placeholder={t("issues.commentPlaceholder")}
          aria-label={t("issues.commentPlaceholder")}
          disabled={posting}
        />
        {error ? <p role="alert" className="text-sm text-grid-danger-text">{error}</p> : null}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={posting || !body.trim()}>
            <SendIcon className="rtl:-scale-x-100" />
            {posting ? t("common.working") : t("issues.postComment")}
          </Button>
          <span className="text-xs text-grid-muted">{t("issues.mentionHint")}</span>
        </div>
      </form>
    </section>
  )
}

function CommentItem({ comment, dir, locale }: { comment: IssueComment; dir: ReturnType<typeof useDirectory>; locale: ReturnType<typeof useTranslations>["locale"] }) {
  const { t } = useTranslations()
  const agent = comment.author_kind === "agent"
  return (
    <li className={cn("px-6 py-4", agent && "bg-grid-soft/60")}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-grid-muted">
        {comment.author_id ? <PersonAvatar id={comment.author_id} dir={dir} /> : <BotIcon className="size-4" aria-hidden />}
        <Ltr>{comment.author_id ? dir.name(comment.author_id) : t("issues.kind.agent")}</Ltr>
        <AuthorKindBadge kind={comment.author_kind} />
        <span aria-hidden className="text-grid-muted/50">·</span>
        <span>{timeAgo(comment.created_at, locale)}</span>
      </div>
      <p className="text-sm whitespace-pre-wrap text-grid-body" dir="auto">{comment.body}</p>
    </li>
  )
}

// ── The issue inside its card ────────────────────────────────────────────────────────────────
// A card and its issue are one item (same key). The card sheet / task page shows the card's own
// planning fields and adds these: the issue's type and agent strategy, its captured context, and
// the issue thread (comments, @agent hand-offs, the agent's plan / review / finish notes).

function useCardIssue(taskKey: string) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const issue = useIssue(ws.id, taskKey)
  const save = async (patch: IssuePatch) => {
    try {
      const next = await issuesApi.patch(ws.id, taskKey, patch)
      await issue.mutate(next, { revalidate: false })
      return true
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      return false
    }
  }
  return { issue, save, canWrite: ws.can("feedback:write") }
}

/** Type, agent strategy, agent time and reporter — status and priority stay the card's. */
export function CardIssueFields({ taskKey }: { taskKey: string }) {
  const { issue, save, canWrite } = useCardIssue(taskKey)
  if (!issue.data) return null
  return <Fields issue={issue.data} canWrite={canWrite} onSave={save} compact />
}

/** Captured context (page, screenshot, console and network logs), resolution and the thread. */
export function CardIssueThread({ taskKey }: { taskKey: string }) {
  const { t } = useTranslations()
  const { issue } = useCardIssue(taskKey)
  const i = issue.data
  if (!i) return null
  return (
    <div className="border-t border-line">
      <ContextPanel issue={i} />
      {i.resolution ? (
        <div className="border-b border-line px-6 py-4">
          <p className="grid-micro mb-1">{t("issues.resolution")}</p>
          <p className="text-sm whitespace-pre-wrap text-grid-body" dir="auto">{i.resolution}</p>
        </div>
      ) : null}
      <CommentThread issue={i} onChanged={() => void issue.mutate()} />
    </div>
  )
}
