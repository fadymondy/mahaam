"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { PlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SectionHeader } from "@/components/public-frame"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ColorDot } from "@/components/work/palette"
import { ProjectForm } from "@/components/work/project-form"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { useProjects } from "@/lib/work"

export default function ProjectsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useDocumentTitle(`${t("nav.projects")} · ${ws.summary.name}`)
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const projects = useProjects(ws.id, archived)
  const canCreate = ws.can("projects:create")
  const base = `/${locale}/w/${ws.slug}/projects`
  const list = projects.data?.projects ?? []

  return (
    <>
      <SectionHeader
        micro={ws.summary.name}
        title={t("nav.projects")}
        description={t("projects.hint")}
        action={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              {t("project.new")}
            </Button>
          ) : null
        }
      />

      <div className="border-t border-line px-6 py-3">
        <Tabs value={archived ? "archived" : "active"} onValueChange={(v) => setArchived(v === "archived")}>
          <TabsList>
            <TabsTrigger value="active">{t("projects.active")}</TabsTrigger>
            <TabsTrigger value="archived">{t("projects.archived")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {projects.error ? (
        <ErrorState error={projects.error} />
      ) : projects.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState
          title={archived ? t("projects.noArchived") : t("projects.empty")}
          body={archived ? undefined : canCreate ? t("projects.emptyBody") : t("projects.emptyMember")}
          action={
            !archived && canCreate ? (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon />
                {t("project.new")}
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="border-y border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("project.name")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("project.client")}</TableHead>
                <TableHead>{t("project.status")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("projects.progress")}</TableHead>
                <TableHead className="pe-6 text-end">{t("projects.tasks")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((p) => {
                const total = p.tasks.todo + p.tasks.doing + p.tasks.done
                const pct = total ? Math.round((p.tasks.done / total) * 100) : 0
                return (
                  <TableRow key={p.id} data-project={p.id} className="cursor-pointer" onClick={() => router.push(`${base}/${p.id}/board`)}>
                    <TableCell className="ps-6">
                      <Link href={`${base}/${p.id}/board`} className="flex items-center gap-2.5 font-medium text-grid-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                        <ColorDot color={p.color} />
                        <span className="truncate">{p.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-grid-muted sm:table-cell">{p.client_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`projectStatus.${p.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="hidden w-48 md:table-cell">
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="w-28" aria-label={t("projects.progress")} />
                        <span className="text-xs text-grid-muted">
                          <Ltr>{pct}%</Ltr>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="pe-6 text-end text-grid-muted">
                      <Ltr>
                        {p.tasks.done}/{total}
                      </Ltr>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("project.new")}</DialogTitle>
            <DialogDescription>{t("project.newHint")}</DialogDescription>
          </DialogHeader>
          <ProjectForm
            onCancel={() => setCreating(false)}
            onSaved={(p) => {
              setCreating(false)
              void projects.mutate()
              router.push(`${base}/${p.id}/board`)
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
