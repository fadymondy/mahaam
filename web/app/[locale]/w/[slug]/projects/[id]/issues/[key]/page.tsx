"use client"

import { useParams } from "next/navigation"

import { IssueDetailView } from "@/components/work/issues/fm/issue-detail-view"
import { useProjectCtx } from "@/components/work/project-context"

export default function ProjectIssuePage() {
  const { key } = useParams<{ key: string }>()
  const { project, base } = useProjectCtx()
  return <IssueDetailView issueKey={decodeURIComponent(key)} projectId={project.id} back={`${base}/issues`} />
}
