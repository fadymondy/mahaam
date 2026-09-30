"use client"

// "Connect GitHub" for the signed-in member (internal/work/github_accounts.go): shows the current
// connection, starts the GitHub App user authorization, or disconnects. The callback sends the
// browser back to /{locale}/w/{slug}/me?github=connected (or ?github_error=…).
import { useState } from "react"
import { GitBranchIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge, Button } from "@fadymondy/nasaq/web"


import { Ltr } from "@/components/copy-field"
import { ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { kpiApi, useGitHubStatus } from "@/lib/kpi"
import { errorText } from "@/lib/work"

export function GitHubConnectCard() {
  const { t, locale, formatDate } = useTranslations()
  const ws = useWorkspace()
  const status = useGitHubStatus(ws.id, "me")
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    setBusy(true)
    try {
      const { url } = await kpiApi.connect(ws.id, locale)
      window.location.assign(url)
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      setBusy(false)
    }
  }
  const disconnect = async () => {
    setBusy(true)
    try {
      await kpiApi.disconnectMine(ws.id)
      void status.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  const acc = status.data?.account
  return (
    <section className="border-y border-line px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <GitBranchIcon className="size-4" aria-hidden /> {t("kpi.connectTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-grid-muted">{t("kpi.connectHint")}</p>
        </div>
        {status.data ? (
          acc ? (
            <Button variant="secondary" disabled={busy} onClick={() => void disconnect()}>
              {t("kpi.disconnect")}
            </Button>
          ) : status.data.oauth_available ? (
            <Button variant="primary" disabled={busy} onClick={() => void connect()}>
              <GitBranchIcon /> {t("kpi.connect")}
            </Button>
          ) : null
        ) : null}
      </div>
      <div className="mt-4">
        {status.error ? (
          <ErrorState error={status.error} />
        ) : !status.data ? (
          <LoadingRows rows={1} />
        ) : acc ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="grid-micro mb-1">{t("kpi.login")}</dt>
              <dd className="flex items-center gap-2">
                <Ltr>@{acc.login}</Ltr>
                <Badge variant="outline">{t(`kpi.via.${acc.connected_via}`)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="grid-micro mb-1">{t("kpi.emails")}</dt>
              <dd className="space-y-0.5">
                {(acc.emails ?? []).length === 0 ? "—" : (acc.emails ?? []).map((e) => <Ltr key={e} className="block truncate">{e}</Ltr>)}
              </dd>
            </div>
            <div>
              <dt className="grid-micro mb-1">{t("kpi.connectedAt")}</dt>
              <dd>{formatDate(acc.connected_at)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-grid-muted">{status.data.oauth_available ? t("kpi.notConnectedBody") : t("kpi.oauthOff")}</p>
        )}
      </div>
    </section>
  )
}
