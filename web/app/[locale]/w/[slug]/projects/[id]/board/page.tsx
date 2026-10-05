"use client"

import { IssuesView } from "@/components/work/issues/fm/issues-view"
import { useProjectCtx } from "@/components/work/project-context"

// The Issues tab: the board inside a rounded card, on the same padding as the other project tabs.
export default function ProjectBoardPage() {
  const { project } = useProjectCtx()
  return (
    <div className="p-4 sm:p-6" data-project-issues>
      <div className="flex flex-col overflow-hidden rounded-card border border-border bg-card">
        <IssuesView projectId={project.id} title={project.name} />
      </div>
    </div>
  )
}
