import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useEffect } from "react";

import { SettingsButton } from "@/components/header-buttons";
import { tabIcon } from "@/components/tab-icon";
import { isTeam } from "@/config";
import { useRunning, useTimeSettings } from "@/features/team";
import { useT } from "@/i18n";
import { LiveProvider, usePolling } from "@/lib/live";
import { syncTimerReminder } from "@/lib/reminders";
import { useSession } from "@/lib/session";
import { useTheme } from "@/theme";

function ReminderSync() {
  const t = useT();
  const polling = usePolling();
  const running = useRunning(polling);
  const settings = useTimeSettings();
  const hours = settings.data?.reminder_running_hours ?? 0;
  const id = running.data?.id ?? null;
  useEffect(() => {
    void syncTimerReminder(running.data ?? null, hours, (what) => ({
      title: t("timer.reminderTitle"),
      body: t("timer.reminderBody", { what: what || t("timer.noProject"), hours }),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hours]);
  return null;
}

export default function TeamLayout() {
  const t = useT();
  const { c } = useTheme();
  const { status, workspace } = useSession();
  if (!isTeam || status !== "signedIn" || !workspace) return <Redirect href="/" />;
  return (
    <LiveProvider>
      <ReminderSync />
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
        <Tabs.Screen name="today" options={{ title: t("tabs.today"), tabBarIcon: tabIcon("timer-outline") }} />
        <Tabs.Screen name="tasks" options={{ title: t("tabs.tasks"), tabBarIcon: tabIcon("checkbox-outline") }} />
        <Tabs.Screen name="log" options={{ title: t("tabs.log"), tabBarIcon: tabIcon("add-circle-outline") }} />
        <Tabs.Screen name="timesheet" options={{ title: t("tabs.timesheet"), tabBarIcon: tabIcon("calendar-outline") }} />
        <Tabs.Screen name="notifications" options={{ title: t("tabs.inbox"), tabBarIcon: tabIcon("notifications-outline") }} />
      </Tabs>
    </LiveProvider>
  );
}
