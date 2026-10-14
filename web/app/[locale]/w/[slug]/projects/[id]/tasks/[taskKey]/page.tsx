"use client"

// A card's page is its issue page (same key, same item).
import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { BoardSkeleton } from "@/components/work/project/project-skeletons"
import { useProjectCtx } from "@/components/work/project-context"

export default function TaskPage() {
  const { base } = useProjectCtx()
  const params = useParams<{ taskKey?: string }>()
  const router = useRouter()
  useEffect(() => {
    router.replace(`${base}/issues/${encodeURIComponent(params.taskKey ?? "")}`)
  }, [router, base, params.taskKey])
  return <BoardSkeleton />
}
