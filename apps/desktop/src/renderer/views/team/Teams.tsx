// Teams: name, members and project count; managers create, edit and delete them. ↵ or a click opens one.
import { PencilIcon, PlusIcon, Trash2Icon, UsersRoundIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { Team } from "../../../main/api-team";
import { AvatarStack, ColorDot, EmptyState, ErrorState, RowsSkeleton, ViewHeader } from "@/components/kit";
import { HeaderButton } from "@/components/issues/controls";
import { Confirm, TeamDialog, invalidateTeams, useErrorText, useMyRole, useTeams } from "@/components/team/team";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useMemberMap, useMembers } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

export function TeamsView() {
  const { t, number } = useI18n();
  const { ws } = useApp();
  const { navigate } = useRouter();
  const { canReadTeams, canWriteTeams } = useMyRole();
  const errorText = useErrorText();
  const teams = useTeams(canReadTeams);
  const members = useMembers();
  const byId = useMemberMap();
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const rows = useMemo(() => [...(teams.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [teams.data]);

  async function remove(team: Team) {
    try {
      await api.deleteTeam(team.id);
      invalidateTeams(ws);
      toast.success(t("team.deleted"));
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  return (
    <>
      <ViewHeader
        title={t("team.teams.title")}
        icon={<UsersRoundIcon className="size-3.5 text-grid-muted" />}
        actions={canWriteTeams ? <HeaderButton icon={<PlusIcon />} label={t("team.new")} onClick={() => setEditing("new")} data-action="new-team" /> : null}
      >
        {teams.data ? <span className="text-[13px] text-grid-muted tabular-nums">{number(rows.length)}</span> : null}
      </ViewHeader>
      {!canReadTeams ? (
        <EmptyState icon={<UsersRoundIcon />} title={t("team.teams.noPermission")} />
      ) : teams.isError ? (
        <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />
      ) : teams.isPending ? (
        <RowsSkeleton rows={5} />
      ) : !rows.length ? (
        <EmptyState icon={<UsersRoundIcon />} title={t("team.teams.empty")} body={canWriteTeams ? t("team.teams.emptyBody") : undefined} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-teams>
          {rows.map((team) => {
            const ids = team.member_ids ?? [];
            return (
              <div
                key={team.id}
                role="button"
                tabIndex={0}
                data-team-row={team.id}
                onClick={() => navigate({ name: "team", id: team.id })}
                onKeyDown={(e) => e.key === "Enter" && navigate({ name: "team", id: team.id })}
                className={cn("group flex h-11 items-center gap-3 border-b border-line/50 ps-4 pe-4 text-[14px] hover:bg-grid-soft/60 focus-visible:bg-grid-soft/70 focus-visible:outline-none")}
              >
                <ColorDot color={team.color} className="size-2.5" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium text-grid-fg">{team.name}</span>
                  {team.description ? <span className="truncate text-[12.5px] text-grid-muted">{team.description}</span> : null}
                </span>
                <span className="hidden text-[13px] text-grid-muted tabular-nums sm:block">
                  {t("team.memberCount", { n: number(ids.length) })} · {t("team.projectCount", { n: number(team.project_count) })}
                </span>
                <AvatarStack people={ids.map((id) => ({ id, email: byId.get(id)?.email ?? "?" }))} max={4} />
                {canWriteTeams ? (
                  <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <HeaderButton icon={<PencilIcon />} label={t("common.edit")} showLabel={false} onClick={() => setEditing(team)} />
                    <HeaderButton icon={<Trash2Icon />} label={t("common.delete")} showLabel={false} onClick={() => setDeleting(team)} />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <TeamDialog team={editing} members={members.data ?? []} onClose={() => setEditing(null)} />
      <Confirm
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("team.deleteTitle", { name: deleting?.name ?? "" })}
        body={t("team.deleteBody")}
        action={t("common.delete")}
        onConfirm={() => {
          if (deleting) void remove(deleting);
          setDeleting(null);
        }}
      />
    </>
  );
}
