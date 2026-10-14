"use client"

// The project's issues are its board.
import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { BoardSkeleton } from "@/components/work/project/project-skeletons"
import { useProjectCtx } from "@/components/work/project-context"

export default function ProjectIssuesPage() {
  const { base } = useProjectCtx()
  const params = useParams<{ taskKey?: string }>()
  const router = useRouter()
  useEffect(() => {
    router.replace(`${base}/board`)
  }, [router, base, params.taskKey])
  return <BoardSkeleton />
}
