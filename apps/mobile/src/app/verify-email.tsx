// Confirm the email address with the 6-digit code sent on sign-up. Reached right after registering,
// and from Profile when the address is still unconfirmed. "Later" is offered unless the server says
// verification is required.
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { MailCheck } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

import { ApiError } from "@/api/client";
import { useErrorText } from "@/components/kit";
import { useProfile, useVerifyState } from "@/features/account";
import { AppText, ErrorLine, fonts, OtpField, PrimaryButton, ResendCountdown, Row, Rows, Screen, StackHeader, TextButton, useColors } from "@/grid";
import { useI18n } from "@/i18n";
import { mahaam, useSession } from "@/lib/session";
import { fs, lh } from "@/lib/type-scale";

export default function VerifyEmail() {
  const { t, locale } = useI18n();
  const c = useColors();
  const qc = useQueryClient();
  const errText = useErrorText();
  const { user } = useSession();
  const profile = useProfile();
  const state = useVerifyState();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const verify = async (value: string = code) => {
    if (busy || value.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await mahaam.me.verifyEmail(value);
      void qc.invalidateQueries({ queryKey: ["me", user?.id ?? ""] });
      leave();
    } catch (e) {
      setError(errText(e, { code: true }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<StackHeader title={t("account.verify.title")} onBack={leave} />}>
        <Rows>
          <Row>
            <AppText style={{ fontFamily: fonts.light, fontSize: fs.body, lineHeight: lh(fs.body), color: c.muted }}>
              {t("account.verify.body", { email: profile.data?.email ?? user?.email ?? "" })}
            </AppText>
          </Row>
          <Row>
            <OtpField label={t("auth.reset.code")} value={code} onChange={setCode} autoFocus onComplete={(v) => void verify(v)} />
            <ResendCountdown seconds={60} onResend={() => void mahaam.me.resendVerify(locale)} />
            {error ? <ErrorLine text={error} /> : null}
            <PrimaryButton label={t("account.verify.submit")} icon={<MailCheck size={17} color={c.onAction} strokeWidth={1.6} />} disabled={busy || code.length < 6} onPress={() => void verify()} />
            {!state.data?.email_verification_required ? <TextButton muted label={t("account.verify.later")} onPress={leave} /> : null}
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}

