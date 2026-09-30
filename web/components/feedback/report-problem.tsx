"use client"

import { toast } from "@fadymondy/nasaq/web"
import { useNasaq } from "@fadymondy/nasaq/web"

// The shared "Report a problem" SDK: a GENERATED copy of fadymondy.com-v2/packages/feedback-sdk,
// synced into lib/feedback by `npm run grid:sync`. Never edit lib/feedback; edit the package.
import { ReportDialog, type FeedbackSubmission } from "@/lib/feedback/react"
import { dataUrlToBlob } from "@/lib/feedback/core"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

const TYPES = ["bug", "feature", "task"] as const

/**
 * The host adapter: the SDK owns the dialog, screenshot, element picker and console/network
 * capture; this file owns the transport (CSRF via lib/api), the Mahaam issue types and `meta`.
 */
export function ReportProblemDialog({
  open,
  onOpenChange,
  workspaceSlug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug?: string
}) {
  const { t, locale } = useTranslations()
  const { resolvedTheme } = useNasaq()

  async function onSubmit(payload: FeedbackSubmission) {
    const form = new FormData()
    const meta = { workspace: workspaceSlug ?? null, locale, theme: resolvedTheme ?? null }
    const fields: Record<string, string | undefined> = {
      title: payload.title,
      body: payload.body,
      issue_type: payload.issue_type,
      page_url: payload.page_url,
      route: payload.route,
      selector: payload.selector,
      console_log: payload.console_log,
      network_log: payload.network_log,
      user_agent: payload.user_agent,
      viewport: payload.viewport,
      meta: JSON.stringify({ ...(payload.meta ?? {}), ...meta }),
    }
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v)
    if (payload.screenshot) {
      const blob = dataUrlToBlob(payload.screenshot)
      form.append("screenshot", blob, `screenshot.${blob.type.split("/")[1] || "png"}`)
    }

    // A thrown ApiError keeps the SDK dialog open and shows its message. Sending the
    // workspace makes the report land in THIS workspace's issues board (the intake falls
    // back to the platform workspace when no workspace is named or you're not a member).
    const res = await api<{ key?: string }>("/api/feedback", {
      form,
      ...(workspaceSlug ? { workspaceId: workspaceSlug } : {}),
    })
    toast.success(res?.key ? t("feedback.sentWithKey", { key: res.key }) : t("feedback.sent"), {
      description: t("feedback.sentHint"),
    })
  }

  return (
    <ReportDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      locale={locale}
      types={TYPES}
      defaultType="bug"
      typeLabels={{ bug: t("feedback.type.bug"), feature: t("feedback.type.feature"), task: t("feedback.type.task") }}
      idPrefix="mahaam-feedback"
    />
  )
}
