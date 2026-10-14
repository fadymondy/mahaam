// The project's Settings tab: details, board columns, members, teams, customer portal sharing,
// project labels and archive/restore. Only managers and the project's lead may change a project
// (ProjectDetail.can_manage); everyone else sees a notice. Mirrors the web console's project settings.
import { useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import type { ProjectInput, StatusInput } from "../../../main/api-project";
import type { ProjectDetail, Status } from "../../../shared/types";
import { Confirm, inputCls, isManager, NativeSelect, TabPage, useInvalidateProject, useProjectDetail, useRun } from "@/components/project/common";
import { Avatar, ColorDot, EmptyState, ErrorState, LtrText, PALETTE, RowsSkeleton } from "@/components/kit";
import { Badge, Group, Row, SmallButton } from "@/components/settings/parts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useLabels, useMemberMap, useMembers } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PROJECT_STATUSES = ["planned", "active", "on_hold", "completed", "cancelled"] as const;
const STAGES = ["backlog", "todo", "in_progress", "waiting_approval", "in_review", "done"] as const;

export function ProjectSettings({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { workspace } = useApp();
  const detail = useProjectDetail(projectId);

  if (detail.error) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <RowsSkeleton rows={6} />;
  const p = detail.data;
  if (!p.can_manage) return <EmptyState title={t("project.settings.noPermission")} body={t("project.settings.noPermissionBody")} />;
  const role = workspace?.role;

  return (
    <TabPage className="max-w-3xl" data-project-settings>
      <DetailsForm key={p.updated_at} p={p} />
      <Statuses p={p} />
      <Members p={p} />
      {role !== "client" ? <Teams p={p} /> : null}
      <Share p={p} />
      {isManager(role) ? <Labels projectId={p.id} /> : null}
      <Archive p={p} />
    </TabPage>
  );
}

// ── details ──

function DetailsForm({ p }: { p: ProjectDetail }) {
  const { t } = useI18n();
  const run = useRun();
  const invalidate = useInvalidateProject(p.id);
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description ?? "");
  const [color, setColor] = useState(p.color);
  const [status, setStatus] = useState<string>(p.status);
  const [visibility, setVisibility] = useState<string>(p.visibility);
  const [billing, setBilling] = useState<string>(p.billing_mode);
  const [startsOn, setStartsOn] = useState(p.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(p.ends_on ?? "");
  const [budgetHours, setBudgetHours] = useState(p.budget_minutes ? String(p.budget_minutes / 60) : "");
  const [budgetMoney, setBudgetMoney] = useState(p.budget_minor ? String(p.budget_minor / 100) : "");
  const [currency, setCurrency] = useState(p.currency ?? "");
  const [saving, setSaving] = useState(false);

  const patch: ProjectInput = {};
  if (name.trim() !== p.name) patch.name = name.trim();
  if (description.trim() !== (p.description ?? "").trim()) patch.description = description;
  if (color !== p.color) patch.color = color;
  if (status !== p.status) patch.status = status as ProjectInput["status"];
  if (visibility !== p.visibility) patch.visibility = visibility as ProjectInput["visibility"];
  if (billing !== p.billing_mode) patch.billing_mode = billing as ProjectInput["billing_mode"];
  if (startsOn !== (p.starts_on ?? "")) patch.starts_on = startsOn;
  if (endsOn !== (p.ends_on ?? "")) patch.ends_on = endsOn;
  const minutes = budgetHours.trim() ? Math.round(Number(budgetHours) * 60) : 0;
  if (minutes !== (p.budget_minutes ?? 0)) patch.budget_minutes = minutes;
  const minor = budgetMoney.trim() ? Math.round(Number(budgetMoney) * 100) : 0;
  if (minor !== (p.budget_minor ?? 0)) patch.budget_minor = minor;
  if (currency.trim().toUpperCase() !== (p.currency ?? "")) patch.currency = currency.trim().toUpperCase();
  const dirty = Object.keys(patch).length > 0;
  const invalid = !name.trim() || Number.isNaN(minutes) || minutes < 0 || Number.isNaN(minor) || minor < 0 || (!!startsOn && !!endsOn && endsOn < startsOn);

  const save = async () => {
    setSaving(true);
    if (await run(() => api.updateProject(p.id, patch), t("project.saved"))) invalidate();
    setSaving(false);
  };

  return (
    <Group
      title={t("project.settings.details")}
      footer={
        <div className="flex justify-end gap-2 pt-1">
          <SmallButton tone="primary" disabled={!dirty || invalid || saving} onClick={() => void save()} data-project-save>
            {t("common.save")}
          </SmallButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <Field label={t("project.field.name")} htmlFor="ps-name">
          <input id="ps-name" className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("project.description")} htmlFor="ps-desc">
          <textarea
            id="ps-desc"
            className={cn(inputCls, "h-auto min-h-20 py-1.5")}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("project.settings.descriptionHint")}
          />
        </Field>
        <Field label={t("project.field.color")} htmlFor="ps-color">
          <div id="ps-color" role="radiogroup" className="flex flex-wrap gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn("flex size-6 items-center justify-center rounded-full border", color === c ? "border-grid-fg" : "border-transparent hover:border-line")}
              >
                <ColorDot color={c} className="size-3.5" />
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("issues.projects.status")} htmlFor="ps-status">
            <NativeSelect id="ps-status" className="w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`issues.project.status.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("project.fact.visibility")} htmlFor="ps-vis">
            <NativeSelect id="ps-vis" className="w-full" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="workspace">{t("project.visibility.workspace")}</option>
              <option value="members">{t("project.visibility.members")}</option>
            </NativeSelect>
          </Field>
          <Field label={t("project.fact.billing")} htmlFor="ps-billing">
            <NativeSelect id="ps-billing" className="w-full" value={billing} onChange={(e) => setBilling(e.target.value)}>
              {(["non_billable", "hourly", "fixed"] as const).map((b) => (
                <option key={b} value={b}>
                  {t(`project.billing.${b}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("project.fact.startsOn")} htmlFor="ps-start">
            <input id="ps-start" type="date" className={inputCls} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label={t("project.fact.endsOn")} htmlFor="ps-end">
            <input id="ps-end" type="date" className={inputCls} value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("project.settings.budgetHours")} htmlFor="ps-bh">
            <input id="ps-bh" type="number" min={0} step="0.5" dir="ltr" className={inputCls} value={budgetHours} onChange={(e) => setBudgetHours(e.target.value)} />
          </Field>
          <Field label={t("project.settings.budgetMoney")} htmlFor="ps-bm">
            <input id="ps-bm" type="number" min={0} step="0.01" dir="ltr" className={inputCls} value={budgetMoney} onChange={(e) => setBudgetMoney(e.target.value)} />
          </Field>
          <Field label={t("project.settings.currency")} htmlFor="ps-cur">
            <input id="ps-cur" dir="ltr" maxLength={3} placeholder="USD" className={cn(inputCls, "uppercase")} value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </Field>
        </div>
        <p className="text-[12.5px] text-grid-muted">{t("project.settings.budgetHint")}</p>
      </div>
    </Group>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-grid-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── board columns ──

function Statuses({ p }: { p: ProjectDetail }) {
  const { t, number } = useI18n();
  const run = useRun();
  const invalidate = useInvalidateProject(p.id);
  const statuses = [...(p.statuses ?? [])].sort((a, b) => a.position - b.position);
  const [editing, setEditing] = useState<Status | "new" | null>(null);
  const [deleting, setDeleting] = useState<Status | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const act = async (fn: () => Promise<unknown>) => {
    const ok = await run(fn);
    if (ok) invalidate();
    return ok;
  };

  return (
    <Group
      title={t("project.settings.statuses")}
      footer={t("project.settings.statusesHint")}
      action={
        <SmallButton onClick={() => setEditing("new")} data-add-status>
          <PlusIcon />
          {t("project.settings.addStatus")}
        </SmallButton>
      }
    >
      {statuses.map((s, i) => (
        <Row
          key={s.id}
          icon={<ColorDot color={s.color} />}
          label={s.name}
          hint={t("project.settings.taskCount", { n: number(s.task_count) })}
          className="min-h-11"
          data-status-row={s.id}
        >
          <Badge>{t(`issues.stage.${s.stage || "todo"}`)}</Badge>
          <IconBtn label={t("project.settings.moveUp")} disabled={i === 0} onClick={() => void act(() => api.updateStatus(s.id, { index: i - 1 }))}>
            <ArrowUpIcon />
          </IconBtn>
          <IconBtn label={t("project.settings.moveDown")} disabled={i === statuses.length - 1} onClick={() => void act(() => api.updateStatus(s.id, { index: i + 1 }))}>
            <ArrowDownIcon />
          </IconBtn>
          <IconBtn label={t("common.edit")} onClick={() => setEditing(s)}>
            <PencilIcon />
          </IconBtn>
          <IconBtn
            label={t("common.delete")}
            disabled={statuses.length <= 1}
            onClick={() => {
              setMoveTo(statuses.find((x) => x.id !== s.id)?.id ?? "");
              setDeleting(s);
            }}
          >
            <Trash2Icon />
          </IconBtn>
        </Row>
      ))}

      <StatusDialog
        status={editing}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          const ok = await act(() => (editing === "new" ? api.createStatus(p.id, body) : api.updateStatus((editing as Status).id, body)));
          if (ok) setEditing(null);
        }}
      />

      <Confirm
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("project.settings.deleteStatusTitle", { name: deleting?.name ?? "" })}
        body={deleting?.task_count ? t("project.settings.deleteStatusMove", { n: number(deleting.task_count) }) : t("project.settings.deleteStatusEmpty")}
        label={t("common.delete")}
        onConfirm={() => {
          if (deleting) void act(() => api.deleteStatus(deleting.id, deleting.task_count ? moveTo : undefined));
          setDeleting(null);
        }}
      >
        {deleting?.task_count ? (
          <NativeSelect className="w-full" aria-label={t("project.settings.moveTasksTo")} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            {statuses
              .filter((x) => x.id !== deleting.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </NativeSelect>
        ) : null}
      </Confirm>
    </Group>
  );
}

function IconBtn({ label, children, ...rest }: { label: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-fg disabled:opacity-40 disabled:hover:bg-transparent [&_svg]:size-3.5"
      {...rest}
    >
      {children}
    </button>
  );
}

function StatusDialog({ status, onClose, onSave }: { status: Status | "new" | null; onClose: () => void; onSave: (b: StatusInput & { name: string }) => Promise<void> }) {
  const { t } = useI18n();
  const s = status && status !== "new" ? status : null;
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("slate");
  const [stage, setStage] = useState<string>("in_progress");
  const [key, setKey] = useState<string | null>(null);
  const current = status === "new" ? "new" : (s?.id ?? null);
  if (current !== key) {
    setKey(current);
    setName(s?.name ?? "");
    setColor(s?.color ?? "slate");
    setStage(s?.stage ?? "in_progress");
  }
  return (
    <Dialog open={!!status} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{status === "new" ? t("project.settings.addStatus") : t("project.settings.editStatus")}</DialogTitle>
          <DialogDescription>{t("project.settings.stageHint")}</DialogDescription>
        </DialogHeader>
        <Field label={t("project.field.name")} htmlFor="st-name">
          <input id="st-name" autoFocus maxLength={60} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("project.settings.stage")} htmlFor="st-stage">
          <NativeSelect id="st-stage" className="w-full" value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((c) => (
              <option key={c} value={c}>
                {t(`issues.stage.${c}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("project.field.color")} htmlFor="st-color">
          <div id="st-color" role="radiogroup" className="flex flex-wrap gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn("flex size-6 items-center justify-center rounded-full border", color === c ? "border-grid-fg" : "border-transparent hover:border-line")}
              >
                <ColorDot color={c} className="size-3.5" />
              </button>
            ))}
          </div>
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!name.trim()} onClick={() => void onSave({ name: name.trim(), color, stage: stage as StatusInput["stage"] })}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── members ──

function Members({ p }: { p: ProjectDetail }) {
  const { t } = useI18n();
  const run = useRun();
  const invalidate = useInvalidateProject(p.id);
  const memberMap = useMemberMap();
  const all = useMembers();
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState<"member" | "lead">("member");
  const [removing, setRemoving] = useState<string | null>(null);
  const onProject = new Set((p.members ?? []).map((m) => m.user_id));
  const candidates = (all.data ?? []).filter((m) => m.status === "active" && !onProject.has(m.user_id));
  const email = (id: string) => memberMap.get(id)?.email ?? id;

  const act = async (fn: () => Promise<unknown>) => {
    const ok = await run(fn);
    if (ok) invalidate();
    return ok;
  };

  return (
    <Group
      title={t("project.settings.members")}
      footer={p.visibility === "members" ? t("project.settings.membersHintPrivate") : t("project.settings.membersHint")}
    >
      {(p.members ?? []).map((m) => (
        <Row key={m.user_id} icon={<Avatar id={m.user_id} email={email(m.user_id)} size={20} />} label={<LtrText>{email(m.user_id)}</LtrText>} className="min-h-11" data-project-member={m.user_id}>
          <NativeSelect
            aria-label={t("project.settings.role")}
            value={m.role}
            onChange={(e) => void act(() => api.putProjectMember(p.id, m.user_id, e.target.value as "lead" | "member"))}
          >
            <option value="member">{t("project.role.member")}</option>
            <option value="lead">{t("project.role.lead")}</option>
          </NativeSelect>
          <SmallButton tone="danger" onClick={() => setRemoving(m.user_id)}>
            {t("project.remove")}
          </SmallButton>
        </Row>
      ))}
      {!(p.members ?? []).length ? <Row label={<span className="text-grid-muted">{t("project.settings.noMembers")}</span>} /> : null}
      {candidates.length ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          <NativeSelect className="min-w-56 flex-1" aria-label={t("project.settings.addMember")} value={addUser} onChange={(e) => setAddUser(e.target.value)}>
            <option value="">{t("project.settings.pickPerson")}</option>
            {candidates.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.email}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t("project.settings.role")} value={addRole} onChange={(e) => setAddRole(e.target.value as "lead" | "member")}>
            <option value="member">{t("project.role.member")}</option>
            <option value="lead">{t("project.role.lead")}</option>
          </NativeSelect>
          <SmallButton
            tone="primary"
            disabled={!addUser}
            onClick={() =>
              void act(async () => {
                await api.putProjectMember(p.id, addUser, addRole);
                setAddUser("");
              })
            }
          >
            <PlusIcon />
            {t("project.add")}
          </SmallButton>
        </div>
      ) : null}
      <Confirm
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("project.settings.removeMemberTitle")}
        body={t("project.settings.removeMemberBody", { name: removing ? email(removing) : "" })}
        label={t("project.remove")}
        onConfirm={() => {
          if (removing) void act(() => api.removeProjectMember(p.id, removing));
        }}
      />
    </Group>
  );
}

// ── teams ──

function Teams({ p }: { p: ProjectDetail }) {
  const { t, number } = useI18n();
  const { ws } = useApp();
  const run = useRun();
  const invalidate = useInvalidateProject(p.id);
  const teams = useQuery({ queryKey: ["w", ws, "project-tab", "teams"], queryFn: () => api.projectTeams(), enabled: !!ws, staleTime: 60_000 });
  const [addTeam, setAddTeam] = useState("");
  const attached = new Set((p.teams ?? []).map((x) => x.team_id));
  const choices = (teams.data ?? []).filter((x) => !attached.has(x.id));

  const act = async (fn: () => Promise<unknown>) => {
    if (await run(fn)) invalidate();
  };

  return (
    <Group title={t("project.settings.teams")} footer={t("project.settings.teamsHint")}>
      {(p.teams ?? []).map((x) => (
        <Row
          key={x.team_id}
          icon={<ColorDot color={x.color} />}
          label={x.name}
          hint={t("project.settings.memberCount", { n: number(x.member_ids?.length ?? 0) })}
          className="min-h-11"
        >
          <SmallButton onClick={() => void act(() => api.detachProjectTeam(p.id, x.team_id))}>{t("project.settings.detach")}</SmallButton>
        </Row>
      ))}
      {!(p.teams ?? []).length ? <Row label={<span className="text-grid-muted">{t("project.settings.noTeams")}</span>} /> : null}
      {choices.length ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          <NativeSelect className="min-w-56 flex-1" aria-label={t("project.settings.attachTeam")} value={addTeam} onChange={(e) => setAddTeam(e.target.value)}>
            <option value="">{t("project.settings.pickTeam")}</option>
            {choices.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </NativeSelect>
          <SmallButton
            disabled={!addTeam}
            onClick={() =>
              void act(async () => {
                await api.attachProjectTeam(p.id, addTeam);
                setAddTeam("");
              })
            }
          >
            {t("project.settings.attachTeam")}
          </SmallButton>
        </div>
      ) : null}
    </Group>
  );
}

// ── customer portal ──

function Share({ p }: { p: ProjectDetail }) {
  const { t } = useI18n();
  const run = useRun();
  const invalidate = useInvalidateProject(p.id);
  return (
    <Group title={t("project.settings.share")} footer={t("project.settings.shareHint")}>
      {(["share_board", "share_team", "share_money"] as const).map((k) => (
        <Row key={k} label={t(`project.settings.${k}`)} hint={t(`project.settings.${k}Hint`)} htmlFor={`ps-${k}`} data-share={k}>
          <Switch
            id={`ps-${k}`}
            checked={!!p[k]}
            onCheckedChange={(v) =>
              void run(() => api.updateProject(p.id, { [k]: v }), t("project.saved")).then((ok) => {
                if (ok) invalidate();
              })
            }
          />
        </Row>
      ))}
    </Group>
  );
}

// ── project labels ──

function Labels({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { ws } = useApp();
  const run = useRun();
  const labels = useLabels();
  const key = ["w", ws, "project-tab", projectId, "labels"];
  const current = useQuery({ queryKey: key, queryFn: () => api.projectLabels(projectId), enabled: !!ws });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const selected = picked ?? new Set((current.data ?? []).map((l) => l.id));
  const dirty = picked !== null;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <Group
      title={t("project.settings.labels")}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span>{t("project.settings.labelsHint")}</span>
          <SmallButton
            tone="primary"
            disabled={!dirty}
            onClick={() =>
              void run(() => api.setProjectLabels(projectId, [...selected]), t("project.saved")).then((ok) => {
                if (ok) {
                  setPicked(null);
                  void current.refetch();
                }
              })
            }
          >
            {t("common.save")}
          </SmallButton>
        </div>
      }
    >
      {current.error ? (
        <ErrorState error={current.error} />
      ) : !labels.data || current.isPending ? (
        <RowsSkeleton rows={2} />
      ) : !labels.data.length ? (
        <Row label={<span className="text-grid-muted">{t("project.settings.noLabels")}</span>} />
      ) : (
        <div className="flex flex-wrap gap-1.5 p-3">
          {labels.data.map((l) => {
            const on = selected.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(l.id)}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[13px]",
                  on ? "border-grid-action/50 bg-grid-action/10 text-grid-fg" : "border-line text-grid-muted hover:bg-grid-soft",
                )}
              >
                <ColorDot color={l.color} />
                {l.name}
              </button>
            );
          })}
        </div>
      )}
    </Group>
  );
}

// ── archive ──

function Archive({ p }: { p: ProjectDetail }) {
  const { t } = useI18n();
  const run = useRun();
  const invalidate = useInvalidateProject(p.id);
  const [confirm, setConfirm] = useState(false);
  const archived = !!p.archived_at;
  return (
    <Group title={archived ? t("project.settings.restoreTitle") : t("project.settings.archiveTitle")}>
      <Row label={archived ? t("project.settings.restoreTitle") : t("project.settings.archiveTitle")} hint={archived ? t("project.settings.restoreHint") : t("project.settings.archiveHint")}>
        {archived ? (
          <SmallButton onClick={() => void run(() => api.restoreProject(p.id), t("project.restored")).then((ok) => ok && invalidate())}>{t("project.settings.restore")}</SmallButton>
        ) : (
          <SmallButton tone="danger" onClick={() => setConfirm(true)} data-archive-project>
            {t("project.settings.archive")}
          </SmallButton>
        )}
      </Row>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={t("project.settings.archiveConfirm")}
        body={t("project.settings.archiveHint")}
        label={t("project.settings.archive")}
        onConfirm={() => void run(() => api.archiveProject(p.id), t("project.archived")).then((ok) => ok && invalidate())}
      />
    </Group>
  );
}
