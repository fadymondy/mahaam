// Profile → Password: the current one, then the new one (the auth plugin's change-password route).
import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { KeyRound } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

import { ApiError } from "@/api/client";
import { useErrorText } from "@/components/kit";
import { AppText, ErrorLine, fonts, PasswordField, passwordScore, PrimaryButton, Row, Rows, Screen, StackHeader, StrengthMeter, useColors } from "@/grid";
import { useT } from "@/i18n";
import { mahaam } from "@/lib/session";
import { fs } from "@/lib/type-scale";

export default function ChangePassword() {
  const t = useT();
  const c = useColors();
  const errText = useErrorText();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({ mutationFn: () => mahaam.auth.changePassword(current, next) });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<StackHeader title={t("account.password.title")} />}>
        <Rows>
          <Row>
            <PasswordField label={t("account.password.current")} value={current} onChangeText={setCurrent} />
            <PasswordField label={t("auth.reset.newPassword")} value={next} onChangeText={setNext} autoComplete="new-password" />
            <StrengthMeter score={passwordScore(next)} caption={t("auth.strengthHint")} />
            {change.error ? <ErrorLine text={change.error instanceof ApiError && change.error.status === 403 ? t("account.password.wrong") : errText(change.error, { newPassword: true })} /> : null}
            {change.isSuccess ? <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.okText }}>{t("account.password.changed")}</AppText> : null}
            <PrimaryButton
              label={t("account.password.submit")}
              icon={<KeyRound size={17} color={c.onAction} strokeWidth={1.6} />}
              disabled={change.isPending || !current || passwordScore(next) < 1}
              onPress={() => change.mutate(undefined, { onSuccess: () => setTimeout(() => router.back(), 900) })}
            />
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
