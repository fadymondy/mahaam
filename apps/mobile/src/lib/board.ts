// "My work" ordering: tasks in board order (status column, then position), grouped by category so
// the list reads like the board — doing first, then to do, then done.
import type { Issue, Status, Task } from "@/api/types";

const CATEGORY_ORDER: Record<string, number> = { doing: 0, todo: 1, done: 2 };
const PRIORITY: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export interface BoardSection<T> {
  category: "doing" | "todo" | "done";
  items: T[];
}

export function boardOrder(tasks: Task[], statuses: Map<string, Status>): BoardSection<Task>[] {
  const sections: Record<string, Task[]> = { doing: [], todo: [], done: [] };
  for (const t of tasks) {
    const st = statuses.get(t.status_id);
    const cat = st?.category ?? (t.completed_at ? "done" : "todo");
    sections[cat].push(t);
  }
  const col = (t: Task) => statuses.get(t.status_id)?.position ?? 0;
  for (const k of Object.keys(sections))
    sections[k].sort((a, b) => col(a) - col(b) || a.position - b.position || a.key.localeCompare(b.key));
  return (["doing", "todo", "done"] as ("doing" | "todo" | "done")[])
    .sort((a, b) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b])
    .map((category) => ({ category, items: sections[category] }))
    .filter((s) => s.items.length);
}

/** Open issues by the issue board's manual order, then priority. */
export function issueOrder(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) => a.sort_order - b.sort_order || (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9) || a.key.localeCompare(b.key),
  );
}
