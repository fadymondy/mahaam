import Constants from "expo-constants";
import { router } from "expo-router";

import { Button, Card, Segmented, Screen, T } from "@/components/ui";
import { useI18n, type Locale } from "@/i18n";
import { useSession } from "@/lib/session";
import { useTheme, type ThemePref } from "@/theme";
import { space } from "@/theme/tokens";

export default function Settings() {
  const { t, locale, setLocale, needsRestart } = useI18n();
  const { pref, setPref } = useTheme();
  const { user, workspace, signOut, chooseWorkspace } = useSession();
  return (
    <Screen edges={[]}>
      <Card style={{ gap: space.md }}>
        <T weight="600">{t("settings.language")}</T>
        <Segmented<Locale>
          label={t("settings.language")}
          value={locale}
          onChange={setLocale}
          options={[
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
        />
        {needsRestart ? <T size="sm" tone="muted">{t("settings.rtlRestart")}</T> : null}
        <T weight="600">{t("settings.theme")}</T>
        <Segmented<ThemePref>
          label={t("settings.theme")}
          value={pref}
          onChange={setPref}
          options={[
            { value: "system", label: t("settings.system") },
            { value: "light", label: t("settings.light") },
            { value: "dark", label: t("settings.dark") },
          ]}
        />
      </Card>
      <Card>
        <T tone="body">{t("settings.signedInAs", { email: user?.email ?? "" })}</T>
        {workspace ? <T tone="body">{`${t("settings.workspace")}: ${workspace.name}`}</T> : null}
        <Button
          variant="secondary"
          label={t("ws.switch")}
          onPress={() => {
            void chooseWorkspace(null).then(() => router.replace("/workspaces"));
          }}
        />
        <Button
          variant="danger"
          label={t("auth.signOut")}
          onPress={() => {
            void signOut().then(() => router.replace("/sign-in"));
          }}
        />
      </Card>
      <T size="xs" tone="muted">{t("settings.version", { v: Constants.expoConfig?.version ?? "" })}</T>
    </Screen>
  );
}
