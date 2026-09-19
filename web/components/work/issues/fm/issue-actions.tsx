"use client"

import { useState, type ReactElement, type ReactNode } from "react"
import { ExternalLinkIcon, LinkIcon, LockIcon, PencilIcon } from "lucide-react"
import { toast } from "sonner"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { ISSUE_PRIORITIES, ISSUE_STATUSES, ISSUE_TYPES, errorText, issuesApi, type Issue, type IssuePatch } from "@/lib/work"
import { IssueFormDialog } from "./issue-form-dialog"
import { copyText, useIssueHref } from "./shared"

export type IssueActionHandlers = {
  /** Called after any write so the caller can revalidate. */
  onChanged?: () => void | Promise<unknown>
}

/**
 * The action set is shared between the right-click menu on a board card and the
 * "..." menu on the sheet and detail toolbar, so the two can never drift apart.
 * (Mahaam has no issue delete endpoint, so there is no delete item.)
 */
function useIssueActions(issue: Issue, { onChanged }: IssueActionHandlers) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const href = useIssueHref()
  const [editing, setEditing] = useState(false)

  async function patch(fields: IssuePatch) {
    try {
      await issuesApi.patch(ws.id, issue.key, fields)
      await onChanged?.()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  function copyLink() {
    void copyText(window.location.origin + href(issue))
  }

  return { patch, copyLink, editing, setEditing, href: href(issue), canWrite: ws.can("feedback:write") }
}

type Actions = ReturnType<typeof useIssueActions>

type MenuParts = {
  Item: typeof ContextMenuItem | typeof DropdownMenuItem
  Group: typeof ContextMenuGroup | typeof DropdownMenuGroup
  Label: typeof ContextMenuLabel | typeof DropdownMenuLabel
  Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator
}

function IssueMenuItems({ issue, parts, actions, showOpen }: { issue: Issue; parts: MenuParts; actions: Actions; showOpen: boolean }) {
  const { t } = useTranslations()
  const { Item, Group, Label, Separator } = parts

  return (
    <>
      {showOpen ? (
        <>
          <Item
            render={
              <a href={actions.href}>
                <ExternalLinkIcon />
                {t("issues.action.open")}
              </a>
            }
          />
          <Item onClick={actions.copyLink}>
            <LinkIcon />
            {t("issues.action.copyLink")}
          </Item>
          {actions.canWrite ? <Separator /> : null}
        </>
      ) : null}

      {actions.canWrite ? (
        <>
          <Group>
            <Label>{t("issues.action.moveTo")}</Label>
            {ISSUE_STATUSES.filter((s) => s !== issue.status).map((status) => (
              <Item key={status} onClick={() => actions.patch({ status })}>
                {t(`issues.status.${status}`)}
              </Item>
            ))}
          </Group>

          <Separator />
          <Group>
            <Label>{t("issues.priorityLabel")}</Label>
            {ISSUE_PRIORITIES.filter((p) => p !== issue.priority).map((priority) => (
              <Item key={priority} onClick={() => actions.patch({ priority })}>
                {t(`issues.priority.${priority}`)}
              </Item>
            ))}
          </Group>

          <Separator />
          <Group>
            <Label>{t("issues.typeLabel")}</Label>
            {ISSUE_TYPES.filter((x) => x !== issue.issue_type).map((issueType) => (
              <Item key={issueType} onClick={() => actions.patch({ issue_type: issueType })}>
                {t(`issues.type.${issueType}`)}
              </Item>
            ))}
          </Group>

          <Separator />
          <Item onClick={() => actions.patch({ human_only: !issue.human_only })}>
            <LockIcon />
            {issue.human_only ? t("issues.action.allowAgents") : t("issues.action.markHumanOnly")}
          </Item>
          <Item onClick={() => actions.setEditing(true)}>
            <PencilIcon />
            {t("issues.action.edit")}
          </Item>
        </>
      ) : null}
    </>
  )
}

/** Right-click a board card. */
export function IssueContextMenu({ issue, children, onChanged }: { issue: Issue; children: ReactNode } & IssueActionHandlers) {
  const actions = useIssueActions(issue, { onChanged })

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={<div />}>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <IssueMenuItems
            issue={issue}
            showOpen
            actions={actions}
            parts={{ Item: ContextMenuItem, Group: ContextMenuGroup, Label: ContextMenuLabel, Separator: ContextMenuSeparator }}
          />
        </ContextMenuContent>
      </ContextMenu>

      <IssueFormDialog open={actions.editing} onOpenChange={actions.setEditing} issue={issue} onSaved={onChanged} />
    </>
  )
}

/** The "..." menu, for the detail toolbar and the side-over header. */
export function IssueActionsMenu({
  issue,
  trigger,
  showOpen = false,
  onChanged,
}: {
  issue: Issue
  trigger: ReactElement
  showOpen?: boolean
} & IssueActionHandlers) {
  const actions = useIssueActions(issue, { onChanged })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent align="end" className="min-w-48">
          <IssueMenuItems
            issue={issue}
            showOpen={showOpen}
            actions={actions}
            parts={{ Item: DropdownMenuItem, Group: DropdownMenuGroup, Label: DropdownMenuLabel, Separator: DropdownMenuSeparator }}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <IssueFormDialog open={actions.editing} onOpenChange={actions.setEditing} issue={issue} onSaved={onChanged} />
    </>
  )
}
