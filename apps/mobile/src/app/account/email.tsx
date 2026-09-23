// Profile → Email: a new address and the password → the code sent to the new address → changed.
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Mail, MailCheck } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

import { ApiError } from "@/api/client";
import { useErrorText } from "@/components/kit";
import { useProfile } from "@/features/account";
import { AppText, ErrorLine, Field, fonts, OtpField, PasswordField, PrimaryButton, Row, Rows, Screen, StackHeader, useColors } from "@/grid";
import { useI18n } from "@/i18n";
import { mahaam, useSession } from "@/lib/session";
import { fs, lh } from "@/lib/type-scale";

export default function ChangeEmail() {
  const { t, locale } = useI18n();
  const c = useColors();
  const qc = useQueryClient();
  const errText = useErrorText();
  const { user } = useSession();
  const profile = useProfile();
  const [step, setStep] = useState<"form" | "code">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e, step === "code" ? { code: true } : { password: true, email: true }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<StackHeader title={t("account.email.title")} />}>
        <Rows>
          <Row>
            <AppText style={{ fontFamily: fonts.light, fontSize: fs.body, lineHeight: lh(fs.body), color: c.muted }}>
              {step === "form" ? t("account.email.body", { email: profile.data?.email ?? "" }) : t("auth.reset.sent", { email: email.trim() })}
            </AppText>
          </Row>
          {step === "form" ? (
            <Row>
              <Field label={t("account.email.new")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" ltr icon={<Mail size={17} color={c.muted} strokeWidth={1.6} />} />
              <PasswordField label={t("auth.password")} value={password} onChangeText={setPassword} />
              {error ? <ErrorLine text={error} /> : null}
              <PrimaryButton
                label={t("auth.reset.send")}
                disabled={busy || !email.includes("@") || !password}
                onPress={() => void run(async () => {
                  await mahaam.me.changeEmail(email.trim(), password, locale);
                  setStep("code");
                })}
              />
            </Row>
          ) : (
            <Row>
              <OtpField label={t("auth.reset.code")} value={code} onChange={setCode} autoFocus />
              {error ? <ErrorLine text={error} /> : null}
              <PrimaryButton
                label={t("account.verify.submit")}
                icon={<MailCheck size={17} color={c.onAction} strokeWidth={1.6} />}
                disabled={busy || code.length < 6}
                onPress={() => void run(async () => {
                  await mahaam.me.confirmEmail(code, locale);
                  void qc.invalidateQueries({ queryKey: ["me", user?.id ?? ""] });
                  router.back();
                })}
              />
            </Row>
          )}
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
