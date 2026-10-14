// Pieces the team views share: the teams query, role helpers, the error text, the team editor and a
// small confirm dialog.
import { useQuery } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Team } from "../../../main/api-team";
import type { Member } from "../../../shared/types";
import { Avatar, ColorDot, LtrText, PALETTE } from "@/components/kit";
import { SmallButton } from "@/components/settings/parts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/app";
import { ApiError, api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { cn } from "@/lib/utils";

export const ROLE_RANK = { client: 0, member: 1, manager: 2, admin: 3, owner: 4 } as const;
export type Role = keyof typeof ROLE_RANK;

/** My role in the workspace, and what it allows (mirrors internal/authz/can.go). */
export function useMyRole() {
  const role = ((useApp().workspace as { role?: string } | null)?.role ?? "client") as Role;
  const at = (r: Role) => (ROLE_RANK[role] ?? 0) >= ROLE_RANK[r];
  return { role, at, canInvite: at("admin"), canReadTeams: at("member"), canWriteTeams: at("manager") };
}

export const teamsKey = (ws: string) => ["w", ws, "teams"] as const;
export const invitationsKey = (ws: string) => ["w", ws, "invitations"] as const;

export function useTeams(enabled = true) {
  const { ws } = useApp();
  return useQuery({ queryKey: teamsKey(ws), queryFn: () => api.teams(), enabled: !!ws && enabled, staleTime: 30_000 });
}

export const invalidateTeams = (ws: string) => void queryClient.invalidateQueries({ queryKey: teamsKey(ws) });

/** The server's message, with a clearer lead for permission and plan-limit refusals. */
export function useErrorText() {
  const { t } = useI18n();
  return (err: unknown) => {
    if (err instanceof ApiError) {
      const code = (err.body as { code?: string } | undefined)?.code;
      if (err.status === 402 || code === "plan_limit") return `${t("team.planLimit")} ${err.message}`.trim();
      if (err.status === 403) return err.message || t("team.forbidden");
      return err.message || t("common.error");
    }
    return err instanceof Error && err.message ? err.message : t("common.error");
  };
}

export function Person({ member, id, size = 20 }: { member?: Member; id: string; size?: number }) {
  const { t } = useI18n();
  const email = member?.email ?? t("team.unknownPerson");
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar id={id} email={email} size={size} />
      <LtrText className="truncate text-grid-fg">{email}</LtrText>
    </span>
  );
}

export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body?: string;
  action: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {body ? <AlertDialogDescription>{body}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] text-grid-muted">{label}</span>
      {children}
    </label>
  );
}

/** Create (team = "new") or edit a team: name, description, colour, members. */
export function TeamDialog({ team, members, onClose }: { team: Team | "new" | null; members: Member[]; onClose: (saved?: Team) => void }) {
  const { t } = useI18n();
  const { ws } = useApp();
  const errorText = useErrorText();
  const existing = team && team !== "new" ? team : null;
  const [key, setKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("teal");
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = team === "new" ? "new" : (existing?.id ?? null);
  if (current !== key) {
    setKey(current);
    setName(existing?.name ?? "");
    setDescription(existing?.description ?? "");
    setColor(existing?.color ?? "teal");
    setPicked(existing?.member_ids ?? []);
    setFilter("");
    setError(null);
  }

  const staff = members.filter((m) => m.role !== "client" && m.email.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function save() {
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), description, color, member_ids: picked };
    try {
      const out = existing ? await api.updateTeam(existing.id, body) : await api.createTeam(body);
      invalidateTeams(ws);
      onClose(out);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-team-dialog>
        <DialogHeader>
          <DialogTitle>{existing ? t("team.edit") : t("team.new")}</DialogTitle>
          <DialogDescription>{t("team.formHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3.5">
          <Field label={t("team.name")}>
            <Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("team.description")}>
            <Textarea rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-grid-muted">{t("team.color")}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("team.color")}>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  title={c}
                  onClick={() => setColor(c)}
                  className={cn("flex size-6 items-center justify-center rounded-md border", color === c ? "border-grid-fg" : "border-transparent hover:border-line")}
                >
                  <ColorDot color={c} className="size-3" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-grid-muted">
              {t("team.members")} · <span className="tabular-nums">{picked.length}</span>
            </span>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("team.filterPeople")} className="h-8" />
            <div className="max-h-48 overflow-y-auto rounded-md border border-line">
              {staff.length === 0 ? (
                <p className="px-3 py-2 text-[13px] text-grid-muted">{t("team.noPeople")}</p>
              ) : (
                staff.map((m) => {
                  const on = picked.includes(m.user_id);
                  return (
                    <button
                      key={m.user_id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(m.user_id)}
                      className="flex h-8 w-full items-center gap-2 px-2.5 text-start text-[13.5px] hover:bg-grid-soft"
                    >
                      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-grid-action bg-grid-action text-grid-on-action" : "border-line")}>
                        {on ? <CheckIcon className="size-3" /> : null}
                      </span>
                      <Person member={m} id={m.user_id} size={18} />
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-grid-danger">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <SmallButton onClick={() => onClose()}>{t("common.cancel")}</SmallButton>
          <SmallButton tone="primary" disabled={busy || !name.trim()} onClick={save} data-team-save>
            {busy ? t("team.saving") : t("common.save")}
          </SmallButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
