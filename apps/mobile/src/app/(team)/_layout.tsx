import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Bell, CalendarDays, ListChecks, PlusCircle, Timer } from "lucide-react-native";
import { useEffect } from "react";

import { isTeam } from "@/config";
import { useRunning, useTimeSettings } from "@/features/team";
import { GridTabBar, type GridTab } from "@/grid";
import { useT } from "@/i18n";
import { LiveProvider, usePolling } from "@/lib/live";
import { syncTimerReminder } from "@/lib/reminders";
import { useSession } from "@/lib/session";

// Labels are string keys: the grid's tab bar translates them.
const TABS: GridTab[] = [
  { name: "today", label: "tabs.today", Icon: Timer },
  { name: "tasks", label: "tabs.tasks", Icon: ListChecks },
  { name: "log", label: "tabs.log", Icon: PlusCircle },
  { name: "timesheet", label: "tabs.timesheet", Icon: CalendarDays },
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

export default function TeamLayout() {
  const { status, workspace } = useSession();
  if (!isTeam || status !== "signedIn" || !workspace) return <Redirect href="/" />;
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
