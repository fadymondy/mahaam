"use client"

// Stands in front of something an unconfirmed address may not do yet (MH-342): today, creating a
// workspace. When the server doesn't require confirmation (EMAIL_VERIFICATION, which is off until
// mail really leaves the server) or the address is already confirmed, it renders its children and
// nothing else; otherwise it asks for the code that was mailed at sign-up, right where the person
// was about to act.
import { useState, type FormEvent, type ReactNode } from "react"
import useSWR from "swr"
import { toast } from "sonner"

import { Button, Field, FieldDescription, FieldError, FieldLabel, Input } from "@fadymondy/nasaq/web"



import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { errorText } from "@/lib/work"

type VerifyState = { email_verified: boolean; email_verification_required: boolean }
const KEY = "/api/me/verify-email"

export function VerifyEmailGate({ email, children }: { email: string; children: ReactNode }) {
  const { t, locale } = useTranslations()
  const state = useSWR<VerifyState>(KEY, (p: string) => api<VerifyState>(p))
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // While loading, or if the check itself fails, show the children: the API enforces the gate
  // anyway, and a flicker of a code form nobody needs is worse than one refused request.
  if (!state.data || state.data.email_verified || !state.data.email_verification_required) return <>{children}</>

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await state.mutate(await api<VerifyState>(KEY, { json: { code: code.trim() } }), false)
      toast.success(t("verify.done"))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? t("auth.resetBadCode") : errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    try {
      await api(`${KEY}/resend`, { json: { locale } })
      toast.success(t("verify.resent"))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t("auth.resetTooMany") : errorText(err, t("common.networkError")))
    }
  }

  return (
    <form onSubmit={submit} noValidate data-verify-email>
      <div className="flex flex-col gap-4">
        <p className="text-sm" role="status">
          {t("verify.sent", { email })}
        </p>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="verify-code">{t("auth.resetCode")}</FieldLabel>
          <Input
            id="verify-code"
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="font-mono tracking-[0.4em]"
            placeholder="000000"
          />
          <FieldDescription>{t("verify.why")}</FieldDescription>
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" type="submit" disabled={busy || code.length !== 6}>
            {busy ? t("common.working") : t("verify.submit")}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void resend()}>
            {t("auth.resetResend")}
          </Button>
        </div>
      </div>
    </form>
  )
}
