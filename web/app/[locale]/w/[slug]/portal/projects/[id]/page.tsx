"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"

/** Customers use the app's own project page and tabs (MH-1176); old portal links land there. */
export default function PortalProjectRedirect() {
  const { locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  useEffect(() => {
    router.replace(`/${locale}/w/${ws.slug}/projects/${id}`)
  }, [locale, ws.slug, id, router])
  return null
}
