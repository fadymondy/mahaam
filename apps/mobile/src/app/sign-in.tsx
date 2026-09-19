import { Redirect } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";

import { ApiError } from "@/api/client";
import { Button, Card, Field, Mark, Screen, T, useErrorText } from "@/components/ui";
import { apiUrl, isTeam } from "@/config";
import { useT } from "@/i18n";
import { useSession } from "@/lib/session";
import { space } from "@/theme/tokens";

export default function SignIn() {
  const t = useT();
  const errText = useErrorText();
  const { status, signIn, register, notice } = useSession();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "signedIn") return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "in") await signIn(email, password);
      else await register(name, email, password);
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 401 || e.status === 422) && mode === "in" ? t("auth.invalid") : errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <View style={{ alignItems: "center", gap: space.sm, marginTop: space.xxl, marginBottom: space.lg }}>
          <Mark size={72} />
          <T size="xl" weight="700" role="header">
            {t(isTeam ? "app.team" : "app.client")}
          </T>
          <T tone="body" style={{ textAlign: "center" }}>
            {t(isTeam ? "auth.subtitleTeam" : "auth.subtitleClient")}
          </T>
        </View>
        <Card style={{ gap: space.md }}>
          {notice === "sessionLost" ? <T tone="danger" role="alert">{t("auth.sessionLost")}</T> : null}
          {mode === "up" ? <Field label={t("auth.name")} value={name} onChangeText={setName} autoComplete="name" testID="name" /> : null}
          <Field
            label={t("auth.email")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            testID="email"
          />
          <Field
            label={t("auth.password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            textContentType="password"
            onSubmitEditing={submit}
            testID="password"
          />
          {error ? <T tone="danger" role="alert">{error}</T> : null}
          <Button
            label={mode === "in" ? t("auth.signIn") : t("auth.register")}
            onPress={submit}
            busy={busy}
            disabled={!email || !password || (mode === "up" && !name)}
          />
          <Button
            variant="ghost"
            label={mode === "in" ? t("auth.noAccount") : t("auth.haveAccount")}
            onPress={() => setMode(mode === "in" ? "up" : "in")}
          />
        </Card>
        <T size="xs" tone="muted" style={{ textAlign: "center" }}>
          {t("auth.server")}: {apiUrl || (typeof location !== "undefined" ? location.origin : "")}
        </T>
      </Screen>
    </KeyboardAvoidingView>
  );
}
