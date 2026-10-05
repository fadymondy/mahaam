"use client"

// App sign-in: where the Mahaam desktop and mobile apps send the SYSTEM browser to sign in with
// Google, GitHub or Apple (RFC 8252 — never an embedded web view). By the time this renders the
// person is signed in on the web (proxy.ts sent them through login and back). They confirm which
// app and which account; the API mints a one-time code bound to the app's PKCE challenge
// (internal/account/appsignin.go) and the browser is sent back to the app's redirect — a loopback
// port on the desktop, mahaam://auth/callback on a phone — where the app trades it for its token.
import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { LaptopIcon, LogOutIcon, SmartphoneIcon } from "lucide-react"

import { Button, Skeleton } from "@fadymondy/nasaq/web"


import { PublicFrame, PublicPanel } from "@/components/public-frame"
import { ErrorState } from "@/components/states"
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useRequireAuth } from "@/lib/use-require-auth"

/** Only the shapes our apps use; the API checks the same rule (validAppRedirect). */
function appRedirect(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.hash || u.search || u.username || u.password) return false
    if (u.protocol === "http:") return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && !!u.port && u.pathname === "/callback"
    return u.protocol === "mahaam:" && raw.startsWith("mahaam://auth/callback")
  } catch {
    return false
  }
}

export default function AppSigninPage() {
  const { t, locale } = useTranslations()
  const me = useRequireAuth()
  const params = useSearchParams()
  const redirectURI = params.get("redirect_uri") ?? ""
  const challenge = params.get("code_challenge") ?? ""
  const method = params.get("code_challenge_method") ?? ""
  const state = params.get("state") ?? ""
  const device = (params.get("device") ?? "").slice(0, 200)
  const [busy, setBusy] = useState<"continue" | "switch" | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = appRedirect(redirectURI) && challenge.length >= 43 && method === "S256" && state.length >= 16
  const phone = redirectURI.startsWith("mahaam:")

  async function proceed() {
    setBusy("continue")
    setError(null)
    try {
      const res = await api<{ redirect_to: string }>("/api/me/app-signin", {
        method: "POST",
        json: { redirect_uri: redirectURI, code_challenge: challenge, code_challenge_method: "S256", state, device },
      })
      setDone(true)
      // A top-level navigation: the app's listener (or the OS, for mahaam://) takes it from here.
      window.location.href = res.redirect_to
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
      setBusy(null)
    }
  }

  // "Not you?": sign out here and come straight back to this page through the login screen.
  async function switchAccount() {
    setBusy("switch")
    try {
      await api("/api/auth/logout", { method: "POST" })
    } catch {}
    window.location.href = `/${locale}/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
  }

  if (!me.data) {
    return (
      <PublicFrame title={t("appSignin.title")}>
        <PublicPanel>{me.error ? <ErrorState error={me.error} /> : <Skeleton className="h-24 w-full" />}</PublicPanel>
      </PublicFrame>
    )
  }

  if (!valid) {
    return (
      <PublicFrame title={t("appSignin.title")}>
        <PublicPanel>
          <p className="p-6 text-sm text-muted-foreground">{t("appSignin.badRequest")}</p>
        </PublicPanel>
      </PublicFrame>
    )
  }

  return (
    <PublicFrame title={t("appSignin.title")} description={t("appSignin.hint")}>
      <PublicPanel>
        <div className="flex flex-col gap-5 p-6" data-app-signin>
          {done ? (
            <p className="text-sm text-nq-fg-body" role="status" data-app-signin-done>
              {t("appSignin.done")}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                  {phone ? <SmartphoneIcon className="size-5 text-nq-accent-text" /> : <LaptopIcon className="size-5 text-nq-accent-text" />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground" dir="auto">
                    {device || t("appSignin.anApp")}
                  </p>
                  <p className="text-sm text-muted-foreground">{t("appSignin.wantsToSignIn")}</p>
                </div>
              </div>
              <p className="text-sm text-nq-fg-body">
                {t("appSignin.as")}{" "}
                <span className="font-medium text-foreground" dir="ltr">
                  {me.data.email}
                </span>
              </p>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={busy !== null} onClick={() => void proceed()} data-app-signin-continue>
                  {busy === "continue" ? t("common.working") : t("appSignin.continue")}
                </Button>
                <Button variant="secondary" disabled={busy !== null} onClick={() => void switchAccount()}>
                  <LogOutIcon />
                  {t("appSignin.switch")}
                </Button>
              </div>
              <p className="text-caption text-muted-foreground">{t("appSignin.notYou")}</p>
            </>
          )}
        </div>
      </PublicPanel>
    </PublicFrame>
  )
}
