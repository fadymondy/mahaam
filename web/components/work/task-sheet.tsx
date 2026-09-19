"use client";

// The task side-over: everything about one task (?task=MH-12 on any project tab). Every field
// saves on its own; the board and lists revalidate through onChanged.
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  BotIcon,
  CheckCircle2Icon,
  CircleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { IssueSourceChip } from "@/components/work/issues/issue-bits";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/confirm-button";
import { Ltr } from "@/components/copy-field";
import { ErrorState } from "@/components/states";
import { AttachmentDropzone } from "@/components/shadcn-space/file-upload/file-upload-02";
import { ActivityFeed } from "@/components/work/activity-feed";
import { StartTimerButton } from "@/components/time/start-timer-button";
import {
  DateField,
  LabelPicker,
  MemberPicker,
  PrioritySelect,
  StatusSelect,
} from "@/components/work/fields";
import { PersonAvatar, useDirectory, type Directory } from "@/components/work/people";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { dayKey, fileSize, isOverdue, timeAgo } from "@/lib/format";
import { useTranslations } from "@/lib/i18n";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  errorText,
  useAttachments,
  useComments,
  useLabels,
  useTask,
  useTaskActivity,
  w,
  type Attachment,
  type Comment,
  type Label,
  type Priority,
  type Status,
  type TaskDetail,
} from "@/lib/work";

export function TaskSheet({
  taskKey,
  statuses,
  onClose,
  onOpen,
  onChanged,
}: {
  taskKey: string | null;
  statuses: Status[];
  onClose: () => void;
  onOpen: (key: string) => void;
  onChanged: () => void;
}) {
  const { t, isRtl } = useTranslations();
  const ws = useWorkspace();
  const task = useTask(ws.id, taskKey);
  const d = task.data;

  return (
    <Sheet open={!!taskKey} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={isRtl ? "left" : "right"}
        className="w-full gap-0 overflow-y-auto p-0 data-[side=left]:sm:max-w-2xl data-[side=right]:sm:max-w-2xl"
        data-task-sheet={taskKey ?? ""}
      >
        {task.error ? (
          <div className="p-6">
            <SheetHeader className="p-0">
              <SheetTitle>{t("task.notFound")}</SheetTitle>
              <SheetDescription>{t("task.notFoundBody")}</SheetDescription>
            </SheetHeader>
            <ErrorState error={task.error} />
          </div>
        ) : !d ? (
          <div className="space-y-4 p-6">
            <SheetHeader className="p-0">
              <SheetTitle>
                <Skeleton className="h-6 w-64" />
              </SheetTitle>
              <SheetDescription className="sr-only">{t("common.loading")}</SheetDescription>
            </SheetHeader>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <TaskBody
            key={d.id}
            d={d}
            statuses={statuses}
            onOpen={onOpen}
            onChanged={() => {
              void task.mutate();
              onChanged();
            }}
            onDeleted={() => {
              onClose();
              onChanged();
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-3 px-6 py-1.5">
      <label htmlFor={htmlFor} className="text-xs text-grid-muted">
        {label}
      </label>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
  action,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border-t border-line">
      <div className="flex items-center gap-2 px-6 pt-4 pb-2">
        <h3 className="text-sm font-medium text-grid-fg">{title}</h3>
        {count != null ? <span className="text-xs text-grid-muted">{count}</span> : null}
        <span className="ms-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

export function TaskBody({
  d,
  statuses,
  onOpen,
  onChanged,
  onDeleted,
  chrome = "sheet",
}: {
  d: TaskDetail;
  statuses: Status[];
  onOpen: (key: string) => void;
  onChanged: () => void;
  onDeleted: () => void;
  /** "sheet" renders the accessible dialog header; "page" renders a plain heading. */
  chrome?: "sheet" | "page";
}) {
  const { t, locale } = useTranslations();
  const ws = useWorkspace();
  const me = useMe();
  const dir = useDirectory(me.data ? String(me.data.id) : undefined);
  const labels = useLabels(ws.id);
  const can = d.can_write;
  const [title, setTitle] = useState(d.title);
  const [desc, setDesc] = useState(d.description ?? "");
  const [estimate, setEstimate] = useState(d.estimate_minutes ? String(d.estimate_minutes) : "");
  useEffect(() => setTitle(d.title), [d.title]);
  useEffect(() => setDesc(d.description ?? ""), [d.description]);
  useEffect(
    () => setEstimate(d.estimate_minutes ? String(d.estimate_minutes) : ""),
    [d.estimate_minutes],
  );

  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
      return true;
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")));
      onChanged();
      return false;
    }
  };
  const patch = (body: Record<string, unknown>) =>
    call(() => w.patch(ws.id, `/api/w/tasks/${d.id}`, body));

  const saveTitle = () => {
    const v = title.trim();
    if (!v) return setTitle(d.title);
    if (v !== d.title) void patch({ title: v });
  };

  const createLabel = async (name: string): Promise<Label> => {
    const l = await w.post<Label>(ws.id, "/api/w/labels", { name, color: "slate" });
    void labels.mutate();
    return l;
  };

  const overdue = isOverdue(d.due_at, d.completed_at);
  const page = chrome === "page";
  const HeaderWrap: ElementType = page ? "div" : SheetHeader;
  const meta = (
    <>
      <Ltr mono>{d.key}</Ltr>
      <span aria-hidden>·</span>
      <span className="truncate">{d.project.name}</span>
      {d.issue && !d.issue.from_board ? (
        <Link
          href={`/${locale}/w/${ws.slug}/projects/${d.project.id}/issues/${d.key}`}
          className="inline-flex items-center gap-1 text-grid-action hover:underline"
          title={t("task.issueReportHint")}
        >
          <IssueSourceChip issue={d.issue} />
          {t("task.issueReport")}
        </Link>
      ) : null}
      {d.completed_at ? (
        <Badge variant="outline" className="gap-1">
          <CheckCircle2Icon />
          {t("task.completed")}
        </Badge>
      ) : null}
      {!page ? (
        <Link
          href={`/${locale}/w/${ws.slug}/projects/${d.project.id}/tasks/${d.key}`}
          className="ms-auto inline-flex items-center gap-1 text-grid-muted hover:text-grid-fg"
        >
          <ExternalLinkIcon className="size-3.5" />
          {t("task.openFullPage")}
        </Link>
      ) : null}
    </>
  );

  return (
    <>
      <HeaderWrap className="gap-1 border-b border-line px-6 pt-5 pb-4">
        {page ? (
          <p className="flex items-center gap-2 text-xs text-grid-muted">{meta}</p>
        ) : (
          <SheetDescription className="flex items-center gap-2 text-xs">{meta}</SheetDescription>
        )}
        {page ? (
          <h1 className="sr-only">{d.title}</h1>
        ) : (
          <SheetTitle className="sr-only">{d.title}</SheetTitle>
        )}
        {can ? (
          <Textarea
            aria-label={t("task.title")}
            value={title}
            rows={1}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            className="min-h-0 resize-none border-transparent bg-transparent px-0 text-lg font-medium shadow-none hover:border-line focus-visible:border-line dark:bg-transparent"
          />
        ) : (
          <p className="text-lg font-medium text-grid-fg">{d.title}</p>
        )}
        {!d.project.archived ? (
          <div className="flex items-center gap-2 pt-1">
            <StartTimerButton task={{ id: d.id, key: d.key, title: d.title }} />
          </div>
        ) : null}
        {d.parent ? (
          <button
            type="button"
            onClick={() => onOpen(d.parent!.key)}
            className="text-start text-xs text-grid-muted hover:text-grid-fg"
          >
            {t("task.subtaskOf")} <Ltr mono>{d.parent.key}</Ltr> {d.parent.title}
          </button>
        ) : null}
      </HeaderWrap>

      <div className="py-3">
        <Row label={t("task.status")} htmlFor="ts-status">
          <StatusSelect
            id="ts-status"
            statuses={statuses}
            value={d.status_id}
            disabled={!can}
            onChange={(s) =>
              void call(() => w.post(ws.id, `/api/w/tasks/${d.id}/move`, { status: s }))
            }
          />
        </Row>
        <Row label={t("task.priority")} htmlFor="ts-priority">
          <PrioritySelect
            id="ts-priority"
            value={d.priority}
            disabled={!can}
            onChange={(p: Priority) => void patch({ priority: p })}
          />
        </Row>
        <Row label={t("task.assignees")}>
          <MemberPicker
            dir={dir}
            selected={d.assignee_ids}
            disabled={!can}
            onChange={(ids) =>
              void call(() => w.put(ws.id, `/api/w/tasks/${d.id}/assignees`, { user_ids: ids }))
            }
          />
        </Row>
        <Row label={t("task.labels")}>
          <LabelPicker
            labels={labels.data?.labels ?? []}
            selected={d.label_ids}
            disabled={!can}
            onCreate={ws.can("labels:create") ? createLabel : undefined}
            onChange={(ids) =>
              void call(() => w.put(ws.id, `/api/w/tasks/${d.id}/labels`, { label_ids: ids }))
            }
          />
        </Row>
        <Row label={t("task.due")} htmlFor="ts-due">
          <DateField
            id="ts-due"
            value={dayKey(d.due_at)}
            disabled={!can}
            tone={overdue ? "danger" : undefined}
            onChange={(v) => void patch({ due_at: v ?? "" })}
          />
        </Row>
        <Row label={t("task.estimate")} htmlFor="ts-estimate">
          <div className="flex items-center gap-2">
            <Input
              id="ts-estimate"
              dir="ltr"
              inputMode="numeric"
              className="h-7 w-24"
              disabled={!can}
              value={estimate}
              placeholder="0"
              onChange={(e) => setEstimate(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={() => {
                const n = Number(estimate || 0);
                if (n !== (d.estimate_minutes ?? 0)) void patch({ estimate_minutes: n });
              }}
            />
            <span className="text-xs text-grid-muted">{t("task.minutes")}</span>
          </div>
        </Row>
      </div>

      <Section title={t("task.description")}>
        <div className="px-6 pb-4">
          <Textarea
            aria-label={t("task.description")}
            rows={4}
            disabled={!can}
            value={desc}
            placeholder={can ? t("task.descriptionPlaceholder") : t("task.noDescription")}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => {
              if (desc !== (d.description ?? "")) void patch({ description: desc });
            }}
          />
        </div>
      </Section>

      <Checklist d={d} can={can} call={call} />
      <Subtasks d={d} can={can} call={call} onOpen={onOpen} />
      <Attachments d={d} can={can} dir={dir} onChanged={onChanged} />
      <Comments d={d} can={can} dir={dir} onChanged={onChanged} />

      <Section title={t("activity.title")}>
        <TaskActivity taskId={d.id} dir={dir} />
      </Section>

      {d.can_delete ? (
        <div className="flex justify-end border-t border-line px-6 py-4">
          <ConfirmButton
            label={
              <>
                <Trash2Icon />
                {t("task.delete")}
              </>
            }
            title={t("task.deleteTitle", { key: d.key })}
            description={t("task.deleteBody")}
            confirmLabel={t("common.delete")}
            onConfirm={async () => {
              if (await call(() => w.del(ws.id, `/api/w/tasks/${d.id}`))) {
                toast.success(t("task.deleted", { key: d.key }));
                onDeleted();
              }
            }}
          />
        </div>
      ) : null}
      <p className="px-6 pb-6 text-xs text-grid-muted">
        {t("task.createdBy", { name: "" })}
        <span dir="ltr">{useDirectoryName(dir, d.created_by)}</span> ·{" "}
        <Ltr>{timeAgo(d.created_at, locale)}</Ltr>
      </p>
    </>
  );
}

function useDirectoryName(dir: Directory, id: string) {
  return dir.name(id);
}

function TaskActivity({ taskId, dir }: { taskId: string; dir: Directory }) {
  const ws = useWorkspace();
  const { t } = useTranslations();
  const a = useTaskActivity(ws.id, taskId);
  return (
    <ActivityFeed
      items={a.data?.activity}
      loading={a.isLoading}
      error={a.error}
      dir={dir}
      showTask={false}
      emptyTitle={t("activity.empty")}
    />
  );
}

// ── checklist ─────────────────────────────────────────────────────────────────

function Checklist({
  d,
  can,
  call,
}: {
  d: TaskDetail;
  can: boolean;
  call: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const { t } = useTranslations();
  const ws = useWorkspace();
  const [text, setText] = useState("");
  const done = d.checklist.filter((c) => c.done).length;
  const pct = d.checklist.length ? Math.round((done / d.checklist.length) * 100) : 0;
  return (
    <Section
      title={t("task.checklist")}
      count={d.checklist.length ? <Ltr>{`${done}/${d.checklist.length}`}</Ltr> : undefined}
    >
      {d.checklist.length ? (
        <Progress
          value={pct}
          className="mx-6 mb-2 w-auto"
          aria-label={t("task.checklistProgress", { done, total: d.checklist.length })}
        />
      ) : null}
      <ul className="px-4" data-checklist>
        {d.checklist.map((c) => (
          <li
            key={c.id}
            className="group flex items-center gap-3 px-2 py-1.5 hover:bg-grid-soft"
            data-item={c.id}
          >
            <Checkbox
              checked={c.done}
              disabled={!can}
              aria-label={c.title}
              onCheckedChange={(v) =>
                void call(() => w.patch(ws.id, `/api/w/checklist/${c.id}`, { done: !!v }))
              }
            />
            <span
              className={cn("min-w-0 flex-1 text-sm", c.done && "text-grid-muted line-through")}
            >
              {c.title}
            </span>
            {can ? (
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t("task.removeItem", { item: c.title })}
                onClick={() => void call(() => w.del(ws.id, `/api/w/checklist/${c.id}`))}
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {can ? (
        <form
          className="flex gap-2 px-6 pt-1 pb-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = text.trim();
            if (!v) return;
            if (await call(() => w.post(ws.id, `/api/w/tasks/${d.id}/checklist`, { title: v })))
              setText("");
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("task.addItem")}
            aria-label={t("task.addItem")}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!text.trim()}>
            <PlusIcon />
            {t("common.add")}
          </Button>
        </form>
      ) : d.checklist.length ? null : (
        <p className="px-6 pb-4 text-sm text-grid-muted">{t("task.noChecklist")}</p>
      )}
    </Section>
  );
}

// ── subtasks ──────────────────────────────────────────────────────────────────

function Subtasks({
  d,
  can,
  call,
  onOpen,
}: {
  d: TaskDetail;
  can: boolean;
  call: (fn: () => Promise<unknown>) => Promise<boolean>;
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslations();
  const ws = useWorkspace();
  const [text, setText] = useState("");
  if (d.parent) return null; // one level deep
  return (
    <Section
      title={t("task.subtasks")}
      count={
        d.subtasks.length ? (
          <Ltr>{`${d.subtasks.filter((s) => s.done).length}/${d.subtasks.length}`}</Ltr>
        ) : undefined
      }
    >
      <ul className="px-4">
        {d.subtasks.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpen(s.key)}
              className="flex w-full items-center gap-3 px-2 py-1.5 text-start text-sm hover:bg-grid-soft"
            >
              {s.done ? (
                <CheckCircle2Icon className="size-4 text-grid-ok-text" />
              ) : (
                <CircleIcon className="size-4 text-grid-muted" />
              )}
              <Ltr mono className="text-xs text-grid-muted">
                {s.key}
              </Ltr>
              <span className={cn("truncate", s.done && "text-grid-muted line-through")}>
                {s.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {can ? (
        <form
          className="flex gap-2 px-6 pt-1 pb-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = text.trim();
            if (!v) return;
            if (
              await call(() =>
                w.post(ws.id, `/api/w/projects/${d.project_id}/tasks`, { title: v, parent: d.key }),
              )
            )
              setText("");
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("task.addSubtask")}
            aria-label={t("task.addSubtask")}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!text.trim()}>
            <PlusIcon />
            {t("common.add")}
          </Button>
        </form>
      ) : d.subtasks.length ? null : (
        <p className="px-6 pb-4 text-sm text-grid-muted">{t("task.noSubtasks")}</p>
      )}
    </Section>
  );
}

// ── attachments ─────────────────────────────────────────────────────────────────

async function download(ws: string, a: Attachment, failed: string) {
  try {
    const res = await fetch(`/api/w/attachments/${encodeURIComponent(a.id)}`, {
      headers: { "X-Workspace-ID": ws },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = a.file_name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    toast.error(failed);
  }
}

function Attachments({
  d,
  can,
  dir,
  onChanged,
}: {
  d: TaskDetail;
  can: boolean;
  dir: Directory;
  onChanged: () => void;
}) {
  const { t, locale } = useTranslations();
  const ws = useWorkspace();
  const files = useAttachments(ws.id, d.id);
  const list = files.data?.attachments ?? [];
  return (
    <Section
      title={t("task.attachments")}
      count={list.length ? <Ltr>{list.length}</Ltr> : undefined}
    >
      {can ? (
        <div className="px-6 pb-3">
          <AttachmentDropzone
            upload={(file) => w.upload(ws.id, `/api/w/tasks/${d.id}/attachments`, file)}
            onUploaded={() => {
              void files.mutate();
              onChanged();
            }}
          />
        </div>
      ) : null}
      {list.length ? (
        <ul className="divide-y divide-line border-y border-line" data-attachments>
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-6 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" dir="auto">
                  {a.file_name}
                </p>
                <p className="text-xs text-grid-muted">
                  <Ltr>{fileSize(a.size)}</Ltr> · <span dir="ltr">{dir.name(a.uploaded_by)}</span> ·{" "}
                  <Ltr>{timeAgo(a.created_at, locale)}</Ltr>
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("task.download", { file: a.file_name })}
                onClick={() => download(ws.id, a, t("task.downloadFailed"))}
              >
                <DownloadIcon />
              </Button>
              {can ? (
                <ConfirmButton
                  label={<Trash2Icon />}
                  title={t("task.removeFileTitle")}
                  description={t("task.removeFileBody", { file: a.file_name })}
                  confirmLabel={t("common.remove")}
                  onConfirm={async () => {
                    try {
                      await w.del(ws.id, `/api/w/attachments/${a.id}`);
                      void files.mutate();
                      onChanged();
                    } catch (err) {
                      toast.error(errorText(err, t("common.networkError")));
                    }
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : !can ? (
        <p className="px-6 pb-4 text-sm text-grid-muted">{t("task.noAttachments")}</p>
      ) : null}
    </Section>
  );
}

// ── comments with @mentions ───────────────────────────────────────────────────────

const MENTION_TOKEN = /(@[A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g;

/** The handle to insert for a member: the local part when unique, otherwise the full email. */
function handleFor(email: string, all: string[]) {
  const local = email.split("@")[0];
  return all.filter((e) => e.split("@")[0].toLowerCase() === local.toLowerCase()).length > 1
    ? email
    : local;
}

function CommentBody({ c, dir }: { c: Comment; dir: Directory }) {
  const mentioned = new Set(c.mentions.map((id) => dir.name(id).toLowerCase()));
  const parts = c.body.split(MENTION_TOKEN);
  return (
    <p className="text-sm whitespace-pre-wrap text-grid-body" dir="auto">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const h = part.slice(1).toLowerCase();
          const hit = [...mentioned].some((e) => e === h || e.split("@")[0] === h);
          return hit ? (
            <span key={i} className="font-medium text-grid-action" dir="ltr" data-mention>
              {part}
            </span>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}

function Comments({
  d,
  can,
  dir,
  onChanged,
}: {
  d: TaskDetail;
  can: boolean;
  dir: Directory;
  onChanged: () => void;
}) {
  const { t, locale } = useTranslations();
  const ws = useWorkspace();
  const comments = useComments(ws.id, d.id);
  const list = comments.data?.comments ?? [];
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const emails = useMemo(() => dir.members.map((m) => m.email), [dir.members]);
  const suggestions = useMemo(
    () =>
      query == null
        ? []
        : dir.members
            .filter((m) => m.email.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 6),
    [query, dir.members],
  );

  const onType = (v: string) => {
    setBody(v);
    const el = ref.current;
    const upto = v.slice(0, el?.selectionStart ?? v.length);
    const m = /(?:^|\s)@([A-Za-z0-9._%+-]*)$/.exec(upto);
    setQuery(m ? m[1] : null);
    setActive(0);
  };

  const insert = (email: string) => {
    const el = ref.current;
    const pos = el?.selectionStart ?? body.length;
    const before = body
      .slice(0, pos)
      .replace(/@([A-Za-z0-9._%+-]*)$/, `@${handleFor(email, emails)} `);
    const next = before + body.slice(pos);
    setBody(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const send = async () => {
    const v = body.trim();
    if (!v) return;
    setBusy(true);
    try {
      await w.post(ws.id, `/api/w/tasks/${d.id}/comments`, { body: v });
      setBody("");
      void comments.mutate();
      onChanged();
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query != null && suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insert(suggestions[active].email);
        return;
      }
      if (e.key === "Escape") {
        setQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <Section title={t("task.comments")} count={list.length ? <Ltr>{list.length}</Ltr> : undefined}>
      {list.length ? (
        <ol className="space-y-4 px-6 pb-4" data-comments>
          {list.map((c) => (
            <li key={c.id} className="flex gap-3" data-comment={c.id}>
              <PersonAvatar id={c.author_id} dir={dir} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-grid-muted">
                  <span className="font-medium text-grid-fg" dir="ltr">
                    {dir.name(c.author_id)}
                  </span>
                  {c.author_kind === "agent" ? (
                    <Badge variant="outline" className="gap-1">
                      <BotIcon />
                      {t("activity.viaMcp")}
                    </Badge>
                  ) : null}
                  <Ltr>{timeAgo(c.created_at, locale)}</Ltr>
                  {c.edited_at ? <span>({t("task.edited")})</span> : null}
                  {c.author_id === dir.me && can ? (
                    <span className="ms-auto flex gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setEditing({ id: c.id, body: c.body })}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={async () => {
                          try {
                            await w.del(ws.id, `/api/w/comments/${c.id}`);
                            void comments.mutate();
                            onChanged();
                          } catch (err) {
                            toast.error(errorText(err, t("common.networkError")));
                          }
                        }}
                      >
                        {t("common.delete")}
                      </Button>
                    </span>
                  ) : null}
                </div>
                {editing?.id === c.id ? (
                  <div className="mt-1 space-y-2">
                    <Textarea
                      aria-label={t("task.editComment")}
                      rows={3}
                      value={editing.body}
                      onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                        {t("common.cancel")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={!editing.body.trim()}
                        onClick={async () => {
                          try {
                            await w.patch(ws.id, `/api/w/comments/${c.id}`, { body: editing.body });
                            setEditing(null);
                            void comments.mutate();
                          } catch (err) {
                            toast.error(errorText(err, t("common.networkError")));
                          }
                        }}
                      >
                        {t("common.save")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <CommentBody c={c} dir={dir} />
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-6 pb-3 text-sm text-grid-muted">{t("task.noComments")}</p>
      )}
      {can ? (
        <div className="relative px-6 pb-5">
          <Textarea
            ref={ref}
            rows={3}
            value={body}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("task.commentPlaceholder")}
            aria-label={t("task.addComment")}
            aria-autocomplete="list"
            aria-expanded={query != null && suggestions.length > 0}
          />
          {query != null && suggestions.length ? (
            <ul
              role="listbox"
              aria-label={t("task.mentionSomeone")}
              className="brand-surface absolute inset-x-6 z-10 mt-1 border border-line bg-popover py-1 shadow-md"
            >
              {suggestions.map((m, i) => (
                <li
                  key={m.user_id}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insert(m.email);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                    i === active && "bg-grid-soft",
                  )}
                >
                  <span className="font-medium" dir="ltr">
                    @{handleFor(m.email, emails)}
                  </span>
                  <span className="truncate text-xs text-grid-muted" dir="ltr">
                    {m.email}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-grid-muted">{t("task.commentHint")}</p>
            <Button size="sm" disabled={busy || !body.trim()} onClick={() => void send()}>
              {busy ? t("common.working") : t("task.addComment")}
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

// ── The card's own work, inside the issue sheet / page ──────────────────────────────────────
// An issue and its card are one item (same key). The issue sheet (fadymondy style) is the one
// detail view; these add what reports and time tracking are built on: assignees, labels, due,
// estimate and the timer (left column), checklist, subtasks and attachments (main column).

function useCard(taskKey: string) {
  const { t } = useTranslations();
  const ws = useWorkspace();
  const task = useTask(ws.id, taskKey);
  const call = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      void task.mutate();
      return true;
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")));
      void task.mutate();
      return false;
    }
  };
  return { ws, task, call };
}

function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] tracking-wider text-grid-muted uppercase">{children}</span>
  );
}

/** Left column: assignees, labels, due, estimate, timer. */
export function CardPlanning({ taskKey }: { taskKey: string }) {
  const { t } = useTranslations();
  const { ws, task, call } = useCard(taskKey);
  const me = useMe();
  const dir = useDirectory(me.data ? String(me.data.id) : undefined);
  const labels = useLabels(ws.id);
  const d = task.data;
  const [estimate, setEstimate] = useState("");
  useEffect(() => setEstimate(d?.estimate_minutes ? String(d.estimate_minutes) : ""), [d?.estimate_minutes]);
  if (!d) return null;
  const can = d.can_write;
  const patch = (body: Record<string, unknown>) => call(() => w.patch(ws.id, `/api/w/tasks/${d.id}`, body));
  const overdue = isOverdue(d.due_at, d.completed_at);
  const createLabel = async (name: string): Promise<Label> => {
    const l = await w.post<Label>(ws.id, "/api/w/labels", { name, color: "slate" });
    void labels.mutate();
    return l;
  };
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4">
      {!d.project.archived ? <StartTimerButton task={{ id: d.id, key: d.key, title: d.title }} /> : null}
      <div className="flex flex-col gap-1.5">
        <MicroLabel>{t("task.assignees")}</MicroLabel>
        <MemberPicker
          dir={dir}
          selected={d.assignee_ids}
          disabled={!can}
          onChange={(ids) => void call(() => w.put(ws.id, `/api/w/tasks/${d.id}/assignees`, { user_ids: ids }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <MicroLabel>{t("task.labels")}</MicroLabel>
        <LabelPicker
          labels={labels.data?.labels ?? []}
          selected={d.label_ids}
          disabled={!can}
          onCreate={ws.can("labels:create") ? createLabel : undefined}
          onChange={(ids) => void call(() => w.put(ws.id, `/api/w/tasks/${d.id}/labels`, { label_ids: ids }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <MicroLabel>{t("task.due")}</MicroLabel>
        <DateField
          id={`due-${d.id}`}
          value={dayKey(d.due_at)}
          disabled={!can}
          tone={overdue ? "danger" : undefined}
          onChange={(v) => void patch({ due_at: v ?? "" })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <MicroLabel>{t("task.estimate")}</MicroLabel>
        <div className="flex items-center gap-2">
          <Input
            dir="ltr"
            inputMode="numeric"
            className="h-8 w-24"
            disabled={!can}
            value={estimate}
            placeholder="0"
            aria-label={t("task.estimate")}
            onChange={(e) => setEstimate(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => {
              const n = Number(estimate || 0);
              if (n !== (d.estimate_minutes ?? 0)) void patch({ estimate_minutes: n });
            }}
          />
          <span className="text-xs text-grid-muted">{t("task.minutes")}</span>
        </div>
      </div>
    </div>
  );
}

/** Main column: checklist, subtasks, attachments. */
export function CardExtras({ taskKey, onOpen }: { taskKey: string; onOpen?: (key: string) => void }) {
  const { task, call } = useCard(taskKey);
  const me = useMe();
  const dir = useDirectory(me.data ? String(me.data.id) : undefined);
  const d = task.data;
  if (!d) return null;
  return (
    <div className="-mx-4 mt-6">
      <Checklist d={d} can={d.can_write} call={call} />
      <Subtasks d={d} can={d.can_write} call={call} onOpen={onOpen ?? (() => {})} />
      <Attachments d={d} can={d.can_write} dir={dir} onChanged={() => void task.mutate()} />
    </div>
  );
}
