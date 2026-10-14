"use client"

import { useEffect, useMemo, useState } from "react"
import { BrainIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react"
import useSWR from "swr"

import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  SectionHeader,
  Textarea,
  Vault,
  toast,
  type VaultSecret,
  type VaultSecretInput,
  type VaultSecretKind,
} from "@fadymondy/nasaq/web"

import { ConfirmButton } from "@/components/confirm-button"
import { EmptyState, ErrorState } from "@/components/states"
import { CardGridSkeleton } from "@/components/work/project/project-skeletons"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText, w } from "@/lib/work"

/*
The project vault (internal/work/vault.go): SECRETS sealed at rest, in Nasaq's Vault (grouped,
masked, reveal and copy fetch the value on demand and the reveal lands in the activity feed),
and MEMORY notes anyone on the project reads and writes, as cards. The same data an agent
reaches over MCP (vault_recall, vault_remember, vault_reveal_secret).

A secret's group, kind and expiry ride in its tags: the first plain tag is the group, and
"kind:<kind>" / "expires:<YYYY-MM-DD>" are reserved, so nothing the dialog asks for is lost.
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

type Draft = { id?: string; title: string; body: string; tags: string }

const KINDS: readonly VaultSecretKind[] = ["api-key", "password", "token", "certificate", "ssh-key", "other"]

function toSecret(v: VaultItem): VaultSecret {
  const plain = v.tags.filter((x) => !x.startsWith("kind:") && !x.startsWith("expires:"))
  const kind = v.tags.find((x) => x.startsWith("kind:"))?.slice(5) as VaultSecretKind | undefined
  const expires = v.tags.find((x) => x.startsWith("expires:"))?.slice(8)
  return {
    id: v.id,
    name: v.title,
    group: plain[0] ?? "",
    kind: kind && KINDS.includes(kind) ? kind : undefined,
    description: v.body || undefined,
    updatedAt: v.updated_at,
    expiresAt: expires || undefined,
    lastAccessedAt: v.last_revealed_at ?? undefined,
  }
}

function secretTags(input: VaultSecretInput, previous: string[] = []): string[] {
  // Keep any extra plain tags an agent added after the group; the dialog only edits the group.
  const extra = previous.filter((x) => !x.startsWith("kind:") && !x.startsWith("expires:")).slice(1)
  // The server lowercases tags and drops any over 40 characters.
  const group = input.group.trim().slice(0, 40)
  return [...(group ? [group] : []), ...extra.filter((x) => x !== group), `kind:${input.kind}`, ...(input.expiresAt ? [`expires:${input.expiresAt}`] : [])]
}

export default function VaultPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const { project } = useProjectCtx()
  useDocumentTitle(`${t("projectTab.vault")} · ${project.name}`)
  const canWrite = ws.can("vault:write")
  const canSecrets = ws.can("vault:secrets")

  const list = useSWR<{ items: VaultItem[] | null }>(
    [`/api/w/projects/${project.id}/vault`, ws.id],
    ([p, id]: [string, string]) => api(p, { workspaceId: id }),
    { revalidateOnFocus: false },
  )
  const items = list.data?.items ?? []
  const secrets = items.filter((v) => v.kind === "secret")
  const memories = items.filter((v) => v.kind === "memory")

  const failed = (err: unknown) => ({ error: errorText(err, t("vault.failed")) })

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 p-4 sm:p-6" data-vault-page>
      {list.error ? <ErrorState error={list.error} /> : null}

      <Vault
        title={t("vault.secrets")}
        description={t("vault.secretHint")}
        secrets={secrets.map(toSecret)}
        loading={!list.data && !list.error}
        revealTimeout={30_000}
        onReveal={async (id) => {
          if (!canSecrets) return { error: t("vault.failed") }
          try {
            const out = await w.post<VaultItem>(ws.id, `/api/w/vault/${id}/reveal`)
            void list.mutate()
            return { value: out.value ?? "" }
          } catch (err) {
            return { error: errorText(err, t("vault.failed")) }
          }
        }}
        onSave={
          canWrite && canSecrets
            ? async (input, id) => {
                const prev = secrets.find((s) => s.id === id)
                const body: Record<string, unknown> = { title: input.name.trim(), body: input.description ?? "", tags: secretTags(input, prev?.tags) }
                if (input.value) body.value = input.value
                try {
                  if (id) await w.patch(ws.id, `/api/w/vault/${id}`, body)
                  else await w.post(ws.id, `/api/w/projects/${project.id}/vault`, { ...body, kind: "secret" })
                  toast.success(t("vault.saved"))
                  void list.mutate()
                } catch (err) {
                  return failed(err)
                }
              }
            : undefined
        }
        onDelete={
          canWrite && canSecrets
            ? async (id) => {
                try {
                  await w.del(ws.id, `/api/w/vault/${id}`)
                  void list.mutate()
                } catch (err) {
                  return failed(err)
                }
              }
            : undefined
        }
        data-vault-secrets
      />

      <Memories items={memories} loading={!list.data && !list.error} canWrite={canWrite} projectId={project.id} onChanged={() => void list.mutate()} />
    </div>
  )
}

function Memories({
  items,
  loading,
  canWrite,
  projectId,
  onChanged,
}: {
  items: VaultItem[]
  loading: boolean
  canWrite: boolean
  projectId: string
  onChanged: () => void
}) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [q, setQ] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const query = q.trim().toLowerCase()
  const shown = useMemo(
    () => (query ? items.filter((v) => `${v.title}\n${v.body}\n${v.tags.join(" ")}`.toLowerCase().includes(query)) : items),
    [items, query],
  )

  return (
    <section className="space-y-4" aria-labelledby="vault-memory" data-vault-memory>
      <SectionHeader
        headingId="vault-memory"
        title={t("vault.memory")}
        description={t("vault.hint")}
        action={
          canWrite ? (
            <Button variant="primary" onClick={() => setDraft({ title: "", body: "", tags: "" })}>
              <PlusIcon />
              {t("vault.newMemory")}
            </Button>
          ) : null
        }
      />
      {items.length > 3 ? (
        <div className="relative max-w-sm">
          <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("vault.search")} className="ps-8" aria-label={t("vault.search")} />
        </div>
      ) : null}
      {loading ? (
        <CardGridSkeleton />
      ) : shown.length === 0 ? (
        <EmptyState title={query ? t("vault.noMatch") : t("vault.empty")} body={query ? undefined : t("vault.emptyBody")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((v) => (
            <Card key={v.id} className="min-w-0 gap-3 border-transparent" data-vault-note={v.id}>
              <CardHeader>
                <CardTitle as="h3" className="flex min-w-0 items-center gap-2">
                  <BrainIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate" dir="auto">
                    {v.title}
                  </span>
                </CardTitle>
                {canWrite ? (
                  <CardAction className="flex gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("vault.edit")}
                      onClick={() => setDraft({ id: v.id, title: v.title, body: v.body, tags: v.tags.join(", ") })}
                    >
                      <PencilIcon />
                    </Button>
                    <ConfirmButton
                      label={
                        <>
                          <Trash2Icon />
                          <span className="sr-only">{t("vault.delete")}</span>
                        </>
                      }
                      title={t("vault.deleteTitle")}
                      description={t("vault.deleteBody")}
                      confirmLabel={t("vault.delete")}
                      onConfirm={() =>
                        w
                          .del(ws.id, `/api/w/vault/${v.id}`)
                          .then(onChanged)
                          .catch((err) => void toast.error(errorText(err, t("vault.failed"))))
                      }
                    />
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                {v.body ? (
                  <p className="line-clamp-6 text-sm whitespace-pre-wrap text-nq-fg-body" dir="auto">
                    {v.body}
                  </p>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  {v.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                  <span className="ms-auto text-caption text-muted-foreground">{t("vault.updated", { when: timeAgo(v.updated_at, locale) })}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <NoteDialog draft={draft} projectId={projectId} onClose={() => setDraft(null)} onSaved={onChanged} />
    </section>
  )
}

function NoteDialog({ draft, projectId, onClose, onSaved }: { draft: Draft | null; projectId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [d, setD] = useState<Draft | null>(draft)
  const [busy, setBusy] = useState(false)
  useEffect(() => setD(draft), [draft])
  if (!d) return null
  const editing = !!d.id

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!d.title.trim()) return
    const body = {
      title: d.title.trim(),
      body: d.body,
      tags: d.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }
    setBusy(true)
    try {
      if (editing) await w.patch(ws.id, `/api/w/vault/${d.id}`, body)
      else await w.post(ws.id, `/api/w/projects/${projectId}/vault`, { ...body, kind: "memory" })
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
            <DialogTitle>{editing ? t("vault.editMemory") : t("vault.newMemory")}</DialogTitle>
            <DialogDescription>{t("vault.memoryHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="vault-title">{t("vault.title")}</FieldLabel>
              <Input id="vault-title" dir="auto" required maxLength={200} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="vault-body">{t("vault.note")}</FieldLabel>
              <Textarea id="vault-body" dir="auto" rows={8} value={d.body} placeholder={t("vault.notePh")} onChange={(e) => setD({ ...d, body: e.target.value })} />
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
