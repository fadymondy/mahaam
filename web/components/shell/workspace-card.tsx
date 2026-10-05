"use client"

// The sidebar's bottom card: the plan and the most-used limit. Plan and usage come from
// /api/w/plan, which only owners and admins may read; for everyone else the card is hidden.
import Link from "next/link"
import { ArrowUpRightIcon } from "lucide-react"
import { SidebarExpandedOnly } from "@fadymondy/nasaq/web"

import { UsageBar } from "@/components/admin/usage"
import { planName, usagePercent, useWorkspacePlan } from "@/lib/admin"
import type { WorkspaceSummary } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

export function WorkspaceCard({ summary, base, canPlan }: { summary: WorkspaceSummary; base: string; canPlan: boolean }) {
  const { t, locale } = useTranslations()
  const plan = useWorkspacePlan(canPlan ? summary.id : undefined)
  const report = plan.data
  // The limit closest to (or over) its cap; unlimited ones have no percentage.
  const tightest = report?.items
    .filter((i) => i.limit != null && !i.key.includes("per_minute"))
    .sort((a, b) => (usagePercent(b) ?? 0) - (usagePercent(a) ?? 0))[0]

  if (!canPlan || !report) return null
  return (
    <SidebarExpandedOnly>
          <div className="flex flex-col gap-2 border border-border bg-background/60 px-3 py-2.5" data-workspace-card>
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption text-muted-foreground">{t("shell.planCard")}</span>
              <span className="truncate text-sm font-medium text-foreground" data-plan-name={report.plan.key}>
                {planName(report.plan, locale)}
              </span>
            </div>
            {tightest ? <UsageBar item={tightest} compact /> : null}
            <Link href={`${base}/settings/plan`} className="inline-flex items-center gap-1 text-caption text-nq-action-text hover:underline">
              {t("shell.upgrade")}
              <ArrowUpRightIcon className="size-3 rtl:-scale-x-100" />
            </Link>
          </div>
    </SidebarExpandedOnly>
  )
}
