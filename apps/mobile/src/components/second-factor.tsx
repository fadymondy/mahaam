// The second factor wherever a screen asks for it (sign-in, turning two-factor off, deleting the
// account): the authenticator's 6-digit code, or — for someone who has lost the phone — one of the
// recovery codes saved when two-factor was turned on. The server takes either (`code` or
// `recovery_code`); `secondFactor()` builds that part of the request.
import { KeyRound } from "lucide-react-native";

import { AppText, Checkbox, Field, fonts, OtpField, useColors } from "@/grid";
import { useT } from "@/i18n";
import { fs } from "@/lib/type-scale";

export type SecondFactor = { value: string; recovery: boolean };

export const secondFactorReady = (f: SecondFactor) => (f.recovery ? f.value.trim().length >= 8 : f.value.length === 6);

export const secondFactor = (f: SecondFactor) => (f.recovery ? { recovery_code: f.value.trim() } : { code: f.value.trim() });

export function SecondFactorField({ value, onChange, autoFocus, onComplete }: { value: SecondFactor; onChange: (v: SecondFactor) => void; autoFocus?: boolean; onComplete?: (code: string) => void }) {
  const t = useT();
  const c = useColors();
  return (
    <>
      {value.recovery ? (
        <Field
          label={t("auth.mfa.recoveryCode")}
          value={value.value}
          onChangeText={(v) => onChange({ ...value, value: v })}
          placeholder="xxxx-xxxx"
          autoCapitalize="none"
          autoCorrect={false}
          // The server's recovery codes are at most 20 characters.
          maxLength={20}
          ltr
          autoFocus={autoFocus}
          icon={<KeyRound size={17} color={c.muted} strokeWidth={1.6} />}
        />
      ) : (
        <OtpField label={t("auth.mfa.code")} value={value.value} onChange={(v) => onChange({ ...value, value: v })} autoFocus={autoFocus} onComplete={onComplete} />
      )}
      <Checkbox checked={value.recovery} onChange={(recovery) => onChange({ value: "", recovery })}>
        <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.body }}>{t("auth.mfa.useRecovery")}</AppText>
      </Checkbox>
    </>
  );
}
