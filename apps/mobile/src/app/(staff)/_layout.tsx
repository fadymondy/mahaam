import { Redirect } from "expo-router";
import { Bell, FolderKanban, ListChecks, Search, Timer } from "lucide-react-native";
import { useEffect } from "react";

import { useRunning, useTimeSettings } from "@/features/team";
import { ShellTabs, type ShellTab } from "@/components/shell-tabs";
import { useT } from "@/i18n";
import { LiveProvider, usePolling } from "@/lib/live";
import { syncTimerReminder } from "@/lib/reminders";
import { isCustomer, useSession } from "@/lib/session";

// Projects first (the owner's flow); Search is the system search tab on iOS 26+.
const TABS: ShellTab[] = [
  { name: "(projects)", label: "tabs.projects", Icon: FolderKanban, sf: { default: "folder", selected: "folder.fill" } },
  { name: "(work)", label: "tabs.work", Icon: ListChecks, sf: { default: "checklist", selected: "checklist" } },
  { name: "(time)", label: "tabs.time", Icon: Timer, sf: { default: "timer", selected: "timer" } },
  { name: "(inbox)", label: "tabs.inbox", Icon: Bell, sf: { default: "bell", selected: "bell.fill" } },
  { name: "(search)", label: "common.search", Icon: Search, sf: { default: "magnifyingglass", selected: "magnifyingglass" }, search: true },
];

export const unstable_settings = { initialRouteName: "(projects)" };

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
      <ShellTabs tabs={TABS} />
    </LiveProvider>
  );
}
