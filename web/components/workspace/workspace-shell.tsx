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
  FolderKanbanIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  MessageSquarePlusIcon,
  DownloadIcon,
  PlugZapIcon,
  ReceiptTextIcon,
  TagIcon,
  UsersIcon,
  UsersRoundIcon,
  ShieldCheckIcon,
  Settings2Icon,
  InboxIcon,
  GaugeIcon,
  BanIcon,
} from "lucide-react";

import {
  AppHeader,
  AppMain,
  AppShell,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ProductMark,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarTrigger,
  Skeleton,
  WorkspaceSwitcher,
} from "@fadymondy/nasaq/web";

import { ReportProblemDialog } from "@/components/feedback/report-problem";
import { AppInstallDialog, useAutoOpenAppPrompt } from "@/components/app-install-dialog";
import { ConnectAgentDialog } from "@/components/mcp/connect-agent-dialog";
import { NotFoundState } from "@/components/not-found-state";
import { NavItem } from "@/components/shell/nav-item";
import { ErrorState } from "@/components/states";
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form";
import { UserMenu } from "@/components/workspace/user-menu";
import { WorkspaceContext, type WorkspaceCtx } from "@/components/workspace/workspace-context";
import { suspensionCode, type WorkspaceSummary } from "@/lib/api";
import { useTranslations } from "@/lib/i18n";
import { useCurrentWorkspace, useMyWorkspaces } from "@/lib/queries";
import { useRequireAuth } from "@/lib/use-require-auth";
import { NotificationBell } from "@/components/time/notification-bell";
import { TimerBar } from "@/components/time/timer-bar";
import { useLiveStream } from "@/lib/time";
import { brandName } from "@/lib/brand-name";

/** The sidebar: brand, workspace switcher (with create), the permission-gated navigation, the account menu. */
function ShellSidebar({
  base,
  summary,
  all,
  can,
  email,
  onReport,
}: {
  base: string;
  summary?: WorkspaceSummary;
  all?: WorkspaceSummary[];
  can: string[];
  email?: string;
  onReport: () => void;
}) {
  const { t, locale } = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);

  // Switching keeps the section (members, MCP) when it exists in every workspace.
  const switchTo = useCallback(
    (id: string) => {
      const next = all?.find((w) => w.id === id);
      if (!next || !summary) return;
      const prefix = `/${locale}/w/${summary.slug}`;
      const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
      router.push(`/${locale}/w/${next.slug}${rest}`);
    },
    [all, summary, locale, pathname, router],
  );

  return (
    <Sidebar aria-label={t("shell.navigation")}>
      <SidebarHeader>
        <Link href={`/${locale}/workspaces`} className="flex items-center gap-2.5 px-1" aria-label={brandName(locale)}>
          <ProductMark brand="mahaam" size={24} title="" />
          <span className="text-label font-medium">{brandName(locale)}</span>
        </Link>
        {summary && all ? (
          <WorkspaceSwitcher
            workspaces={all.map((w) => ({ id: w.id, name: w.name, description: t(`role.${w.role}`) }))}
            value={summary.id}
            onValueChange={switchTo}
            onCreate={() => setCreating(true)}
            labels={{ heading: t("shell.workspaces"), create: t("workspaces.create") }}
          />
        ) : (
          <Skeleton className="h-9 w-full" />
        )}
      </SidebarHeader>
      <SidebarContent>{summary ? <ShellNav base={base} can={can} isOwner={summary.role === "owner"} /> : null}</SidebarContent>
      <SidebarFooter>
        {email ? <UserMenu email={email} onReport={onReport} profileHref={summary ? `${base}/me` : undefined} /> : null}
      </SidebarFooter>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("workspaces.createTitle")}</DialogTitle>
            <DialogDescription>{t("workspaces.createHint")}</DialogDescription>
          </DialogHeader>
          <CreateWorkspaceForm autoFocus onCreated={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const { t, locale } = useTranslations();
  const me = useRequireAuth();
  const list = useMyWorkspaces(!!me.data);
  const [reporting, setReporting] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const openApp = useCallback(() => setAppOpen(true), []);
  useAutoOpenAppPrompt(Boolean(me.data), openApp);

  const summary = list.data?.find((w) => w.slug === slug);
  const current = useCurrentWorkspace(summary?.id);
  const base = `/${locale}/w/${slug}`;
  // One context object for the sidebar, the header's timer/bell and the page body.
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
  else body = children;

  const shell = (
    <AppShell
      sidebar={
        <ShellSidebar
          base={base}
          summary={summary}
          all={list.data}
          can={current.data?.can ?? []}
          email={me.data?.email}
          onReport={() => setReporting(true)}
        />
      }
    >
      <AppHeader data-live={live}>
        <SidebarTrigger />
        {ctx ? <TimerBar /> : null}
        <div className="ms-auto flex items-center gap-1">
          {me.data ? (
            <Button variant="secondary" size="sm" className="hidden sm:inline-flex" onClick={() => setReporting(true)} aria-label={t("feedback.report")}>
              <MessageSquarePlusIcon />
              <span className="hidden lg:inline">{t("feedback.report")}</span>
            </Button>
          ) : null}
          {ctx ? (
            <Button variant="secondary" size="sm" className="hidden sm:inline-flex" onClick={() => setConnectOpen(true)} aria-label={t("mcp.connectTitle")}>
              <PlugZapIcon />
              <span className="hidden lg:inline">{t("mcp.connectAgent")}</span>
            </Button>
          ) : null}
          {me.data ? (
            <Button variant="ghost" size="icon-sm" onClick={openApp} aria-label={t("pwa.title")} title={t("pwa.title")}>
              <DownloadIcon />
            </Button>
          ) : null}
          {ctx ? <NotificationBell /> : null}
        </div>
      </AppHeader>
      <AppMain className="p-0">{body}</AppMain>

      <AppInstallDialog open={appOpen} onOpenChange={setAppOpen} />
      {ctx ? <ConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} /> : null}
      <ReportProblemDialog open={reporting} onOpenChange={setReporting} workspaceSlug={summary?.slug} />
    </AppShell>
  );

  return ctx ? <WorkspaceContext.Provider value={ctx}>{shell}</WorkspaceContext.Provider> : shell;
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

/** The workspace navigation, gated by the caller's permissions. */
function ShellNav({ base, can, isOwner }: { base: string; can: string[]; isOwner?: boolean }) {
  const { t } = useTranslations();
  // A client is external: they get only the portal (their projects, issues and
  // invoices). members:read is the Member tier, which a client never holds, so
  // its absence identifies the client role without threading the role in.
  const isClient = !can.includes("members:read");
  if (isClient) {
    return (
      <SidebarGroup>
        <NavItem href={`${base}/portal`} icon={<LayoutGridIcon />}>
          {t("nav.portal")}
        </NavItem>
        <NavItem href={`${base}/settings/mcp`} icon={<KeyRoundIcon />}>
          {t("nav.connectAi")}
        </NavItem>
      </SidebarGroup>
    );
  }
  return (
    <>
      <SidebarGroup>
        <NavItem href={base} exact icon={<LayoutGridIcon />}>
          {t("nav.overview")}
        </NavItem>
        <NavItem href={`${base}/projects`} icon={<FolderKanbanIcon />}>
          {t("nav.projects")}
        </NavItem>
        {can.includes("time:track") ? (
          <NavItem href={`${base}/time`} exact icon={<ClockIcon />}>
            {t("nav.time")}
          </NavItem>
        ) : null}
        {can.includes("time:manage") ? (
          <NavItem href={`${base}/time/team`} icon={<CalendarRangeIcon />}>
            {t("nav.teamTime")}
          </NavItem>
        ) : null}
        {can.includes("reports:read") ? (
          <NavItem href={`${base}/reports`} icon={<ChartColumnIcon />}>
            {t("nav.reports")}
          </NavItem>
        ) : null}
        {can.includes("clients:read") ? (
          <NavItem href={`${base}/clients`} icon={<BriefcaseIcon />}>
            {t("nav.clients")}
          </NavItem>
        ) : null}
        {can.includes("invoices:read") ? (
          <NavItem href={`${base}/invoices`} icon={<ReceiptTextIcon />}>
            {t("nav.invoices")}
          </NavItem>
        ) : null}
        {can.includes("teams:read") ? (
          <NavItem href={`${base}/teams`} icon={<UsersRoundIcon />}>
            {t("nav.teams")}
          </NavItem>
        ) : null}
        <NavItem href={`${base}/members`} icon={<UsersIcon />}>
          {t("nav.members")}
        </NavItem>
        {can.includes("requests:manage") ? (
          <NavItem href={`${base}/requests`} icon={<InboxIcon />}>
            {t("nav.requests")}
          </NavItem>
        ) : null}
      </SidebarGroup>
      <SidebarGroup label={t("nav.settings")}>
        <NavItem href={`${base}/settings/labels`} icon={<TagIcon />}>
          {t("nav.labels")}
        </NavItem>
        {can.includes("access:manage") ? (
          <NavItem href={`${base}/settings/access`} icon={<ShieldCheckIcon />}>
            {t("nav.access")}
          </NavItem>
        ) : null}
        <NavItem href={`${base}/settings/mcp`} icon={<KeyRoundIcon />}>
          {t("nav.mcpTokens")}
        </NavItem>
        <NavItem href={`${base}/settings/time`} icon={<TimerIcon />}>
          {t("nav.timeSettings")}
        </NavItem>
        <NavItem href={`${base}/settings/notifications`} icon={<BellIcon />}>
          {t("nav.notifications")}
        </NavItem>
        {isOwner ? (
          <NavItem href={`${base}/settings/workspace`} icon={<Settings2Icon />}>
            {t("nav.workspaceSettings")}
          </NavItem>
        ) : null}
        {can.includes("workspace:update") ? (
          <NavItem href={`${base}/settings/plan`} icon={<GaugeIcon />}>
            {t("nav.plan")}
          </NavItem>
        ) : null}
        {can.includes("rates:read") ? (
          <NavItem href={`${base}/settings/rates`} icon={<CoinsIcon />}>
            {t("nav.rates")}
          </NavItem>
        ) : null}
      </SidebarGroup>
    </>
  );
}

/** The whole account or this workspace is suspended by a platform admin: say so plainly. */
function SuspendedState({ code, message }: { code: "workspace_suspended" | "account_suspended"; message?: string }) {
  const { t, locale } = useTranslations();
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-20 text-center" role="alert" data-suspended={code}>
      <BanIcon className="size-10 text-nq-danger-text" />
      <h1 className="text-h1">{t(code === "workspace_suspended" ? "suspended.workspaceTitle" : "suspended.accountTitle")}</h1>
      <p className="max-w-md text-body text-nq-fg-body">{message || t(code === "workspace_suspended" ? "suspended.workspaceBody" : "suspended.accountBody")}</p>
      {code === "workspace_suspended" ? (
        <Button variant="secondary" nativeButton={false} render={<Link href={`/${locale}/workspaces`} />}>
          {t("shell.allWorkspaces")}
        </Button>
      ) : null}
    </div>
  );
}
