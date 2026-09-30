"use client"

// The MCP OAuth consent screen: a remote connector (Claude.ai, ChatGPT, ...) sent the browser
// here (via the Go /api/oauth/authorize redirect, internal/mcp/oauth.go) after validating its
// client_id and redirect_uri. This page's only job is: show who's asking and for what, let the
// signed-in user pick a workspace, and on Allow/Deny, ask the API to mint the code (or the error)
// and hand back the exact redirect_uri to send the browser to next — a full top-level navigation,
// not a fetch, since the third-party client's own server needs to see the query params land.
import { useState } from "react"
import { useSearchParams } from "next/navigation"
import useSWR from "swr"
import { BotIcon, ShieldCheckIcon } from "lucide-react"

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton } from "@fadymondy/nasaq/web"



import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { ErrorState } from "@/components/states"
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useRequireAuth } from "@/lib/use-require-auth"

type ConsentInfo = {
  client_name: string
  scopes: { scope: string; description: string }[]
  workspaces: { id: string; slug: string; name: string; role: string }[]
}

export default function OAuthAuthorizePage() {
  const { t } = useTranslations()
  const me = useRequireAuth()
  const params = useSearchParams()
  const clientID = params.get("client_id") ?? ""
  const redirectURI = params.get("redirect_uri") ?? ""
  const scope = params.get("scope") ?? ""
  const state = params.get("state") ?? ""
  const codeChallenge = params.get("code_challenge") ?? ""
  const codeChallengeMethod = params.get("code_challenge_method") ?? ""

  const info = useSWR(
    me.data && clientID ? `/api/oauth/consent?client_id=${encodeURIComponent(clientID)}&scope=${encodeURIComponent(scope)}` : null,
    (path: string) => api<ConsentInfo>(path),
  )
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workspaces = info.data?.workspaces ?? []
  const selected = workspaceId ?? workspaces[0]?.id ?? ""

  const missingParams = !clientID || !redirectURI || !codeChallenge || codeChallengeMethod !== "S256"

  const decide = async (allow: boolean) => {
    setBusy(allow ? "allow" : "deny")
    setError(null)
    try {
      const res = await api<{ redirect_to: string }>("/api/oauth/consent", {
        method: "POST",
        json: {
          client_id: clientID,
          redirect_uri: redirectURI,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          state,
          scope,
          workspace_id: selected,
          allow,
        },
      })
      window.location.href = res.redirect_to
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
      setBusy(null)
    }
  }

  if (!me.data) {
    return (
      <PublicFrame title={t("oauth.title")}>
        <PublicPanel>{me.error ? <ErrorState error={me.error} /> : <Skeleton className="h-24 w-full" />}</PublicPanel>
      </PublicFrame>
    )
  }

  if (missingParams) {
    return (
      <PublicFrame title={t("oauth.title")}>
        <PublicPanel>
          <p className="p-6 text-sm text-grid-muted">{t("oauth.badRequest")}</p>
        </PublicPanel>
      </PublicFrame>
    )
  }

  return (
    <PublicFrame title={t("oauth.title")} description={t("oauth.hint")}>
      <PublicPanel>
        <div className="flex flex-col gap-5 p-6">
          {info.error ? (
            <ErrorState error={info.error} />
          ) : !info.data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center border border-line bg-grid-soft">
                  <BotIcon className="size-5 text-grid-action" />
                </span>
                <p className="text-sm text-grid-body">
                  <span className="font-medium text-grid-fg" dir="auto">
                    {info.data.client_name}
                  </span>{" "}
                  {t("oauth.wantsToConnect")}
                </p>
              </div>

              {workspaces.length > 1 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="grid-micro">{t("oauth.workspace")}</span>
                  <Select items={workspaces.map((w) => ({ value: w.id, label: w.name }))} value={selected} onValueChange={(v) => setWorkspaceId(String(v ?? selected))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaces.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : workspaces.length === 1 ? (
                <p className="text-sm text-grid-muted">
                  {t("oauth.workspace")}: <span className="text-grid-fg">{workspaces[0].name}</span>
                </p>
              ) : (
                <p className="text-sm text-grid-muted">{t("oauth.noWorkspaces")}</p>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="grid-micro">{t("oauth.willBeAbleTo")}</span>
                <ul className="flex flex-col gap-1.5">
                  {info.data.scopes.map((s) => (
                    <li key={s.scope} className="flex items-start gap-2 text-sm text-grid-body">
                      <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-grid-muted" />
                      <span>{s.description}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={!selected || busy !== null} onClick={() => void decide(true)}>
                  {busy === "allow" ? t("common.working") : t("oauth.allow")}
                </Button>
                <Button variant="secondary" disabled={busy !== null} onClick={() => void decide(false)}>
                  {t("oauth.deny")}
                </Button>
              </div>
            </>
          )}
        </div>
      </PublicPanel>
    </PublicFrame>
  )
}
