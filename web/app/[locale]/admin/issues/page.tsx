"use client"

// Platform issues live on the `platform` workspace's board (platform admins are implicitly its
// admins). The board is built on the workspace shell's context (members, projects, live stream),
// so rather than re-host it here we send the admin to the real board.
import Link from "next/link"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@fadymondy/nasaq/web"

import { SectionHeader } from "@/components/public-frame"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

const PLATFORM_SLUG = "platform"

export default function AdminIssuesPage() {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const href = `/${locale}/w/${PLATFORM_SLUG}/projects`
  useDocumentTitle(`${t("admin.nav.issues")} · ${t("admin.title")}`)
  useEffect(() => {
    router.replace(href)
  }, [router, href])
  return (
    <SectionHeader
      micro={t("admin.title")}
      title={t("admin.nav.issues")}
      description={t("admin.issues.redirecting")}
      action={
        <Button variant="primary" nativeButton={false} render={<Link href={href} />}>
          {t("admin.issues.open")}
        </Button>
      }
    />
  )
}
