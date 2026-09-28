// Members and invitations: who is in the workspace (role, teams, joined), and — for owners and
// admins — inviting by email, the pending invitations, their links, resend and revoke.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, MailPlusIcon, MailWarningIcon, RotateCwIcon, UsersIcon, XIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { Invitation, InviteRole } from "../../../main/api-team";
import { EmptyState, ErrorState, LtrText, RowsSkeleton, ViewHeader } from "@/components/kit";
import { Segmented } from "@/components/issues/controls";
import { SmallButton } from "@/components/settings/parts";
import { Confirm, Person, invitationsKey, useErrorText, useMyRole, useTeams } from "@/components/team/team";
import { Input } from "@/components/ui/input";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useMembers } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

const INVITABLE: InviteRole[] = ["admin", "manager", "member", "client"];
const ROW = "grid grid-cols-[minmax(0,1fr)_110px_minmax(0,160px)_110px] items-center gap-4";

type Tab = "members" | "invitations";

export function MembersView() {
  const { t, number } = useI18n();
  const { ws } = useApp();
  const { canInvite } = useMyRole();
  const [tab, setTab] = useState<Tab>("members");
  const members = useMembers();
  const invitations = useQuery({ queryKey: invitationsKey(ws), queryFn: () => api.invitations(), enabled: !!ws && canInvite, staleTime: 30_000 });
  const shown: Tab = canInvite ? tab : "members";

  return (
    <>
      <ViewHeader
        title={t("team.members.title")}
        icon={<UsersIcon className="size-3.5 text-grid-muted" />}
        actions={
          canInvite ? (
            <Segmented<Tab>
              label={t("team.members.title")}
              value={shown}
              onChange={setTab}
              options={[
                { value: "members", label: t("team.members.tab"), count: members.data?.length },
                { value: "invitations", label: t("team.invites.tab"), count: invitations.data?.length },
              ]}
            />
          ) : null
        }
      >
        {members.data && shown === "members" ? <span className="text-[13px] text-grid-muted tabular-nums">{number(members.data.length)}</span> : null}
      </ViewHeader>
      {shown === "members" ? <MemberList /> : <Invitations q={invitations} />}
    </>
  );
}

function MemberList() {
  const { t, date } = useI18n();
  const { session } = useApp();
  const { canInvite, canReadTeams } = useMyRole();
  const { navigate } = useRouter();
  const members = useMembers();
  const teams = useTeams(canReadTeams);
  const teamsOf = useMemo(() => {
    const m = new Map<string, { id: string; name: string }[]>();
    for (const tm of teams.data ?? []) for (const uid of tm.member_ids ?? []) m.set(uid, [...(m.get(uid) ?? []), { id: tm.id, name: tm.name }]);
    return m;
  }, [teams.data]);
  const rows = useMemo(() => [...(members.data ?? [])].sort((a, b) => ROLE_ORDER(b.role) - ROLE_ORDER(a.role) || a.email.localeCompare(b.email)), [members.data]);

  if (members.isError) return <ErrorState error={members.error} onRetry={() => void members.refetch()} />;
  if (members.isPending) return <RowsSkeleton rows={6} />;
  if (!rows.length) return <EmptyState icon={<UsersIcon />} title={t("team.members.empty")} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-members>
      <div className={cn(ROW, "sticky top-0 z-[1] h-8 border-b border-line bg-background ps-4 pe-4 text-[12.5px] text-grid-muted")}>
        <span>{t("team.members.person")}</span>
        <span>{t("team.members.role")}</span>
        <span>{t("team.members.teams")}</span>
        <span className="text-end">{t("team.members.joined")}</span>
      </div>
      {rows.map((m) => (
        <div key={m.user_id} className={cn(ROW, "h-10 border-b border-line/50 ps-4 pe-4 text-[14px]")} data-member-row={m.user_id}>
          <span className="flex min-w-0 items-center gap-2">
            <Person member={m} id={m.user_id} />
            {m.user_id === session?.userId ? <span className="shrink-0 text-[12px] text-grid-muted">{t("team.members.you")}</span> : null}
            {m.status && m.status !== "active" ? <span className="shrink-0 rounded border border-line px-1.5 text-[11.5px] text-grid-muted">{m.status}</span> : null}
          </span>
          <span className="truncate text-[13.5px] text-grid-body">{t(`role.${m.role}`)}</span>
          <span className="flex min-w-0 gap-1 truncate text-[13px]">
            {(teamsOf.get(m.user_id) ?? []).map((tm, i) => (
              <button key={tm.id} type="button" onClick={() => navigate({ name: "team", id: tm.id })} className="truncate text-grid-body hover:text-grid-fg hover:underline">
                {tm.name}
                {i < (teamsOf.get(m.user_id)?.length ?? 0) - 1 ? "," : ""}
              </button>
            ))}
          </span>
          <span className="text-end text-[13px] text-grid-muted tabular-nums">{m.joined_at ? date(m.joined_at, { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
        </div>
      ))}
      <p className="px-4 py-3 text-[12.5px] text-grid-muted">{canInvite ? t("team.members.roleHint") : t("team.members.noInvite")}</p>
    </div>
  );
}

const ROLE_ORDER = (r: string) => ({ owner: 4, admin: 3, manager: 2, member: 1, client: 0 })[r] ?? 0;

/** The accept link as the person will open it: the signed-in server's origin, the locale, the path. */
function useAcceptUrl() {
  const { session } = useApp();
  const { locale } = useI18n();
  return (path: string) => {
    const p = path.startsWith("/") ? path : `/${path}`;
    let origin = "";
    try {
      origin = session?.apiUrl ? new URL(session.apiUrl).origin : "";
    } catch {}
    return `${origin}/${locale}${p}`;
  };
}

function copy(text: string, done: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success(done));
}

function Invitations({ q }: { q: ReturnType<typeof useQuery<Invitation[]>> }) {
  const { t, date, relative } = useI18n();
  const { ws, workspace } = useApp();
  const { at } = useMyRole();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const acceptUrl = useAcceptUrl();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: invitationsKey(ws) });
    void qc.invalidateQueries({ queryKey: qk.members(ws) });
  };

  async function invite(to: string, as: InviteRole) {
    const out = await api.invite(to, as);
    setLink({ url: acceptUrl(out.accept_url), email: out.invitation.email });
    refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await invite(email.trim(), role);
      setEmail("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // The server keeps no link (only its hash) and sends no email: "resend" issues a fresh link.
  async function resend(inv: Invitation) {
    try {
      await api.revokeInvitation(inv.id);
      await invite(inv.email, inv.role);
      toast.success(t("team.invites.resent"));
    } catch (err) {
      refresh();
      toast.error(errorText(err));
    }
  }

  async function revoke(inv: Invitation) {
    try {
      await api.revokeInvitation(inv.id);
      toast.success(t("team.invites.revoked"));
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  const items = q.data ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-invitations>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2 border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("team.invites.emailPlaceholder")}
            aria-label={t("team.invites.email")}
            className="h-8 min-w-56 flex-1"
            data-invite-email
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
            aria-label={t("team.members.role")}
            className="h-8 rounded-md border border-line bg-background px-2 text-[13.5px] text-grid-fg"
            data-invite-role
          >
            {INVITABLE.filter((r) => at(r)).map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </select>
          <SmallButton type="submit" tone="primary" disabled={busy || !email.trim()} data-invite-submit>
            <MailPlusIcon />
            {busy ? t("team.invites.inviting") : t("team.invites.invite")}
          </SmallButton>
        </div>
        <p className="flex items-center gap-1.5 text-[12.5px] text-grid-muted">
          <MailWarningIcon className="size-3.5 shrink-0" />
          {t("team.invites.noEmail", { workspace: workspace?.name ?? "" })}
        </p>
        {error ? (
          <p role="alert" className="text-[13px] text-grid-danger">
            {error}
          </p>
        ) : null}
        {link ? (
          <div role="status" className="mt-1 flex flex-col gap-2 rounded-md border border-line bg-grid-card p-3" data-invite-link>
            <p className="text-[13.5px] font-medium text-grid-fg">
              {t("team.invites.linkReady")} <LtrText>{link.email}</LtrText>
            </p>
            <p className="text-[12.5px] text-grid-muted">{t("team.invites.linkOnce")}</p>
            <div className="flex items-center gap-2">
              <Input readOnly dir="ltr" value={link.url} onFocus={(e) => e.currentTarget.select()} className="h-8 flex-1 font-mono text-[12.5px]" />
              <SmallButton onClick={() => copy(link.url, t("common.copied"))}>
                <CopyIcon />
                {t("common.copy")}
              </SmallButton>
              <SmallButton onClick={() => setLink(null)} aria-label={t("team.invites.dismiss")} title={t("team.invites.dismiss")}>
                <XIcon />
              </SmallButton>
            </div>
          </div>
        ) : null}
      </form>

      <h2 className="px-4 pt-4 pb-2 text-[13px] font-medium text-grid-fg">{t("team.invites.pending")}</h2>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <RowsSkeleton rows={3} />
      ) : !items.length ? (
        <p className="px-4 pb-4 text-[13.5px] text-grid-muted">{t("team.invites.none")}</p>
      ) : (
        <div className="border-t border-line">
          {items.map((inv) => (
            <div key={inv.id} className="grid h-10 grid-cols-[minmax(0,1fr)_110px_130px_auto] items-center gap-4 border-b border-line/50 ps-4 pe-4 text-[14px]" data-invitation={inv.id}>
              <LtrText className="truncate text-grid-fg">{inv.email}</LtrText>
              <span className="text-[13.5px] text-grid-body">{t(`role.${inv.role}`)}</span>
              <span className="text-[13px] text-grid-muted" title={date(inv.expires_at)}>
                {new Date(inv.expires_at).getTime() < Date.now() ? t("team.invites.expired") : t("team.invites.expires", { when: relative(inv.expires_at) })}
              </span>
              <span className="flex justify-end gap-1">
                <SmallButton onClick={() => void resend(inv)} title={t("team.invites.resendHint")}>
                  <RotateCwIcon />
                  {t("team.invites.resend")}
                </SmallButton>
                <SmallButton tone="danger" onClick={() => setRevoking(inv)}>
                  {t("team.invites.revoke")}
                </SmallButton>
              </span>
            </div>
          ))}
        </div>
      )}

      <Confirm
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t("team.invites.revokeTitle")}
        body={t("team.invites.revokeBody", { email: revoking?.email ?? "" })}
        action={t("team.invites.revoke")}
        onConfirm={() => {
          if (revoking) void revoke(revoking);
          setRevoking(null);
        }}
      />
    </div>
  );
}
