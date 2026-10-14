"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { HomeDashboard } from "@/components/home/dashboard"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function OverviewPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("nav.home")} · ${ws.summary.name}`)
  const base = `/${locale}/w/${ws.slug}`
  const router = useRouter()
  // A customer's home is their portal, not the staff dashboard.
  const isCustomer = ws.summary.role === "client"
  useEffect(() => {
    if (isCustomer) router.replace(`${base}/portal`)
  }, [isCustomer, base, router])
  if (isCustomer) return null
  return <HomeDashboard />
}
