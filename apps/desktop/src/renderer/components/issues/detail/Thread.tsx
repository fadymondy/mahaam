// Comments and the issue's history on one timeline (oldest first, like reading a conversation),
// then the composer: markdown, ⌘↵ sends. A comment shows at once and is taken back if it fails.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BotIcon, Trash2Icon } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Activity, Comment, Member } from "../../../../shared/types";
import { Avatar, Kbd, LtrText, Spinner } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useUserId } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { cn } from "@/lib/utils";

import { SectionTitle } from "../controls";
import { Markdown } from "../Markdown";

/** More than this many entries: the first, "N more", and the latest. */
const FOLD = 12;
const FIELDS = ["title", "description", "priority", "due_at", "estimate_minutes", "parent_id", "status"];
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

type Entry = { kind: "comment"; at: string; comment: Comment } | { kind: "activity"; at: string; activity: Activity };

export function Thread({ taskKey, memberMap, readOnly }: { taskKey: string; memberMap: Map<string, Member>; readOnly?: boolean }) {
  const { t, locale, number } = useI18n();
  const { ws } = useApp();
  const comments = useQuery({ queryKey: qk.comments(ws, taskKey), queryFn: () => api.comments(taskKey), enabled: !!ws });
  const activity = useQuery({ queryKey: qk.taskActivity(ws, taskKey), queryFn: () => api.taskActivity(taskKey), enabled: !!ws });

  const [all, setAll] = useState(false);
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [
      ...(comments.data ?? []).map((c) => ({ kind: "comment" as const, at: c.created_at, comment: c })),
      // A comment is its own entry; its "commented" line would say it twice.
      ...(activity.data ?? []).filter((a) => a.action !== "comment.added").map((a) => ({ kind: "activity" as const, at: a.created_at, activity: a })),
    ];
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [comments.data, activity.data]);

  // A long history folds: the first entry, "N more", then the latest.
  const folded = !all && entries.length > FOLD;
  const shown = folded ? [entries[0]!, ...entries.slice(-(FOLD - 2))] : entries;
  const hidden = folded ? entries.length - shown.length : 0;

  const sentence = (a: Activity) => {
    const c = a.changes ?? {};
    const vars: Record<string, string> = { from: str(c.from), to: str(c.to), status: str(c.status), item: str(c.item), file: str(c.file) };
    if (a.action === "task.updated") {
      const fields = FIELDS.filter((f) => f in c).map((f) => t(`issue.field.${f}`));
      if (!fields.length) return null;
      vars.fields = fields.join(locale === "ar" ? "، " : ", ");
    }
    const k = `issue.act.${a.action}`;
    const text = t(k, vars);
    return text === k ? null : text;
  };

  return (
    <section className="flex flex-col" aria-label={t("issue.activity")} data-thread>
      <SectionTitle>{t("issue.activity")}</SectionTitle>
      {comments.isPending || activity.isPending ? (
        <div className="flex h-16 items-center">
          <Spinner />
        </div>
      ) : (
        <ol className="relative mt-1 flex flex-col">
          {shown.map((e, i) => (
            <Fragment key={e.kind === "comment" ? e.comment.id : e.activity.id}>
              {i === 1 && hidden ? (
                <li className="flex min-h-7 items-center gap-2.5 py-0.5">
                  <span className="flex w-6 shrink-0 justify-center text-grid-muted">⋯</span>
                  <button type="button" onClick={() => setAll(true)} className="rounded px-1 text-[13px] text-grid-muted hover:bg-grid-soft hover:text-grid-fg" data-thread-more>
                    {t("issue.showMore", { n: number(hidden) })}
                  </button>
                </li>
              ) : null}
              {e.kind === "comment" ? (
                <CommentItem comment={e.comment} memberMap={memberMap} taskKey={taskKey} />
              ) : (
                <ActivityLine activity={e.activity} memberMap={memberMap} sentence={sentence(e.activity)} />
              )}
            </Fragment>
          ))}
        </ol>
      )}
      {readOnly ? null : <Composer taskKey={taskKey} />}
    </section>
  );
}

const who = (id: string, members: Map<string, Member>) => members.get(id)?.email ?? "—";

function ActivityLine({ activity: a, memberMap, sentence }: { activity: Activity; memberMap: Map<string, Member>; sentence: string | null }) {
  const { relative, date } = useI18n();
  if (!sentence) return null;
  const email = who(a.actor_id, memberMap);
  return (
    <li className="flex min-h-7 items-center gap-2.5 py-0.5 text-[13px] text-grid-muted" data-activity={a.action}>
      <span className="flex w-6 shrink-0 justify-center">
        <Avatar id={a.actor_id} email={email} size={16} />
      </span>
      <p className="min-w-0 flex-1 truncate">
        <LtrText className="text-grid-body">{email.split("@")[0]}</LtrText> {sentence}
        {a.via === "mcp" ? <BotIcon className="ms-1 inline size-3 align-[-2px]" /> : null}
        <span className="mx-1.5">·</span>
        <time dateTime={a.created_at} title={date(a.created_at, { dateStyle: "medium", timeStyle: "short" })}>
          {relative(a.created_at)}
        </time>
      </p>
    </li>
  );
}

function CommentItem({ comment: c, memberMap, taskKey }: { comment: Comment; memberMap: Map<string, Member>; taskKey: string }) {
  const { t, relative, date } = useI18n();
  const { ws } = useApp();
  const me = useUserId();
  const qc = useQueryClient();
  const email = who(c.author_id, memberMap);
  const pending = c.id.startsWith("pending-");
  const remove = async () => {
    const key = qk.comments(ws, taskKey);
    const before = qc.getQueryData<Comment[]>(key);
    qc.setQueryData<Comment[]>(key, (l) => (l ?? []).filter((x) => x.id !== c.id));
    try {
      await api.deleteComment(c.id);
    } catch (e) {
      if (before) qc.setQueryData(key, before);
      toast.error(e instanceof Error && e.message ? e.message : t("common.error"));
    } finally {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
  return (
    <li className={cn("group my-1.5 flex gap-2.5 rounded-lg border border-line bg-grid-card/60 px-3 py-2.5", pending && "opacity-60")} data-comment={c.id}>
      <Avatar id={c.author_id} email={email} size={22} className="mt-px" />
      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center gap-2 text-[13px]">
          <LtrText className="truncate font-medium text-grid-fg">{email}</LtrText>
          {c.author_kind === "agent" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 text-[11.5px] text-grid-muted">
              <BotIcon className="size-3" />
              {t("issue.agent")}
            </span>
          ) : null}
          <time className="text-grid-muted" dateTime={c.created_at} title={date(c.created_at, { dateStyle: "medium", timeStyle: "short" })}>
            {pending ? t("issue.sending") : relative(c.created_at)}
          </time>
          {c.edited_at ? <span className="text-grid-muted">· {t("issue.edited")}</span> : null}
          <span className="flex-1" />
          {c.author_id === me && !pending ? (
            <button
              type="button"
              onClick={() => void remove()}
              title={t("common.delete")}
              aria-label={t("common.delete")}
              className="flex size-5 items-center justify-center rounded text-grid-muted opacity-0 group-hover:opacity-100 hover:bg-grid-soft hover:text-grid-fg"
            >
              <Trash2Icon className="size-3" />
            </button>
          ) : null}
        </div>
        <Markdown source={c.body} className="mt-1" />
      </div>
    </li>
  );
}

function Composer({ taskKey }: { taskKey: string }) {
  const { t } = useI18n();
  const { ws, session } = useApp();
  const me = useUserId();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    const key = qk.comments(ws, taskKey);
    const temp: Comment = { id: `pending-${Date.now()}`, author_id: me, author_kind: "user", body: text, created_at: new Date().toISOString(), edited_at: null, mentions: null, task_id: "" };
    qc.setQueryData<Comment[]>(key, (l) => [...(l ?? []), temp]);
    setBody("");
    setBusy(true);
    try {
      const saved = await api.comment(taskKey, text);
      qc.setQueryData<Comment[]>(key, (l) => (l ?? []).map((x) => (x.id === temp.id ? saved : x)));
    } catch (e) {
      qc.setQueryData<Comment[]>(key, (l) => (l ?? []).filter((x) => x.id !== temp.id));
      setBody(text);
      toast.error(e instanceof Error && e.message ? e.message : t("common.error"));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: qk.task(ws, taskKey) });
    }
  };

  return (
    <div
      className="mt-3 flex flex-col rounded-lg border border-line bg-grid-card transition-colors focus-within:border-[color-mix(in_oklab,var(--grid-action)_45%,var(--grid-line))]"
      onClick={() => ref.current?.focus()}
      data-composer
    >
      <textarea
        ref={ref}
        dir="auto"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
        placeholder={t("issue.commentPlaceholder")}
        aria-label={t("issue.commentPlaceholder")}
        className="min-h-[68px] w-full resize-none bg-transparent px-3 pt-2.5 text-[14px] leading-relaxed text-grid-fg outline-none placeholder:text-grid-muted"
      />
      <div className="flex items-center justify-end gap-2 px-2 pb-2">
        <span className="me-auto ps-1 text-[12px] text-grid-muted" dir="ltr">
          {session?.email}
        </span>
        <Button size="sm" onClick={() => void send()} disabled={!body.trim() || busy} data-comment-send>
          {t("issue.send")}
          <Kbd combo="mod+enter" className="border-primary-foreground/30 bg-transparent text-primary-foreground/80" />
        </Button>
      </div>
    </div>
  );
}
