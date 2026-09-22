// Sign in / create account, on the grid's sign-in shapes. This is the app's root when signed out,
// so it has no back button: the mark, the product name and the one line of intro head it instead.
import { Redirect } from "expo-router";
import { Lock, Mail, User, UserPlus } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";

import { ApiError } from "@/api/client";
import { useErrorText } from "@/components/kit";
import { isTeam } from "@/config";
import {
  AppText,
  CubeMark,
  ErrorLine,
  Field,
  fonts,
  PasswordField,
  passwordScore,
  PrimaryButton,
  Row,
  Rows,
  Screen,
  StrengthMeter,
  useColors,
  useGridApp,
} from "@/grid";
import { useT } from "@/i18n";
import { useSession } from "@/lib/session";

export default function SignIn() {
  const t = useT();
  const c = useColors();
  const app = useGridApp();
  const errText = useErrorText();
  const { status, signIn, register, notice } = useSession();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "signedIn") return <Redirect href="/" />;

  const up = mode === "up";
  const score = passwordScore(password);
  const ready = email.includes("@") && !!password && (!up || (!!name.trim() && score >= 1));

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (up) await register(name, email, password);
      else await signIn(email, password);
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 401 || e.status === 422) && !up ? t("auth.invalid") : errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen
        header={
          <View style={{ paddingHorizontal: 28, paddingTop: 28, paddingBottom: 18, gap: 14, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <CubeMark size={44} />
            {/* The product name stays Latin and untranslated. */}
            <AppText variant="latin">{app.name}</AppText>
            <AppText variant="bigHeader">{t(up ? "auth.register" : "auth.title")}</AppText>
          </View>
        }>
        <Rows>
          <Row>
            <AppText style={{ fontFamily: fonts.light, fontSize: 13.5, lineHeight: 25, color: c.muted }}>
              {t(isTeam ? "auth.subtitleTeam" : "auth.subtitleClient")}
            </AppText>
          </Row>
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
            {error ? <ErrorLine text={error} /> : null}
            <PrimaryButton
              label={t(up ? "auth.register" : "auth.signIn")}
              icon={up ? <UserPlus size={18} color={c.onAction} strokeWidth={1.6} /> : <Lock size={18} color={c.onAction} strokeWidth={1.6} />}
              disabled={busy || !ready}
              onPress={submit}
            />
          </Row>
          <Row style={{ paddingVertical: 10 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode(up ? "in" : "up");
                setError(null);
              }}
              style={{ minHeight: 44, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center" }}>
              <AppText style={{ fontFamily: fonts.regular, fontSize: 13, color: c.muted }}>{t(up ? "auth.haveAccountQ" : "auth.noAccountQ")}</AppText>
              <AppText style={{ fontFamily: fonts.medium, fontSize: 13, color: c.fg }}>{t(up ? "auth.signIn" : "auth.register")}</AppText>
            </Pressable>
          </Row>
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
