// What an inbox item is about and how it reads. The API stores a fallback title in the workspace's
// language; the app renders its own from `kind` + `data`, so an Arabic desktop in an English
// workspace still reads Arabic.
import type { Notification, Route } from "../../../shared/types";

export type Note = Notification;

export type NoteKind = "assigned" | "mentioned" | "done" | "budget" | "timer" | "missingDay" | "request" | "other";

export function kindOf(n: Pick<Note, "kind">): NoteKind {
  switch (n.kind) {
    case "task.assigned":
      return "assigned";
    case "task.mentioned":
      return "mentioned";
    case "task.done":
      return "done";
    case "budget.threshold":
      return "budget";
    case "timer.long_running":
      return "timer";
    case "time.missing_day":
      return "missingDay";
  }
  return n.kind.startsWith("request.") ? "request" : "other";
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const KEY = /\b([A-Z][A-Z0-9]{0,9}-\d+)\b/;

/** The issue key a notification is about: data.task_key, else ?task=KEY in its URL. */
export function issueKeyOf(n: Note): string | null {
  const fromData = str(n.data?.task_key);
  if (KEY.test(fromData)) return fromData;
  const url = n.url ?? "";
  const q = /[?&]task=([^&#]+)/.exec(url)?.[1];
  if (q && KEY.test(decodeURIComponent(q))) return decodeURIComponent(q);
  return null;
}

/** Where Enter takes you: the issue, the timesheet, the project, or the web console. */
export type Target = { kind: "route"; route: Route } | { kind: "web"; path: string } | null;

export function targetOf(n: Note): Target {
  const key = issueKeyOf(n);
  if (key) return { kind: "route", route: { name: "issue", key } };
  const k = kindOf(n);
  if (k === "timer" || k === "missingDay") return { kind: "route", route: { name: "time" } };
  const project = str(n.data?.project_id);
  if (k === "budget" && project) return { kind: "route", route: { name: "project", id: project } };
  // Workspace-relative web paths (/w/{slug}/…): openWeb adds the locale and this workspace.
  const url = n.url ?? "";
  if (url.startsWith("/w/")) return { kind: "web", path: url.replace(/^\/w\/[^/]+/, "") || "/" };
  return null;
}

/** The person who caused it, as a short name: "sara" for sara@acme.com, keeping " (MCP)". */
export function actorOf(n: Note): { id: string; email: string; short: string } | null {
  const actor = str(n.data?.actor);
  if (!actor) return null;
  const mcp = actor.endsWith(" (MCP)");
  const email = mcp ? actor.slice(0, -6) : actor;
  const short = (email.includes("@") ? email.split("@")[0]! : email) + (mcp ? " (MCP)" : "");
  return { id: str(n.data?.actor_id) || email, email, short };
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The row's first line: what it is about. */
export function headline(n: Note, t: T): string {
  const k = kindOf(n);
  const task = str(n.data?.task_title);
  if ((k === "assigned" || k === "mentioned" || k === "done") && task) return task;
  if (k === "timer") return t("inbox.timer.title", { hours: Number(n.data?.hours) || 0 });
  if (k === "missingDay") return t("inbox.missingDay.title");
  const request = str(n.data?.request_title);
  if (k === "request" && request) return request;
  return n.title;
}

/**
 * The row's second line: who did what (`lead`), and for a mention the comment's words (`quote`) —
 * kept apart so a quote in another script than the UI is laid out, and truncated, in its own
 * direction.
 */
export function sublineParts(n: Note, t: T): { lead: string; quote?: string } {
  const k = kindOf(n);
  const actor = actorOf(n)?.short ?? t("inbox.someone");
  if (k === "assigned") return { lead: t("inbox.kind.assigned", { actor }) };
  if (k === "mentioned") {
    const quote = str(n.data?.excerpt) || n.body || "";
    return { lead: t("inbox.kind.mentioned", { actor }), quote: quote || undefined };
  }
  if (k === "done") return { lead: t("inbox.kind.done", { actor }) };
  if (k === "timer") return { lead: t("inbox.timer.body") };
  if (k === "missingDay") return { lead: t("inbox.missingDay.body") };
  return { lead: n.body ?? t(`inbox.kind.${k}`) };
}

export function subline(n: Note, t: T): string {
  const { lead, quote } = sublineParts(n, t);
  return quote ? `${lead}: ${quote}` : lead;
}

export type Day = "today" | "yesterday" | "earlier";

export function dayOf(iso: string, now = new Date()): Day {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= start) return "today";
  if (d.getTime() >= start - 86_400_000) return "yesterday";
  return "earlier";
}
