"use client"

// Two-factor sign-in on the Account card (MH-341): set up with an authenticator app (QR, the secret
// for typing by hand, and an otpauth:// link for an authenticator on the same device), confirm
// with a first code, keep the recovery codes, replace them, or turn it off.
import { useEffect, useState, type FormEvent } from "react"
import useSWR from "swr"
import QRCode from "qrcode"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Field, FieldDescription, FieldError, FieldLabel, Input } from "@fadymondy/nasaq/web"



import { Ltr } from "@/components/copy-field"
import { api, ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { errorText } from "@/lib/work"

type State = { enabled: boolean; pending: boolean; recovery_codes_left: number }
const KEY = "/api/me/2fa"

export function useTwoFactor() {
  return useSWR<State>(KEY, (p: string) => api<State>(p))
}

function CodeInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      id={id}
      dir="ltr"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="font-mono tracking-[0.4em]"
      placeholder="000000"
    />
  )
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslations()
  const text = codes.join("\n")
  return (
    <div className="space-y-3" data-recovery-codes>
      <p className="text-sm">{t("twofa.recoveryHint")}</p>
      <ul className="grid grid-cols-2 gap-1 rounded-md border border-border p-3 font-mono text-sm" dir="ltr">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(text)
            toast.success(t("twofa.copied"))
          }}
        >
          {t("twofa.copy")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            const a = document.createElement("a")
            a.href = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }))
            a.download = "mahaam-recovery-codes.txt"
            a.click()
            URL.revokeObjectURL(a.href)
          }}
        >
          {t("twofa.download")}
        </Button>
        <Button variant="primary" type="button" size="sm" onClick={onDone}>
          {t("twofa.saved")}
        </Button>
      </div>
    </div>
  )
}

export function TwoFactor() {
  const { t } = useTranslations()
  const state = useTwoFactor()
  const [step, setStep] = useState<"idle" | "password" | "scan" | "codes" | "disable" | "regenerate">("idle")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [recovery, setRecovery] = useState("")
  const [enroll, setEnroll] = useState<{ secret: string; otpauth_url: string } | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enroll) return
    let live = true
    void QRCode.toDataURL(enroll.otpauth_url, { margin: 1, width: 192 }).then((u) => live && setQr(u))
    return () => {
      live = false
    }
  }, [enroll])

  const reset = (to: typeof step = "idle") => {
    setStep(to)
    setPassword("")
    setCode("")
    setRecovery("")
    setError(null)
  }

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 403) setError(t("account.wrongPassword"))
    else if (err instanceof ApiError && err.status === 400) setError(t("auth.mfaWrong"))
    else if (err instanceof ApiError && err.status === 429) setError(t("auth.mfaLocked"))
    else setError(errorText(err, t("common.networkError")))
  }

  async function run(e: FormEvent, fn: () => Promise<void>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const s = state.data
  return (
    <div className="mt-8 border-t border-border pt-5" data-two-factor>
      <h3 className="text-eyebrow uppercase mb-2">{t("twofa.title")}</h3>
      <p className="max-w-2xl text-sm text-muted-foreground">
        {s?.enabled ? t("twofa.on", { n: s.recovery_codes_left }) : t("twofa.off")}
      </p>

      {step === "codes" ? (
        <div className="mt-4 max-w-md">
          <RecoveryCodes codes={codes} onDone={() => reset()} />
        </div>
      ) : step === "idle" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {s?.enabled ? (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={() => reset("regenerate")}>
                {t("twofa.regenerate")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => reset("disable")}>
                {t("twofa.disable")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => reset("password")}>
              {t("twofa.setup")}
            </Button>
          )}
        </div>
      ) : step === "password" ? (
        <form
          className="mt-4 max-w-sm"
          noValidate
          onSubmit={(e) =>
            run(e, async () => {
              setEnroll(await api<{ secret: string; otpauth_url: string }>(`${KEY}/enroll`, { json: { password } }))
              setPassword("")
              setStep("scan")
            })
          }
        >
          <div className="flex flex-col gap-4">
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="twofa-pw">{t("account.currentPassword")}</FieldLabel>
              <Input id="twofa-pw" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <div className="flex gap-2">
              <Button variant="primary" type="submit" disabled={busy || !password}>
                {t("twofa.continue")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => reset()}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </form>
      ) : step === "scan" && enroll ? (
        <form
          className="mt-4 grid max-w-2xl gap-6 sm:grid-cols-[auto_1fr]"
          noValidate
          onSubmit={(e) =>
            run(e, async () => {
              const out = await api<{ recovery_codes: string[] }>(`${KEY}/confirm`, { json: { code } })
              setCodes(out.recovery_codes)
              setEnroll(null)
              setQr(null)
              await state.mutate()
              setStep("codes")
            })
          }
        >
          <div className="rounded-md border border-border bg-white p-2">
            {/* The QR is a data: URL generated in the browser from the otpauth link. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr ? <img src={qr} alt={t("twofa.qrAlt")} width={192} height={192} data-twofa-qr /> : <div className="size-48" />}
          </div>
          <div className="flex flex-col gap-4">
            <p className="text-sm">{t("twofa.scan")}</p>
            <p className="text-sm text-muted-foreground">
              {t("twofa.manual")} <Ltr mono className="break-all text-foreground" data-twofa-secret>{enroll.secret}</Ltr>
            </p>
            <a href={enroll.otpauth_url} className="text-sm underline underline-offset-4">
              {t("twofa.openApp")}
            </a>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="twofa-code">{t("auth.mfaLabel")}</FieldLabel>
              <CodeInput id="twofa-code" value={code} onChange={setCode} />
              <FieldDescription>{t("twofa.confirmHint")}</FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <div className="flex gap-2">
              <Button variant="primary" type="submit" disabled={busy || code.length !== 6}>
                {t("twofa.turnOn")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => reset()}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <form
          className="mt-4 max-w-sm"
          noValidate
          onSubmit={(e) =>
            run(e, async () => {
              if (step === "disable") {
                await api(`${KEY}/disable`, { json: recovery ? { password, recovery_code: recovery } : { password, code } })
                await state.mutate()
                toast.success(t("twofa.disabled"))
                reset()
              } else {
                const out = await api<{ recovery_codes: string[] }>(`${KEY}/recovery-codes`, { json: { password, code } })
                setCodes(out.recovery_codes)
                await state.mutate()
                setStep("codes")
              }
            })
          }
        >
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="twofa-pw2">{t("account.currentPassword")}</FieldLabel>
              <Input id="twofa-pw2" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="twofa-code2">{t("auth.mfaLabel")}</FieldLabel>
              <CodeInput id="twofa-code2" value={code} onChange={setCode} />
            </Field>
            {step === "disable" ? (
              <Field>
                <FieldLabel htmlFor="twofa-recovery">{t("twofa.orRecovery")}</FieldLabel>
                <Input id="twofa-recovery" dir="ltr" className="font-mono" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="xxxxx-xxxxx" />
              </Field>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant={step === "disable" ? "danger" : "primary"}
                disabled={busy || !password || (code.length !== 6 && !(step === "disable" && recovery.trim()))}
              >
                {step === "disable" ? t("twofa.disable") : t("twofa.regenerate")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => reset()}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
