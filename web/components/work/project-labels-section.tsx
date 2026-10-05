"use client"

import { useEffect, useState } from "react"
import { toast } from "@fadymondy/nasaq/web"
import useSWR from "swr"

import { Button } from "@fadymondy/nasaq/web"

import { ColorChip } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { errorText, useLabels, w } from "@/lib/work"

// The labels a project carries. Label grants (Settings → Access) follow them, so labelling
// a project "Client X" opens it to every team granted "Client X". Manager+.
export function ProjectLabelsSection({ projectId }: { projectId: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const all = useLabels(ws.id)
  const current = useSWR<{ labels: { id: string }[] | null }>([`/api/w/projects/${projectId}/project-labels`, ws.id], ([p, id]: [string, string]) =>
    api(p, { workspaceId: id }),
  )
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => setPicked(new Set((current.data?.labels ?? []).map((l) => l.id))), [current.data])

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function save() {
    setBusy(true)
    try {
      await w.put(ws.id, `/api/w/projects/${projectId}/project-labels`, { labels: [...picked] })
      toast.success(t("projectLabels.saved"))
      void current.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-card bg-card">
      <div className="px-6 pt-5 pb-3">
        <h2 className="text-h3">{t("projectLabels.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("projectLabels.hint")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-6 pb-6">
        {(all.data?.labels ?? []).map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={picked.has(l.id)}
            onClick={() => toggle(l.id)}
            className={
              "rounded-full border px-1 py-0.5 transition-opacity " + (picked.has(l.id) ? "border-nq-action" : "border-transparent opacity-50 hover:opacity-100")
            }
          >
            <ColorChip color={l.color}>{l.name}</ColorChip>
          </button>
        ))}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save()} className="ms-auto">
          {t("projectLabels.save")}
        </Button>
      </div>
    </section>
  )
}
