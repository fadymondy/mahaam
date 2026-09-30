"use client"

// The account a person manages for themselves (MH-343): name, picture, language, timezone, the
// email they sign in with, and their password. Account-wide, not per workspace, so it reads
// /api/me/* and never sends X-Workspace-ID.
import { useMemo, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR, { useSWRConfig } from "swr"
import { toast } from "sonner"

import { Button, Field, FieldDescription, FieldError, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@fadymondy/nasaq/web"




import { Ltr } from "@/components/copy-field"
import { ErrorState, LoadingRows } from "@/components/states"
import { api, ApiError, resetCsrf } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n-locale"
import { errorText } from "@/lib/work"
import { TwoFactor, useTwoFactor } from "@/components/account/two-factor"

export type Profile = {
  id: string
  email: string
  name: string
  avatar: string | null
  locale: "en" | "ar" | null
  timezone: string | null
  created_at: string
}

const PROFILE = "/api/me/profile"

function initials(p: Profile) {
  const from = p.name || p.email
  const parts = from.split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

export function AccountCard() {
  const { t } = useTranslations()
  const profile = useSWR<Profile>(PROFILE, (p: string) => api<Profile>(p))

  return (
    <section className="border-y border-line px-6 py-5" data-account-card>
      <h2 className="text-base font-medium">{t("account.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-grid-muted">{t("account.hint")}</p>
      <div className="mt-5">
        {profile.error ? (
          <ErrorState error={profile.error} />
        ) : !profile.data ? (
          <LoadingRows rows={3} />
        ) : (
          <>
            <div className="grid gap-8 lg:grid-cols-3">
              <ProfileForm profile={profile.data} onSaved={(p) => void profile.mutate(p, false)} />
              <EmailForm profile={profile.data} onSaved={(p) => void profile.mutate(p, false)} />
              <PasswordForm />
            </div>
            <TwoFactor />
            <DeleteAccount />
          </>
        )}
      </div>
    </section>
  )
}

function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const { t } = useTranslations()
  const [name, setName] = useState(profile.name)
  const [locale, setLocale] = useState<string>(profile.locale ?? "")
  const [timezone, setTimezone] = useState(profile.timezone ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  // Every zone the browser knows, for the suggestion list. The API checks the name against its own
  // copy of the tz database, so this only helps typing.
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []
    } catch {
      return []
    }
  }, [])
  const deviceZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const languages = [{ value: "", label: t("account.languageDevice") }, ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))]

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const p = await api<Profile>(PROFILE, { method: "PATCH", json: { name, locale, timezone: timezone.trim() } })
      onSaved(p)
      toast.success(t("account.saved"))
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  async function upload(f: File) {
    setBusy(true)
    const form = new FormData()
    form.append("file", f)
    try {
      onSaved(await api<Profile>("/api/me/avatar", { form }))
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 415
          ? t("account.avatarFormat")
          : err instanceof ApiError && err.status === 413
            ? t("account.avatarTooBig")
            : errorText(err, t("common.networkError")),
      )
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ""
    }
  }

  async function removeAvatar() {
    setBusy(true)
    try {
      onSaved(await api<Profile>("/api/me/avatar", { method: "DELETE" }))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {profile.avatar ? (
            // A data: URL the API produced (256px JPEG); next/image adds nothing for one.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar} alt="" className="size-16 rounded-full border border-line object-cover" data-avatar />
          ) : (
            <span
              className="grid size-16 place-items-center rounded-full border border-line bg-grid-soft text-lg font-medium text-grid-muted"
              aria-hidden
              data-avatar-initials
            >
              {initials(profile)}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/gif"
              className="sr-only"
              id="avatar-file"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
              }}
            />
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => file.current?.click()}>
              {profile.avatar ? t("account.avatarChange") : t("account.avatarUpload")}
            </Button>
            {profile.avatar ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void removeAvatar()}>
                {t("account.avatarRemove")}
              </Button>
            ) : null}
          </div>
        </div>
        <Field>
          <FieldLabel htmlFor="acc-name">{t("account.name")}</FieldLabel>
          <Input id="acc-name" value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>{t("account.language")}</FieldLabel>
          <Select items={languages} value={locale} onValueChange={(v) => setLocale(String(v ?? ""))}>
            <SelectTrigger className="h-9 w-full" aria-label={t("account.language")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((l) => (
                <SelectItem key={l.value || "device"} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="acc-tz">{t("account.timezone")}</FieldLabel>
          <Input
            id="acc-tz"
            dir="ltr"
            list="acc-tz-list"
            value={timezone}
            placeholder={deviceZone}
            onChange={(e) => setTimezone(e.target.value)}
          />
          <datalist id="acc-tz-list">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <FieldDescription>{t("account.timezoneHint")}</FieldDescription>
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? t("common.working") : t("account.save")}
        </Button>
      </div>
    </form>
  )
}

function EmailForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const { t, locale } = useTranslations()
  const { mutate } = useSWRConfig()
  const [step, setStep] = useState<"idle" | "ask" | "code">("idle")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function request(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await api("/api/me/email", { json: { email: email.trim(), password, locale } })
      setPassword("")
      setStep("code")
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? t("account.wrongPassword")
          : err instanceof ApiError && err.status === 429
            ? t("auth.resetTooMany")
            : errorText(err, t("common.networkError")),
      )
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const p = await api<Profile>("/api/me/email/confirm", { json: { code: code.trim(), locale } })
      onSaved(p)
      void mutate("/api/auth/me")
      toast.success(t("account.emailChanged"))
      setStep("idle")
      setEmail("")
      setCode("")
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? t("auth.resetBadCode") : errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="grid-micro mb-2">{t("account.email")}</h3>
      <Ltr className="block truncate text-sm" data-current-email>
        {profile.email}
      </Ltr>
      {step === "idle" ? (
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setStep("ask")}>
          {t("account.emailChange")}
        </Button>
      ) : step === "ask" ? (
        <form onSubmit={request} noValidate className="mt-4">
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="acc-new-email">{t("account.newEmail")}</FieldLabel>
              <Input id="acc-new-email" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="acc-email-pw">{t("account.currentPassword")}</FieldLabel>
              <Input
                id="acc-email-pw"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <div className="flex gap-2">
              <Button variant="primary" type="submit" disabled={busy || !email.includes("@") || !password}>
                {busy ? t("common.working") : t("account.emailSend")}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep("idle")}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate className="mt-4">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-grid-muted" role="status">
              {t("account.emailSent", { email: email.trim() })}
            </p>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="acc-email-code">{t("auth.resetCode")}</FieldLabel>
              <Input
                id="acc-email-code"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="font-mono tracking-[0.4em]"
                placeholder="000000"
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
            <div className="flex gap-2">
              <Button variant="primary" type="submit" disabled={busy || code.length !== 6}>
                {busy ? t("common.working") : t("account.emailConfirm")}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep("idle")}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

function PasswordForm() {
  const { t } = useTranslations()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 8) {
      setError(t("auth.passwordTooShort"))
      return
    }
    setBusy(true)
    try {
      await api("/api/auth/change-password", { json: { old_password: current, new_password: next } })
      setCurrent("")
      setNext("")
      toast.success(t("account.passwordChanged"))
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? t("account.wrongPassword") : errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} noValidate>
      <h3 className="grid-micro mb-2">{t("account.password")}</h3>
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="acc-pw-current">{t("account.currentPassword")}</FieldLabel>
          <Input
            id="acc-pw-current"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="acc-pw-new">{t("auth.newPassword")}</FieldLabel>
          <Input id="acc-pw-new" type="password" dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <FieldDescription>{t("auth.passwordHint")}</FieldDescription>
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <Button type="submit" variant="secondary" disabled={busy || !current || !next}>
          {busy ? t("common.working") : t("account.passwordSave")}
        </Button>
      </div>
    </form>
  )
}

type OwnedWorkspace = { id: string; slug: string; name: string }

// Deleting the account (MH-344). The API refuses while the person is the only owner of a
// workspace and sends the list, so each is a link rather than a sentence to go and act on. On
// success every session has already ended server-side; this page only has to leave.
function DeleteAccount() {
  const { t, locale } = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [owned, setOwned] = useState<OwnedWorkspace[] | null>(null)
  // With two-factor sign-in on, the password alone doesn't delete the account.
  const twofa = useTwoFactor()
  const [code, setCode] = useState("")

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOwned(null)
    setBusy(true)
    try {
      const out = await api<{ purge_after: string }>("/api/me/delete", {
        json: twofa.data?.enabled ? { password, locale, code } : { password, locale },
      })
      // The session is already revoked; this only clears the cookie, so it may well 401.
      await api("/api/auth/logout", { method: "POST" }).catch(() => undefined)
      resetCsrf()
      router.replace(`/${locale}/login?deleted=${encodeURIComponent(out.purge_after)}`)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.code === "sole_owner") {
        setOwned(((err.data as { workspaces?: OwnedWorkspace[] })?.workspaces ?? []) as OwnedWorkspace[])
      } else if (err instanceof ApiError && err.code === "mfa_required") {
        setError(t("auth.mfaHint"))
      } else if (err instanceof ApiError && err.status === 400) {
        setError(t("auth.mfaWrong"))
      } else if (err instanceof ApiError && err.status === 403) {
        setError(t("account.wrongPassword"))
      } else {
        setError(errorText(err, t("common.networkError")))
      }
    }
  }

  return (
    <div className="mt-8 border-t border-line pt-5" data-delete-account>
      <h3 className="grid-micro mb-2 text-grid-danger">{t("account.deleteTitle")}</h3>
      <p className="max-w-2xl text-sm text-grid-muted">{t("account.deleteHint")}</p>
      {!open ? (
        <Button type="button" variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          {t("account.deleteOpen")}
        </Button>
      ) : (
        <form onSubmit={submit} noValidate className="mt-4 max-w-sm">
          <div className="flex flex-col gap-4">
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="acc-delete-pw">{t("account.currentPassword")}</FieldLabel>
              <Input
                id="acc-delete-pw"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <FieldDescription>{t("account.deleteConfirmHint")}</FieldDescription>
            </Field>
            {twofa.data?.enabled ? (
              <Field>
                <FieldLabel htmlFor="acc-delete-code">{t("auth.mfaLabel")}</FieldLabel>
                <Input
                  id="acc-delete-code"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="font-mono tracking-[0.4em]"
                  placeholder="000000"
                />
              </Field>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
            {owned ? (
              <div className="rounded-md border border-line p-3 text-sm" role="alert" data-sole-owner>
                <p>{t("account.deleteSoleOwner")}</p>
                <ul className="mt-2 list-disc ps-5">
                  {owned.map((w) => (
                    <li key={w.id}>
                      <Link href={`/${locale}/w/${w.slug}/settings/workspace`} className="underline underline-offset-4">
                        {w.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={busy || !password || (!!twofa.data?.enabled && code.length !== 6)}>
                {busy ? t("common.working") : t("account.deleteSubmit")}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
