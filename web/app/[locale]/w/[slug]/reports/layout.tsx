"use client"

// Reports: Time (the grouped report), Budgets (every project's burn) and Profitability (manager+).
// Tabs are sub-routes so each view has its own URL, title and saved-view kind.
import Link from "next/link"
import type { ReactNode } from "react"
import { usePathname } from "next/navigation"

import { Tabs, TabsList, TabsTab } from "@fadymondy/nasaq/web"

import { Page, PageHeader } from "@/components/page"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"

import "@/app/styles/reports-print.css"

export default function ReportsLayout({ children }: { children: ReactNode }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const pathname = usePathname()
  const base = `/${locale}/w/${ws.slug}/reports`
  const tabs = [
    { value: "time", href: base, show: true },
    { value: "budgets", href: `${base}/budgets`, show: true },
    { value: "profitability", href: `${base}/profitability`, show: ws.can("reports:finance") },
  ].filter((x) => x.show)
  const tab = pathname.endsWith("/budgets") ? "budgets" : pathname.endsWith("/profitability") ? "profitability" : "time"

  if (ws.current && !ws.can("reports:read")) return (
      <Page>
        <p className="text-sm text-muted-foreground">{t("reports.noPermission")}</p>
      </Page>
    )

  return (
    <Page wide data-reports={tab}>
      <div className="flex flex-col gap-4" data-print-hide>
        <PageHeader title={t("reports.title")} description={t("reports.hint")} />
        <Tabs value={tab}>
            <TabsList variant="underline">
              {tabs.map((x) => (
                <TabsTab key={x.value} value={x.value} nativeButton={false} render={<Link href={x.href} />} data-report-tab={x.value}>
                  {t(`reports.tab.${x.value}`)}
                </TabsTab>
              ))}
            </TabsList>
        </Tabs>
      </div>
      {children}
    </Page>
  )
}
