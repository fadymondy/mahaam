import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Bell, FolderKanban, ListChecks, Timer } from "lucide-react-native";
import { useEffect } from "react";

import { useRunning, useTimeSettings } from "@/features/team";
import { GridTabBar, type GridTab } from "@/grid";
import { useT } from "@/i18n";
import { LiveProvider, usePolling } from "@/lib/live";
import { syncTimerReminder } from "@/lib/reminders";
import { isCustomer, useSession } from "@/lib/session";

// Labels are string keys: the grid's tab bar translates them.
// Projects first (the owner's flow): a project opens its board, overview and reports.
const TABS: GridTab[] = [
  { name: "projects", label: "tabs.projects", Icon: FolderKanban },
  { name: "work", label: "tabs.work", Icon: ListChecks },
  { name: "time", label: "tabs.time", Icon: Timer },
  { name: "notifications", label: "tabs.inbox", Icon: Bell },
];

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

/** Staff of the selected workspace (owner, admin, manager, member). A customer gets the portal. */
export default function StaffLayout() {
  const { status, workspace } = useSession();
  if (status !== "signedIn" || !workspace || isCustomer(workspace)) return <Redirect href="/" />;
  return (
    <LiveProvider>
      <ReminderSync />
      <Tabs screenOptions={{ headerShown: false }} tabBar={(p) => <GridTabBar {...p} tabs={TABS} />}>
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} />
        ))}
      </Tabs>
    </LiveProvider>
  );
}
