"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { InboxIcon } from "lucide-react"

import { Tabs, TabsList, TabsTab } from "@fadymondy/nasaq/web"

import { PortalActions } from "@/components/portal/file-issue-dialog"
import { PortalEmpty, RequestCard } from "@/components/portal/portal-bits"
import { SectionHeader } from "@/components/public-frame"
import { ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { usePortalProjects, usePortalRequests } from "@/lib/portal"
import { useDocumentTitle } from "@/lib/title"

const STATES = ["all", "pending", "accepted", "converted", "declined"] as const
type Filter = (typeof STATES)[number]

/*
The customer's requests across their projects (MH-1167, GET /api/w/portal/requests): file a new
one, and follow each through pending → accepted (an issue) / converted (a task) / declined, with
the team's reply. Opening the issue or task goes to its project's panel.
*/
export default function PortalRequestsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useDocumentTitle(`${t("nav.requests")} · ${ws.summary.name}`)
  const [filter, setFilter] = useState<Filter>("all")
  const requests = usePortalRequests(ws.id)
  const projects = usePortalProjects(ws.id)
  const base = `/${locale}/w/${ws.slug}/portal/projects`

  const all = useMemo(() => requests.data?.requests ?? [], [requests.data])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, pending: 0, accepted: 0, converted: 0, declined: 0 }
    for (const r of all) c[r.state] += 1
    return c
  }, [all])
  const rows = filter === "all" ? all : all.filter((r) => r.state === filter)
  const open = (projectId: string | null, q: string) => {
    if (projectId) router.push(`${base}/${projectId}?${q}`)
  }

  return (
    <>
      <SectionHeader
        title={t("nav.requests")}
        description={t("portal.requests.hint")}
        action={
          <PortalActions
            projects={(projects.data?.projects ?? []).filter((p) => !p.archived)}
            onFiled={() => {
              void requests.mutate()
              void projects.mutate()
            }}
          />
        }
      />
      <div className="flex flex-col gap-4 px-6 pb-6" data-portal-requests>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            {STATES.map((s) => (
              <TabsTab key={s} value={s}>
                {t(`portal.requests.state.${s}`)}
                {counts[s] ? <span className="ms-1.5 text-caption tabular-nums text-muted-foreground">{counts[s]}</span> : null}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>

        {requests.error ? (
          <ErrorState error={requests.error} />
        ) : !requests.data ? (
          <LoadingRows rows={4} />
        ) : rows.length === 0 ? (
          <PortalEmpty icon={<InboxIcon />} title={filter === "all" ? t("portal.requests.none") : t("portal.requests.noneIn")} body={filter === "all" ? t("portal.requests.noneBody") : undefined} />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <RequestCard
                key={r.key}
                r={r}
                project={r.project_name}
                onOpenIssue={(key) => open(r.project_id, `tab=issues&issue=${encodeURIComponent(key)}`)}
                onOpenTask={(key) => open(r.project_id, `tab=board&task=${encodeURIComponent(key)}`)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
