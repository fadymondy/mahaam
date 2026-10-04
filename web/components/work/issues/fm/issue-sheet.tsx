"use client"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@fadymondy/nasaq/web"

import { TaskDetail } from "@/components/work/task-detail"
import { useTranslations } from "@/lib/i18n"
import type { Issue } from "@/lib/work"

/**
 * Clicking a board card opens the item here rather than navigating: the board stays behind it,
 * and "open full page" in the header is the way through. Same component as the full page.
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
  const { t } = useTranslations()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl!" data-issue-sheet={issue?.key ?? ""}>
        <SheetTitle className="sr-only">{issue?.key ?? t("task.title")}</SheetTitle>
        <SheetDescription className="sr-only">{t("td.info")}</SheetDescription>
        {open && issue ? (
          <TaskDetail
            taskKey={issue.key}
            layout="sheet"
            onChanged={() => void onChanged?.()}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
