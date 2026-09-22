// Language and appearance (the grid's PreferencesRow: switching to Arabic flips the whole app to
// RTL), the account and workspace, and the version.
import Constants from "expo-constants";
import { router } from "expo-router";
import { ArrowLeftRight } from "lucide-react-native";

import { DangerButton } from "@/components/kit";
import { AppText, Meta, PreferencesRow, Row, Rows, Screen, SecondaryButton, StackHeader, useColors } from "@/grid";
import { useT } from "@/i18n";
import { useSession } from "@/lib/session";

export default function Settings() {
  const t = useT();
  const c = useColors();
  const { user, workspace, signOut, chooseWorkspace } = useSession();
  return (
    <Screen header={<StackHeader title={t("settings.title")} />}>
      <Rows>
        <PreferencesRow />
        <Row>
          <AppText variant="micro">{t("auth.email")}</AppText>
          <AppText variant="rowTitle" style={{ writingDirection: "ltr" }}>
            {user?.email ?? ""}
          </AppText>
          {workspace ? (
            <>
              <AppText variant="micro">{t("settings.workspace")}</AppText>
              <AppText variant="rowTitle">{workspace.name}</AppText>
            </>
          ) : null}
          <SecondaryButton
            label={t("ws.switch")}
            icon={<ArrowLeftRight size={17} color={c.muted} strokeWidth={1.6} />}
            onPress={() => void chooseWorkspace(null).then(() => router.replace("/workspaces"))}
          />
          <DangerButton label={t("auth.signOut")} onPress={() => void signOut().then(() => router.replace("/sign-in"))} />
        </Row>
        <Row>
          <Meta items={[t("settings.version", { v: Constants.expoConfig?.version ?? "" })]} />
        </Row>
      </Rows>
    </Screen>
  );
}
