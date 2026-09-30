"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { AccountCard } from "@/components/account/account-card"
import { Badge } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { LoadingRows } from "@/components/states"
import { GitHubConnectCard } from "@/components/kpi/github-connect-card"
import { KpiDashboard } from "@/components/kpi/kpi-dashboard"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

// Your profile: the account itself (every workspace), then in this workspace the GitHub connection
// (for KPI attribution) and your own KPI.
export default function MyProfilePage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const search = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  useDocumentTitle(`${t("kpi.profile")} · ${ws.summary.name}`)

  // The GitHub callback lands here with ?github=connected or ?github_error=…
  useEffect(() => {
    const ok = search.get("github")
    const err = search.get("github_error")
    if (!ok && !err) return
    if (ok === "connected") toast.success(t("kpi.connected"))
    if (err) toast.error(err)
    router.replace(pathname)
  }, [search, router, pathname, t])

  const canKpi = ws.can("kpi:read")
  return (
    <>
      <SectionHeader
        micro={ws.summary.name}
        title={t("kpi.profile")}
        description={
          me.data ? (
            <span className="flex flex-wrap items-center gap-2">
              <Ltr>{me.data.email}</Ltr>
              <Badge variant="outline">{t(`role.${ws.summary.role}`)}</Badge>
            </span>
          ) : null
        }
      />
      <AccountCard />
      {!me.data ? (
        <LoadingRows rows={3} />
      ) : canKpi ? (
        <div className="space-y-6 pt-6 pb-8">
          <GitHubConnectCard />
          <KpiDashboard userId={String(me.data.id)} isSelf />
        </div>
      ) : (
        <p className="px-6 py-6 text-sm text-grid-muted">{t("kpi.clientNoKpi")}</p>
      )}
    </>
  )
}
