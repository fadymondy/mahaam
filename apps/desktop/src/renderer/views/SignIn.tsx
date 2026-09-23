// Signed out: a small centred column on the grid (hairline frame, micro labels), the way a desktop
// app asks for an account — email and password, the second factor when the account has one, or
// Google/GitHub through the Mahaam sign-in page in its own window.
import { ArrowLeftIcon, GlobeIcon, KeyRoundIcon, LockIcon, MailIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { BRAND, MARK_RECTS } from "@mahaam/client/brand";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/kit";
import { useApp } from "@/lib/app";
import { ApiError, desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

type Step = "credentials" | "mfa";

export function SignIn() {
  const { t, locale } = useI18n();
  const { config, ended, setSession } = useApp();
  const [step, setStep] = useState<Step>("credentials");
  const [server, setServer] = useState(config.defaultApiUrl);
  const [showServer, setShowServer] = useState(false);
  const [email, setEmail] = useState(config.lastEmail);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState<"password" | "browser" | null>(null);
  const [error, setError] = useState<string | null>(ended === "expired" ? t("auth.sessionExpired") : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy("password");
    setError(null);
    try {
      const second = step === "mfa" ? (recovery ? { recovery_code: code.trim() } : { code: code.trim() }) : undefined;
      const out = await desktop.signIn(server, email, password, second);
      if (!out.ok) {
        setStep("mfa");
        setCode("");
        return;
      }
      setSession(out.session);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(
        step === "mfa" && (status === 401 || status === 422)
          ? t("auth.mfaWrong")
          : status === 401 || status === 422
            ? t("auth.invalid")
            : err instanceof Error
              ? err.message
              : t("common.error"),
      );
    } finally {
      setBusy(null);
    }
  }

  // Each browser attempt gets a number; re-opening cancels the previous one, whose settling must not
  // touch the screen of the one now waiting.
  const attempt = useRef(0);
  async function browser() {
    if (busy === "password") return;
    const mine = ++attempt.current;
    setBusy("browser");
    setError(null);
    try {
      const out = await desktop.signInWithBrowser(server);
      if (mine === attempt.current && out?.ok) setSession(out.session);
    } catch (err) {
      if (mine === attempt.current) setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      if (mine === attempt.current) setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="drag h-11 shrink-0" />
      <div className="flex flex-1 items-center justify-center overflow-auto px-6 pb-16">
        <div className="w-full max-w-[380px] border border-line bg-grid-card">
          <div className="flex flex-col items-center gap-3 border-b border-line px-8 pt-8 pb-6 text-center">
            <Mark />
            <h1 className="text-[17px] font-medium text-grid-fg">{step === "mfa" ? t("auth.mfaTitle") : t("auth.title")}</h1>
            <p className="text-[12.5px] text-grid-muted">
              {step === "mfa" ? t(recovery ? "auth.mfaRecoveryBody" : "auth.mfaBody") : t("auth.subtitle")}
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3 px-8 py-6" data-signin-form>
            {step === "credentials" ? (
              <>
                <Field label={t("auth.email")}>
                  <Input
                    id="email"
                    type="email"
                    dir="ltr"
                    autoFocus={!email}
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="ps-8"
                  />
                  <MailIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
                </Field>
                <Field label={t("auth.password")}>
                  <Input
                    id="password"
                    type="password"
                    dir="ltr"
                    autoFocus={!!email}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="ps-8"
                  />
                  <LockIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
                </Field>
                {showServer ? (
                  <Field label={t("auth.server")}>
                    <Input id="server" dir="ltr" value={server} onChange={(e) => setServer(e.target.value)} className="ps-8" />
                    <GlobeIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
                  </Field>
                ) : null}
              </>
            ) : (
              <Field label={t("auth.mfaCode")}>
                <Input
                  id="mfa-code"
                  dir="ltr"
                  autoFocus
                  inputMode={recovery ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  maxLength={recovery ? 32 : 6}
                  value={code}
                  onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, ""))}
                  className="ps-8 font-mono tracking-[0.3em]"
                />
                <KeyRoundIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-grid-muted" />
              </Field>
            )}

            {error ? (
              <p role="alert" className="text-[12.5px] text-destructive" data-signin-error>
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="mt-1 h-9 w-full"
              disabled={!!busy || (step === "credentials" ? !email.includes("@") || !password : code.trim().length < 6)}
            >
              {busy === "password" ? <Spinner className="border-primary-foreground border-t-transparent" /> : null}
              {step === "mfa" ? t("auth.verify") : t("auth.signIn")}
            </Button>

            {step === "mfa" ? (
              <div className="flex items-center justify-between pt-1 text-[12.5px]">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-grid-muted hover:text-grid-fg"
                  onClick={() => {
                    setStep("credentials");
                    setError(null);
                  }}
                >
                  <ArrowLeftIcon className="size-3.5 rtl:-scale-x-100" />
                  {t("common.back")}
                </button>
                <button
                  type="button"
                  className="text-grid-muted hover:text-grid-fg"
                  onClick={() => {
                    setRecovery((r) => !r);
                    setCode("");
                  }}
                >
                  {t(recovery ? "auth.mfaUseApp" : "auth.mfaUseRecovery")}
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 py-1 text-[11px] text-grid-muted uppercase">
                  <span className="h-px flex-1 bg-line" />
                  {t("auth.orContinue")}
                  <span className="h-px flex-1 bg-line" />
                </div>
                {busy === "browser" ? (
                  <div className="flex flex-col items-center gap-2 border border-line bg-background px-4 py-3 text-center" role="status" data-signin-waiting>
                    <span className="flex items-center gap-2 text-[12.5px] font-medium text-grid-fg">
                      <Spinner />
                      {t("auth.waiting")}
                    </span>
                    <p className="text-[11.5px] leading-relaxed text-grid-muted">{t("auth.waitingHint")}</p>
                    <div className="flex gap-3 text-[12px]">
                      <button type="button" className="text-grid-muted hover:text-grid-fg" onClick={() => void browser()}>
                        {t("auth.reopen")}
                      </button>
                      <button type="button" className="text-grid-muted hover:text-grid-fg" onClick={() => void desktop.cancelBrowserSignIn()}>
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button type="button" variant="outline" className="h-9 w-full" disabled={!!busy} onClick={browser} data-signin-browser>
                      <GlobeIcon />
                      {t("auth.browser")}
                    </Button>
                    <p className="text-center text-[11.5px] leading-relaxed text-grid-muted">{t("auth.browserHint")}</p>
                  </>
                )}
              </>
            )}
          </form>

          {step === "credentials" ? (
            <div className="flex items-center justify-between border-t border-line px-8 py-3 text-[12px] text-grid-muted">
              <button type="button" className="hover:text-grid-fg" onClick={() => void desktop.openExternal(`${server}/${locale}/forgot-password`)}>
                {t("auth.forgot")}
              </button>
              <span className="flex items-center gap-3">
                <button type="button" className="hover:text-grid-fg" onClick={() => setShowServer((s) => !s)}>
                  {t("auth.changeServer")}
                </button>
                <button type="button" className="font-medium text-grid-fg hover:underline" onClick={() => void desktop.openExternal(`${server}/${locale}/register`)}>
                  {t("auth.createOnWeb")}
                </button>
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="grid-micro text-[10.5px]">{label}</span>
      <span className="relative block">{children}</span>
    </label>
  );
}

/** The Mahaam mark (never redrawn: the brand's own squares; the body lightens on dark). */
export function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Mahaam">
      {MARK_RECTS.map(([x, y, s, part]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={s} height={s} fill={part === "accent" ? BRAND.accent : "var(--grid-brand)"} />
      ))}
    </svg>
  );
}
