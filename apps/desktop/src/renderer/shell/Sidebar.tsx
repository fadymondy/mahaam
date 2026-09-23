// The sidebar, Linear-style: the workspace switcher in the title-bar row (beside the traffic
// lights), search and new issue, the personal views (Inbox, My issues, Time), the projects, and the
// running timer at the bottom. A hairline separates it from the view, like the web's grid shell.
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  InboxIcon,
  LayersIcon,
  LogOutIcon,
  PanelLeftCloseIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  CircleDotIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { Route } from "../../shared/types";
import { Kbd, ProjectMark } from "@/components/kit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { desktop } from "@/lib/bridge";
import { useInbox, useIsStaff, useProjects } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

import { TimerPill } from "./Timer";
import { UpdatePill } from "./UpdatePill";

export function Sidebar({ onSearch, onCreate, onCollapse }: { onSearch: () => void; onCreate: () => void; onCollapse: () => void }) {
  const { t } = useI18n();
  const { route } = useRouter();
  const inbox = useInbox();
  const projects = useProjects();
  const staff = useIsStaff();
  const unread = inbox.data?.unread ?? 0;

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-e border-line bg-grid-card" data-sidebar>
      <div className="drag sidebar-top flex h-11 shrink-0 items-center gap-1 ps-2 pe-2">
        <WorkspaceSwitcher />
        <button
          type="button"
          onClick={onCollapse}
          title={t("nav.collapse")}
          aria-label={t("nav.collapse")}
          className="ms-auto flex size-7 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
        >
          <PanelLeftCloseIcon className="size-4 rtl:-scale-x-100" />
        </button>
      </div>

      <div className="flex gap-1 px-2 pt-1 pb-2">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-7 flex-1 items-center gap-2 rounded-md border border-line bg-background px-2 text-[13.5px] text-grid-muted hover:text-grid-fg"
          data-open-palette
        >
          <SearchIcon className="size-3.5" />
          <span className="flex-1 truncate text-start">{t("common.search")}</span>
          <Kbd combo="mod+k" />
        </button>
        {staff ? (
          <button
            type="button"
            onClick={onCreate}
            title={`${t("nav.newIssue")} (C)`}
            aria-label={t("nav.newIssue")}
            className="flex size-7 items-center justify-center rounded-md border border-line bg-background text-grid-fg hover:bg-grid-soft"
            data-new-issue
          >
            <SquarePenIcon className="size-3.5" />
          </button>
        ) : null}
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2" aria-label={t("nav.projects")}>
        <Item to={{ name: "inbox" }} active={route.name === "inbox"} icon={<InboxIcon />} label={t("nav.inbox")} badge={unread || undefined} />
        {staff ? (
          <>
            <Item to={{ name: "my-issues" }} active={route.name === "my-issues"} icon={<CircleDotIcon />} label={t("nav.myIssues")} />
            <Item to={{ name: "time" }} active={route.name === "time"} icon={<ClockIcon />} label={t("nav.time")} />
          </>
        ) : null}

        <p className="grid-micro mt-4 mb-1 px-2 text-[11.5px]">{t("nav.projects")}</p>
        <Item to={{ name: "projects" }} active={route.name === "projects"} icon={<LayersIcon />} label={t("nav.allProjects")} />
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
        {projects.data && projects.data.length === 0 ? <p className="px-2 py-1 text-[13px] text-grid-muted">{t("nav.noProjects")}</p> : null}
      </nav>

      <UpdatePill />
      <TimerPill />
    </aside>
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
        "nav-item group flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2 text-start text-[14px] [&_svg]:size-4 [&_svg]:shrink-0",
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

function WorkspaceSwitcher() {
  const { t } = useI18n();
  const { session, workspace, selectWorkspace, signOut } = useApp();
  if (!workspace) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-[14px] font-medium text-grid-fg hover:bg-grid-soft"
            data-workspace-switcher
          />
        }
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-grid-action text-[12px] font-semibold text-grid-on-action">
          {workspace.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 truncate">{workspace.name}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-grid-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate" dir="ltr">
            {session?.email}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("nav.workspaces")}</DropdownMenuLabel>
          {(session?.workspaces ?? []).map((w) => (
            <DropdownMenuItem key={w.id} onClick={() => void selectWorkspace(w.id)}>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="text-[12px] text-grid-muted">{t(`role.${w.role}`)}</span>
              {w.id === workspace.id ? <CheckIcon /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void desktop.openSettings()}>
          <SettingsIcon />
          {t("nav.settings")}
          <span className="ms-auto">
            <Kbd combo="mod+," />
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void signOut()}>
          <LogOutIcon />
          {t("nav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
