"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CopyIcon, LinkIcon, MoreHorizontalIcon, Share2Icon } from "lucide-react"

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@fadymondy/nasaq/web"


import { useTranslations } from "@/lib/i18n"
import type { Issue } from "@/lib/work"
import { IssueActionsMenu } from "./issue-actions"
import { copyText } from "./shared"

/** The issue rendered as markdown, for the clipboard. */
function toMarkdown(issue: Issue) {
  const meta = [`**Key:** ${issue.key}`, `**Status:** ${issue.status}`, `**Type:** ${issue.issue_type}`, `**Priority:** ${issue.priority}`].join("  \n")
  return `# ${issue.title}\n\n${meta}\n\n${issue.body ?? ""}`.trim() + "\n"
}

/**
 * Copy the page, share it, step to the neighbouring item, plus the issue-only
 * actions menu. Workspace issues are private, so "share" only copies the link.
 */
export function IssueToolbar({
  issue,
  prevHref,
  nextHref,
  onChanged,
}: {
  issue: Issue
  prevHref: string | null
  nextHref: string | null
  onChanged?: () => void | Promise<unknown>
}) {
  const { t } = useTranslations()
  const [copied, setCopied] = useState<"page" | "link" | null>(null)

  const copy = async (text: string, which: "page" | "link") => {
    if (await copyText(text)) {
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => copy(toMarkdown(issue), "page")}>
        {copied === "page" ? <CheckIcon /> : <CopyIcon />}
        {copied === "page" ? t("issues.detail.copied") : t("issues.detail.copyPage")}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="secondary" size="icon-sm" aria-label={t("issues.detail.share")}>
              <Share2Icon />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-52 *:whitespace-nowrap">
          <DropdownMenuItem onClick={() => copy(window.location.href, "link")}>
            {copied === "link" ? <CheckIcon /> : <LinkIcon />}
            {copied === "link" ? t("issues.detail.copied") : t("issues.action.copyLink")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <IssueActionsMenu
        issue={issue}
        onChanged={onChanged}
        trigger={
          <Button variant="secondary" size="icon-sm" aria-label={t("issues.action.more")}>
            <MoreHorizontalIcon />
          </Button>
        }
      />

      {/* Arrows point along the reading direction, so they mirror under RTL. */}
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={t("issues.detail.previous")}
        disabled={!prevHref}
        nativeButton={!prevHref}
        render={prevHref ? <Link href={prevHref} /> : undefined}
      >
        <ArrowLeftIcon className="rtl:-scale-x-100" />
      </Button>

      <Button
        variant="secondary"
        size="icon-sm"
        aria-label={t("issues.detail.next")}
        disabled={!nextHref}
        nativeButton={!nextHref}
        render={nextHref ? <Link href={nextHref} /> : undefined}
      >
        <ArrowRightIcon className="rtl:-scale-x-100" />
      </Button>
    </div>
  )
}
