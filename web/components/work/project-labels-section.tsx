"use client"

import { useState, type FormEvent } from "react"
import { PencilIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"
import useSWR from "swr"

import { Button, Checkbox, Input } from "@fadymondy/nasaq/web"

import { ConfirmButton } from "@/components/confirm-button"
import { EditLabel } from "@/components/work/label-edit-dialog"
import { ColorChip, ColorPicker } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { errorText, useLabels, w, type Label } from "@/lib/work"

// The labels a project carries, and the one place labels are managed (the workspace sidebar has no
// Labels page any more). One field searches the workspace's labels or, with no exact match, creates
// the label and adds it to the project; ticking a row adds or removes it, saved at once. Label
// grants (Settings → Access) follow them, so labelling a project "Client X" opens it to every team
// granted "Client X". Manager+; creating needs labels:create, rename/recolour/delete labels:manage.
export function ProjectLabelsSection({ projectId }: { projectId: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const all = useLabels(ws.id)
  const current = useSWR<{ labels: { id: string }[] | null }>([`/api/w/projects/${projectId}/project-labels`, ws.id], ([p, id]: [string, string]) =>
    api(p, { workspaceId: id }),
  )
  const canCreate = ws.can("labels:create")
  const canManage = ws.can("labels:manage")
  const [q, setQ] = useState("")
  const [color, setColor] = useState<string>("slate")
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Label | null>(null)

  const picked = new Set((current.data?.labels ?? []).map((l) => l.id))
  const list = all.data?.labels ?? []
  const needle = q.trim().toLowerCase()
  // The project's own labels first, then the rest, each alphabetical.
  const shown = (needle ? list.filter((l) => l.name.toLowerCase().includes(needle)) : [...list]).sort(
    (a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)) || a.name.localeCompare(b.name),
  )
  const exact = list.some((l) => l.name.trim().toLowerCase() === needle)

  async function put(ids: Set<string>, ok?: string) {
    setBusy(true)
    try {
      await w.put(ws.id, `/api/w/projects/${projectId}/project-labels`, { labels: [...ids] })
      if (ok) toast.success(ok)
      await current.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string, on: boolean) => {
    const n = new Set(picked)
    if (on) n.add(id)
    else n.delete(id)
    void put(n)
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    const name = q.trim()
    if (!name || exact || !canCreate) return
    setBusy(true)
    try {
      const l = await w.post<Label>(ws.id, "/api/w/labels", { name, color })
      await all.mutate()
      setQ("")
      await put(new Set([...picked, l.id]), t("projectLabels.created", { name }))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-h3">{t("projectLabels.title")}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">{t("projectLabels.hint")}</p>
      </div>

      <form onSubmit={create} className="flex flex-col gap-3 rounded-card bg-muted/40 p-4" data-label-add>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={40}
              className="ps-8"
              placeholder={canCreate ? t("projectLabels.searchOrCreate") : t("projectLabels.search")}
              aria-label={canCreate ? t("projectLabels.searchOrCreate") : t("projectLabels.search")}
            />
          </div>
          {canCreate ? (
            <Button variant="primary" type="submit" disabled={busy || !needle || exact}>
              <PlusIcon />
              {needle && !exact ? t("projectLabels.createNamed", { name: q.trim() }) : t("labels.create")}
            </Button>
          ) : null}
        </div>
        {canCreate && needle && !exact ? <ColorPicker value={color} onChange={setColor} /> : null}
      </form>

      <p className="text-caption text-muted-foreground">{t("projectLabels.count", { n: picked.size })}</p>

      {shown.length ? (
        <ul className="divide-y divide-line" data-project-labels>
          {shown.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 text-sm" data-label={l.id}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <Checkbox checked={picked.has(l.id)} disabled={busy} onCheckedChange={(on) => toggle(l.id, !!on)} />
                <ColorChip color={l.color}>{l.name}</ColorChip>
                <span className="truncate text-caption text-muted-foreground">{t("labels.taskCount", { n: l.task_count })}</span>
              </label>
              {canManage ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(l)} aria-label={t("labels.edit")} title={t("labels.edit")}>
                    <PencilIcon />
                  </Button>
                  <ConfirmButton
                    label={t("common.delete")}
                    title={t("labels.deleteTitle", { name: l.name })}
                    description={t("labels.deleteBody", { n: l.task_count })}
                    confirmLabel={t("common.delete")}
                    onConfirm={async () => {
                      try {
                        await w.del(ws.id, `/api/w/labels/${l.id}`)
                        void all.mutate()
                        void current.mutate()
                      } catch (err) {
                        toast.error(errorText(err, t("common.networkError")))
                      }
                    }}
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{needle ? t("projectLabels.noMatch") : t("labels.empty")}</p>
      )}

      <EditLabel
        label={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void all.mutate()
        }}
      />
    </section>
  )
}
