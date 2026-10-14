"use client"

// The platform admin panel's frame: sidebar nav + header, guarded by /api/me/platform.
// A signed-out visitor goes to login (useRequireAuth); a signed-in non-admin sees the
// app's ordinary 404 — the API answers 404 to them too, so the panel never advertises itself.
import Link from "next/link"
import type { ReactNode } from "react"
import {
  Building2Icon,
  LayoutDashboardIcon,
  MessageSquarePlusIcon,
  PackageIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react"
import { AppHeader, AppMain, AppShell, Badge, Button, ProductMark, Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarTrigger, Skeleton } from "@fadymondy/nasaq/web"

import { NotFoundState } from "@/components/not-found-state"
import { NavItem } from "@/components/shell/nav-item"
import { ErrorState } from "@/components/states"
import { UserMenu } from "@/components/workspace/user-menu"
import { usePlatform } from "@/lib/admin"
import { brandName } from "@/lib/brand-name"
import { useTranslations } from "@/lib/i18n"
import { useRequireAuth } from "@/lib/use-require-auth"

function AdminSidebar({ isAdmin, email }: { isAdmin: boolean; email?: string }) {
  const { t, locale } = useTranslations()
  const base = `/${locale}/admin`
  return (
    <Sidebar aria-label={t("admin.nav")}>
      <SidebarHeader>
        <Link href={base} className="flex items-center gap-2.5 px-1">
          <ProductMark brand="mahaam" size={24} title="" />
          <span className="text-label font-medium">{brandName(locale)}</span>
          <Badge variant="outline">
            <ShieldIcon />
            {t("admin.badge")}
          </Badge>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {isAdmin ? (
          <SidebarGroup>
            <NavItem href={base} exact icon={<LayoutDashboardIcon />}>
              {t("admin.nav.dashboard")}
            </NavItem>
            <NavItem href={`${base}/users`} icon={<UsersIcon />}>
              {t("admin.nav.users")}
            </NavItem>
            <NavItem href={`${base}/workspaces`} icon={<Building2Icon />}>
              {t("admin.nav.workspaces")}
            </NavItem>
            <NavItem href={`${base}/plans`} icon={<PackageIcon />}>
              {t("admin.nav.plans")}
            </NavItem>
            <NavItem href={`${base}/issues`} icon={<MessageSquarePlusIcon />}>
              {t("admin.nav.issues")}
            </NavItem>
            <NavItem href={`${base}/audit`} icon={<ScrollTextIcon />}>
              {t("admin.nav.audit")}
            </NavItem>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>{email ? <UserMenu email={email} /> : null}</SidebarFooter>
    </Sidebar>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { t, locale } = useTranslations()
  const me = useRequireAuth()
  const platform = usePlatform(!!me.data)
  const isAdmin = !!platform.data?.is_admin

  let body: ReactNode
  if (me.error || platform.error) body = <ErrorState error={me.error ?? platform.error} />
  else if (!me.data || !platform.data)
    body = (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  else if (!isAdmin) body = <NotFoundState />
  else body = children

  return (
    <AppShell sidebar={<AdminSidebar isAdmin={isAdmin} email={me.data?.email} />}>
      <AppHeader>
        <SidebarTrigger />
        <span className="min-w-0 flex-1 truncate text-label font-medium">{t("admin.title")}</span>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/${locale}/workspaces`} />}>
          {t("admin.backToApp")}
        </Button>
      </AppHeader>
      <AppMain className="p-0">{body}</AppMain>
    </AppShell>
  )
}
