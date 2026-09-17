"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ChevronLeftIcon, SendIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { NotFoundState } from "@/components/not-found-state"
import { ErrorState, LoadingRows } from "@/components/states"
import { PersonAvatar, useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  issuesApi,
  useIssue,
  type IssueComment,
  type IssueDetail,
  type IssuePriority,
  type IssueStatus,
} from "@/lib/work"

export default function IssueDetailPage() {
  const { key } = useParams<{ key: string }>()
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const issue = useIssue(ws.id, key)
  const back = `/${locale}/w/${ws.slug}/issues`
  const i = issue.data
  useDocumentTitle(`${i ? `${i.key} · ${i.title}` : t("issues.title")} · ${ws.summary.name}`)

  if (issue.error) {
    return issue.error instanceof ApiError && issue.error.status === 404 ? (
      <NotFoundState title={t("issues.notFound")} body={t("issues.notFoundBody")} backHref={back} backLabel={t("issues.title")} />
    ) : (
      <ErrorState error={issue.error} />
    )
  }
  if (!i) return <LoadingRows rows={5} />

  return (
    <>
      <div className="px-6 pt-5">
        <Link href={back} className="inline-flex items-center gap-1 text-xs text-grid-muted hover:text-grid-fg">
          <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
          {t("issues.title")}
        </Link>
      </div>
      <SectionHeader
        micro={<Ltr mono>{i.key}</Ltr>}
        title={i.title}
        description={i.issue_type ?? undefined}
      />

      <div className="grid gap-px border-y border-line bg-grid-line lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* main: body + comments */}
        <div className="min-w-0 bg-grid-bg">
          {i.body ? (
            <div className="border-b border-line px-6 py-4">
              <p className="text-sm whitespace-pre-wrap text-grid-body">{i.body}</p>
            </div>
          ) : null}
          <CommentThread issue={i} onChanged={() => void issue.mutate()} />
        </div>

        {/* side rail: editors + captured context */}
        <aside className="min-w-0 space-y-px bg-grid-bg">
          <Editors issue={i} onChanged={() => void issue.mutate()} />
          <ContextPanel issue={i} />
        </aside>
      </div>
    </>
  )
}

function Editors({ issue, onChanged }: { issue: IssueDetail; onChanged: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)

  async function setStatus(v: IssueStatus) {
    setBusy(true)
    try {
      await issuesApi.patch(ws.id, issue.key, { status: v })
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }
  async function setPriority(v: IssuePriority) {
    setBusy(true)
    try {
      await issuesApi.patch(ws.id, issue.key, { priority: v })
      onChanged()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  const statusItems = ISSUE_STATUSES.map((s) => ({ value: s, label: t(`issues.status.${s}`) }))
  const priorityItems = ISSUE_PRIORITIES.map((p) => ({ value: p, label: t(`issues.priority.${p}`) }))

  return (
    <dl className="grid grid-cols-1 gap-px border-b border-line bg-grid-line sm:grid-cols-2 lg:grid-cols-1">
      <div className="flex flex-col gap-2 bg-grid-bg px-6 py-4">
        <dt className="grid-micro">{t("issues.statusLabel")}</dt>
        <dd>
          <Select items={statusItems} value={issue.status} onValueChange={(v) => v && setStatus(v as IssueStatus)} disabled={busy}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </dd>
      </div>
      <div className="flex flex-col gap-2 bg-grid-bg px-6 py-4">
        <dt className="grid-micro">{t("issues.priorityLabel")}</dt>
        <dd>
          <Select items={priorityItems} value={issue.priority} onValueChange={(v) => v && setPriority(v as IssuePriority)} disabled={busy}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorityItems.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </dd>
      </div>
    </dl>
  )
}

function ContextPanel({ issue }: { issue: IssueDetail }) {
  const { t } = useTranslations()
  const rows: [string, string | null][] = [
    [t("issues.ctx.route"), issue.route],
    [t("issues.ctx.pageUrl"), issue.page_url],
    [t("issues.ctx.selector"), issue.selector],
    [t("issues.ctx.viewport"), issue.viewport],
    [t("issues.ctx.userAgent"), issue.user_agent],
  ]
  const hasAny = rows.some(([, v]) => v) || issue.screenshot || issue.console_log || issue.network_log
  if (!hasAny) return null

  return (
    <details className="group border-b border-line bg-grid-bg" open>
      <summary className="grid-micro cursor-pointer list-none px-6 py-3 hover:bg-grid-soft">{t("issues.ctx.title")}</summary>
      <div className="space-y-4 px-6 pb-5">
        {issue.screenshot ? (
          <div>
            <p className="grid-micro mb-1">{t("issues.ctx.screenshot")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={issue.screenshot} alt={t("issues.ctx.screenshot")} className="max-w-full rounded border border-line" />
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
        {issue.console_log ? <LogBlock label={t("issues.ctx.consoleLog")} value={issue.console_log} /> : null}
        {issue.network_log ? <LogBlock label={t("issues.ctx.networkLog")} value={issue.network_log} /> : null}
      </div>
    </details>
  )
}

function LogBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="grid-micro mb-1">{label}</p>
      <pre dir="ltr" className="ltr-isolate max-h-64 overflow-auto border border-line bg-grid-card p-3 font-mono text-[11px] leading-5 whitespace-pre-wrap text-grid-body">
        {value}
      </pre>
    </div>
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
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
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
          placeholder={t("issues.commentPlaceholder")}
          disabled={posting}
        />
        {error ? <p role="alert" className="text-sm text-grid-danger-text">{error}</p> : null}
        <Button type="submit" size="sm" className="self-start" disabled={posting || !body.trim()}>
          <SendIcon />
          {posting ? t("common.working") : t("issues.postComment")}
        </Button>
      </form>
    </section>
  )
}

function CommentItem({ comment, dir, locale }: { comment: IssueComment; dir: ReturnType<typeof useDirectory>; locale: ReturnType<typeof useTranslations>["locale"] }) {
  return (
    <li className="px-6 py-4">
      <div className="mb-2 flex items-center gap-2 text-[11px] text-grid-muted">
        <PersonAvatar id={comment.author_id} dir={dir} />
        <Ltr>{dir.name(comment.author_id)}</Ltr>
        <span aria-hidden className="text-grid-muted/50">·</span>
        <span>{timeAgo(comment.created_at, locale)}</span>
      </div>
      <p className="text-sm whitespace-pre-wrap text-grid-body">{comment.body}</p>
    </li>
  )
}
