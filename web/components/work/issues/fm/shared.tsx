"use client"

// Shared bits of the fadymondy.com issue UI, ported to Mahaam's data layer.
import { ChevronDownIcon, ChevronUpIcon, ChevronsUpIcon } from "lucide-react"

import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import type { Issue } from "@/lib/work"

/** Type wears a coloured dot + word; priority is a mark. */
export const TYPE_DOT: Record<string, string> = {
  bug: "bg-red-500",
  task: "bg-sky-500",
  story: "bg-emerald-500",
  feature: "bg-violet-500",
  epic: "bg-amber-500",
}

export const PRIORITY_MARK: Record<string, { Icon: typeof ChevronUpIcon; tone: string } | null> = {
  highest: { Icon: ChevronsUpIcon, tone: "text-red-500" },
  high: { Icon: ChevronUpIcon, tone: "text-orange-500" },
  medium: null,
  low: { Icon: ChevronDownIcon, tone: "text-sky-500" },
  lowest: { Icon: ChevronDownIcon, tone: "text-grid-muted" },
}

/** Agent time is stored in seconds. */
export function formatAgentTime(seconds: number | null | undefined): string | null {
  if (!seconds) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** The issue's page: inside its project when it has one, else the workspace redirect. */
export function useIssueHref() {
  const { locale } = useTranslations()
  const ws = useWorkspace()
  return (issue: Pick<Issue, "key" | "project_id">) =>
    issue.project_id
      ? `/${locale}/w/${ws.slug}/projects/${issue.project_id}/issues/${encodeURIComponent(issue.key)}`
      : `/${locale}/w/${ws.slug}/issues/${encodeURIComponent(issue.key)}`
}

export function copyText(text: string) {
  if (typeof window === "undefined") return Promise.resolve(false)
  return (navigator.clipboard?.writeText(text) ?? Promise.reject())
    .then(() => true)
    .catch(() => false)
}
