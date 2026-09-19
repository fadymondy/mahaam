// Local reminder when a timer runs longer than the workspace's `reminder_running_hours` (the same
// threshold the server's in-app reminder uses). Scheduled on the device for started_at + N hours and
// cancelled when the timer stops, so it fires even if the app is closed. No push server needed.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { TimeEntry } from "@/api/types";

const ID = "mahaam-timer-reminder";
let permission: boolean | null = null;

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

async function allowed(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (permission !== null) return permission;
  const cur = await Notifications.getPermissionsAsync();
  permission = cur.granted || (cur.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  return permission;
}

/** When the reminder for `entry` should fire (ms), or null if it is already past. */
export function reminderAt(entry: Pick<TimeEntry, "started_at">, hours: number, now = Date.now()): number | null {
  if (!hours || hours <= 0) return null;
  const at = Date.parse(entry.started_at) + hours * 3600_000;
  return at > now ? at : null;
}

export async function syncTimerReminder(
  running: TimeEntry | null,
  hours: number,
  text: (what: string) => { title: string; body: string },
): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(ID);
    if (!running) return;
    const at = reminderAt(running, hours);
    if (at === null || !(await allowed())) return;
    const what = running.task_title ?? running.description ?? running.project_name ?? "";
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: { ...text(what), data: { entry: running.id } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
    });
  } catch {
    // Reminders are best effort (e.g. Expo Go without notification support).
  }
}
