"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"

/** Customers use the app's own Projects list (MH-1176); old portal links land there. */
export default function PortalProjectsRedirect() {
  const { locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useEffect(() => {
    router.replace(`/${locale}/w/${ws.slug}/projects`)
  }, [locale, ws.slug, router])
  return null
}
