"use client"

// The project overview's budget panel: hours (and money for managers) spent against the budget.
// Clients cannot read budgets (403), so the panel is not rendered for them.
import Link from "next/link"
import { SettingsIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BudgetMeters, LevelBadge } from "@/components/reports/budget-meter"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useProjectBudget } from "@/lib/reports"

export function ProjectBudgetPanel({ projectId, canManage, settingsHref }: { projectId: string; canManage: boolean; settingsHref: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const isClient = ws.current?.role === "client"
  const enabled = !!ws.current && !isClient
  const res = useProjectBudget(ws.id, enabled ? projectId : null)
  if (!enabled || res.error) return null
  const b = res.data
  const finance = ws.can("reports:finance")

  return (
    <section className="border-b border-line px-6 py-4" aria-label={t("budget.title")} data-budget-panel data-level={b?.level ?? ""}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{t("budget.title")}</h2>
        {b && b.level !== "none" ? <LevelBadge level={b.level} /> : null}
      </div>
      {!b ? (
        <Skeleton className="h-10 w-full max-w-xl" />
      ) : b.level === "none" ? (
        <div className="flex flex-wrap items-center justify-between gap-3" data-budget-none>
          <div className="space-y-0.5">
            <p className="text-sm text-grid-body">{t("budget.none")}</p>
            {canManage ? <p className="text-xs text-grid-muted">{t("budget.noneManager")}</p> : null}
          </div>
          {canManage ? (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={settingsHref} />} data-budget-settings>
              <SettingsIcon />
              {t("budget.setInSettings")}
            </Button>
          ) : null}
        </div>
      ) : (
        <BudgetMeters b={b} finance={finance} className="max-w-3xl" />
      )}
    </section>
  )
}
