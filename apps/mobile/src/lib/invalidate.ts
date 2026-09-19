import type { SseEvent } from "@/api/sse";

/** Which query families a realtime event invalidates. */
export function invalidationsFor(e: SseEvent): string[] {
  if (e.event.startsWith("timer.")) return ["running", "entries", "timesheet"];
  if (e.event === "entry.changed") return ["entries", "timesheet"];
  if (e.event.startsWith("notification.")) return ["inbox"];
  if (e.event.startsWith("task.")) return ["tasks", "task"];
  return [];
}
