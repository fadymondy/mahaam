// Forgot password: email → the 6-digit code from the email + a new password → sign in again.
// The server always answers the first step the same way, so it never reveals which emails exist.
import { router, useLocalSearchParams } from "expo-router";
import { KeyRound, Mail, Send } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

import { ApiError } from "@/api/client";
import { useErrorText } from "@/components/kit";
import { AppText, ErrorLine, Field, fonts, OtpField, PasswordField, passwordScore, PrimaryButton, ResendCountdown, Row, Rows, Screen, StackHeader, StrengthMeter, useColors } from "@/grid";
import { useI18n } from "@/i18n";
import { mahaam } from "@/lib/session";

export default function Forgot() {
  const { email: initial } = useLocalSearchParams<{ email?: string }>();
  const { t, locale } = useI18n();
  const c = useColors();
  const errText = useErrorText();
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState(initial ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 422 ? t("auth.reset.invalid") : errText(e));
    } finally {
      setBusy(false);
    }
  };

  const send = () => run(async () => {
    await mahaam.auth.forgot(email.trim(), locale);
    setStep("code");
  });
  const reset = () => run(async () => {
    await mahaam.auth.reset({ email: email.trim(), code, new_password: password, locale });
    setStep("done");
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<StackHeader title={t("auth.reset.title")} />}>
        <Rows>
          <Row>
            <AppText style={{ fontFamily: fonts.light, fontSize: 13.5, lineHeight: 25, color: c.muted }}>
              {step === "email" ? t("auth.reset.body") : step === "code" ? t("auth.reset.sent", { email: email.trim() }) : t("auth.reset.done")}
            </AppText>
          </Row>
          {step === "email" ? (
            <Row>
              <Field
                label={t("auth.email")}
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                ltr
                autoFocus
                icon={<Mail size={17} color={c.muted} strokeWidth={1.6} />}
              />
              {error ? <ErrorLine text={error} /> : null}
              <PrimaryButton label={t("auth.reset.send")} icon={<Send size={17} color={c.onAction} strokeWidth={1.6} />} disabled={busy || !email.includes("@")} onPress={() => void send()} />
            </Row>
          ) : null}
          {step === "code" ? (
            <Row>
              <OtpField label={t("auth.reset.code")} value={code} onChange={setCode} autoFocus />
              <ResendCountdown seconds={60} onResend={() => void mahaam.auth.forgot(email.trim(), locale)} />
              <PasswordField label={t("auth.reset.newPassword")} value={password} onChangeText={setPassword} autoComplete="new-password" />
              <StrengthMeter score={passwordScore(password)} caption={t("auth.strengthHint")} />
              {error ? <ErrorLine text={error} /> : null}
              <PrimaryButton
                label={t("auth.reset.submit")}
                icon={<KeyRound size={17} color={c.onAction} strokeWidth={1.6} />}
                disabled={busy || code.length < 6 || passwordScore(password) < 1}
                onPress={() => void reset()}
              />
            </Row>
          ) : null}
          {step === "done" ? (
            <Row>
              <PrimaryButton label={t("auth.signIn")} onPress={() => (router.canGoBack() ? router.back() : router.replace("/sign-in"))} />
            </Row>
          ) : null}
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
