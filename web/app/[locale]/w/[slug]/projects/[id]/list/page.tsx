"use client"

// One board per project (issues and cards are the same items): the old list view goes to it.
import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { BoardSkeleton } from "@/components/work/project/project-skeletons"
import { useProjectCtx } from "@/components/work/project-context"

export default function ProjectListPage() {
  const { base } = useProjectCtx()
  const params = useParams<{ taskKey?: string }>()
  const router = useRouter()
  useEffect(() => {
    router.replace(`${base}/board`)
  }, [router, base, params.taskKey])
  return <BoardSkeleton />
}
