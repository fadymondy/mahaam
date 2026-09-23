// Profile → Delete account (App Store guideline 5.1.1(v)): the password (and the 2FA code when it is
// on) → the account is closed, signed out everywhere, and erased after the grace period. The only
// owner of a workspace others use is told which workspaces to hand over first.
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";

import { ApiError } from "@/api/client";
import { useErrorText } from "@/components/kit";
import { useTwoFA } from "@/features/account";
import { AppText, Checkbox, ErrorLine, fonts, OtpField, PasswordField, Row, Rows, Screen, StackHeader, useColors } from "@/grid";
import { useFormat, useI18n } from "@/i18n";
import { client, mahaam, useSession } from "@/lib/session";
import { DangerButton } from "@/components/kit";
import { fs, lh } from "@/lib/type-scale";

export default function DeleteAccount() {
  const { t, locale } = useI18n();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const { signOut } = useSession();
  const twoFA = useTwoFA();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const needsCode = !!twoFA.data?.enabled;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await mahaam.me.deleteAccount({ password, code: needsCode ? code : undefined, locale });
      setDone(r.purge_after);
      // The server has revoked every token already; clear this device.
      await client.logout();
      setTimeout(() => void signOut().finally(() => router.replace("/sign-in")), 2500);
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { code?: string; workspaces?: { name: string }[] } | undefined) : undefined;
      if (body?.code === "sole_owner") setError(t("account.delete.soleOwner", { names: (body.workspaces ?? []).map((w) => w.name).join(", ") }));
      else if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 422)) setError(t("account.twofa.wrong"));
      else setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<StackHeader title={t("account.delete.title")} />}>
        <Rows>
          <Row>
            <AppText style={{ fontFamily: fonts.light, fontSize: fs.body, lineHeight: lh(fs.body), color: c.body }}>{t("account.delete.body")}</AppText>
          </Row>
          {done ? (
            <Row>
              <AppText style={{ fontFamily: fonts.regular, fontSize: fs.body, color: c.okText }}>{t("account.delete.done", { date: f.date(done) })}</AppText>
            </Row>
          ) : (
            <Row>
              <PasswordField label={t("auth.password")} value={password} onChangeText={setPassword} />
              {needsCode ? <OtpField label={t("auth.mfa.code")} value={code} onChange={setCode} /> : null}
              <Checkbox checked={sure} onChange={setSure} large>
                <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, lineHeight: lh(fs.meta), color: c.body }}>{t("account.delete.confirm")}</AppText>
              </Checkbox>
              {error ? <ErrorLine text={error} /> : null}
              <DangerButton label={t("account.delete.submit")} disabled={busy || !sure || !password || (needsCode && code.length < 6)} onPress={() => void submit()} />
            </Row>
          )}
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}

