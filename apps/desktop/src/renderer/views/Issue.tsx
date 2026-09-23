// One issue, full size: title and description edited in place, sub-issues, the checklist, and the
// conversation (comments and history) on the left; its properties and the timer on the right.
// Keys: S/P/A/L open status/priority/assignees/labels, T starts or stops the timer, E edits the
// description, ⌘⇧C copies the key, ⌘⌫ deletes, Esc goes back.
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, CopyIcon, CornerLeftUpIcon, ExternalLinkIcon, FileQuestionIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { EmptyState, ErrorState, Kbd, LtrText, ProjectMark, StatusIcon, ViewHeader } from "@/components/kit";
import { HeaderButton, SectionTitle } from "@/components/issues/controls";
import { useIssueActions } from "@/components/issues/data";
import { Checklist } from "@/components/issues/detail/Checklist";
import { DescriptionEditor, TitleEditor, type DescriptionHandle } from "@/components/issues/detail/Editors";
import { Properties } from "@/components/issues/detail/Properties";
import { Thread } from "@/components/issues/detail/Thread";
import { DeleteIssueDialog, useIssueTimer } from "@/components/issues/IssueContext";
import type { RowMenu } from "@/components/issues/IssueList";
import { sortStatuses, useKeys } from "@/components/issues/util";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { ApiError, api } from "@/lib/bridge";
import { useBoard, useLabels, useMembers } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useRouter } from "@/lib/router";

export function IssueView({ issueKey }: { issueKey: string }) {
  const { t } = useI18n();
  const { ws } = useApp();
  const { navigate, back, canBack } = useRouter();
  const q = useQuery({ queryKey: qk.task(ws, issueKey), queryFn: () => api.task(issueKey), enabled: !!ws });
  const task = q.data;
  const board = useBoard(task?.project_id);
  const members = useMembers().data ?? [];
  const labels = useLabels().data ?? [];
  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const actions = useIssueActions();
  const timer = useIssueTimer();
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const description = useRef<DescriptionHandle>(null);

  const statuses = useMemo(() => {
    const list = sortStatuses(board.data?.statuses);
    return list.length ? list : task?.status ? [task.status] : [];
  }, [board.data, task?.status]);
  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const goBack = () => (canBack ? back() : navigate({ name: "my-issues" }));

  useKeys(
    {
      s: () => task?.can_write && setMenu("status"),
      p: () => task?.can_write && setMenu("priority"),
      a: () => task?.can_write && setMenu("assignee"),
      l: () => task?.can_write && setMenu("label"),
      t: () => task && void timer.toggle(task),
      e: () => description.current?.edit(),
      "mod+shift+c": () => task && void actions.copyKey(task),
      "mod+backspace": () => task?.can_delete && setConfirmDelete(true),
      escape: goBack,
    },
    !!task,
  );
  useKeys({ escape: goBack }, !task);

  const notFound = q.error instanceof ApiError && q.error.status === 404;
  if (notFound) {
    return (
      <>
        <ViewHeader title={<LtrText>{issueKey}</LtrText>} />
        <EmptyState
          icon={<FileQuestionIcon />}
          title={t("issue.notFound")}
          body={t("issue.notFoundBody", { key: issueKey })}
          action={
            <button type="button" onClick={goBack} className="flex items-center gap-2 rounded-md border border-line px-3 py-1 text-[13.5px] hover:bg-grid-soft" data-issue-back>
              {t("common.back")} <Kbd combo="Esc" />
            </button>
          }
        />
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <ViewHeader title={<LtrText>{issueKey}</LtrText>} />
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  }

  const ro = task ? !task.can_write : true;
  const siblings = board.data?.tasks ?? [];
  const parent = task?.parent_id ? (siblings.find((x) => x.id === task.parent_id) ?? task.parent) : null;

  return (
    <>
      <ViewHeader
        actions={
          task ? (
            <>
              <HeaderButton icon={<CopyIcon />} label={t("issue.copyKey")} showLabel={false} onClick={() => void actions.copyKey(task)} data-action="copy-key" />
              <HeaderButton icon={<ExternalLinkIcon />} label={t("common.openInBrowser")} showLabel={false} onClick={() => actions.openInBrowser(task)} data-action="open-web" />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<button type="button" aria-label={t("issue.more")} title={t("issue.more")} className="flex size-7 items-center justify-center rounded-md text-grid-body hover:bg-grid-soft hover:text-grid-fg aria-expanded:bg-grid-soft" />}
                >
                  <MoreHorizontalIcon className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem className="gap-2 text-[13.5px]" onClick={() => void actions.copyKey(task)}>
                    <CopyIcon />
                    {t("issue.copyKey")}
                    <Kbd combo="mod+shift+c" className="ms-auto" />
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2 text-[13.5px]" onClick={() => actions.openInBrowser(task)}>
                    <ExternalLinkIcon />
                    {t("common.openInBrowser")}
                  </DropdownMenuItem>
                  {task.can_delete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" className="gap-2 text-[13.5px]" onClick={() => setConfirmDelete(true)}>
                        <Trash2Icon />
                        {t("issue.delete")}
                        <Kbd combo="mod+⌫" className="ms-auto" />
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null
        }
      >
        {task ? (
          <nav className="flex min-w-0 items-center gap-1.5 text-[14px]" aria-label={t("issue.breadcrumb")}>
            <button
              type="button"
              onClick={() => navigate({ name: "project", id: task.project.id })}
              className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-grid-body hover:bg-grid-soft hover:text-grid-fg"
              data-breadcrumb-project
            >
              <ProjectMark name={task.project.name} color={task.project.color} size={16} />
              <span className="truncate">{task.project.name}</span>
            </button>
            <ChevronRightIcon className="size-3.5 shrink-0 text-grid-muted rtl:-scale-x-100" />
            <LtrText className="font-mono text-[13.5px] font-medium text-grid-fg">{task.key}</LtrText>
          </nav>
        ) : (
          <LtrText className="font-mono text-[13.5px] text-grid-muted">{issueKey}</LtrText>
        )}
      </ViewHeader>

      {!task ? (
        <IssueSkeleton />
      ) : (
        <div className="flex min-h-0 flex-1" data-issue={task.key}>
          <div className="min-w-0 flex-1 overflow-y-auto">
            <article className="mx-auto flex max-w-[760px] flex-col px-10 pt-7 pb-16">
              {parent ? (
                <button
                  type="button"
                  onClick={() => navigate({ name: "issue", key: parent.key })}
                  className="mb-2 flex max-w-full items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-[13px] text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
                  data-parent-link
                >
                  <CornerLeftUpIcon className="size-3.5 rtl:-scale-x-100" />
                  {t("issue.subIssueOf")}
                  <LtrText className="font-mono">{parent.key}</LtrText>
                  <span className="truncate text-grid-body">{parent.title}</span>
                </button>
              ) : null}
              <TitleEditor value={task.title} readOnly={ro} onSave={(title) => void actions.update(task, { title }, { title })} />
              <div className="mt-2">
                <DescriptionEditor
                  ref={description}
                  value={task.description ?? ""}
                  readOnly={ro}
                  onSave={(text) => void actions.update(task, { description: text }, { description: text || null })}
                />
              </div>

              {task.subtasks?.length ? (
                <section className="mt-8 flex flex-col" data-subtasks aria-label={t("issue.subtasks")}>
                  <SectionTitle>
                    {t("issue.subtasks")}{" "}
                    <LtrText className="ms-1 tabular-nums">
                      {task.subtask_done}/{task.subtask_count}
                    </LtrText>
                  </SectionTitle>
                  <ul className="mt-1 flex flex-col border-t border-line">
                    {task.subtasks.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => navigate({ name: "issue", key: s.key })}
                          className="flex h-9 w-full items-center gap-2.5 border-b border-line/60 px-1 text-start text-[14px] hover:bg-grid-soft/60"
                        >
                          <StatusIcon status={statusById.get(s.status_id) ?? { category: s.done ? "done" : "todo", stage: s.done ? "done" : "todo", color: "slate" }} />
                          <LtrText className="w-[52px] shrink-0 font-mono text-[12.5px] text-grid-muted">{s.key}</LtrText>
                          <span className={s.done ? "truncate text-grid-muted" : "truncate text-grid-fg"} dir="auto">
                            {s.title}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="mt-8">
                <Checklist task={task} readOnly={ro} />
              </div>

              <div className="mt-8 border-t border-line pt-5">
                <Thread taskKey={task.key} memberMap={memberMap} readOnly={ro} />
              </div>
            </article>
          </div>
          <Properties
            task={task}
            statuses={statuses}
            siblings={siblings}
            members={members}
            memberMap={memberMap}
            labels={labels}
            actions={actions}
            menu={menu}
            onMenu={setMenu}
          />
          <DeleteIssueDialog task={confirmDelete ? task : null} onClose={() => setConfirmDelete(false)} actions={actions} onDeleted={goBack} />
        </div>
      )}
    </>
  );
}

function IssueSkeleton() {
  return (
    <div className="flex min-h-0 flex-1" aria-busy>
      <div className="min-w-0 flex-1">
        <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-10 pt-8">
          <span className="h-6 w-2/3 rounded bg-grid-soft" />
          <span className="mt-3 h-3 w-full rounded bg-grid-soft" />
          <span className="h-3 w-5/6 rounded bg-grid-soft" />
          <span className="h-3 w-1/2 rounded bg-grid-soft" />
        </div>
      </div>
      <aside className="flex w-[272px] shrink-0 flex-col gap-3 border-s border-line bg-grid-card p-3">
        <span className="h-9 rounded-lg bg-grid-soft" />
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="flex h-6 items-center gap-3">
            <span className="h-2.5 w-14 rounded bg-grid-soft" />
            <span className="h-2.5 flex-1 rounded bg-grid-soft" />
          </span>
        ))}
      </aside>
    </div>
  );
}
