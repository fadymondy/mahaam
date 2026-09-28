// The project's Vault tab (renderer/views/Project.tsx renders it under the project header): memory
// notes anyone on the project reads and writes, and secrets sealed at rest. A secret's value is
// never listed; Reveal decrypts one (manager+ or the project lead), is recorded server-side, and
// the value lives only in this component's state — never the query cache — and hides after 30 s.
// Mirrors web/app/[locale]/w/[slug]/projects/[id]/vault.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { VaultInput, VaultItem, VaultKind } from "../../../main/api-projectMoney";
import { EmptyState } from "@/components/kit";
import { Segmented } from "@/components/issues/controls";
import { Badge, SmallButton } from "@/components/settings/parts";
import { Confirm, Field, Gate, areaCls, errText, inputCls, isManager, isMember } from "@/components/projectMoney/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";

type Draft = { id?: string; kind: VaultKind; title: string; body: string; tags: string; value: string };
const HIDE_AFTER = 30_000;

export function ProjectVault({ projectId }: { projectId: string }) {
  const { t, relative } = useI18n();
  const { ws, workspace } = useApp();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: qk.project(ws, projectId), queryFn: () => api.project(projectId), enabled: !!ws, staleTime: 60_000 });
  const [kind, setKind] = useState<"all" | VaultKind>("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<VaultItem | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, number>>({});

  const canWrite = isMember(workspace?.role);
  // Secrets: manager+ or the project's lead (can_manage covers the lead); the server decides.
  const canSecrets = isManager(workspace?.role) || !!detail.data?.can_manage;

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  // Forget every revealed value when the tab goes away.
  useEffect(() => {
    const tm = timers.current;
    return () => Object.values(tm).forEach((h) => clearTimeout(h));
  }, []);

  const listKey = ["w", ws, "vault", projectId];
  const list = useQuery({
    queryKey: [...listKey, kind, query],
    queryFn: () => api.vaultList(projectId, { kind: kind === "all" ? undefined : kind, q: query }),
    enabled: !!ws,
    placeholderData: keepPreviousData,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: listKey });

  const hide = (id: string) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setRevealed(({ [id]: _, ...rest }) => rest);
  };
  const reveal = async (item: VaultItem) => {
    if (revealed[item.id] !== undefined) return hide(item.id);
    try {
      const out = await api.vaultReveal(item.id);
      setRevealed((r) => ({ ...r, [item.id]: out.value ?? "" }));
      timers.current[item.id] = window.setTimeout(() => hide(item.id), HIDE_AFTER);
      refresh();
    } catch (err) {
      toast.error(errText(err, t("projectMoney.failed")));
    }
  };
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => toast.success(t("projectMoney.vault.copied")),
      () => toast.error(t("projectMoney.vault.copyFailed")),
    );

  const del = useMutation({
    mutationFn: (id: string) => api.vaultDelete(id),
    onSuccess: (_d, id) => {
      hide(id);
      refresh();
    },
    onError: (err) => toast.error(errText(err, t("projectMoney.failed"))),
  });

  const blank = (k: VaultKind): Draft => ({ kind: k, title: "", body: "", tags: "", value: "" });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("projectMoney.vault.search")} aria-label={t("projectMoney.vault.search")} className={`${inputCls} ps-8`} />
        </div>
        <Segmented<"all" | VaultKind>
          label={t("projectMoney.vault.kind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: t("projectMoney.vault.all") },
            { value: "memory", label: t("projectMoney.vault.memory") },
            { value: "secret", label: t("projectMoney.vault.secrets") },
          ]}
        />
        {canWrite ? (
          <SmallButton tone="primary" onClick={() => setDraft(blank("memory"))}>
            <BrainIcon /> {t("projectMoney.vault.newMemory")}
          </SmallButton>
        ) : null}
        {canSecrets ? (
          <SmallButton onClick={() => setDraft(blank("secret"))}>
            <KeyRoundIcon /> {t("projectMoney.vault.newSecret")}
          </SmallButton>
        ) : null}
      </div>
      <p className="px-6 pt-2 pb-3 text-[12.5px] text-grid-muted">{t("projectMoney.vault.hint")}</p>

      <div className="px-6 pb-6">
        <Gate
          q={list}
          render={(items) =>
            items.length === 0 ? (
              <EmptyState
                icon={<BrainIcon />}
                title={query ? t("projectMoney.vault.noMatch") : t("projectMoney.vault.empty")}
                body={query ? undefined : t("projectMoney.vault.emptyBody")}
              />
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {items.map((v) => {
                  const shown = revealed[v.id];
                  const editable = canWrite && (v.kind === "memory" || canSecrets);
                  return (
                    <li key={v.id} className="group flex flex-col gap-1.5 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {v.kind === "secret" ? <KeyRoundIcon className="size-3.5 text-grid-warn" aria-hidden /> : <BrainIcon className="size-3.5 text-grid-muted" aria-hidden />}
                        <span className="text-[14px] font-medium text-grid-fg" dir="auto">
                          {v.title}
                        </span>
                        <Badge>{v.kind === "secret" ? t("projectMoney.vault.secret") : t("projectMoney.vault.memoryOne")}</Badge>
                        {(v.tags ?? []).map((tag) => (
                          <Badge key={tag} tone="action">
                            {tag}
                          </Badge>
                        ))}
                        <span className="ms-auto text-[12.5px] text-grid-muted">{t("projectMoney.vault.updated", { when: relative(v.updated_at) })}</span>
                        {editable ? (
                          <span className="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                            <SmallButton aria-label={t("projectMoney.edit")} title={t("projectMoney.edit")} onClick={() => setDraft({ id: v.id, kind: v.kind, title: v.title, body: v.body, tags: (v.tags ?? []).join(", "), value: "" })}>
                              <PencilIcon />
                            </SmallButton>
                            <SmallButton tone="danger" aria-label={t("projectMoney.delete")} title={t("projectMoney.delete")} onClick={() => setDeleting(v)}>
                              <Trash2Icon />
                            </SmallButton>
                          </span>
                        ) : null}
                      </div>
                      {v.body ? (
                        <p className="text-[13.5px] whitespace-pre-wrap text-grid-body" dir="auto">
                          {v.body}
                        </p>
                      ) : null}
                      {v.kind === "secret" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <code dir="ltr" className="min-w-0 flex-1 truncate rounded-md border border-line bg-grid-soft px-2 py-1 font-mono text-[12px] text-grid-fg select-all">
                            {shown ?? (v.has_value ? "••••••••••••" : t("projectMoney.vault.noValue"))}
                          </code>
                          {canSecrets && v.has_value ? (
                            <SmallButton onClick={() => void reveal(v)}>
                              {shown !== undefined ? <EyeOffIcon /> : <EyeIcon />}
                              {shown !== undefined ? t("projectMoney.vault.hide") : t("projectMoney.vault.reveal")}
                            </SmallButton>
                          ) : null}
                          {shown !== undefined ? (
                            <SmallButton onClick={() => void copy(shown)}>
                              <CopyIcon /> {t("projectMoney.vault.copy")}
                            </SmallButton>
                          ) : null}
                          {v.last_revealed_at ? <span className="text-[12.5px] text-grid-muted">{t("projectMoney.vault.lastRevealed", { when: relative(v.last_revealed_at) })}</span> : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )
          }
        />
      </div>

      <VaultDialog
        draft={draft}
        projectId={projectId}
        onClose={() => setDraft(null)}
        onSaved={(id) => {
          if (id) hide(id);
          refresh();
        }}
      />
      <Confirm
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("projectMoney.vault.deleteTitle")}
        body={t("projectMoney.vault.deleteBody")}
        label={t("projectMoney.delete")}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </div>
  );
}

function VaultDialog({ draft, projectId, onClose, onSaved }: { draft: Draft | null; projectId: string; onClose: () => void; onSaved: (id?: string) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<Draft | null>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setD(draft);
    setError(null);
  }, [draft]);
  if (!d) return null;
  const secret = d.kind === "secret";
  const editing = !!d.id;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) return;
    const body: VaultInput = {
      title: d.title.trim(),
      body: d.body,
      tags: d.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (secret && d.value) body.value = d.value;
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.vaultUpdate(d.id!, body);
      else await api.vaultCreate(projectId, { ...body, kind: d.kind });
      toast.success(t("projectMoney.saved"));
      onSaved(d.id);
      onClose();
    } catch (err) {
      setError(errText(err, t("projectMoney.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {secret
                ? editing
                  ? t("projectMoney.vault.editSecret")
                  : t("projectMoney.vault.newSecret")
                : editing
                  ? t("projectMoney.vault.editMemory")
                  : t("projectMoney.vault.newMemory")}
            </DialogTitle>
            <DialogDescription>{secret ? t("projectMoney.vault.secretHint") : t("projectMoney.vault.memoryHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field label={t("projectMoney.vault.title")} htmlFor="vault-title">
              <input id="vault-title" dir="auto" required maxLength={200} autoFocus className={inputCls} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
            </Field>
            {secret ? (
              <Field label={editing ? t("projectMoney.vault.newValue") : t("projectMoney.vault.value")} htmlFor="vault-value">
                <input
                  id="vault-value"
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  required={!editing}
                  className={inputCls}
                  value={d.value}
                  placeholder={editing ? t("projectMoney.vault.keepValue") : undefined}
                  onChange={(e) => setD({ ...d, value: e.target.value })}
                />
              </Field>
            ) : null}
            <Field label={secret ? t("projectMoney.vault.secretBody") : t("projectMoney.vault.note")} htmlFor="vault-body">
              <textarea
                id="vault-body"
                dir="auto"
                rows={secret ? 2 : 8}
                className={areaCls}
                value={d.body}
                placeholder={secret ? t("projectMoney.vault.secretBodyPh") : t("projectMoney.vault.notePh")}
                onChange={(e) => setD({ ...d, body: e.target.value })}
              />
            </Field>
            <Field label={t("projectMoney.vault.tags")} htmlFor="vault-tags">
              <input id="vault-tags" dir="auto" className={inputCls} value={d.tags} placeholder="deploy, staging" onChange={(e) => setD({ ...d, tags: e.target.value })} />
            </Field>
            {error ? (
              <p className="text-[13px] text-grid-danger" role="alert" dir="auto">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <SmallButton onClick={onClose}>{t("projectMoney.cancel")}</SmallButton>
            <SmallButton type="submit" tone="primary" disabled={busy || !d.title.trim()}>
              <PlusIcon /> {t("projectMoney.save")}
            </SmallButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
