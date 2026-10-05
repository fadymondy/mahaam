"use client"

import Link from "next/link"
import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"

import { Alert, Button, Field, FieldDescription, FieldLabel, Input, PasswordInput } from "@fadymondy/nasaq/web"

import { PublicFrame } from "@/components/public-frame"
import { api, ApiError, resetCsrf } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

/*
  Forgot password: email → a six-digit code by mail → a new password (POST /api/auth/password/*).

  Two steps on one page rather than a link in the email, so the same flow works in the phone app,
  where a link would open a browser instead of the app.

  "Check your email" is shown whatever the address was: the API answers 202 either way, and this
  page must not undo that by saying "no such account". After the reset every old session is signed
  out, so the page signs in with the new password itself. The person has just proved they own the
  inbox, and sending them back to the login form to type it again gains nothing.
*/
export function ResetPasswordForm() {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const { mutate } = useSWRConfig()
  useDocumentTitle(t("auth.resetTitle"))

  const [step, setStep] = useState<"email" | "code">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function requestCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api("/api/auth/password/forgot", { json: { email: email.trim(), locale } })
      setStep("code")
      setNotice(t("auth.resetSent", { email: email.trim() }))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t("auth.resetTooMany") : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"))
      return
    }
    setBusy(true)
    try {
      await api("/api/auth/password/reset", {
        json: { email: email.trim(), code: code.trim(), new_password: password, locale },
      })
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError) {
        if (err.status === 400) setError(t("auth.resetBadCode"))
        else if (err.status === 429) setError(t("auth.resetTooMany"))
        else setError(err.message)
      } else {
        setError(t("common.networkError"))
      }
      return
    }
    try {
      resetCsrf()
      await api("/api/auth/login", { json: { email: email.trim(), password } })
      resetCsrf()
      await mutate("/api/auth/me")
      router.replace(`/${locale}`)
    } catch {
      // The password did change. Only the automatic sign-in failed, so send them to sign in.
      router.replace(`/${locale}/login`)
    }
  }

  return (
    <PublicFrame eyebrow={t("auth.resetEyebrow")} title={t("auth.resetTitle")} description={t("auth.resetHint")}>
      <div data-reset-form>
          {step === "email" ? (
            <form onSubmit={requestCode} noValidate>
              <div className="flex flex-col gap-4">
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
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <Button variant="primary" type="submit" size="lg" disabled={busy || !email.includes("@")}>
                  {busy ? t("common.working") : t("auth.resetSend")}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={reset} noValidate>
              <div className="flex flex-col gap-4">
                {notice ? <Alert tone="info">{notice}</Alert> : null}
                <Field>
                  <FieldLabel htmlFor="code">{t("auth.resetCode")}</FieldLabel>
                  <Input
                    id="code"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">{t("auth.newPassword")}</FieldLabel>
                  <PasswordInput
                    id="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <FieldDescription>{t("auth.resetSignsOut")}</FieldDescription>
                </Field>
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <Button variant="primary" type="submit" size="lg" disabled={busy || code.length !== 6 || !password}>
                  {busy ? t("common.working") : t("auth.resetSubmit")}
                </Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => void requestCode()}>
                  {t("auth.resetResend")}
                </Button>
              </div>
            </form>
          )}
          <p className="mt-6 text-center text-body-sm text-muted-foreground">
            <Link href={`/${locale}/login`} className="font-medium text-foreground underline underline-offset-4">
              {t("auth.backToSignIn")}
            </Link>
          </p>
      </div>
    </PublicFrame>
  )
}
