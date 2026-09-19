"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  BellIcon,
  BriefcaseIcon,
  ChartColumnIcon,
  CalendarRangeIcon,
  ClockIcon,
  CoinsIcon,
  TimerIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  FolderKanbanIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  DownloadIcon,
  ReceiptTextIcon,
  PlusIcon,
  TagIcon,
  UsersIcon,
  UsersRoundIcon,
  ShieldCheckIcon,
  Settings2Icon,
  InboxIcon,
  GaugeIcon,
  BanIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CubeMark } from "@/components/brand/cube-mark";
import { LanguageSwitcher, ThemeToggle } from "@/components/header-controls";
import { ReportProblemDialog } from "@/components/feedback/report-problem";
import { AppInstallDialog, useAutoOpenAppPrompt } from "@/components/app-install-dialog";
import { NotFoundState } from "@/components/not-found-state";
import { ErrorState } from "@/components/states";
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form";
import { UserMenu } from "@/components/workspace/user-menu";
import { WorkspaceContext, type WorkspaceCtx } from "@/components/workspace/workspace-context";
import { MAHAAM_MARK } from "@/lib/brand/mark";
import { suspensionCode, type WorkspaceSummary } from "@/lib/api";
import { useTranslations } from "@/lib/i18n";
import { useCurrentWorkspace, useMyWorkspaces } from "@/lib/queries";
import { useRequireAuth } from "@/lib/use-require-auth";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/time/notification-bell";
import { TimerBar } from "@/components/time/timer-bar";
import { useLiveStream } from "@/lib/time";
import { brandName } from "@/lib/brand-name";

function Brand() {
  const { locale } = useTranslations();
  return (
    <Link href={`/${locale}/workspaces`} className="flex items-center gap-2.5">
      <CubeMark mark={MAHAAM_MARK} size={24} />
      <span className="text-[15px] font-medium">{brandName(locale)}</span>
    </Link>
  );
}

function WorkspaceSwitcher({ active, all }: { active: WorkspaceSummary; all: WorkspaceSummary[] }) {
  const { t, locale } = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);

  // Switching keeps the section (members, MCP) when it exists in every workspace.
  function hrefFor(slug: string) {
    const prefix = `/${locale}/w/${active.slug}`;
    const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    return `/${locale}/w/${slug}${rest}`;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className="h-9 max-w-[9rem] justify-between gap-2 px-2.5 sm:max-w-[16rem]"
              aria-label={t("shell.switchWorkspace")}
            />
          }
        >
          <span className="flex size-6 shrink-0 items-center justify-center border border-line bg-grid-card text-xs font-medium text-grid-brand">
            {active.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden truncate text-sm font-medium sm:inline">{active.name}</span>
          <ChevronsUpDownIcon className="text-grid-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("shell.workspaces")}</DropdownMenuLabel>
            {all.map((w) => (
              <DropdownMenuItem key={w.id} onClick={() => router.push(hrefFor(w.slug))}>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <span className="text-xs text-grid-muted">{t(`role.${w.role}`)}</span>
                {w.id === active.id ? <CheckIcon /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <PlusIcon />
            {t("workspaces.create")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("workspaces.createTitle")}</DialogTitle>
            <DialogDescription>{t("workspaces.createHint")}</DialogDescription>
          </DialogHeader>
          <CreateWorkspaceForm autoFocus onCreated={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function NavLink({
  href,
  icon,
  children,
  exact = false,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  exact?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 border-s-2 px-3 py-2 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
        active
          ? "border-grid-action bg-grid-soft font-medium text-grid-fg"
          : "border-transparent text-grid-body hover:bg-grid-soft hover:text-grid-fg",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const { t, locale } = useTranslations();
  const me = useRequireAuth();
  const list = useMyWorkspaces(!!me.data);
  const [reporting, setReporting] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const openApp = useCallback(() => setAppOpen(true), []);
  useAutoOpenAppPrompt(Boolean(me.data), openApp);
  const [navOpen, setNavOpen] = useState(false);
  const { isRtl } = useTranslations();

  const summary = list.data?.find((w) => w.slug === slug);
  const current = useCurrentWorkspace(summary?.id);
  const base = `/${locale}/w/${slug}`;
  // One context object for the header's timer/bell and the page body (the header sits outside <main>).
  const ctx: WorkspaceCtx | null = summary
    ? {
        summary,
        current: current.data,
        id: summary.id,
        slug: summary.slug,
        can: (p: string) => !!current.data?.can?.includes(p),
      }
    : null;
  // The per-user realtime stream: mounted once per tab, it keeps every view of the timer in step.
  const live = useLiveStream(summary?.id);

  const suspended = suspensionCode(me.error) ?? suspensionCode(list.error) ?? suspensionCode(current.error);

  let body: ReactNode;
  if (suspended) body = <SuspendedState code={suspended} message={(me.error ?? list.error ?? current.error)?.message} />;
  else if (me.error || list.error) body = <ErrorState error={me.error ?? list.error} />;
  else if (!me.data || !list.data) body = <ShellSkeleton />;
  else if (!summary)
    body = (
      <NotFoundState
        title={t("shell.unknownWorkspace")}
        body={t("shell.unknownWorkspaceBody", { slug })}
        backHref={`/${locale}/workspaces`}
        backLabel={t("shell.allWorkspaces")}
      />
    );
  else if (current.error) body = <ErrorState error={current.error} />;
  else
    body = (
      <WorkspaceContext.Provider
        value={{
          summary,
          current: current.data,
          id: summary.id,
          slug: summary.slug,
          can: (p) => !!current.data?.can?.includes(p),
        }}
      >
        {children}
      </WorkspaceContext.Provider>
    );

  return (
    <div className="grid-shell">
      <aside className="grid-shell-nav sticky top-0 hidden h-dvh flex-col overflow-y-auto md:flex">
        <div className="flex h-14 items-center border-b border-line px-4">
          <Brand />
        </div>
        {summary ? <ShellNav base={base} can={current.data?.can ?? []} isOwner={summary.role === "owner"} /> : null}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header
          className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-background px-3 sm:px-4"
          data-live={live}
        >
          <div className="flex min-w-0 items-center gap-1">
            {summary ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label={t("shell.navigation")}
                onClick={() => setNavOpen(true)}
              >
                <MenuIcon />
              </Button>
            ) : null}
            {summary && list.data ? (
              <WorkspaceSwitcher active={summary} all={list.data} />
            ) : (
              <Skeleton className="h-6 w-40" />
            )}
            {ctx ? (
              <WorkspaceContext.Provider value={ctx}>
                <TimerBar />
              </WorkspaceContext.Provider>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {me.data ? (
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => setReporting(true)}
                aria-label={t("feedback.report")}
              >
                <MessageSquarePlusIcon />
                <span className="hidden sm:inline">{t("feedback.report")}</span>
              </Button>
            ) : null}
            {me.data ? (
              <Button variant="ghost" size="icon-sm" onClick={openApp} aria-label={t("pwa.title")} title={t("pwa.title")}>
                <DownloadIcon />
              </Button>
            ) : null}
            {ctx ? (
              <WorkspaceContext.Provider value={ctx}>
                <NotificationBell />
              </WorkspaceContext.Provider>
            ) : null}
            <LanguageSwitcher />
            <ThemeToggle />
            {me.data ? (
              <UserMenu
                email={me.data.email}
                onReport={() => setReporting(true)}
                profileHref={ctx ? `${base}/me` : undefined}
              />
            ) : null}
          </div>
        </header>
        <main className="min-w-0 flex-1">{body}</main>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side={isRtl ? "right" : "left"} className="w-72 gap-0 p-0" data-mobile-nav>
          <SheetTitle className="flex h-14 items-center border-b border-line px-4">
            <Brand />
          </SheetTitle>
          {summary ? (
            <ShellNav
              base={base}
              can={current.data?.can ?? []} isOwner={summary.role === "owner"}
              onNavigate={() => setNavOpen(false)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <AppInstallDialog open={appOpen} onOpenChange={setAppOpen} />
      <ReportProblemDialog
        open={reporting}
        onOpenChange={setReporting}
        workspaceSlug={summary?.slug}
      />
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/** The workspace navigation: the sticky sidebar on desktop, a slide-out sheet below md. */
function ShellNav({
  base,
  can,
  isOwner,
  onNavigate,
}: {
  base: string;
  can: string[];
  isOwner?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslations();
  const L = (props: { href: string; icon: ReactNode; children: ReactNode; exact?: boolean }) => (
    <NavLink {...props} onNavigate={onNavigate} />
  );
  // A client is external: they get only the portal (their projects, issues and
  // invoices). members:read is the Member tier, which a client never holds, so
  // its absence identifies the client role without threading the role in.
  const isClient = !can.includes("members:read");
  if (isClient) {
    return (
      <nav className="flex flex-col py-3" aria-label={t("shell.navigation")}>
        <L href={`${base}/portal`} icon={<LayoutGridIcon />}>
          {t("nav.portal")}
        </L>
        <L href={`${base}/settings/mcp`} icon={<KeyRoundIcon />}>
          {t("nav.connectAi")}
        </L>
      </nav>
    );
  }
  return (
    <nav className="flex flex-col py-3" aria-label={t("shell.navigation")}>
      <L href={base} exact icon={<LayoutGridIcon />}>
        {t("nav.overview")}
      </L>
      <L href={`${base}/projects`} icon={<FolderKanbanIcon />}>
        {t("nav.projects")}
      </L>
      {can.includes("time:track") ? (
        <L href={`${base}/time`} exact icon={<ClockIcon />}>
          {t("nav.time")}
        </L>
      ) : null}
      {can.includes("time:manage") ? (
        <L href={`${base}/time/team`} icon={<CalendarRangeIcon />}>
          {t("nav.teamTime")}
        </L>
      ) : null}
      {can.includes("reports:read") ? (
        <L href={`${base}/reports`} icon={<ChartColumnIcon />}>
          {t("nav.reports")}
        </L>
      ) : null}
      {can.includes("clients:read") ? (
        <L href={`${base}/clients`} icon={<BriefcaseIcon />}>
          {t("nav.clients")}
        </L>
      ) : null}
      {can.includes("invoices:read") ? (
        <L href={`${base}/invoices`} icon={<ReceiptTextIcon />}>
          {t("nav.invoices")}
        </L>
      ) : null}
      {can.includes("teams:read") ? (
        <L href={`${base}/teams`} icon={<UsersRoundIcon />}>
          {t("nav.teams")}
        </L>
      ) : null}
      <L href={`${base}/members`} icon={<UsersIcon />}>
        {t("nav.members")}
      </L>
      <L href={`${base}/issues`} icon={<MessageSquarePlusIcon />}>
        {t("nav.issues")}
      </L>
      {can.includes("requests:manage") ? (
        <L href={`${base}/requests`} icon={<InboxIcon />}>
          {t("nav.requests")}
        </L>
      ) : null}
      <p className="grid-micro mt-4 border-t border-line px-4 pt-4 pb-1">{t("nav.settings")}</p>
      <L href={`${base}/settings/labels`} icon={<TagIcon />}>
        {t("nav.labels")}
      </L>
      {can.includes("access:manage") ? (
        <L href={`${base}/settings/access`} icon={<ShieldCheckIcon />}>
          {t("nav.access")}
        </L>
      ) : null}
      <L href={`${base}/settings/mcp`} icon={<KeyRoundIcon />}>
        {t("nav.mcpTokens")}
      </L>
      <L href={`${base}/settings/time`} icon={<TimerIcon />}>
        {t("nav.timeSettings")}
      </L>
      <L href={`${base}/settings/notifications`} icon={<BellIcon />}>
        {t("nav.notifications")}
      </L>
      {isOwner ? (
        <L href={`${base}/settings/workspace`} icon={<Settings2Icon />}>
          {t("nav.workspaceSettings")}
        </L>
      ) : null}
      {can.includes("workspace:update") ? (
        <L href={`${base}/settings/plan`} icon={<GaugeIcon />}>
          {t("nav.plan")}
        </L>
      ) : null}
      {can.includes("rates:read") ? (
        <L href={`${base}/settings/rates`} icon={<CoinsIcon />}>
          {t("nav.rates")}
        </L>
      ) : null}
    </nav>
  );
}

/** The whole account or this workspace is suspended by a platform admin: say so plainly. */
function SuspendedState({ code, message }: { code: "workspace_suspended" | "account_suspended"; message?: string }) {
  const { t, locale } = useTranslations();
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-20 text-center" role="alert" data-suspended={code}>
      <BanIcon className="size-10 text-grid-danger" />
      <h1 className="grid-title text-2xl">{t(code === "workspace_suspended" ? "suspended.workspaceTitle" : "suspended.accountTitle")}</h1>
      <p className="grid-body max-w-md text-sm">{message || t(code === "workspace_suspended" ? "suspended.workspaceBody" : "suspended.accountBody")}</p>
      {code === "workspace_suspended" ? (
        <Button variant="outline" nativeButton={false} render={<Link href={`/${locale}/workspaces`} />}>
          {t("shell.allWorkspaces")}
        </Button>
      ) : null}
    </div>
  );
}
