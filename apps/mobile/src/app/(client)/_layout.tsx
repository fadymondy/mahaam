import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";

import { SettingsButton } from "@/components/header-buttons";
import { tabIcon } from "@/components/tab-icon";
import { isTeam } from "@/config";
import { useT } from "@/i18n";
import { LiveProvider } from "@/lib/live";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";

export default function ClientLayout() {
  const t = useT();
  const { c } = useTheme();
  const { status, workspace } = useSession();
  if (isTeam || status !== "signedIn" || !workspace) return <Redirect href="/" />;
  return (
    <LiveProvider>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: c.card },
          headerTintColor: c.fg,
          headerRight: () => <SettingsButton />,
          tabBarStyle: { backgroundColor: c.card, borderTopColor: c.line },
          tabBarActiveTintColor: c.brand,
          tabBarInactiveTintColor: c.muted,
          sceneStyle: { backgroundColor: c.bg },
        }}
      >
        <Tabs.Screen name="projects" options={{ title: t("tabs.projects"), tabBarIcon: tabIcon("folder-open-outline") }} />
        <Tabs.Screen name="invoices" options={{ title: t("tabs.invoices"), tabBarIcon: tabIcon("receipt-outline") }} />
        <Tabs.Screen name="updates" options={{ title: t("tabs.inbox"), tabBarIcon: tabIcon("notifications-outline") }} />
      </Tabs>
    </LiveProvider>
  );
}
