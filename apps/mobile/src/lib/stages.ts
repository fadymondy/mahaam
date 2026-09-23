// The six issue stages, in board order, and the tone each is drawn in — the web's STATUS_TONE
// (web/app/[locale]/w/[slug]/projects/page.tsx), so a project's track reads the same everywhere.
export const STAGES = ["backlog", "todo", "in_progress", "waiting_approval", "in_review", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_TONE: Record<Stage, string> = {
  backlog: "#6E7891",
  todo: "#3B6FD4",
  in_progress: "#8C3FB5",
  waiting_approval: "#E2661C",
  in_review: "#D08A1E",
  done: "#4E9A3E",
};

export const isStage = (s: string): s is Stage => (STAGES as readonly string[]).includes(s);

/** Issues still open: every stage but done. */
export const openCount = (issues: Record<string, number> | undefined) =>
  STAGES.filter((s) => s !== "done").reduce((n, s) => n + (issues?.[s] ?? 0), 0);
