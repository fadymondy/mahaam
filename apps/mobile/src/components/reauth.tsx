// "Confirm it's you" wherever a screen asks for the password (change email, two-factor, delete
// account). An account made with Apple, Google or GitHub has no password (profile.has_password is
// false): it asks for a 6-digit code by email instead (POST /api/me/reauth/code) and sends it as
// `email_code`. `reauthBody()` builds that part of the request either way.
import { Mail } from "lucide-react-native";
import { useState } from "react";

import type { Reauth } from "@/api/endpoints";
import { useErrorText } from "@/components/kit";
import { AppText, ErrorLine, fonts, OtpField, PasswordField, ResendCountdown, SecondaryButton, useColors } from "@/grid";
import { useI18n } from "@/i18n";
import { mahaam } from "@/lib/session";
import { fs, lh } from "@/lib/type-scale";

export type ReauthValue = { password: string; code: string };
export const EMPTY_REAUTH: ReauthValue = { password: "", code: "" };

export const reauthReady = (v: ReauthValue, hasPassword: boolean) => (hasPassword ? !!v.password : v.code.length === 6);
export const reauthBody = (v: ReauthValue, hasPassword: boolean): Reauth => (hasPassword ? { password: v.password } : { email_code: v.code });

export function ReauthField({ hasPassword, value, onChange }: { hasPassword: boolean; value: ReauthValue; onChange: (v: ReauthValue) => void }) {
  const { t, locale } = useI18n();
  const c = useColors();
  const errText = useErrorText();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (hasPassword) return <PasswordField label={t("auth.password")} value={value.password} onChangeText={(password) => onChange({ ...value, password })} />;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await mahaam.me.reauthCode(locale);
      setSentTo(r.email);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, lineHeight: lh(fs.meta), color: c.muted }}>
        {sentTo ? t("account.reauth.sent", { email: `⁦${sentTo}⁩` }) : t("account.reauth.body")}
      </AppText>
      {sentTo ? (
        <>
          <OtpField label={t("account.reauth.code")} value={value.code} onChange={(code) => onChange({ ...value, code })} autoFocus />
          <ResendCountdown seconds={60} onResend={() => void send()} />
        </>
      ) : (
        <SecondaryButton label={t("account.reauth.send")} icon={<Mail size={17} color={c.muted} strokeWidth={1.6} />} disabled={busy} onPress={() => void send()} />
      )}
      {error ? <ErrorLine text={error} /> : null}
    </>
  );
}
