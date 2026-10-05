"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  BriefcaseIcon,
  ChartColumnIcon,
  CalendarRangeIcon,
  HomeIcon,
  ClockIcon,
  FolderKanbanIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  ReceiptTextIcon,
  UsersIcon,
  UsersRoundIcon,
  Settings2Icon,
  InboxIcon,
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
  BootSplash,
  ProductMark,
  Sidebar,
  SidebarContent,
  SidebarExpandedOnly,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarTrigger,
  Skeleton,
  WorkspaceSwitcher,
} from "@fadymondy/nasaq/web";

import { ReportProblemDialog } from "@/components/feedback/report-problem";
import { AppInstallDialog, useAutoOpenAppPrompt } from "@/components/app-install-dialog";
import { ConnectAgentButton, ConnectAgentSheet } from "@/components/mcp/connect-agent-sheet";
import { NotFoundState } from "@/components/not-found-state";
import { NavItem } from "@/components/shell/nav-item";
import { GlobalSearch } from "@/components/shell/global-search";
import { ErrorState } from "@/components/states";
import { CreateWorkspaceForm } from "@/components/workspace/create-workspace-form";
import { UserMenu } from "@/components/workspace/user-menu";
import { WorkspaceContext, type WorkspaceCtx } from "@/components/workspace/workspace-context";
import { ViewAsBanner } from "@/components/workspace/view-as-banner";
import { ApiError, suspensionCode, type WorkspaceSummary } from "@/lib/api";
import { clearViewAs } from "@/lib/view-as";
import { useTranslations } from "@/lib/i18n";
import { useCurrentWorkspace, useMyWorkspaces } from "@/lib/queries";
import { useRequireAuth } from "@/lib/use-require-auth";
import { NotificationBell } from "@/components/time/notification-bell";
import { TimerBar } from "@/components/time/timer-bar";
import { useLiveStream } from "@/lib/time";
import { brandName } from "@/lib/brand-name";

/** The sidebar (Nasaq dashboard layout): brand, workspace switcher and search on top, the permission-gated
 * navigation, then the account menu (help, theme, language) at the bottom. */
function ShellSidebar({
  base,
  summary,
  all,
  can,
  email,
  onReport,
  onInstall,
}: {
  base: string;
  summary?: WorkspaceSummary;
  all?: WorkspaceSummary[];
  can: string[];
  email?: string;
  onReport: () => void;
  onInstall: () => void;
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
        <Link href={summary ? base : `/${locale}/workspaces`} className="flex items-center gap-2.5 px-1" aria-label={brandName(locale)}>
          <ProductMark brand="mahaam" size={28} title="" />
          <SidebarExpandedOnly>
            <span className="text-label font-semibold">{brandName(locale)}</span>
          </SidebarExpandedOnly>
        </Link>
        {summary && all ? (
          <WorkspaceSwitcher
            workspaces={all.map((w) => ({ id: w.id, name: w.name, description: t(`role.${w.role}`), logoSrc: w.logo ?? undefined }))}
            value={summary.id}
            onValueChange={switchTo}
            onCreate={() => setCreating(true)}
            labels={{ heading: t("shell.workspaces"), create: t("workspaces.create") }}
          />
        ) : (
          <Skeleton className="h-9 w-full" />
        )}
        {summary ? <GlobalSearch /> : null}
      </SidebarHeader>
      <SidebarContent>{summary ? <ShellNav base={base} can={can} isOwner={summary.role === "owner" || summary.role === "admin"} /> : null}</SidebarContent>
      <SidebarFooter>
        {email ? <UserMenu email={email} onReport={onReport} onInstall={onInstall} profileHref={summary ? `${base}/me` : undefined} /> : null}
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

  // A stale view-as (the member left or now outranks you): drop it and load your own view.
  const viewAsDenied = current.error instanceof ApiError && current.error.code === "view_as_denied";
  useEffect(() => {
    if (!viewAsDenied) return;
    clearViewAs();
    window.location.reload();
  }, [viewAsDenied]);

  const suspended = suspensionCode(me.error) ?? suspensionCode(list.error) ?? suspensionCode(current.error);

  // Until we know who you are, which workspaces you have and what you can do here, show Nasaq's boot
  // splash instead of a half-built shell (empty nav, empty header) that looks broken.
  const booting =
    !suspended && !me.error && !list.error && !current.error && (!me.data || !list.data || (!!summary && !current.data));
  if (booting) return <BootSplash mark={<ProductMark brand="mahaam" size={56} title="" />} name={brandName(locale)} />;

  let body: ReactNode;
  if (suspended) body = <SuspendedState code={suspended} message={(me.error ?? list.error ?? current.error)?.message} />;
  else if (me.error || list.error) body = <ErrorState error={me.error ?? list.error} />;
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
          onInstall={openApp}
        />
      }
    >
      <AppHeader data-live={live}>
        <SidebarTrigger />
        {ctx ? <TimerBar /> : null}
        <div className="ms-auto flex items-center gap-1">
          {ctx ? <ConnectAgentButton onClick={() => setConnectOpen(true)} /> : null}
          {ctx ? <NotificationBell /> : null}
        </div>
      </AppHeader>
      <AppMain className="p-0">
        {current.data?.viewing_as ? <ViewAsBanner viewing={current.data.viewing_as} home={base} /> : null}
        {body}
      </AppMain>

      <AppInstallDialog open={appOpen} onOpenChange={setAppOpen} />
      {ctx ? <ConnectAgentSheet open={connectOpen} onOpenChange={setConnectOpen} /> : null}
      <ReportProblemDialog open={reporting} onOpenChange={setReporting} workspaceSlug={summary?.slug} />
    </AppShell>
  );

  return ctx ? <WorkspaceContext.Provider value={ctx}>{shell}</WorkspaceContext.Provider> : shell;
}

/** The workspace navigation, gated by the caller's permissions. */
function ShellNav({ base, can }: { base: string; can: string[]; isOwner?: boolean }) {
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
  const item = (perm: string | null, href: string, icon: ReactNode, label: string, exact = false) =>
    perm === null || can.includes(perm) ? (
      <NavItem href={href} exact={exact} icon={icon}>
        {label}
      </NavItem>
    ) : null;
  const hasTime = can.includes("time:track") || can.includes("time:manage");
  return (
    <>
      <SidebarGroup>
        {item(null, base, <HomeIcon />, t("nav.home"), true)}
        {item(null, `${base}/projects`, <FolderKanbanIcon />, t("nav.projects"))}
        {item(null, `${base}/members`, <UsersIcon />, t("nav.team"))}
        {item("reports:read", `${base}/reports`, <ChartColumnIcon />, t("nav.reports"))}
      </SidebarGroup>
      <SidebarGroup label={t("nav.workspace")}>
        {item("clients:read", `${base}/clients`, <BriefcaseIcon />, t("nav.clients"))}
        {item("invoices:read", `${base}/invoices`, <ReceiptTextIcon />, t("nav.invoices"))}
        {item("teams:read", `${base}/teams`, <UsersRoundIcon />, t("nav.teams"))}
        {item("requests:manage", `${base}/requests`, <InboxIcon />, t("nav.requests"))}
      </SidebarGroup>
      {hasTime ? (
        <SidebarGroup label={t("nav.timeGroup")}>
          {item("time:track", `${base}/time`, <ClockIcon />, t("nav.time"), true)}
          {item("time:manage", `${base}/time/team`, <CalendarRangeIcon />, t("nav.teamTime"))}
        </SidebarGroup>
      ) : null}
      <SidebarGroup>
        {/* one entry: the settings page carries its own grouped nav (settings/layout.tsx) */}
        <NavItem href={`${base}/settings`} icon={<Settings2Icon />}>
          {t("nav.settingsGroup")}
        </NavItem>
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
