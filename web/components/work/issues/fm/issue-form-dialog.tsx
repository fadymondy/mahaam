"use client"

import { useEffect, useState } from "react"

import { Field, FieldLabel, Switch } from "@fadymondy/nasaq/web"


import { useWorkspace } from "@/components/workspace/workspace-context"
import { ReportDialog, type FeedbackSubmission } from "@/lib/feedback/react/report-dialog"
import { useTranslations } from "@/lib/i18n"
import {
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  issuesApi,
  type Issue,
  type IssuePriority,
  type IssueType,
} from "@/lib/work"

/**
 * fadymondy.com's reporter: the shared feedback SDK's dialog plus priority and
 * the human-only switch. Passing an `issue` switches it to edit mode.
 *
 * Mahaam's in-app create endpoint does not store captures, so a picked
 * element's selector is folded into the body; a screenshot is not kept.
 */
export function IssueFormDialog({
  open,
  onOpenChange,
  issue,
  projectId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  issue?: Issue
  projectId?: string
  onSaved?: (issue?: Issue) => void | Promise<unknown>
}) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [humanOnly, setHumanOnly] = useState(false)

  useEffect(() => {
    if (open) setHumanOnly(issue?.human_only ?? false)
  }, [open, issue])

  async function save(s: FeedbackSubmission) {
    let saved: Issue
    if (issue) {
      saved = await issuesApi.patch(ws.id, issue.key, {
        title: s.title,
        body: s.body ?? "",
        issue_type: s.issue_type as IssueType,
        priority: (s.priority ?? issue.priority) as IssuePriority,
        human_only: humanOnly,
      })
    } else {
      const extra = [s.selector ? `Selector: \`${s.selector}\`` : null].filter(Boolean).join("\n")
      const body = [s.body ?? "", extra].filter(Boolean).join("\n\n")
      saved = await issuesApi.create(ws.id, {
        title: s.title,
        body: body || undefined,
        issue_type: s.issue_type as IssueType,
        priority: (s.priority ?? "medium") as IssuePriority,
        project: projectId,
      })
      if (humanOnly) saved = await issuesApi.patch(ws.id, saved.key, { human_only: true })
    }
    await onSaved?.(saved)
  }

  return (
    <ReportDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={save}
      mode={issue ? "edit" : "create"}
      initial={issue}
      locale={locale === "ar" ? "ar" : "en"}
      idPrefix="issue"
      types={ISSUE_TYPES}
      typeLabels={Object.fromEntries(ISSUE_TYPES.map((x) => [x, t(`issues.type.${x}`)]))}
      priorities={ISSUE_PRIORITIES}
      priorityLabels={Object.fromEntries(ISSUE_PRIORITIES.map((p) => [p, t(`issues.priority.${p}`)]))}
      labels={{
        reportTitle: t("issues.form.reportTitle"),
        reportHint: t("issues.form.reportHint"),
        editTitle: t("issues.form.editTitle"),
        editHint: t("issues.form.editHint"),
        title: t("issues.fieldTitle"),
        type: t("issues.typeLabel"),
        priority: t("issues.priorityLabel"),
        details: t("issues.fieldBody"),
        bodyPlaceholder: t("issues.bodyPlaceholder"),
      }}
      extra={
        <Field className="flex-row items-center gap-2">
          <Switch id="issue-human-only" checked={humanOnly} onCheckedChange={(v) => setHumanOnly(Boolean(v))} />
          <FieldLabel htmlFor="issue-human-only" className="font-normal">
            {t("issues.humanOnlyHint")}
          </FieldLabel>
        </Field>
      }
    />
  )
}
