// Sign in / create account, on the grid's sign-in shapes, with the second step for accounts that
// have two-factor on (an authenticator code, or one of the recovery codes). This is the app's root
// when signed out, so it has no back button: the mark, the product name and one line of intro head
// it instead. Registering continues to the email code (verify-email).
import * as WebBrowser from "expo-web-browser";
import { Redirect, router } from "expo-router";
import { KeyRound, Lock, Mail, ShieldCheck, User, UserPlus } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";

import { ApiError } from "@/api/client";
import { useErrorText } from "@/components/kit";
import {
  AppText,
  Checkbox,
  CubeMark,
  ErrorLine,
  Field,
  fonts,
  OtpField,
  PasswordField,
  passwordScore,
  PrimaryButton,
  Row,
  Rows,
  Screen,
  StrengthMeter,
  TextButton,
  useColors,
  useGridApp,
} from "@/grid";
import { useI18n } from "@/i18n";
import { legalUrl } from "@/lib/links";
import { useSession } from "@/lib/session";
import { fs, lh } from "@/lib/type-scale";

type Mode = "in" | "up" | "mfa";

export default function SignIn() {
  const { t, locale } = useI18n();
  const c = useColors();
  const app = useGridApp();
  const errText = useErrorText();
  const { status, signIn, register, completeMfa, notice } = useSession();
  const [mode, setMode] = useState<Mode>("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "signedIn") return <Redirect href="/" />;

  const up = mode === "up";
  const score = passwordScore(password);
  const ready = email.includes("@") && !!password && (!up || (!!name.trim() && score >= 1 && agree));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof ApiError && (e.status === 401 || e.status === 422) && mode === "in"
          ? t("auth.invalid")
          : e instanceof ApiError && e.status === 422 && mode === "mfa"
            ? t("auth.mfa.wrong")
            : errText(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    ready &&
    !busy &&
    run(async () => {
      if (up) {
        await register(name, email, password);
        router.replace("/verify-email");
        return;
      }
      const r = await signIn(email, password);
      if (r.mfa) {
        setChallenge(r.mfa);
        setCode("");
        setMode("mfa");
      }
    });

  // Takes the code explicitly: OtpField's onComplete fires in the same tick as its onChange.
  const submitCode = (value: string = code) =>
    challenge && !busy && run(() => completeMfa(challenge, recovery ? { recovery_code: value.trim() } : { code: value.trim() }));

  const title = mode === "mfa" ? t("auth.mfa.title") : t(up ? "auth.register" : "auth.title");
  const intro = mode === "mfa" ? t(recovery ? "auth.mfa.recoveryBody" : "auth.mfa.body") : t("auth.subtitle");

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen
        header={
          <View style={{ paddingHorizontal: 28, paddingTop: 28, paddingBottom: 18, gap: 14, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <CubeMark size={44} />
            {/* The product name stays Latin and untranslated. */}
            <AppText variant="latin">{app.name}</AppText>
            <AppText variant="bigHeader">{title}</AppText>
          </View>
        }>
        <Rows>
          <Row>
            <AppText style={{ fontFamily: fonts.light, fontSize: fs.body, lineHeight: lh(fs.body), color: c.muted }}>{intro}</AppText>
          </Row>

          {mode === "mfa" ? (
            <Row>
              {recovery ? (
                <Field
                  label={t("auth.mfa.recoveryCode")}
                  value={code}
                  onChangeText={setCode}
                  placeholder="xxxx-xxxx"
                  autoCapitalize="none"
                  maxLength={32}
                  ltr
                  autoFocus
                  icon={<KeyRound size={17} color={c.muted} strokeWidth={1.6} />}
                />
              ) : (
                <OtpField label={t("auth.mfa.code")} value={code} onChange={setCode} autoFocus onComplete={(v) => v.length === 6 && void submitCode(v)} />
              )}
              <Checkbox
                checked={recovery}
                onChange={(v) => {
                  setRecovery(v);
                  setCode("");
                }}>
                <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.body }}>{t("auth.mfa.useRecovery")}</AppText>
              </Checkbox>
              {error ? <ErrorLine text={error} /> : null}
              <PrimaryButton
                label={t("auth.mfa.verify")}
                icon={<ShieldCheck size={18} color={c.onAction} strokeWidth={1.6} />}
                disabled={busy || code.trim().length < 6}
                onPress={() => void submitCode()}
              />
              <TextButton
                muted
                label={t("common.back")}
                onPress={() => {
                  setMode("in");
                  setChallenge(null);
                  setError(null);
                }}
              />
            </Row>
          ) : (
            <Row>
              {notice === "sessionLost" ? <ErrorLine text={t("auth.sessionLost")} /> : null}
              {up ? (
                <Field
                  label={t("auth.name")}
                  value={name}
                  onChangeText={setName}
                  autoComplete="name"
                  textContentType="name"
                  icon={<User size={17} color={c.muted} strokeWidth={1.6} />}
                  testID="name"
                />
              ) : null}
              <Field
                label={t("auth.email")}
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="username"
                ltr
                icon={<Mail size={17} color={c.muted} strokeWidth={1.6} />}
                testID="email"
              />
              <PasswordField label={t("auth.password")} value={password} onChangeText={setPassword} autoComplete={up ? "new-password" : "password"} />
              {up ? <StrengthMeter score={score} caption={t("auth.strengthHint")} /> : null}
              {up ? (
                <Checkbox checked={agree} onChange={setAgree} large>
                  <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, lineHeight: lh(fs.meta), color: c.body }}>
                    {t("auth.agreePrefix")}{" "}
                    <AppText
                      style={{ fontFamily: fonts.medium, fontSize: fs.meta, color: c.goldText }}
                      onPress={() => void WebBrowser.openBrowserAsync(legalUrl("terms", locale))}>
                      {t("legal.terms")}
                    </AppText>{" "}
                    {t("auth.agreeAnd")}{" "}
                    <AppText
                      style={{ fontFamily: fonts.medium, fontSize: fs.meta, color: c.goldText }}
                      onPress={() => void WebBrowser.openBrowserAsync(legalUrl("privacy", locale))}>
                      {t("legal.privacy")}
                    </AppText>
                  </AppText>
                </Checkbox>
              ) : null}
              {error ? <ErrorLine text={error} /> : null}
              <PrimaryButton
                label={t(up ? "auth.register" : "auth.signIn")}
                icon={up ? <UserPlus size={18} color={c.onAction} strokeWidth={1.6} /> : <Lock size={18} color={c.onAction} strokeWidth={1.6} />}
                disabled={busy || !ready}
                onPress={() => void submit()}
              />
              {!up ? <TextButton label={t("auth.forgot")} onPress={() => router.push({ pathname: "/forgot", params: { email } })} /> : null}
            </Row>
          )}

          {mode !== "mfa" ? (
            <Row style={{ paddingVertical: 10 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setMode(up ? "in" : "up");
                  setError(null);
                }}
                style={{ minHeight: 44, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" }}>
                <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.muted }}>{t(up ? "auth.haveAccountQ" : "auth.noAccountQ")}</AppText>
                <AppText style={{ fontFamily: fonts.medium, fontSize: fs.meta, color: c.fg }}>{t(up ? "auth.signIn" : "auth.register")}</AppText>
              </Pressable>
            </Row>
          ) : null}
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
