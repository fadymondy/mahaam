"use client"

import Link from "next/link"
import { useRef, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import useSWR, { useSWRConfig } from "swr"

import {
  Alert,
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  SignInFlow,
  OAuthButtons,
  OAuthDivider,
  PasswordInput,
  ProductMark,
  type OAuthProvider as NqProvider,
} from "@fadymondy/nasaq/web"

import { PublicFrame } from "@/components/public-frame"
import { api, ApiError, resetCsrf } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { safeNext } from "@/lib/use-require-auth"
import { useDocumentTitle } from "@/lib/title"

type OAuthProvider = { id: string; label: string; href: string }

const KNOWN: Record<string, string> = { google: "Google", github: "GitHub" }

/*
  GET /api/auth/methods lists what the togo auth plugin has enabled. Its exact shape is read
  defensively — strings ("password", "oauth:google") or objects ({ type, provider, url }). Only a
  listed oauth provider renders a button; with none listed, nothing renders (no dead controls).
*/
function oauthProviders(data: unknown): OAuthProvider[] {
  const list: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? (((data as Record<string, unknown>).methods ??
          (data as Record<string, unknown>).oauth ??
          (data as Record<string, unknown>).providers ??
          []) as unknown[])
      : []
  if (!Array.isArray(list)) return []

  const out: OAuthProvider[] = []
  for (const item of list) {
    let id = ""
    let href = ""
    if (typeof item === "string") {
      const m = /^(?:oauth[:/])?(google|github)$/i.exec(item)
      if (m) id = m[1].toLowerCase()
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>
      const name = String(o.provider ?? o.name ?? o.id ?? "").toLowerCase()
      const type = String(o.type ?? o.kind ?? "oauth").toLowerCase()
      if (type.includes("oauth") && KNOWN[name]) id = name
      href = typeof o.url === "string" ? o.url : typeof o.start_url === "string" ? o.start_url : ""
    }
    if (id && KNOWN[id] && !out.some((p) => p.id === id)) {
      out.push({ id, label: KNOWN[id], href: href || `/api/auth/oauth/${id}` })
    }
  }
  return out
}

const HUB_ERRORS = ["failed", "email_unverified", "account_conflict", "suspended", "no_email", "not_member", "unavailable"]

function hubErrorMessage(t: (key: string) => string, code: string): string {
  return t(`auth.circlexoError.${HUB_ERRORS.includes(code) ? code : "failed"}`)
}

type Failure = { error?: string } | void

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t, locale, formatDate } = useTranslations()
  const router = useRouter()
  const params = useSearchParams()
  const { mutate } = useSWRConfig()
  const next = safeNext(params.get("next"), `/${locale}`)

  useDocumentTitle(mode === "login" ? t("auth.signIn") : t("auth.createAccount"))

  // A refused CircleXO sign-in comes back as /login?circlexo_error=<code>.
  const hubError = params.get("circlexo_error")
  const [notice, setNotice] = useState<string | null>(hubError ? hubErrorMessage(t, hubError) : null)

  const methods = useSWR("/api/auth/methods", (p: string) => api<unknown>(p), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const providers = oauthProviders(methods.data)
  // Sign in with CircleXO: shown only when the API reports the integration on.
  const hubConfig = useSWR("/api/circlexo/config", (p: string) => api<{ enabled?: boolean; login_url?: string }>(p), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const hubLogin = hubConfig.data?.enabled ? hubConfig.data.login_url || "/auth/circlexo/login" : ""

  // Nasaq's provider buttons: Google / GitHub with their own logos, then CircleXO with its Nasaq brand mark.
  const buttons: NqProvider[] = [
    ...providers.map((p) => p.id as "google" | "github"),
    ...(hubLogin
      ? [
          {
            id: "circlexo",
            label: mode === "login" ? t("auth.signInCircleXO") : t("auth.continueWith", { provider: "CircleXO" }),
            icon: <ProductMark brand="circlexo" size={18} title="" />,
          },
        ]
      : []),
  ]

  function goOAuth(id: string) {
    // CircleXO is a chain of redirects through the API: a full page load.
    if (id === "circlexo" && hubLogin) {
      window.location.assign(`${hubLogin}?return_to=${encodeURIComponent(next)}`)
      return
    }
    const p = providers.find((x) => x.id === id)
    if (!p) return
    window.location.assign(`${p.href}${p.href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`)
  }

  async function finish() {
    // A new session carries a new CSRF token.
    resetCsrf()
    await mutate("/api/auth/me")
    router.replace(next)
  }

  // The email-first flow (as on the CircleXO hub): email, then password, then the second factor.
  // There is no lookup on the email step, so every address goes on to the password step and the page
  // never says whether an account exists. The challenge id lives in a ref so the flow's 2FA step
  // reads the latest one.
  const pending = useRef<string | null>(null)

  async function password(values: { email: string; password: string }): Promise<{ error?: string } | { twoFactor: true } | void> {
    setNotice(null)
    try {
      resetCsrf()
      await api("/api/auth/login", { json: { email: values.email.trim(), password: values.password } })
      await finish()
    } catch (err) {
      if (err instanceof ApiError) {
        const mfa = (err.data as { challenge?: string } | undefined)?.challenge
        if (err.code === "mfa_required" && mfa) {
          pending.current = mfa
          return { twoFactor: true }
        }
        return { error: err.status === 401 ? t("auth.invalidCredentials") : err.message }
      }
      return { error: t("common.networkError") }
    }
  }

  async function flowSecondFactor(values: { code: string; method: string }): Promise<Failure> {
    const id = pending.current
    if (!id) return { error: t("auth.mfaExpired") }
    const code = values.code.trim()
    try {
      await api("/api/auth/2fa/challenge", { json: values.method === "recovery" ? { challenge: id, recovery_code: code } : { challenge: id, code } })
      await finish()
    } catch (err) {
      // The challenge expired (five minutes) or the password changed: say so; "Change" starts over.
      if (err instanceof ApiError && err.status === 401) return { error: t("auth.mfaExpired") }
      if (err instanceof ApiError && err.status === 429) return { error: t("auth.mfaLocked") }
      if (err instanceof ApiError && err.status === 400) return { error: t("auth.mfaWrong") }
      return { error: err instanceof ApiError ? err.message : t("common.networkError") }
    }
  }

  const other = mode === "login" ? "register" : "login"
  const otherHref = `/${locale}/${other}${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`

  return (
    <PublicFrame
      split
      title={mode === "login" ? t("auth.signIn") : t("auth.createAccount")}
      description={mode === "login" ? t("auth.signInHint") : t("auth.registerHint")}
      prompt={
        <>
          {mode === "login" ? t("auth.noAccount") : t("auth.haveAccount")} <Link href={otherHref}>{mode === "login" ? t("auth.createAccount") : t("auth.signIn")}</Link>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-auth-form>
        {notice ? (
          <Alert tone="danger" data-auth-error>
            {notice}
          </Alert>
        ) : null}
        {mode === "login" && params.get("deleted") ? (
          // Arrived from deleting the account: say when, and that signing in is the undo.
          <Alert tone="info" data-deleted-notice>
            {t("auth.deletedNotice", { date: formatDate(params.get("deleted")) })}
          </Alert>
        ) : null}

        {mode === "login" ? (
          <SignInFlow
            showRemember={false}
            forgotPassword={
              <Link
                href={`/${locale}/forgot-password`}
                className="text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("auth.forgotPassword")}
              </Link>
            }
            oauthProviders={buttons}
            onOAuth={goOAuth}
            onPassword={password}
            onTwoFactor={flowSecondFactor}
            onRegister={() => router.push(otherHref)}
            onStepChange={() => setNotice(null)}
          />
        ) : (
          <RegisterFields providers={buttons} onDone={finish} onOAuth={goOAuth} />
        )}

        {mode === "register" ? (
          // Links rather than a checkbox: submitting the form is the agreement, and a box that
          // must be ticked before the button works adds a step without adding consent.
          <p className="text-center text-caption text-muted-foreground" data-consent>
            {t("auth.consent")
              .split(/(\{terms\}|\{privacy\})/)
              .map((part, i) =>
                part === "{terms}" || part === "{privacy}" ? (
                  <Link
                    key={i}
                    href={`/${locale}/legal/${part === "{terms}" ? "terms" : "privacy"}`}
                    className="text-foreground underline underline-offset-4"
                  >
                    {t(part === "{terms}" ? "auth.consentTerms" : "auth.consentPrivacy")}
                  </Link>
                ) : (
                  <span key={i}>{part}</span>
                ),
              )}
          </p>
        ) : null}
      </div>
    </PublicFrame>
  )
}

/*
  Register keeps its own two fields (email + password): Nasaq RegisterForm also collects a name and
  a confirmation, which POST /api/auth/register does not take.
*/
function RegisterFields({
  providers,
  onDone,
  onOAuth,
}: {
  providers: NqProvider[]
  onDone: () => Promise<void>
  onOAuth: (id: string) => void
}) {
  const { t } = useTranslations()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"))
      return
    }
    setBusy(true)
    try {
      resetCsrf()
      await api("/api/auth/register", { json: { email: email.trim(), password } })
      await onDone()
    } catch (err) {
      if (err instanceof ApiError) {
        setError(/registration failed/i.test(err.message) ? t("auth.registrationFailed") : err.message)
      } else {
        setError(t("common.networkError"))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field>
        <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
        <Input
          id="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          required
          minLength={8}
          showStrength
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FieldDescription>{t("auth.passwordHint")}</FieldDescription>
      </Field>
      <Button variant="primary" type="submit" size="lg" disabled={busy || !email || !password}>
        {busy ? t("common.working") : t("auth.createAccount")}
      </Button>
      {providers.length ? (
        <>
          <OAuthDivider />
          <OAuthButtons providers={providers} intent="signup" onSelect={onOAuth} />
        </>
      ) : null}
    </form>
  )
}
