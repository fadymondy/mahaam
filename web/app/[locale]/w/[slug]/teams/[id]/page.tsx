"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ChevronLeftIcon } from "lucide-react"

import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { NotFoundState } from "@/components/not-found-state"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { ColorDot } from "@/components/work/palette"
import { PersonAvatar, useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"
import { useProject, useProjects, useTeams, type Project } from "@/lib/work"

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const canRead = ws.can("teams:read")
  const teams = useTeams(ws.id, canRead)
  const projects = useProjects(ws.id)
  const back = `/${locale}/w/${ws.slug}/teams`

  const team = (teams.data?.teams ?? []).find((tm) => tm.id === id)
  useDocumentTitle(`${team?.name ?? t("nav.teams")} · ${ws.summary.name}`)

  if (ws.current && !canRead) return <p className="px-6 py-6 text-sm text-grid-muted">{t("teams.noPermission")}</p>
  if (teams.error) return <ErrorState error={teams.error} />
  if (teams.isLoading) return <LoadingRows rows={5} />
  if (!team) {
    return <NotFoundState title={t("teamDetail.notFound")} body={t("teamDetail.notFoundBody")} backHref={back} backLabel={t("nav.teams")} />
  }

  return (
    <>
      <div className="px-6 pt-5">
        <Link href={back} className="inline-flex items-center gap-1 text-xs text-grid-muted hover:text-grid-fg">
          <ChevronLeftIcon className={isRtl ? "size-3.5 rotate-180" : "size-3.5"} />
          {t("nav.teams")}
        </Link>
      </div>
      <SectionHeader
        micro={ws.summary.name}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <ColorDot color={team.color} className="size-3" />
            {team.name}
          </span>
        }
        description={team.description || t("teams.hint")}
      />

      <div className="grid gap-px border-y border-line bg-grid-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* members */}
        <div className="min-w-0 bg-grid-bg">
          <h2 className="flex items-baseline justify-between px-6 pt-5 pb-3">
            <span className="text-base font-medium">{t("teams.members")}</span>
            <span className="text-xs text-grid-muted">{t("teams.memberCount", { n: team.member_ids.length })}</span>
          </h2>
          {team.member_ids.length === 0 ? (
            <EmptyState title={t("teamDetail.noMembers")} />
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {team.member_ids.map((uid) => (
                <li key={uid}>
                  <Link href={`/${locale}/w/${ws.slug}/members/${uid}`} className="flex items-center gap-3 px-6 py-3 hover:bg-grid-soft">
                    <PersonAvatar id={uid} dir={dir} />
                    <Ltr className="min-w-0 flex-1 truncate text-grid-fg">{dir.name(uid)}</Ltr>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* projects the team is attached to */}
        <div className="min-w-0 bg-grid-bg">
          <h2 className="flex items-baseline justify-between px-6 pt-5 pb-3">
            <span className="text-base font-medium">{t("teamDetail.projects")}</span>
            <span className="text-xs text-grid-muted">{t("teams.projectCount", { n: team.project_count })}</span>
          </h2>
          {projects.error ? (
            <ErrorState error={projects.error} />
          ) : projects.isLoading ? (
            <LoadingRows rows={2} />
          ) : team.project_count === 0 ? (
            <EmptyState title={t("teamDetail.noProjects")} />
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {(projects.data?.projects ?? []).map((p) => (
                <TeamProjectRow key={p.id} project={p} teamId={team.id} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}

/** A project row shown only when this team is attached to it (project attachment lives on ProjectDetail). */
function TeamProjectRow({ project, teamId }: { project: Project; teamId: string }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const detail = useProject(ws.id, project.id)
  const attached = detail.data?.teams.some((tm) => tm.team_id === teamId)
  if (!attached) return null
  return (
    <li>
      <Link href={`/${locale}/w/${ws.slug}/projects/${project.id}`} className="flex items-center gap-3 px-6 py-3 hover:bg-grid-soft">
        <ColorDot color={project.color} className="size-3" />
        <span className="min-w-0 flex-1 truncate font-medium text-grid-fg">{project.name}</span>
        <Badge variant="outline">{t(`projectStatus.${project.status}`)}</Badge>
      </Link>
    </li>
  )
}
