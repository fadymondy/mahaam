// One team: its members and the projects it is attached to. Managers edit or delete it here.
import { useQueries } from "@tanstack/react-query";
import { ChevronLeftIcon, PencilIcon, Trash2Icon, UsersRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Team as TeamT } from "../../../main/api-team";
import { ColorDot, EmptyState, ErrorState, ProjectMark, RowsSkeleton, ViewHeader } from "@/components/kit";
import { HeaderButton, SectionTitle } from "@/components/issues/controls";
import { Confirm, Person, TeamDialog, invalidateTeams, useErrorText, useMyRole, useTeams } from "@/components/team/team";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useMemberMap, useMembers, useProjects } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useRouter } from "@/lib/router";

export function TeamView({ id }: { id: string }) {
  const { t, number } = useI18n();
  const { ws } = useApp();
  const { navigate } = useRouter();
  const { canReadTeams, canWriteTeams } = useMyRole();
  const errorText = useErrorText();
  const teams = useTeams(canReadTeams);
  const members = useMembers();
  const byId = useMemberMap();
  const projects = useProjects();
  const [editing, setEditing] = useState<TeamT | null>(null);
  const [deleting, setDeleting] = useState(false);
  const team = (teams.data ?? []).find((x) => x.id === id);

  // Which projects the team is attached to lives on each project's detail (as on the web).
  const list = team && team.project_count > 0 ? (projects.data ?? []) : [];
  const details = useQueries({
    queries: list.map((p) => ({ queryKey: qk.project(ws, p.id), queryFn: () => api.project(p.id), staleTime: 60_000 })),
  });
  const attached = list.filter((_, i) => ((details[i]?.data as { teams?: { team_id: string }[] | null } | undefined)?.teams ?? []).some((x) => x.team_id === id));
  const loadingProjects = projects.isPending || details.some((d) => d.isPending);

  async function remove() {
    try {
      await api.deleteTeam(id);
      invalidateTeams(ws);
      toast.success(t("team.deleted"));
      navigate({ name: "teams" }, { replace: true });
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  const header = (
    <ViewHeader
      title={team?.name ?? t("team.teams.title")}
      icon={
        <>
          <HeaderButton icon={<ChevronLeftIcon className="rtl:-scale-x-100" />} label={t("team.teams.title")} showLabel={false} onClick={() => navigate({ name: "teams" })} />
          {team ? <ColorDot color={team.color} className="size-2.5" /> : null}
        </>
      }
      actions={
        team && canWriteTeams ? (
          <>
            <HeaderButton icon={<PencilIcon />} label={t("common.edit")} onClick={() => setEditing(team)} />
            <HeaderButton icon={<Trash2Icon />} label={t("common.delete")} showLabel={false} onClick={() => setDeleting(true)} />
          </>
        ) : null
      }
    />
  );

  if (!canReadTeams)
    return (
      <>
        {header}
        <EmptyState icon={<UsersRoundIcon />} title={t("team.teams.noPermission")} />
      </>
    );
  if (teams.isError)
    return (
      <>
        {header}
        <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />
      </>
    );
  if (teams.isPending)
    return (
      <>
        {header}
        <RowsSkeleton rows={5} />
      </>
    );
  if (!team)
    return (
      <>
        {header}
        <EmptyState icon={<UsersRoundIcon />} title={t("team.notFound")} body={t("team.notFoundBody")} />
      </>
    );

  const ids = team.member_ids ?? [];
  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto" data-team={team.id}>
        {team.description ? <p className="border-b border-line px-4 py-3 text-[13.5px] text-grid-body">{team.description}</p> : null}
        <div className="grid gap-px bg-line lg:grid-cols-2">
          <section className="min-w-0 bg-background">
            <SectionTitle className="px-4 pt-4 pb-2" actions={<span className="text-[12.5px] text-grid-muted tabular-nums">{number(ids.length)}</span>}>
              {t("team.members")}
            </SectionTitle>
            {ids.length === 0 ? (
              <p className="px-4 pb-4 text-[13.5px] text-grid-muted">{t("team.noMembers")}</p>
            ) : (
              <div className="border-t border-line">
                {ids.map((uid) => {
                  const m = byId.get(uid);
                  return (
                    <div key={uid} className="flex h-10 items-center gap-3 border-b border-line/50 px-4 text-[14px]">
                      <Person member={m} id={uid} />
                      <span className="ms-auto shrink-0 text-[13px] text-grid-muted">{m ? t(`role.${m.role}`) : ""}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="min-w-0 bg-background">
            <SectionTitle className="px-4 pt-4 pb-2" actions={<span className="text-[12.5px] text-grid-muted tabular-nums">{number(team.project_count)}</span>}>
              {t("team.projects")}
            </SectionTitle>
            {team.project_count === 0 ? (
              <p className="px-4 pb-4 text-[13.5px] text-grid-muted">{t("team.noProjects")}</p>
            ) : loadingProjects ? (
              <RowsSkeleton rows={Math.min(team.project_count, 4)} />
            ) : (
              <div className="border-t border-line">
                {attached.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate({ name: "project", id: p.id })}
                    className="flex h-10 w-full items-center gap-2.5 border-b border-line/50 px-4 text-start text-[14px] hover:bg-grid-soft/60"
                  >
                    <ProjectMark name={p.name} color={p.color} id={p.id} size={18} />
                    <span className="truncate font-medium text-grid-fg">{p.name}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <TeamDialog team={editing} members={members.data ?? []} onClose={() => setEditing(null)} />
      <Confirm
        open={deleting}
        onOpenChange={setDeleting}
        title={t("team.deleteTitle", { name: team.name })}
        body={t("team.deleteBody")}
        action={t("common.delete")}
        onConfirm={() => {
          setDeleting(false);
          void remove();
        }}
      />
    </>
  );
}
