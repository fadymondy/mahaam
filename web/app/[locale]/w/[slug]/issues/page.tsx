"use client"

// Issues live inside their projects now (each project's board); the old workspace-wide page
// sends you to the projects.
import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"

export default function IssuesRedirectPage() {
  const { locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${locale}/w/${ws.slug}/projects`)
  }, [router, locale, ws.slug])
  return <LoadingRows rows={3} />
}
