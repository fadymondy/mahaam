"use client"

// A card's page is its issue page (same key, same item).
import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { LoadingRows } from "@/components/states"
import { useProjectCtx } from "@/components/work/project-context"

export default function TaskPage() {
  const { base } = useProjectCtx()
  const params = useParams<{ taskKey?: string }>()
  const router = useRouter()
  useEffect(() => {
    router.replace(`${base}/issues/${encodeURIComponent(params.taskKey ?? "")}`)
  }, [router, base, params.taskKey])
  return <LoadingRows rows={3} />
}
