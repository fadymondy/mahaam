// The inbox's right pane: the issue a notification is about — key, title, status, priority,
// project, assignees and the description — with what happened on top, and "Open issue" (Enter).
// A notification that isn't about an issue shows its own text and where it leads.
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, CalendarIcon, CheckSquareIcon, ChevronRightIcon, CornerDownLeftIcon, MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { TaskDetail } from "../../../shared/types";
import { Avatar, ErrorState, LtrText, PriorityIcon, ProjectMark, StatusIcon, Kbd } from "@/components/kit";
import { useApp } from "@/lib/app";
import { api, ApiError } from "@/lib/bridge";
import { useMemberMap } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";

import { useShortAge } from "./InboxList";
import { actorOf, headline, issueKeyOf, kindOf, subline, targetOf, type Note } from "./model";
import { KindIcon, NoteGlyph } from "./NoteGlyph";
import { PaneHeader } from "./PaneHeader";
import { Prose } from "./Prose";

export function InboxPreview({ note, onOpen }: { note: Note; onOpen: (n: Note) => void }) {
  const key = issueKeyOf(note);
  return key ? <IssuePreview note={note} issueKey={key} onOpen={onOpen} /> : <NotePreview note={note} onOpen={onOpen} />;
}

function OpenButton({ label, onClick, external }: { label: string; onClick: () => void; external?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-open-issue
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-grid-action ps-2.5 pe-1.5 text-[13.5px] font-medium text-grid-on-action hover:opacity-90"
    >
      {label}
      {external ? (
        <ArrowUpRightIcon className="size-3.5 rtl:-scale-x-100" />
      ) : (
        <span className="flex h-[18px] items-center rounded-[4px] bg-black/15 px-1">
          <CornerDownLeftIcon className="size-3 rtl:-scale-x-100" />
        </span>
      )}
    </button>
  );
}

/** What happened, above the issue: "sara mentioned you · 2h" and the comment's words. */
function Context({ note }: { note: Note }) {
  const { t } = useI18n();
  const age = useShortAge();
  const actor = actorOf(note);
  const k = kindOf(note);
  const excerpt = k === "mentioned" ? (typeof note.data?.excerpt === "string" ? note.data.excerpt : note.body) : null;
  const line = k === "mentioned" ? t("inbox.kind.mentioned", { actor: actor?.short ?? t("inbox.someone") }) : subline(note, t);
  return (
    <div className="mb-6 flex gap-3 rounded-lg border border-line bg-grid-card px-3.5 py-3 [--row:var(--grid-card)]" data-note-context>
      <NoteGlyph note={note} size={22} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[13.5px] text-grid-body">
          <span className="min-w-0 truncate">{line}</span>
          <span className="text-grid-muted">·</span>
          <span className="shrink-0 text-grid-muted">{age(note.created_at)}</span>
        </p>
        {excerpt ? <p dir="auto" className="selectable mt-1 text-[14px] leading-relaxed text-grid-fg rtl:text-right">{excerpt}</p> : null}
        {actor ? (
          <p className="mt-1 text-[12.5px] text-grid-muted">
            <LtrText>{actor.email}</LtrText>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-6 max-w-60 items-center gap-1.5 rounded-md border border-line bg-background px-2 text-[13px] text-grid-body">
      {children}
    </span>
  );
}

function IssuePreview({ note, issueKey, onOpen }: { note: Note; issueKey: string; onOpen: (n: Note) => void }) {
  const { ws } = useApp();
  const { t, relative, date } = useI18n();
  const members = useMemberMap();
  const q = useQuery({ queryKey: qk.task(ws, issueKey), queryFn: () => api.task(issueKey), enabled: !!ws });
  const task = q.data as TaskDetail | undefined;
  const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={issueKey} data-inbox-preview={issueKey}>
      <PaneHeader>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px] text-grid-muted">
          {task ? (
            <>
              <ProjectMark name={task.project.name} color={task.project.color} />
              <span className="truncate">{task.project.name}</span>
              <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 rtl:-scale-x-100" />
            </>
          ) : null}
          <LtrText className="font-mono text-[13px] text-grid-fg">{issueKey}</LtrText>
        </div>
        {gone ? null : <OpenButton label={t("inbox.openIssue")} onClick={() => onOpen(note)} />}
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 pt-6 pb-12">
          <Context note={note} />
          {q.isPending ? (
            <div className="flex flex-col gap-3" aria-busy>
              <span className="h-5 w-2/3 rounded bg-grid-soft" />
              <span className="h-4 w-1/3 rounded bg-grid-soft" />
              <span className="mt-4 h-3 w-full rounded bg-grid-soft" />
              <span className="h-3 w-5/6 rounded bg-grid-soft" />
            </div>
          ) : gone ? (
            <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
              <p className="text-[14px] font-medium text-grid-fg">{headline(note, t)}</p>
              <p className="mt-1 text-[13.5px] text-grid-muted">{t("inbox.issueGone")}</p>
              {note.body ? <p className="selectable mt-3 text-[14px] text-grid-body">{note.body}</p> : null}
            </div>
          ) : q.error || !task ? (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          ) : (
            <>
              <h2 dir="auto" className="selectable text-[20px] leading-snug font-semibold text-grid-fg rtl:text-right" data-issue-title>
                {task.title}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Chip title={t("issue.status")}>
                  <StatusIcon status={task.status} />
                  <span className="truncate">{task.status.name}</span>
                </Chip>
                <Chip title={t("issue.priority")}>
                  <PriorityIcon priority={task.priority} />
                  <span>{t(`priority.${task.priority}`)}</span>
                </Chip>
                <Chip title={t("issue.assignees")}>
                  {(task.assignee_ids ?? []).length ? (
                    <>
                      <span className="flex -space-x-1 rtl:space-x-reverse">
                        {(task.assignee_ids ?? []).slice(0, 3).map((id) => (
                          <Avatar key={id} id={id} email={members.get(id)?.email ?? "?"} size={16} />
                        ))}
                      </span>
                      <LtrText className="truncate">
                        {(task.assignee_ids ?? [])
                          .map((id) => (members.get(id)?.email ?? "").split("@")[0])
                          .filter(Boolean)
                          .join(", ")}
                      </LtrText>
                    </>
                  ) : (
                    <span className="text-grid-muted">{t("issue.unassigned")}</span>
                  )}
                </Chip>
                {task.due_at ? (
                  <Chip>
                    <CalendarIcon className="size-3.5 text-grid-muted" />
                    {t("inbox.due", { date: date(task.due_at) })}
                  </Chip>
                ) : null}
              </div>

              <div className="mt-6 border-t border-line pt-5">
                {task.description?.trim() ? (
                  <Prose source={task.description} />
                ) : (
                  <p className="text-[14px] text-grid-muted italic">{t("inbox.noDescription")}</p>
                )}
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[12.5px] text-grid-muted">
                <span>{t("inbox.created", { when: relative(task.created_at) })}</span>
                <span>{t("inbox.updated", { when: relative(task.updated_at) })}</span>
                {task.comment_count ? (
                  <span className="inline-flex items-center gap-1">
                    <MessageSquareIcon className="size-3" />
                    {t("inbox.comments", { count: task.comment_count })}
                  </span>
                ) : null}
                {task.checklist_total ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckSquareIcon className="size-3" />
                    {t("inbox.checklist", { done: task.checklist_done, total: task.checklist_total })}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
      <KeyHints />
    </section>
  );
}

function NotePreview({ note, onOpen }: { note: Note; onOpen: (n: Note) => void }) {
  const { t, date } = useI18n();
  const target = targetOf(note);
  const k = kindOf(note);
  const label =
    target?.kind === "web"
      ? t("inbox.openWeb")
      : target?.route.name === "time"
        ? t("inbox.openTimesheet")
        : target?.route.name === "project"
          ? t("inbox.openProject")
          : t("inbox.openIssue");
  return (
    <section className="flex min-w-0 flex-1 flex-col" data-inbox-preview="note">
      <PaneHeader>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px] text-grid-muted">
          <KindIcon note={note} />
          <span className="truncate">{t(`inbox.kind.${k === "assigned" || k === "mentioned" || k === "done" ? "other" : k}`)}</span>
        </div>
        {target ? <OpenButton label={label} onClick={() => onOpen(note)} external={target.kind === "web"} /> : null}
      </PaneHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 pt-10 pb-12">
          <NoteGlyph note={note} size={36} />
          <h2 dir="auto" className="selectable mt-4 text-[20px] leading-snug font-semibold text-grid-fg rtl:text-right">{headline(note, t)}</h2>
          <p className="mt-1 text-[13px] text-grid-muted">{date(note.created_at, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</p>
          <p className="selectable mt-5 text-[14.5px] leading-relaxed text-grid-body">{subline(note, t)}</p>
        </div>
      </div>
      <KeyHints />
    </section>
  );
}

/** The pane's footer: the keys that work here. */
function KeyHints() {
  const { t } = useI18n();
  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-line px-4 text-[12.5px] text-grid-muted">
      <span className="flex items-center gap-1.5">
        <Kbd combo="j" />
        <Kbd combo="k" />
        {t("inbox.hintMove")}
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd combo="enter" />
        {t("inbox.hintOpen")}
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd combo="e" />
        {t("inbox.hintRead")}
      </span>
    </footer>
  );
}

export { KeyHints };
