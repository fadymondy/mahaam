"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ClockIcon, SendIcon, UserRoundIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { NotFoundState } from "@/components/not-found-state";
import { ErrorState, LoadingRows } from "@/components/states";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { ContextPanel } from "@/components/work/issues/issue-detail";
import { ApiError } from "@/lib/api";
import { useTranslations } from "@/lib/i18n";
import { useDocumentTitle } from "@/lib/title";
import { cn } from "@/lib/utils";
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  errorText,
  issuesApi,
  useIssue,
  useIssues,
  type IssuePatch,
} from "@/lib/work";
import { IssueAgentSettings } from "./issue-agent-settings";
import { MentionTextarea } from "./mention-textarea"
import { CardExtras, CardPlanning } from "@/components/work/task-sheet";
import { useCommentAuthor, useCommentForm } from "./issue-comments";
import { IssueToolbar } from "./issue-toolbar";
import { formatAgentTime, useIssueHref } from "./shared";

/**
 * Issue detail laid out like a blog post — back link, title, meta row, body —
 * with the editable fields and the comment thread beneath.
 */
export function IssueDetailView({
  issueKey,
  projectId,
  back,
}: {
  issueKey: string;
  projectId?: string;
  back: string;
}) {
  const { t, locale } = useTranslations();
  const ws = useWorkspace();
  const href = useIssueHref();
  const canWrite = ws.can("feedback:write");
  const issue = useIssue(ws.id, issueKey);
  const list = useIssues(ws.id, projectId ? { project: projectId } : {});
  const author = useCommentAuthor();
  const report = issue.data;
  useDocumentTitle(
    `${report ? `${report.key} · ${report.title}` : t("issues.title")} · ${ws.summary.name}`,
  );

  // Prev/next follow the board's own order: column by column, then rank.
  const neighbours = useMemo(() => {
    const rows = [...(list.data?.issues ?? [])].sort(
      (a, b) =>
        ISSUE_STATUSES.indexOf(a.status) - ISSUE_STATUSES.indexOf(b.status) ||
        a.sort_order - b.sort_order,
    );
    const i = rows.findIndex((r) => r.key === issueKey);
    if (i === -1) return { prev: null as string | null, next: null as string | null };
    return {
      prev: i > 0 ? href(rows[i - 1]) : null,
      next: i < rows.length - 1 ? href(rows[i + 1]) : null,
    };
  }, [list.data, issueKey, href]);

  const reload = async () => {
    await issue.mutate();
    await list.mutate();
  };
  const form = useCommentForm(report?.key, () => issue.mutate());

  if (issue.error) {
    return issue.error instanceof ApiError && issue.error.status === 404 ? (
      <NotFoundState
        title={t("issues.notFound")}
        body={t("issues.notFoundBody")}
        backHref={back}
        backLabel={t("issues.detail.back")}
      />
    ) : (
      <ErrorState error={issue.error} />
    );
  }
  if (!report) return <LoadingRows rows={5} />;

  async function patch(fields: IssuePatch) {
    if (!report) return;
    try {
      const next = await issuesApi.patch(ws.id, report.key, fields);
      await issue.mutate(next, { revalidate: false });
      void list.mutate();
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")));
    }
  }

  const agentTime = formatAgentTime(report.agent_seconds);
  const busy = Boolean(report.started_at && !report.finished_at);
  const comments = report.comments ?? [];
  const dateTag = locale === "ar" ? "ar-EG" : "en-US";

  const fields: {
    key: "status" | "issue_type" | "priority";
    label: string;
    value: string;
    options: readonly string[];
    labels: Record<string, string>;
  }[] = [
    {
      key: "status",
      label: t("issues.statusLabel"),
      value: report.status,
      options: ISSUE_STATUSES,
      labels: Object.fromEntries(ISSUE_STATUSES.map((s) => [s, t(`issues.status.${s}`)])),
    },
    {
      key: "issue_type",
      label: t("issues.typeLabel"),
      value: report.issue_type,
      options: ISSUE_TYPES,
      labels: Object.fromEntries(ISSUE_TYPES.map((x) => [x, t(`issues.type.${x}`)])),
    },
    {
      key: "priority",
      label: t("issues.priorityLabel"),
      value: report.priority,
      options: ISSUE_PRIORITIES,
      labels: Object.fromEntries(ISSUE_PRIORITIES.map((p) => [p, t(`issues.priority.${p}`)])),
    },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
        <Link
          className="flex items-center gap-1.5 px-1 font-mono text-sm text-grid-muted transition-colors hover:text-grid-fg"
          href={back}
        >
          <ArrowLeftIcon className="size-4 rtl:-scale-x-100" />
          {t("issues.detail.back")}
        </Link>

        <IssueToolbar
          issue={report}
          prevHref={neighbours.prev}
          nextHref={neighbours.next}
          onChanged={reload}
        />
      </div>

      <header className="border-b border-line px-4 py-8">
        <h1 dir="auto" className="text-3xl font-medium tracking-tight text-balance">
          {report.title}
        </h1>

        <dl className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm text-grid-muted">
          <dt className="sr-only">Key</dt>
          <dd dir="ltr">{report.key}</dd>

          <span aria-hidden className="text-grid-muted/50">
            ·
          </span>
          <dt className="sr-only">Created</dt>
          <dd>
            <time dateTime={report.created_at}>
              {new Date(report.created_at).toLocaleDateString(dateTag, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          </dd>

          {report.human_only ? (
            <>
              <span aria-hidden className="text-grid-muted/50">
                ·
              </span>
              <dd className="flex items-center gap-1">
                <UserRoundIcon className="size-3.5" />
                {t("issues.humanOnly")}
              </dd>
            </>
          ) : null}

          {agentTime ? (
            <>
              <span aria-hidden className="text-grid-muted/50">
                ·
              </span>
              <dd className={cn("flex items-center gap-1", busy && "text-grid-action")}>
                <ClockIcon className="size-3.5" />
                <span dir="ltr">{agentTime}</span>
              </dd>
            </>
          ) : null}
        </dl>
      </header>

      {/* Two columns, like the sheet: the item's content, and a side menu with every field. */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:border-e border-line">
          {report.body ? (
            <div className="border-b border-line px-4 py-8">
              <p dir="auto" className="max-w-[70ch] whitespace-pre-wrap text-grid-body">
                {report.body}
              </p>
            </div>
          ) : null}

          <ContextPanel issue={report} />

          <div className="border-b border-line px-4 pb-4">
            <CardExtras taskKey={report.key} />
          </div>

          <section id="comments">
            <h2 className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3 font-mono text-[11px] tracking-wider text-grid-muted uppercase">
              {t("issues.comments")}
              <span dir="ltr" className="tabular-nums">
                {comments.length}
              </span>
            </h2>

            {comments.length > 0 ? (
              <ul>
                {comments.map((comment) => (
                  <li key={comment.id} className="border-b border-line p-4">
                    <p className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-grid-muted">
                      <span dir="ltr">{author(comment)}</span>
                      <span aria-hidden className="text-grid-muted/50">
                        ·
                      </span>
                      <time dateTime={comment.created_at}>
                        {new Date(comment.created_at).toLocaleString(dateTag)}
                      </time>
                    </p>
                    <p dir="auto" className="mt-2 text-sm whitespace-pre-wrap text-grid-body">
                      {comment.body}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-b border-line px-4 py-6 text-sm text-grid-muted">
                {t("issues.noComments")}
              </p>
            )}

            {form.canWrite ? (
              <form onSubmit={form.submit} className="flex flex-col gap-3 p-4">
                <MentionTextarea
                  value={form.value}
                  onChange={form.setValue}
                  projectId={report.project_id}
                  onChoose={(kind, name) => void patch(kind === "agent" ? { agent: name } : { skill: name })}
                  disabled={form.posting}
                  placeholder={t("issues.commentPlaceholder")}
                />
                <p className="text-xs text-grid-muted">{t("issues.mentionHint")}</p>

                {form.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {form.error}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  size="sm"
                  className="gap-2 self-start"
                  disabled={form.posting || !form.value.trim()}
                >
                  <SendIcon className="rtl:-scale-x-100" />
                  {form.posting ? t("issues.comments.posting") : t("issues.postComment")}
                </Button>
              </form>
            ) : null}
          </section>
        </div>

        <aside className="min-w-0 max-lg:border-t border-line lg:sticky lg:top-14 lg:max-h-[calc(100vh-3.5rem)] lg:self-start lg:overflow-y-auto">
          {/* Editable fields — each writes straight through, no save button. */}
          <dl className="flex flex-col border-b border-line">
            {fields.map((field, i) => (
              <div
                key={field.key}
                className={cn(
                  "flex flex-col gap-2 p-4",
                  i < fields.length - 1 && "border-b",
                  "border-line",
                )}
              >
                <dt className="font-mono text-[11px] tracking-wider text-grid-muted uppercase">
                  {field.label}
                </dt>
                <dd>
                  <Select
                    value={field.value}
                    disabled={!canWrite}
                    onValueChange={(v) =>
                      v && v !== field.value && void patch({ [field.key]: v } as IssuePatch)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{(v) => field.labels[String(v)] ?? String(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {field.labels[option] ?? option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </dd>
              </div>
            ))}
          </dl>

          <section className="border-b border-line p-4 [&>div]:border-t-0 [&>div]:pt-0 ">
            <CardPlanning taskKey={report.key} />
          </section>

          <section className="border-b border-line p-4">
            <h2 className="mb-4 font-mono text-[11px] tracking-wider text-grid-muted uppercase">
              {t("issues.agent.title")}
            </h2>
            <IssueAgentSettings issue={report} onPatch={patch} disabled={!canWrite} />
          </section>
        </aside>
      </div>
    </>
  );
}
