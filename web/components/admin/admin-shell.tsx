"use client"

// The platform admin panel's frame: sidebar nav + header, guarded by /api/me/platform.
// A signed-out visitor goes to login (useRequireAuth); a signed-in non-admin sees the
// app's ordinary 404 — the API answers 404 to them too, so the panel never advertises itself.
import Link from "next/link"
import { useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import {
  Building2Icon,
  LayoutDashboardIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  PackageIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react"

import { Button, Sheet, SheetContent, SheetTitle, Skeleton } from "@fadymondy/nasaq/web"



import { CubeMark } from "@/components/brand/cube-mark"
import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls"
import { NotFoundState } from "@/components/not-found-state"
import { ErrorState } from "@/components/states"
import { UserMenu } from "@/components/workspace/user-menu"
import { usePlatform } from "@/lib/admin"
import { MAHAAM_MARK } from "@/lib/brand/mark"
import { brandName } from "@/lib/brand-name"
import { useTranslations } from "@/lib/i18n"
import { useRequireAuth } from "@/lib/use-require-auth"
import { cn } from "@/lib/utils"

function NavLink({ href, icon, children, exact = false, onNavigate }: { href: string; icon: ReactNode; children: ReactNode; exact?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname()
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 border-s-2 px-3 py-2 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "border-grid-action bg-grid-soft font-medium text-grid-fg" : "border-transparent text-grid-body hover:bg-grid-soft hover:text-grid-fg",
      )}
    >
      {icon}
      {children}
    </Link>
  )
}

function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t, locale } = useTranslations()
  const base = `/${locale}/admin`
  const L = (p: { href: string; icon: ReactNode; children: ReactNode; exact?: boolean }) => <NavLink {...p} onNavigate={onNavigate} />
  return (
    <nav className="flex flex-col py-3" aria-label={t("admin.nav")}>
      <L href={base} exact icon={<LayoutDashboardIcon />}>
        {t("admin.nav.dashboard")}
      </L>
      <L href={`${base}/users`} icon={<UsersIcon />}>
        {t("admin.nav.users")}
      </L>
      <L href={`${base}/workspaces`} icon={<Building2Icon />}>
        {t("admin.nav.workspaces")}
      </L>
      <L href={`${base}/plans`} icon={<PackageIcon />}>
        {t("admin.nav.plans")}
      </L>
      <L href={`${base}/issues`} icon={<MessageSquarePlusIcon />}>
        {t("admin.nav.issues")}
      </L>
      <L href={`${base}/audit`} icon={<ScrollTextIcon />}>
        {t("admin.nav.audit")}
      </L>
    </nav>
  )
}

function Brand() {
  const { t, locale } = useTranslations()
  return (
    <Link href={`/${locale}/admin`} className="flex items-center gap-2.5">
      <CubeMark mark={MAHAAM_MARK} size={24} />
      <span className="text-[15px] font-medium">{brandName(locale)}</span>
      <span className="grid-micro flex items-center gap-1">
        <ShieldIcon className="size-3" />
        {t("admin.badge")}
      </span>
    </Link>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { t, locale, isRtl } = useTranslations()
  const me = useRequireAuth()
  const platform = usePlatform(!!me.data)
  const [navOpen, setNavOpen] = useState(false)
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
    <div className="grid-shell">
      <aside className="grid-shell-nav sticky top-0 hidden h-dvh flex-col overflow-y-auto md:flex">
        <div className="flex h-14 items-center border-b border-line px-4">
          <Brand />
        </div>
        {isAdmin ? <AdminNav /> : null}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-background px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            {isAdmin ? (
              <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label={t("admin.nav")} onClick={() => setNavOpen(true)}>
                <MenuIcon />
              </Button>
            ) : null}
            <span className="truncate text-sm font-medium">{t("admin.title")}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/${locale}/workspaces`} />}>
              {t("admin.backToApp")}
            </Button>
            <LanguageSwitcher />
            <ThemeToggle />
            {me.data ? <UserMenu email={me.data.email} /> : null}
          </div>
        </header>
        <main className="min-w-0 flex-1">{body}</main>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="start" className="w-72 gap-0 p-0">
          <SheetTitle className="flex h-14 items-center border-b border-line px-4">
            <Brand />
          </SheetTitle>
          <AdminNav onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
