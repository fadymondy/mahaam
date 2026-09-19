"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BriefcaseIcon, FolderKanbanIcon, KeyRoundIcon, UsersIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/public-frame"
import { Ltr } from "@/components/copy-field"
import { ActivityFeed } from "@/components/work/activity-feed"
import { MyWork } from "@/components/work/my-work"
import { useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { useWorkspaceActivity } from "@/lib/work"

export default function OverviewPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("nav.overview")} · ${ws.summary.name}`)
  const base = `/${locale}/w/${ws.slug}`
  const details = ws.current?.workspace
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const canFeed = ws.can("activity:read")
  const activity = useWorkspaceActivity(ws.id, canFeed)
  const router = useRouter()
  // A customer's home is their portal, not the staff overview.
  const isCustomer = ws.summary.role === "client"
  useEffect(() => {
    if (isCustomer) router.replace(`${base}/portal`)
  }, [isCustomer, base, router])
  if (isCustomer) return null

  return (
    <>
      <SectionHeader micro={t("nav.overview")} title={ws.summary.name} action={<Badge variant="outline">{t(`role.${ws.summary.role}`)}</Badge>} />

      <MyWork meId={me.data ? String(me.data.id) : undefined} />

      <div className="flex flex-wrap gap-2 px-6 py-6">
        <Button nativeButton={false} render={<Link href={`${base}/projects`} />}>
          <FolderKanbanIcon />
          {t("nav.projects")}
        </Button>
        {ws.can("clients:read") ? (
          <Button variant="outline" nativeButton={false} render={<Link href={`${base}/clients`} />}>
            <BriefcaseIcon />
            {t("nav.clients")}
          </Button>
        ) : null}
        <Button variant="outline" nativeButton={false} render={<Link href={`${base}/members`} />}>
          <UsersIcon />
          {t("nav.members")}
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href={`${base}/settings/mcp`} />}>
          <KeyRoundIcon />
          {t("nav.mcpTokens")}
        </Button>
      </div>

      <dl className="grid grid-cols-1 divide-y divide-line border-y border-line text-sm sm:grid-cols-4 sm:divide-x sm:divide-y-0 rtl:sm:divide-x-reverse">
        {[
          [t("overview.slug"), <Ltr key="s" mono>/{ws.slug}</Ltr>],
          [t("overview.locale"), details?.locale ? <Ltr key="l" mono>{details.locale}</Ltr> : "—"],
          [t("overview.timezone"), details?.timezone ? <Ltr key="tz" mono>{details.timezone}</Ltr> : "—"],
          [t("overview.currency"), details?.currency ? <Ltr key="c" mono>{details.currency}</Ltr> : "—"],
        ].map(([label, value], i) => (
          <div key={i} className="px-6 py-4">
            <dt className="grid-micro mb-1">{label}</dt>
            <dd className="text-grid-fg">{value}</dd>
          </div>
        ))}
      </dl>

      {canFeed ? (
        <>
          <h2 className="px-6 pt-6 pb-3 text-base font-medium">{t("overview.recentActivity")}</h2>
          <ActivityFeed items={activity.data?.activity} loading={activity.isLoading} error={activity.error} dir={dir} />
        </>
      ) : null}
    </>
  )
}
