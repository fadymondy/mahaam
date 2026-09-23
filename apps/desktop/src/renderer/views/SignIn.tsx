// Signed out: the window itself is the sign-in screen, after Health Debug's — no card, a quiet
// radial glow on the ground, one centred column: the mark, "Sign in", a line of intro, email and
// password (Forgot password? beside the password label), the primary button, then one button per
// sign-in provider the server has on (Google, GitHub…). Providers always run in the system browser
// and come back here (RFC 8252; main/session.ts). Accounts with two-factor get the code step.
import { ArrowLeftIcon, GlobeIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { BRAND, MARK_RECTS } from "@mahaam/client/brand";

import { Spinner } from "@/components/kit";
import { useApp } from "@/lib/app";
import { ApiError, desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

type Step = "credentials" | "mfa";
type Method = { name: string; label: string; url: string };

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
  const [methods, setMethods] = useState<Method[] | null>(null);

  // Which providers this server offers; the buttons follow it.
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => void desktop.authMethods(server).then((m) => live && setMethods(m), () => live && setMethods([])), 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [server]);

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
  async function browser(provider?: string) {
    if (busy === "password") return;
    const mine = ++attempt.current;
    setBusy("browser");
    setError(null);
    try {
      const out = await desktop.signInWithBrowser(server, provider);
      if (mine === attempt.current && out?.ok) setSession(out.session);
    } catch (err) {
      if (mine === attempt.current) setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      if (mine === attempt.current) setBusy(null);
    }
  }

  const mfa = step === "mfa";

  return (
    <div className="signin relative flex h-full flex-col overflow-auto">
      <div className="drag h-11 shrink-0" />
      <div className="flex flex-1 items-center justify-center px-6 pb-14">
        <div className="w-full max-w-[360px]">
          <div className="flex flex-col items-center text-center">
            <Mark size={40} />
            <h1 className="mt-5 text-[22px] font-medium text-grid-fg">{mfa ? t("auth.mfaTitle") : t("auth.title")}</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-grid-muted">{mfa ? t(recovery ? "auth.mfaRecoveryBody" : "auth.mfaBody") : t("auth.subtitle")}</p>
          </div>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-4" data-signin-form>
            {mfa ? (
              <Field label={t("auth.mfaCode")} htmlFor="mfa-code">
                <input
                  id="mfa-code"
                  dir="ltr"
                  autoFocus
                  inputMode={recovery ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  maxLength={recovery ? 32 : 6}
                  value={code}
                  onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, ""))}
                  className="signin-input font-mono tracking-[0.35em]"
                />
              </Field>
            ) : (
              <>
                <Field label={t("auth.email")} htmlFor="email">
                  <input
                    id="email"
                    type="email"
                    dir="ltr"
                    autoFocus={!email}
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="signin-input"
                  />
                </Field>
                <Field
                  label={t("auth.password")}
                  htmlFor="password"
                  aside={
                    <button type="button" className="signin-link" onClick={() => void desktop.openExternal(`${server}/${locale}/forgot-password`)}>
                      {t("auth.forgot")}
                    </button>
                  }
                >
                  <input
                    id="password"
                    type="password"
                    dir="ltr"
                    autoFocus={!!email}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="signin-input"
                  />
                </Field>
                {showServer ? (
                  <Field label={t("auth.server")} htmlFor="server">
                    <input id="server" dir="ltr" value={server} onChange={(e) => setServer(e.target.value)} className="signin-input" />
                  </Field>
                ) : null}
              </>
            )}

            {error ? (
              <p role="alert" className="text-[13.5px] text-destructive" data-signin-error>
                {error}
              </p>
            ) : null}

            <button type="submit" className="signin-primary" disabled={!!busy || (mfa ? code.trim().length < 6 : !email.includes("@") || !password)}>
              {busy === "password" ? <Spinner className="border-grid-on-action border-t-transparent" /> : null}
              {mfa ? t("auth.verify") : t("auth.signIn")}
            </button>

            {mfa ? (
              <div className="flex items-center justify-between text-[13.5px]">
                <button
                  type="button"
                  className="signin-link inline-flex items-center gap-1"
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
                  className="signin-link"
                  onClick={() => {
                    setRecovery((r) => !r);
                    setCode("");
                  }}
                >
                  {t(recovery ? "auth.mfaUseApp" : "auth.mfaUseRecovery")}
                </button>
              </div>
            ) : null}
          </form>

          {!mfa ? (
            <>
              <div className="my-6 h-px bg-line" />
              {busy === "browser" ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-line px-4 py-4 text-center" role="status" data-signin-waiting>
                  <span className="flex items-center gap-2 text-[14px] font-medium text-grid-fg">
                    <Spinner />
                    {t("auth.waiting")}
                  </span>
                  <p className="text-[13px] leading-relaxed text-grid-muted">{t("auth.waitingHint")}</p>
                  <div className="flex gap-4 text-[13px]">
                    <button type="button" className="signin-link" onClick={() => void browser()}>
                      {t("auth.reopen")}
                    </button>
                    <button type="button" className="signin-link" onClick={() => void desktop.cancelBrowserSignIn()}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {(methods ?? []).map((m) => (
                    <button key={m.name} type="button" className="signin-provider" onClick={() => void browser(m.url)} data-signin-provider={m.name}>
                      <ProviderIcon name={m.name} />
                      {t("auth.continueWith", { provider: providerName(m.name) })}
                    </button>
                  ))}
                  {methods && methods.length === 0 ? (
                    <button type="button" className="signin-provider" onClick={() => void browser()} data-signin-browser>
                      <GlobeIcon className="size-4" />
                      {t("auth.browser")}
                    </button>
                  ) : null}
                </div>
              )}
              <div className="mt-7 flex flex-col items-center gap-2 text-[13.5px]">
                <button type="button" className="signin-link" onClick={() => void desktop.openExternal(`${server}/${locale}/register`)}>
                  {t("auth.noAccountCreate", { host: hostOf(server) })}
                </button>
                <button type="button" className="text-[12.5px] text-grid-muted hover:text-grid-fg" onClick={() => setShowServer((s) => !s)}>
                  {t("auth.changeServer")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, aside, children }: { label: string; htmlFor: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-[13.5px] font-medium text-grid-body">
          {label}
        </label>
        {aside}
      </div>
      {children}
    </div>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const providerName = (n: string) =>
  ({ google: "Google", github: "GitHub", apple: "Apple", microsoft: "Microsoft" })[n] ?? n.charAt(0).toUpperCase() + n.slice(1);

/** The providers' own marks, monochrome like the reference (they follow the text colour). */
function ProviderIcon({ name }: { name: string }) {
  if (name === "google")
    return (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path
          fill="currentColor"
          d="M21.35 11.1H12v2.92h5.35c-.23 1.4-1.64 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.22 12 6.22c1.84 0 3.07.78 3.77 1.46l2.57-2.48C16.7 3.67 14.56 2.75 12 2.75 6.9 2.75 2.75 6.9 2.75 12S6.9 21.25 12 21.25c5.34 0 8.88-3.75 8.88-9.04 0-.61-.07-1.07-.15-1.53Z"
        />
      </svg>
    );
  if (name === "github")
    return (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path
          fill="currentColor"
          d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49v-1.71c-2.78.62-3.37-1.37-3.37-1.37-.46-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.64-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.72 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.46.1 2.72.64.72 1.03 1.64 1.03 2.76 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"
        />
      </svg>
    );
  if (name === "apple")
    return (
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path
          fill="currentColor"
          d="M16.37 12.67c-.03-2.6 2.13-3.86 2.23-3.92-1.21-1.78-3.1-2.02-3.78-2.05-1.61-.16-3.14.95-3.96.95-.82 0-2.08-.93-3.42-.9-1.76.03-3.38 1.02-4.29 2.6-1.83 3.17-.47 7.87 1.31 10.44.87 1.26 1.91 2.67 3.27 2.62 1.31-.05 1.81-.85 3.4-.85 1.58 0 2.03.85 3.42.82 1.41-.02 2.31-1.28 3.17-2.55 1-1.46 1.41-2.88 1.43-2.95-.03-.01-2.75-1.06-2.78-4.21ZM13.76 5.02c.72-.88 1.21-2.1 1.08-3.32-1.04.04-2.3.7-3.05 1.57-.67.77-1.26 2.02-1.1 3.21 1.16.09 2.35-.59 3.07-1.46Z"
        />
      </svg>
    );
  return <GlobeIcon className="size-4" />;
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
