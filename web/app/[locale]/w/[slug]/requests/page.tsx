"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  CalendarIcon,
  CheckIcon,
  ExternalLinkIcon,
  InboxIcon,
  ListTodoIcon,
  RotateCcwIcon,
  UserIcon,
  XIcon,
} from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Badge, Button, Field, FieldLabel, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, SheetContent, SheetDescription, SheetTitle } from "@fadymondy/nasaq/web"





import { NotFoundState } from "@/components/not-found-state"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { AuthImage, PromptDialog, RequestStateBadge, ScrollTabs } from "@/components/portal/portal-bits"
import { IssuePriorityMark, IssueTypeIcon } from "@/components/work/issues/issue-bits"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { formatDay, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { requestsApi, useRequest, useRequests, type CustomerRequest, type RequestDetail } from "@/lib/portal"
import { useDocumentTitle } from "@/lib/title"
import { ISSUE_PRIORITIES, ISSUE_TYPES, errorText } from "@/lib/work"

/*
The staff Requests inbox (roadmap 5, manager+). Every request — whatever its state — opens a detail
panel (?key=MH-12, also the link in the "new request" notification): body, screenshot, requester,
project, wanted-by date, state history, reply and the thread, with a link to what it became (the
issue on the board, or the task). From a pending request: convert to issue (type, priority,
column), convert to task, or decline with a reason. A handled one can be reopened to pending.
*/
const STATES = ["pending", "accepted", "declined", "converted", "all"] as const
const COLUMNS = ["backlog", "todo", "in_progress"] as const

export default function RequestsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const allowed = ws.can("requests:manage")
  const [state, setState] = useState<string>(search.get("state") ?? "pending")
  const list = useRequests(ws.id, state, allowed)
  const openKey = search.get("key")
  useDocumentTitle(`${t("requests.title")} · ${ws.summary.name}`)

  if (!allowed) {
    return <NotFoundState title={t("requests.title")} body={t("portal.notFoundBody")} />
  }

  const setKey = (key: string | null) => {
    const q = new URLSearchParams(search.toString())
    if (key) q.set("key", key)
    else q.delete("key")
    router.replace(`${pathname}${q.size ? `?${q}` : ""}`, { scroll: false })
  }

  const rows = list.data?.requests ?? []
  const counts = list.data?.counts
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-nq-action/10 text-nq-accent-text">
          <InboxIcon className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">{t("requests.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("requests.subtitle")}</p>
        </div>
      </header>

      <ScrollTabs
        value={state}
        onChange={setState}
        label={t("requests.title")}
        items={STATES.map((s) => ({ value: s, label: t(`requests.state.${s}`), count: counts?.[s] }))}
      />

      {list.error ? (
        <ErrorState error={list.error} />
      ) : !list.data ? (
        <LoadingRows rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t(`requests.empty.${state}`)} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-border bg-card" data-requests={rows.length}>
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => setKey(r.key)}
                data-request={r.key}
                className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <IssueTypeIcon type={r.issue_type} className="mt-1 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <code className="text-xs text-muted-foreground" dir="ltr">
                      {r.key}
                    </code>
                    <span className="truncate font-medium">{r.title}</span>
                    <Badge variant="outline">{t(`portal.request.kind.${r.kind}`)}</Badge>
                  </span>
                  <span className="mt-0.5 block text-caption text-muted-foreground">
                    {t("requests.from", { project: r.project_name ?? "—", date: timeAgo(r.created_at, locale) })}
                    {r.desired_on ? ` · ${t("portal.request.wantedBy", { date: formatDay(r.desired_on, locale) })}` : ""}
                  </span>
                  {r.reply ? <span className="mt-1 line-clamp-1 block text-caption text-muted-foreground">↳ {r.reply}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <IssuePriorityMark priority={r.priority} />
                  <RequestStateBadge state={r.state} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openKey ? (
        <RequestSheet
          requestKey={openKey}
          onClose={() => setKey(null)}
          onChanged={() => void list.mutate()}
        />
      ) : null}
    </div>
  )
}

function RequestSheet({ requestKey, onClose, onChanged }: { requestKey: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const req = useRequest(ws.id, requestKey)
  const r = req.data
  const [acting, setActing] = useState<"accept" | "decline" | "reopen" | null>(null)
  const [busy, setBusy] = useState(false)
  const base = `/${locale}/w/${ws.slug}`

  const done = async (msg: string) => {
    toast.success(msg)
    setActing(null)
    await req.mutate()
    onChanged()
  }
  const convert = async () => {
    if (!r) return
    setBusy(true)
    try {
      const out = await requestsApi.convert(ws.id, r.key)
      await done(t("requests.convertedToast", { task: out.task_key }))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="end" className="w-full gap-0 overflow-y-auto sm:max-w-xl" data-request-detail={requestKey}>
        {!r ? (
          <div className="p-5">{req.error ? <ErrorState error={req.error} /> : <LoadingRows rows={5} />}</div>
        ) : (
          <>
            <div className="space-y-3 border-b border-border p-5 pe-12">
              <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                <IssueTypeIcon type={r.issue_type} />
                <code dir="ltr">{r.key}</code>
                <Badge variant="outline">{t(`portal.request.kind.${r.kind}`)}</Badge>
                <RequestStateBadge state={r.state} />
              </div>
              <SheetTitle className="text-lg leading-snug">{r.title}</SheetTitle>
              <SheetDescription className="sr-only">{t("requests.detail")}</SheetDescription>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <UserIcon className="size-3.5" /> {t("requests.requester")}
                </dt>
                <dd className="truncate" dir="ltr">
                  {r.reporter_email ?? "—"}
                </dd>
                <dt className="text-muted-foreground">{t("portal.request.project")}</dt>
                <dd className="truncate">
                  {r.project_id ? (
                    <Link href={`${base}/projects/${r.project_id}`} className="hover:underline">
                      {r.project_name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <CalendarIcon className="size-3.5" /> {t("requests.filed")}
                </dt>
                <dd>{formatDay(r.created_at, locale)}</dd>
                {r.desired_on ? (
                  <>
                    <dt className="text-muted-foreground">{t("requests.wanted")}</dt>
                    <dd>{formatDay(r.desired_on, locale)}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">{t("portal.priority")}</dt>
                <dd>
                  <IssuePriorityMark priority={r.priority} withLabel />
                </dd>
              </dl>
            </div>

            <Outcome r={r} base={base} />

            {r.state === "pending" ? (
              <div className="flex flex-wrap gap-2 border-b border-border p-5">
                <Button variant="primary" size="sm" disabled={busy} onClick={() => setActing("accept")} data-action="to-issue">
                  <CheckIcon /> {t("requests.toIssue")}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={convert} data-action="to-task">
                  <ListTodoIcon /> {t("requests.convert")}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setActing("decline")} data-action="decline">
                  <XIcon /> {t("requests.decline")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 border-b border-border p-5">
                <Button size="sm" variant="secondary" onClick={() => setActing("reopen")} data-action="reopen">
                  <RotateCcwIcon /> {t("requests.reopen")}
                </Button>
                <span className="text-caption text-muted-foreground">{t("requests.reopenHint")}</span>
              </div>
            )}

            <section className="space-y-2 border-b border-border p-5">
              <h3 className="text-eyebrow uppercase">{t("portal.request.details")}</h3>
              {r.body ? (
                <p className="text-sm whitespace-pre-wrap" dir="auto">
                  {r.body}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("requests.noBody")}</p>
              )}
              {r.screenshot ? <AuthImage src={`/api/w/issues/${encodeURIComponent(r.key)}/screenshot`} alt={t("requests.attachment")} /> : null}
            </section>

            <History r={r} />

            {r.comments.length ? (
              <section className="space-y-2 p-5">
                <h3 className="text-eyebrow uppercase">{t("portal.comments")}</h3>
                <ul className="space-y-2">
                  {r.comments.map((c) => (
                    <li key={c.id} className="rounded-md border border-border px-3 py-2">
                      <p className="text-caption text-muted-foreground">
                        {c.author_id && c.author_id === r.reporter_id ? t("requests.customer") : t("portal.team")} · {timeAgo(c.created_at, locale)}
                      </p>
                      <p className="text-sm whitespace-pre-wrap" dir="auto">
                        {c.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </SheetContent>

      {r && acting === "accept" ? <AcceptDialog r={r} onClose={() => setActing(null)} onDone={() => done(t("requests.acceptedToast"))} /> : null}
      {r && acting === "decline" ? (
        <PromptDialog
          title={t("requests.declineTitle", { key: r.key })}
          hint={t("requests.declineHint")}
          label={t("requests.reason")}
          required
          destructive
          confirm={t("requests.decline")}
          onClose={() => setActing(null)}
          onConfirm={async (reason) => {
            try {
              await requestsApi.decline(ws.id, r.key, reason)
              await done(t("requests.declinedToast"))
            } catch (err) {
              toast.error(errorText(err, t("common.networkError")))
            }
          }}
        />
      ) : null}
      {r && acting === "reopen" ? (
        <PromptDialog
          title={t("requests.reopenTitle", { key: r.key })}
          hint={r.task_key ? t("requests.reopenTaskHint", { task: r.task_key }) : t("requests.reopenHint")}
          label={t("requests.reopenNote")}
          confirm={t("requests.reopen")}
          onClose={() => setActing(null)}
          onConfirm={async (note) => {
            try {
              await requestsApi.reopen(ws.id, r.key, note || undefined)
              await done(t("requests.reopenedToast"))
            } catch (err) {
              toast.error(errorText(err, t("common.networkError")))
            }
          }}
        />
      ) : null}
    </Sheet>
  )
}

function Outcome({ r, base }: { r: RequestDetail; base: string }) {
  const { t } = useTranslations()
  if (r.state === "pending" && !r.reply) return null
  return (
    <div className="space-y-2 border-b border-border bg-muted/30 p-5" data-outcome={r.state}>
      {r.state === "accepted" ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("requests.becameIssue")}</span>
          <Link href={`${base}/issues/${r.key}`} className="inline-flex items-center gap-1 font-medium text-nq-accent-text hover:underline" data-link="issue">
            <code dir="ltr">{r.key}</code> · {t(`issues.status.${r.status}`)} <ExternalLinkIcon className="size-3.5" />
          </Link>
        </p>
      ) : null}
      {r.state === "converted" && r.task_key ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("requests.becameTask")}</span>
          {r.task_project_id ? (
            <Link
              href={`${base}/projects/${r.task_project_id}/tasks/${r.task_key}`}
              className="inline-flex items-center gap-1 font-medium text-nq-accent-text hover:underline"
              data-link="task"
            >
              <code dir="ltr">{r.task_key}</code> <ExternalLinkIcon className="size-3.5" />
            </Link>
          ) : (
            <code dir="ltr">{r.task_key}</code>
          )}
        </p>
      ) : null}
      {r.reply ? (
        <div className="text-sm">
          <p className="text-eyebrow uppercase mb-1">{r.state === "declined" ? t("requests.reason") : t("portal.request.reply")}</p>
          <p className="whitespace-pre-wrap" dir="auto">
            {r.reply}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function History({ r }: { r: RequestDetail }) {
  const { t, locale } = useTranslations()
  return (
    <section className="space-y-3 border-b border-border p-5">
      <h3 className="text-eyebrow uppercase">{t("requests.history")}</h3>
      <ol className="relative space-y-3 border-s border-border ps-4">
        {r.history.map((h, i) => (
          <li key={i} className="relative">
            <span className="absolute -start-[21px] top-1.5 size-2.5 rounded-full border-2 border-background bg-nq-action" aria-hidden />
            <p className="text-sm">
              {i === 0 ? t("requests.event.filed") : h.state === "pending" ? t("requests.event.reopened") : t(`requests.event.${h.state}`)}
              <span className="ms-2 text-caption text-muted-foreground">{formatDay(h.at, locale)} · {timeAgo(h.at, locale)}</span>
            </p>
            {h.note ? (
              <p className="text-caption whitespace-pre-wrap text-muted-foreground" dir="auto">
                {h.note}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

function AcceptDialog({ r, onClose, onDone }: { r: CustomerRequest; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [status, setStatus] = useState<string>("todo")
  const [priority, setPriority] = useState<string>(r.priority)
  const [type, setType] = useState<string>(r.issue_type)
  return (
    <PromptDialog
      title={t("requests.acceptTitle", { key: r.key })}
      hint={t("requests.acceptHint")}
      label={t("requests.reply")}
      confirm={t("requests.toIssue")}
      onClose={onClose}
      onConfirm={async (reply) => {
        try {
          await requestsApi.accept(ws.id, r.key, { status, priority, issue_type: type, reply: reply || undefined })
          onDone()
        } catch (err) {
          toast.error(errorText(err, t("common.networkError")))
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel>{t("portal.issue.type")}</FieldLabel>
          <Select value={type} onValueChange={(v) => setType(v ?? r.issue_type)}>
            <SelectTrigger>
              <SelectValue>
                <span className="flex items-center gap-1.5">
                  <IssueTypeIcon type={type} /> {t(`issues.type.${type}`)}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ISSUE_TYPES.map((x) => (
                <SelectItem key={x} value={x}>
                  <span className="flex items-center gap-1.5">
                    <IssueTypeIcon type={x} /> {t(`issues.type.${x}`)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{t("portal.priority")}</FieldLabel>
          <Select value={priority} onValueChange={(v) => setPriority(v ?? r.priority)}>
            <SelectTrigger>
              <SelectValue>
                <IssuePriorityMark priority={priority} withLabel />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ISSUE_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  <IssuePriorityMark priority={p} withLabel />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{t("requests.column")}</FieldLabel>
          <Select value={status} onValueChange={(v) => setStatus(v ?? "todo")}>
            <SelectTrigger>
              <SelectValue>{t(`issues.status.${status}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COLUMNS.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`issues.status.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </PromptDialog>
  )
}
