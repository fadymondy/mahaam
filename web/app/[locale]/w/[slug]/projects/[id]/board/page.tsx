"use client"

import { IssuesView } from "@/components/work/issues/fm/issues-view"
import { useProjectCtx } from "@/components/work/project-context"

export default function ProjectBoardPage() {
  const { project } = useProjectCtx()
  return <IssuesView projectId={project.id} title={project.name} />
}
