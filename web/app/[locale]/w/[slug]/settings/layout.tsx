"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { BellIcon, CoinsIcon, GaugeIcon, KeyRoundIcon, Settings2Icon, ShieldCheckIcon, TimerIcon } from "lucide-react"
import { SettingsSections } from "@fadymondy/nasaq/web"

import { Page } from "@/components/page"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"

/*
Workspace settings on Nasaq's SettingsSections: one "Settings" title, a grouped side nav (a select on
small screens) and the open page on the right. Each settings page is still its own route, so the nav
navigates and only the open page has content; the pages a role can't use aren't listed (the routes
and endpoints enforce it too). A route outside the nav (the old /settings/labels) renders plainly; /settings
itself (the sidebar's one Settings entry) goes on to the first page.
*/
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const pathname = usePathname()
  const base = `/${locale}/w/${ws.slug}/settings`
  const owner = ws.summary.role === "owner" || ws.summary.role === "admin"

  const groups = [
    {
      id: "workspace",
      label: t("settings.wsGroup.workspace"),
      pages: [
        { id: "workspace", label: t("nav.workspaceSettings"), icon: <Settings2Icon />, ok: owner },
        { id: "plan", label: t("nav.plan"), icon: <GaugeIcon />, ok: ws.can("workspace:update") },
        { id: "rates", label: t("nav.rates"), icon: <CoinsIcon />, ok: ws.can("rates:read") },
        { id: "time", label: t("nav.timeSettings"), icon: <TimerIcon />, ok: true },
      ],
    },
    {
      id: "people",
      label: t("settings.wsGroup.people"),
      pages: [
        { id: "access", label: t("nav.access"), icon: <ShieldCheckIcon />, ok: ws.can("access:manage") },
        { id: "notifications", label: t("nav.notifications"), icon: <BellIcon />, ok: true },
      ],
    },
    {
      id: "developers",
      label: t("settings.wsGroup.developers"),
      pages: [{ id: "mcp", label: t("nav.mcpTokens"), icon: <KeyRoundIcon />, ok: true }],
    },
  ]
    .map((g) => ({ ...g, pages: g.pages.filter((p) => p.ok) }))
    .filter((g) => g.pages.length > 0)

  const active = pathname.slice(base.length + 1).split("/")[0] ?? ""
  const listed = groups.some((g) => g.pages.some((p) => p.id === active))
  // The sidebar links to /settings: open the first page this role can use.
  const first = groups[0]?.pages[0]?.id
  useEffect(() => {
    if (active === "" && first) router.replace(`${base}/${first}`)
  }, [active, first, base, router])
  if (active === "") return null
  if (!listed) return <Page>{children}</Page>

  return (
    <Page wide>
      <SettingsSections
        className="max-w-none"
        groups={groups.map((g) => ({
          id: g.id,
          label: g.label,
          pages: g.pages.map((p) => ({ id: p.id, label: p.label, icon: p.icon, content: p.id === active ? children : null })),
        }))}
        value={active}
        onValueChange={(id) => router.push(`${base}/${id}`)}
        title={t("nav.settings")}
        description={null}
        searchable={false}
      />
    </Page>
  )
}
