// The sidebar, a native source list like Zekra's and Health Debug's: the window's own material
// (vibrancy / Mica) shows through it. The title-bar row holds the traffic lights and the collapse
// toggle; under it the Mahaam mark and name with search and a new issue; then the workspace (its
// name is the section title and opens the workspace menu) with Inbox, My issues and Time; the
// projects; and at the foot the update and timer pills and the Settings gear.
import { ChevronDownIcon, CircleDotIcon, ClockIcon, InboxIcon, PanelLeftIcon, SearchIcon, SettingsIcon, SquarePenIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Route } from "../../shared/types";
import { ProjectMark, useWindowControlsPadding } from "@/components/kit";
import { nativeMenu } from "@/lib/native";
import { useApp } from "@/lib/app";
import { desktop } from "@/lib/bridge";
import { useInbox, useIsStaff, useProjects } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Mark } from "@/views/SignIn";

import { TimerPill } from "./Timer";
import { UpdatePill } from "./UpdatePill";

export function Sidebar({ onSearch, onCreate, onCollapse }: { onSearch: () => void; onCreate: () => void; onCollapse: () => void }) {
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  const { workspace } = useApp();
  const inbox = useInbox();
  const projects = useProjects();
  const staff = useIsStaff();
  const unread = inbox.data?.unread ?? 0;
  // The title-bar row leaves room for the traffic lights on whichever side they are.
  const pad = useWindowControlsPadding<HTMLDivElement>();

  return (
    <aside className="app-chrome flex h-full w-[240px] shrink-0 flex-col border-e border-line" data-sidebar>
      {/* The title-bar row: the traffic lights and the collapse toggle (⌘\ in the View menu). */}
      <div ref={pad.ref} style={{ paddingLeft: pad.left, paddingRight: pad.right }} className="drag flex h-11 shrink-0 items-center ps-3 pe-2">
        <span className="flex-1" />
        <IconButton label={t("nav.collapse")} onClick={onCollapse}>
          <PanelLeftIcon className="rtl:-scale-x-100" />
        </IconButton>
      </div>

      {/* The app, by name, under the lights — then search and a new issue. */}
      <div className="drag flex shrink-0 items-center gap-2 ps-4 pe-2 pt-0.5 pb-1.5" data-sidebar-brand>
        <Mark size={22} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-grid-fg">{t("app.name")}</span>
        <IconButton label={`${t("common.search")} (⌘K)`} onClick={onSearch} data-open-palette>
          <SearchIcon />
        </IconButton>
        {staff ? (
          <IconButton label={`${t("nav.newIssue")} (C)`} onClick={onCreate} data-new-issue>
            <SquarePenIcon />
          </IconButton>
        ) : null}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2" aria-label={t("nav.projects")}>
        {workspace ? <WorkspaceHeader /> : null}
        <div className="flex flex-col gap-px">
          <Item to={{ name: "inbox" }} active={route.name === "inbox"} icon={<InboxIcon />} label={t("nav.inbox")} badge={unread || undefined} />
          {staff ? (
            <>
              <Item to={{ name: "my-issues" }} active={route.name === "my-issues"} icon={<CircleDotIcon />} label={t("nav.myIssues")} />
              <Item to={{ name: "time" }} active={route.name === "time"} icon={<ClockIcon />} label={t("nav.time")} />
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => navigate({ name: "projects" })}
          aria-current={route.name === "projects" ? "page" : undefined}
          className="nav-section-header nav-section-link mt-3"
          data-all-projects
        >
          {t("nav.projects")}
        </button>
        <div className="flex flex-col gap-px">
          {(projects.data ?? []).map((p) => (
            <Item
              key={p.id}
              to={{ name: "project", id: p.id }}
              active={route.name === "project" && route.id === p.id}
              icon={<ProjectMark name={p.name} color={p.color} />}
              label={p.name}
              data-project={p.id}
            />
          ))}
        </div>
        {projects.data && projects.data.length === 0 ? <p className="px-2 py-1 text-[13px] text-grid-muted">{t("nav.noProjects")}</p> : null}
      </nav>

      <UpdatePill />
      <TimerPill />
      <div className="flex shrink-0 items-center gap-1 px-2 pt-1 pb-2">
        <IconButton label={`${t("nav.settings")} (⌘,)`} onClick={() => void desktop.openSettings()} data-open-settings>
          <SettingsIcon />
        </IconButton>
      </div>
    </aside>
  );
}

function IconButton({ label, onClick, children, ...rest }: { label: string; onClick: () => void; children: ReactNode; "data-open-palette"?: boolean; "data-new-issue"?: boolean; "data-open-settings"?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-grid-muted hover:bg-[color-mix(in_oklab,var(--grid-fg)_8%,transparent)] hover:text-grid-fg [&_svg]:size-4 [&_svg]:[stroke-width:1.75]"
      {...rest}
    >
      {children}
    </button>
  );
}

function Item({
  to,
  active,
  icon,
  label,
  badge,
  ...rest
}: {
  to: Route;
  active: boolean;
  icon: ReactNode;
  label: string;
  badge?: number;
  "data-project"?: string;
}) {
  const { navigate } = useRouter();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "nav-item group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-start text-[14px] [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "font-medium text-grid-fg" : "text-grid-body hover:text-grid-fg",
      )}
      {...rest}
    >
      <span className={cn("nav-icon flex size-4 items-center justify-center", active ? "" : "text-grid-muted group-hover:text-grid-fg")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="rounded-full bg-grid-action px-1.5 text-[11.5px] leading-4 font-medium text-grid-on-action" data-unread={badge}>
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/** The workspace, as the first section's title: a click opens the native menu of workspaces. */
function WorkspaceHeader() {
  const { t } = useI18n();
  const { session, workspace, selectWorkspace, signOut } = useApp();
  if (!workspace) return null;
  // The operating system's own menu (main/native.ts): the account, the workspaces, settings, sign out.
  const open = (el: HTMLElement) =>
    void nativeMenu(
      [
        { label: session?.email ?? "", enabled: false },
        { type: "separator" },
        { label: t("nav.workspaces"), enabled: false },
        ...(session?.workspaces ?? []).map((w) => ({ id: `ws:${w.id}`, label: w.name, sublabel: t(`role.${w.role}`), type: "radio" as const, checked: w.id === workspace.id })),
        { type: "separator" },
        { id: "settings", label: t("nav.settings"), accelerator: "CmdOrCtrl+," },
        { id: "signout", label: t("nav.signOut") },
      ],
      el,
    ).then((id) => {
      if (!id) return;
      if (id.startsWith("ws:")) void selectWorkspace(id.slice(3));
      else if (id === "settings") void desktop.openSettings();
      else if (id === "signout") void signOut();
    });
  return (
    <button type="button" aria-haspopup="menu" onClick={(e) => open(e.currentTarget)} className="nav-section-header group/ws mt-1" data-workspace-switcher>
      <span className="min-w-0 truncate">{workspace.name}</span>
      <ChevronDownIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover/ws:opacity-100" />
    </button>
  );
}
