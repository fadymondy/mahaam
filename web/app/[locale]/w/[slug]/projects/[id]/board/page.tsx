"use client"

import { IssuesView } from "@/components/work/issues/fm/issues-view"
import { useProjectCtx } from "@/components/work/project-context"

// The Issues tab: the board straight on the page, no section border, on the same padding as the other project tabs.
export default function ProjectBoardPage() {
  const { project } = useProjectCtx()
  return (
    <div className="flex flex-col p-4 sm:p-6" data-project-issues>
      <IssuesView projectId={project.id} title={project.name} />
    </div>
  )
}
