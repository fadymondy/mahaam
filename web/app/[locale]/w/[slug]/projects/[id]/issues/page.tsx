"use client"

// The project's issues: the same tracker as /w/{slug}/issues (SDK, portal, MCP and in-app reports
// all land in it), narrowed to this project. A project-scoped MCP token sees exactly these.
import { IssuesView } from "@/components/work/issues/issues-screen"
import { useProjectCtx } from "@/components/work/project-context"

export default function ProjectIssuesPage() {
  const { project } = useProjectCtx()
  return <IssuesView fixedProject={{ id: project.id, name: project.name }} />
}
