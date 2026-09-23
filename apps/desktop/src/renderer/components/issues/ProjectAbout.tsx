// A project's "About" side panel: status, progress, description, dates, client and people.
import { ExternalLinkIcon } from "lucide-react";

import type { Member, Project, ProjectDetail } from "../../../shared/types";
import { Avatar, ColorChip, LtrText, ProjectMark, Spinner } from "@/components/kit";
import { desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

import { ProgressBar, SectionTitle } from "./controls";
import { Markdown } from "./Markdown";
import { webPath } from "./util";

export const PROJECT_STATUS_COLOR: Record<string, string> = {
  planned: "blue",
  active: "green",
  on_hold: "amber",
  completed: "violet",
  cancelled: "slate",
};

export function ProjectStatusChip({ status }: { status: Project["status"] }) {
  const { t } = useI18n();
  return (
    <ColorChip color={PROJECT_STATUS_COLOR[status]} className="rounded-full">
      {t(`issues.project.status.${status}`)}
    </ColorChip>
  );
}

/** "12 Mar 2026", or "—". YYYY-MM-DD is a calendar date: shown as that day wherever you are. */
export function useDay() {
  const { date } = useI18n();
  return (d: string | null | undefined, year = true) => (d ? date(`${d}T12:00:00`, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) }) : "—");
}

export function ProjectAbout({ project, memberMap }: { project: ProjectDetail | undefined; memberMap: Map<string, Member> }) {
  const { t, number } = useI18n();
  const day = useDay();
  if (!project) {
    return (
      <aside className="flex w-[288px] shrink-0 items-center justify-center border-s border-line bg-grid-card" data-about>
        <Spinner />
      </aside>
    );
  }
  const counts = project.tasks;
  const total = counts.todo + counts.doing + counts.done;
  const pct = total ? Math.round((counts.done / total) * 100) : 0;
  const stages = Object.entries(project.issues ?? {}).filter(([, n]) => n > 0);
  const people = (project.members ?? []).map((m) => ({ ...m, email: memberMap.get(m.user_id)?.email ?? m.user_id }));

  return (
    <aside className="flex w-[288px] shrink-0 flex-col overflow-y-auto border-s border-line bg-grid-card" data-about aria-label={t("issues.project.about")}>
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <div className="flex items-center gap-2.5">
          <ProjectMark name={project.name} color={project.color} id={project.id} size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-grid-fg">{project.name}</p>
            {project.client_name ? <p className="truncate text-[13px] text-grid-muted">{project.client_name}</p> : null}
          </div>
          <ProjectStatusChip status={project.status} />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b border-line p-4" data-progress>
        <SectionTitle>{t("issues.project.progress")}</SectionTitle>
        <div className="flex items-baseline justify-between text-[13.5px]">
          <span className="text-grid-fg">{t("issues.project.doneOf", { done: number(counts.done), total: number(total) })}</span>
          <LtrText className="text-grid-muted tabular-nums">{number(pct)}%</LtrText>
        </div>
        <ProgressBar value={counts.done} total={total} className="h-1.5" />
        {stages.length ? (
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
            {stages.map(([stage, n]) => (
              <div key={stage} className="flex items-center justify-between gap-2">
                <dt className="truncate text-grid-muted">{t(`issues.stage.${stage}`)}</dt>
                <dd className="text-grid-body tabular-nums">{number(n)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 border-b border-line p-4">
        <SectionTitle>{t("issues.project.description")}</SectionTitle>
        {project.description?.trim() ? <Markdown source={project.description} className="text-[13.5px]" /> : <p className="text-[13.5px] text-grid-muted">{t("issues.project.noDescription")}</p>}
      </div>

      <dl className="flex flex-col gap-2 border-b border-line p-4 text-[13.5px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-grid-muted">{t("issues.project.starts")}</dt>
          <dd className="text-grid-body">
            <LtrText>{day(project.starts_on)}</LtrText>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-grid-muted">{t("issues.project.ends")}</dt>
          <dd className="text-grid-body">
            <LtrText>{day(project.ends_on)}</LtrText>
          </dd>
        </div>
        {project.client_name ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-grid-muted">{t("issues.project.client")}</dt>
            <dd className="truncate text-grid-body">{project.client_name}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-col gap-1.5 p-4">
        <SectionTitle>
          {t("issues.project.members")} <span className="ms-1 tabular-nums">{number(people.length)}</span>
        </SectionTitle>
        {people.length ? (
          <ul className="flex flex-col gap-1.5">
            {people.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2 text-[13.5px]">
                <Avatar id={m.user_id} email={m.email} size={20} />
                <span className="min-w-0 flex-1 truncate text-grid-body" dir="ltr">
                  {m.email}
                </span>
                {m.role === "lead" ? <span className="text-[12px] text-grid-muted">{t("issues.project.lead")}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-grid-muted">{t("issues.project.noMembers")}</p>
        )}
      </div>

      <div className="mt-auto border-t border-line p-2">
        <button
          type="button"
          onClick={() => void desktop.openWeb(webPath.project(project.id))}
          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
        >
          <ExternalLinkIcon className="size-3.5" />
          {t("common.openInBrowser")}
        </button>
      </div>
    </aside>
  );
}
