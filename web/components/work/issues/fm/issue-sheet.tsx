"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ClockIcon, ExternalLinkIcon, LinkIcon, MoreHorizontalIcon, PencilIcon, SendIcon, SparklesIcon, UserRoundIcon, XIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, SheetClose, SheetContent, SheetTitle, Switch, Textarea } from "@fadymondy/nasaq/web"

import { Markdown } from "@/components/markdown"




import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  errorText,
  issuesApi,
  useIssue,
  type Issue,
  type IssuePatch,
} from "@/lib/work"
import { IssueActionsMenu } from "./issue-actions"
import { IssueAgentSettings } from "./issue-agent-settings"
import { MentionTextarea } from "./mention-textarea"
import { CardExtras, CardPlanning } from "@/components/work/task-sheet"
import { ContextPanel } from "@/components/work/issues/issue-detail"
import { useCommentAuthor, useCommentForm } from "./issue-comments"
import { IssueFormDialog } from "./issue-form-dialog"
import { copyText, formatAICost, formatAgentTime, issueSeconds, useIssueHref } from "./shared"

/**
 * Clicking a board card opens the issue here rather than navigating: the board
 * stays behind it, and the arrow in the header is the way through to the full page.
 */
export function IssueSheet({
  issue,
  open,
  onOpenChange,
  onChanged,
}: {
  issue: Issue | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged?: () => void | Promise<unknown>
}) {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const href = useIssueHref()
  const canWrite = ws.can("feedback:write")
  const detail = useIssue(ws.id, open && issue ? issue.key : null)
  const [draft, setDraft] = useState<Issue | null>(issue)
  const [editing, setEditing] = useState(false)
  const author = useCommentAuthor()
  const comments = detail.data?.comments ?? []

  useEffect(() => {
    if (detail.data) setDraft(detail.data)
    else if (issue) setDraft(issue)
  }, [issue, detail.data])

  const refresh = async () => {
    await detail.mutate()
    await onChanged?.()
  }
  const form = useCommentForm(draft?.key, () => detail.mutate())

  async function patch(fields: IssuePatch) {
    if (!draft) return
    // Optimistic: the selects should not stall on a round-trip.
    setDraft({ ...draft, ...fields } as Issue)
    try {
      const next = await issuesApi.patch(ws.id, draft.key, fields)
      await detail.mutate(next, { revalidate: false })
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      setDraft(draft)
    }
    await onChanged?.()
  }

  const agentTime = !draft ? null : draft.started_at ? formatAgentTime(issueSeconds(draft)) || "0m" : formatAgentTime(draft.agent_seconds)
  const aiCost = draft ? formatAICost(draft) : null

  const fields: { key: "status" | "priority" | "issue_type"; label: string; value: string; options: readonly string[]; labels: Record<string, string> }[] = draft
    ? [
        {
          key: "status",
          label: t("issues.statusLabel"),
          value: draft.status,
          options: ISSUE_STATUSES,
          labels: Object.fromEntries(ISSUE_STATUSES.map((s) => [s, t(`issues.status.${s}`)])),
        },
        {
          key: "priority",
          label: t("issues.priorityLabel"),
          value: draft.priority,
          options: ISSUE_PRIORITIES,
          labels: Object.fromEntries(ISSUE_PRIORITIES.map((p) => [p, t(`issues.priority.${p}`)])),
        },
        {
          key: "issue_type",
          label: t("issues.typeLabel"),
          value: draft.issue_type,
          options: ISSUE_TYPES,
          labels: Object.fromEntries(ISSUE_TYPES.map((x) => [x, t(`issues.type.${x}`)])),
        },
      ]
    : []

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="end"
          showClose={false}
          className="w-full gap-0 p-0 data-[side=left]:w-full data-[side=right]:w-full sm:max-w-3xl! data-[side=left]:sm:max-w-3xl data-[side=right]:sm:max-w-3xl"
        >
          {draft ? (
            <>
              <header className="flex flex-col gap-2 border-b border-border p-3">
                <div className="flex items-center gap-1">
                  <SheetClose
                    render={
                      <Button size="icon-sm" variant="ghost" aria-label={t("issues.sheet.close")}>
                        <XIcon />
                      </Button>
                    }
                  />

                  <Button size="icon-sm" variant="ghost" aria-label={t("issues.sheet.openPage")} nativeButton={false} render={<Link href={href(draft)} />}>
                    <ExternalLinkIcon />
                  </Button>

                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("issues.action.copyLink")}
                    onClick={() => void copyText(window.location.origin + href(draft))}
                  >
                    <LinkIcon />
                  </Button>

                  {canWrite ? (
                    <Button size="icon-sm" variant="ghost" aria-label={t("issues.action.edit")} onClick={() => setEditing(true)}>
                      <PencilIcon />
                    </Button>
                  ) : null}

                  <IssueActionsMenu
                    issue={draft}
                    onChanged={refresh}
                    trigger={
                      <Button size="icon-sm" variant="ghost" aria-label={t("issues.action.more")}>
                        <MoreHorizontalIcon />
                      </Button>
                    }
                  />

                  <span dir="ltr" className="ms-auto font-mono text-xs text-muted-foreground">
                    {draft.key}
                  </span>
                </div>

                <SheetTitle dir="auto" className="text-base font-medium text-pretty">
                  {draft.title}
                </SheetTitle>
              </header>

              <div className="grid flex-1 overflow-hidden sm:grid-cols-[16rem_1fr] rtl:sm:grid-cols-[1fr_16rem]">
                <div className="flex flex-col gap-4 overflow-y-auto border-border p-4 max-sm:border-b sm:border-e rtl:sm:order-2 rtl:sm:border-e-0 rtl:sm:border-s">
                  {fields.map((field) => (
                    <div key={field.key} className="flex flex-col gap-1.5">
                      <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">{field.label}</span>
                      <Select
                        value={field.value}
                        disabled={!canWrite}
                        onValueChange={(v) => v && v !== field.value && void patch({ [field.key]: v } as IssuePatch)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{(v) => field.labels[String(v)] ?? String(v)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {field.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {field.labels[option] ?? option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}

                  <label className="flex items-start gap-3 border border-border p-3">
                    <Switch checked={draft.human_only} disabled={!canWrite} onCheckedChange={(v) => void patch({ human_only: Boolean(v) })} />
                    <span className="flex flex-col gap-1">
                      <span className="flex items-center gap-1.5 text-sm">
                        <UserRoundIcon className="size-3.5" />
                        {t("issues.humanOnly")}
                      </span>
                      <span className="text-caption text-muted-foreground">{t("issues.humanOnlyHint")}</span>
                    </span>
                  </label>

                  <CardPlanning taskKey={draft.key} />

                  <IssueAgentSettings issue={draft} onPatch={patch} disabled={!canWrite} className="border-t border-border pt-4" />

                  {agentTime ? (
                    <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground" title={t("issues.agentTime")}>
                      <ClockIcon className="size-3.5" />
                      <span dir="ltr">{agentTime}</span>
                    </p>
                  ) : null}
                  {aiCost ? (
                    <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground" title={t("issues.aiCost")}>
                      <SparklesIcon className="size-3.5" />
                      <span dir="ltr">{aiCost}</span>
                    </p>
                  ) : null}
                </div>

                <div className="overflow-y-auto p-4 rtl:sm:order-1">
                  {draft.body ? (
                    <Markdown>{draft.body}</Markdown>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("issues.sheet.noDescription")}</p>
                  )}

                  <div className="-mx-4 mt-6 border-t border-border">
                    <ContextPanel issue={draft} />
                  </div>

                  <CardExtras taskKey={draft.key} />

                  <section className="mt-8 border-t border-border pt-4">
                    <h3 className="flex items-baseline justify-between gap-3 font-mono text-xs tracking-wider text-muted-foreground uppercase">
                      {t("issues.comments")}
                      <span dir="ltr" className="tabular-nums">
                        {comments.length}
                      </span>
                    </h3>

                    {comments.length > 0 ? (
                      <ul className="mt-3 flex flex-col divide-y divide-line">
                        {comments.map((comment) => (
                          <li key={comment.id} className="py-3">
                            <p className="font-mono text-xs text-muted-foreground">
                              <span dir="ltr">{author(comment)}</span> · {new Date(comment.created_at).toLocaleString(locale === "ar" ? "ar-EG" : "en-US")}
                            </p>
                            <Markdown className="mt-1.5">{comment.body}</Markdown>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">{t("issues.noComments")}</p>
                    )}

                    {form.canWrite ? (
                      <form onSubmit={form.submit} className="mt-4 flex flex-col gap-3">
                        <MentionTextarea
                          value={form.value}
                          onChange={form.setValue}
                          projectId={draft.project_id}
                          onChoose={(kind, name) => void patch(kind === "agent" ? { agent: name } : { skill: name })}
                          disabled={form.posting}
                          placeholder={t("issues.commentPlaceholder")}
                        />
                        <p className="text-caption text-muted-foreground">{t("issues.mentionHint")}</p>

                        {form.error ? (
                          <p role="alert" className="text-sm text-destructive">
                            {form.error}
                          </p>
                        ) : null}

                        <Button variant="primary" type="submit" size="sm" className="gap-2 self-start" disabled={form.posting || !form.value.trim()}>
                          <SendIcon className="rtl:-scale-x-100" />
                          {form.posting ? t("issues.comments.posting") : t("issues.postComment")}
                        </Button>
                      </form>
                    ) : null}
                  </section>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {draft ? <IssueFormDialog open={editing} onOpenChange={setEditing} issue={draft} onSaved={refresh} /> : null}
    </>
  )
}
