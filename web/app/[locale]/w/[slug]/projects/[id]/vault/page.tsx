"use client"

import { useEffect, useState } from "react"
import { BrainIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import useSWR from "swr"

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, Tabs, TabsList, TabsTab, Textarea } from "@fadymondy/nasaq/web"







import { ConfirmButton } from "@/components/confirm-button"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText, w } from "@/lib/work"

/*
The project vault (internal/work/vault.go): MEMORY notes anyone on the project reads and
writes, and SECRETS sealed at rest. A secret's value is never listed; Reveal decrypts one
(manager+ or the project lead) and the reveal lands in the activity feed. The same data an
agent reaches over MCP (vault_recall, vault_remember, vault_reveal_secret).
*/

type Kind = "memory" | "secret"
type VaultItem = {
  id: string
  project_id: string
  kind: Kind
  title: string
  body: string
  tags: string[]
  has_value: boolean
  value?: string
  last_revealed_at: string | null
  updated_at: string
}

type Draft = { id?: string; kind: Kind; title: string; body: string; tags: string; value: string }

export default function VaultPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const { project } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.vault")} · ${project.name}`)
  const [kind, setKind] = useState<"all" | Kind>("all")
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const canWrite = ws.can("vault:write")
  const canSecrets = ws.can("vault:secrets")

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(id)
  }, [q])

  const params = new URLSearchParams()
  if (kind !== "all") params.set("kind", kind)
  if (query) params.set("q", query)
  const list = useSWR<{ items: VaultItem[] | null }>(
    [`/api/w/projects/${project.id}/vault?${params}`, ws.id],
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { revalidateOnFocus: false },
  )

  const reveal = async (item: VaultItem) => {
    if (revealed[item.id]) {
      setRevealed(({ [item.id]: _, ...rest }) => rest)
      return
    }
    try {
      const out = await w.post<VaultItem>(ws.id, `/api/w/vault/${item.id}/reveal`)
      setRevealed((r) => ({ ...r, [item.id]: out.value ?? "" }))
      // Hide it again after 30 s; the reveal is already on record.
      setTimeout(() => setRevealed(({ [item.id]: _, ...rest }) => rest), 30_000)
      void list.mutate()
    } catch (err) {
      toast.error(errorText(err, t("vault.failed")))
    }
  }

  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => toast.success(t("vault.copied")),
      () => toast.error(t("vault.copyFailed")),
    )

  const items = list.data?.items ?? []

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 start-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("vault.search")} className="ps-8" aria-label={t("vault.search")} />
        </div>
        <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <TabsList>
            <TabsTab value="all">{t("vault.all")}</TabsTab>
            <TabsTab value="memory">{t("vault.memory")}</TabsTab>
            <TabsTab value="secret">{t("vault.secrets")}</TabsTab>
          </TabsList>
        </Tabs>
        {canWrite ? (
          <Button variant="primary" onClick={() => setDraft({ kind: "memory", title: "", body: "", tags: "", value: "" })}>
            <BrainIcon /> {t("vault.newMemory")}
          </Button>
        ) : null}
        {canSecrets ? (
          <Button variant="secondary" onClick={() => setDraft({ kind: "secret", title: "", body: "", tags: "", value: "" })}>
            <KeyRoundIcon /> {t("vault.newSecret")}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t("vault.hint")}</p>

      {list.error ? (
        <ErrorState error={list.error} />
      ) : !list.data ? (
        <LoadingRows rows={4} />
      ) : items.length === 0 ? (
        <EmptyState title={query ? t("vault.noMatch") : t("vault.empty")} body={query ? undefined : t("vault.emptyBody")} />
      ) : (
        <ul className="divide-y divide-line border border-border">
          {items.map((v) => (
            <li key={v.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {v.kind === "secret" ? (
                  <KeyRoundIcon className="size-4 text-nq-warning-text" aria-hidden />
                ) : (
                  <BrainIcon className="size-4 text-muted-foreground" aria-hidden />
                )}
                <h3 className="font-medium" dir="auto">
                  {v.title}
                </h3>
                <Badge variant="neutral">{v.kind === "secret" ? t("vault.secret") : t("vault.memoryOne")}</Badge>
                {v.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
                <span className="ms-auto text-caption text-muted-foreground">{t("vault.updated", { when: timeAgo(v.updated_at, locale) })}</span>
              </div>
              {v.body ? (
                <p className="text-sm whitespace-pre-wrap text-nq-fg-body" dir="auto">
                  {v.body}
                </p>
              ) : null}
              {v.kind === "secret" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code dir="ltr" className="min-w-0 flex-1 truncate border border-border bg-muted px-2 py-1 font-mono text-xs">
                    {revealed[v.id] ?? "••••••••••••"}
                  </code>
                  {canSecrets ? (
                    <Button size="sm" variant="secondary" onClick={() => void reveal(v)}>
                      {revealed[v.id] ? <EyeOffIcon /> : <EyeIcon />} {revealed[v.id] ? t("vault.hide") : t("vault.reveal")}
                    </Button>
                  ) : null}
                  {revealed[v.id] ? (
                    <Button size="sm" variant="ghost" onClick={() => void copy(revealed[v.id])}>
                      <CopyIcon /> {t("vault.copy")}
                    </Button>
                  ) : null}
                  {v.last_revealed_at ? (
                    <span className="text-caption text-muted-foreground">{t("vault.lastRevealed", { when: timeAgo(v.last_revealed_at, locale) })}</span>
                  ) : null}
                </div>
              ) : null}
              {canWrite && (v.kind === "memory" || canSecrets) ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft({ id: v.id, kind: v.kind, title: v.title, body: v.body, tags: v.tags.join(", "), value: "" })}
                  >
                    <PencilIcon /> {t("vault.edit")}
                  </Button>
                  <ConfirmButton
                    label={
                      <>
                        <Trash2Icon /> {t("vault.delete")}
                      </>
                    }
                    title={t("vault.deleteTitle")}
                    description={t("vault.deleteBody")}
                    confirmLabel={t("vault.delete")}
                    onConfirm={() =>
                      w
                        .del(ws.id, `/api/w/vault/${v.id}`)
                        .then(() => void list.mutate())
                        .catch((err) => void toast.error(errorText(err, t("vault.failed"))))
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <VaultDialog draft={draft} projectId={project.id} onClose={() => setDraft(null)} onSaved={() => void list.mutate()} />
    </div>
  )
}

function VaultDialog({
  draft,
  projectId,
  onClose,
  onSaved,
}: {
  draft: Draft | null
  projectId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [d, setD] = useState<Draft | null>(draft)
  const [busy, setBusy] = useState(false)
  useEffect(() => setD(draft), [draft])
  if (!d) return null
  const secret = d.kind === "secret"
  const editing = !!d.id

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!d.title.trim()) return
    const body: Record<string, unknown> = {
      title: d.title.trim(),
      body: d.body,
      tags: d.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }
    if (secret && d.value) body.value = d.value
    setBusy(true)
    try {
      if (editing) await w.patch(ws.id, `/api/w/vault/${d.id}`, body)
      else await w.post(ws.id, `/api/w/projects/${projectId}/vault`, { ...body, kind: d.kind })
      toast.success(t("vault.saved"))
      onSaved()
      onClose()
    } catch (err) {
      toast.error(errorText(err, t("vault.failed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {secret ? (editing ? t("vault.editSecret") : t("vault.newSecret")) : editing ? t("vault.editMemory") : t("vault.newMemory")}
            </DialogTitle>
            <DialogDescription>{secret ? t("vault.secretHint") : t("vault.memoryHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="vault-title">{t("vault.title")}</FieldLabel>
              <Input id="vault-title" dir="auto" required maxLength={200} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
            </Field>
            {secret ? (
              <Field>
                <FieldLabel htmlFor="vault-value">{editing ? t("vault.newValue") : t("vault.value")}</FieldLabel>
                <Input
                  id="vault-value"
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  required={!editing}
                  value={d.value}
                  placeholder={editing ? t("vault.keepValue") : undefined}
                  onChange={(e) => setD({ ...d, value: e.target.value })}
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="vault-body">{secret ? t("vault.secretBody") : t("vault.note")}</FieldLabel>
              <Textarea
                id="vault-body"
                dir="auto"
                rows={secret ? 2 : 8}
                value={d.body}
                placeholder={secret ? t("vault.secretBodyPh") : t("vault.notePh")}
                onChange={(e) => setD({ ...d, body: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="vault-tags">{t("vault.tags")}</FieldLabel>
              <Input id="vault-tags" dir="auto" value={d.tags} placeholder="deploy, staging" onChange={(e) => setD({ ...d, tags: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("vault.cancel")}
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              <PlusIcon /> {t("vault.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
