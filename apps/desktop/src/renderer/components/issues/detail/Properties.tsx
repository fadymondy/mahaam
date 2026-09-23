// The issue view's right panel: the timer, then every property as a row you can change in place
// (S/P/A/L open the first four from the keyboard), then when it was made and last changed.
import { CalendarIcon, GitBranchIcon, PlayIcon, SquareIcon, TagIcon, UserIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Label, Member, Status, Task, TaskDetail } from "../../../../shared/types";
import { Avatar, ColorDot, Kbd, LtrText, ProjectMark } from "@/components/kit";
import { AssigneePicker, LabelPicker, PriorityPicker, PropertyMenu, StatusPicker } from "@/components/pickers";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";
import { clock, useNow } from "@/shell/Timer";

import { useIssueTimer } from "../IssueContext";
import type { IssueActions } from "../data";
import type { RowMenu } from "../IssueList";
import { dateInputValue, dueTone, fmtEstimate, parseEstimate } from "../util";

const TRIGGER =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-start text-[13.5px] text-grid-fg outline-none hover:bg-grid-soft focus-visible:bg-grid-soft aria-expanded:bg-grid-soft disabled:hover:bg-transparent [&_svg]:shrink-0";

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-8 items-center gap-1", className)}>
      <span className="w-[76px] shrink-0 truncate text-[13px] text-grid-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Properties({
  task,
  statuses,
  siblings,
  members,
  memberMap,
  labels,
  actions,
  menu,
  onMenu,
}: {
  task: TaskDetail;
  statuses: Status[];
  /** The project's other issues, for the parent picker. */
  siblings: Task[];
  members: Member[];
  memberMap: Map<string, Member>;
  labels: Label[];
  actions: IssueActions;
  menu: RowMenu | null;
  onMenu: (m: RowMenu | null) => void;
}) {
  const { t, date, relative } = useI18n();
  const { navigate } = useRouter();
  const ro = !task.can_write;
  const openFor = (kind: RowMenu) => ({ open: menu === kind, onOpenChange: (o: boolean) => onMenu(o ? kind : null) });
  const assignees = (task.assignee_ids ?? []).map((id) => memberMap.get(id) ?? { user_id: id, email: "?" });
  const labelList = labels.filter((l) => (task.label_ids ?? []).includes(l.id));
  const done = task.status?.category === "done";

  // Parent candidates: same project, not itself, not one of its own sub-issues, not a sub-issue.
  const kids = new Set((task.subtasks ?? []).map((s) => s.id));
  const parents = siblings.filter((x) => x.id !== task.id && !kids.has(x.id) && !x.parent_id);
  const parent = siblings.find((x) => x.id === task.parent_id) ?? (task.parent_id ? task.parent : null);

  return (
    <aside className="flex w-[272px] shrink-0 flex-col overflow-y-auto border-s border-line bg-grid-card" aria-label={t("issue.properties")} data-properties>
      <div className="border-b border-line p-3">
        <TimerButton task={task} />
      </div>
      <div className="flex flex-col gap-0.5 border-b border-line px-3 py-2.5">
        <Row label={t("issue.status")}>
          <StatusPicker
            statuses={statuses}
            value={task.status_id}
            onChange={(id) => {
              const s = statuses.find((x) => x.id === id);
              if (s) void actions.setStatus(task, s);
            }}
            triggerClassName={TRIGGER}
            disabled={ro}
            {...openFor("status")}
          />
        </Row>
        <Row label={t("issue.priority")}>
          <PriorityPicker value={task.priority} onChange={(p) => void actions.setPriority(task, p as Task["priority"])} triggerClassName={TRIGGER} disabled={ro} {...openFor("priority")} />
        </Row>
        <Row label={t("issue.assignees")} className="items-start py-0.5">
          <AssigneePicker
            members={members}
            value={task.assignee_ids ?? []}
            onToggle={(id) => void actions.toggleAssignee(task, id)}
            triggerClassName={cn(TRIGGER, "h-auto min-h-7 flex-wrap py-1")}
            disabled={ro}
            {...openFor("assignee")}
            trigger={
              assignees.length ? (
                <span className="flex min-w-0 flex-col gap-1">
                  {assignees.map((m) => (
                    <span key={m.user_id} className="flex min-w-0 items-center gap-2">
                      <Avatar id={m.user_id} email={m.email} size={18} />
                      <span className="truncate" dir="ltr">
                        {m.email.split("@")[0]}
                      </span>
                    </span>
                  ))}
                </span>
              ) : (
                <>
                  <UserIcon className="size-3.5 text-grid-muted" />
                  <span className="text-grid-muted">{t("issue.unassigned")}</span>
                </>
              )
            }
          />
        </Row>
        <Row label={t("issue.labels")} className="items-start py-0.5">
          <LabelPicker
            labels={labels}
            value={task.label_ids ?? []}
            onToggle={(id) => void actions.toggleLabel(task, id)}
            triggerClassName={cn(TRIGGER, "h-auto min-h-7 flex-wrap gap-1 py-1")}
            disabled={ro}
            {...openFor("label")}
            trigger={
              labelList.length ? (
                labelList.map((l) => (
                  <span key={l.id} className="inline-flex h-5 max-w-full items-center gap-1 rounded-full border border-line px-1.5 text-[12px] text-grid-body">
                    <ColorDot color={l.color} className="size-2" />
                    <span className="truncate">{l.name}</span>
                  </span>
                ))
              ) : (
                <>
                  <TagIcon className="size-3.5 text-grid-muted" />
                  <span className="text-grid-muted">{labels.length ? t("issue.addLabel") : t("issue.noLabelsYet")}</span>
                </>
              )
            }
          />
        </Row>
        <Row label={t("issue.due")}>
          <DueInput value={task.due_at} done={done} disabled={ro} onChange={(v) => void actions.update(task, { due_at: v }, { due_at: v ? `${v}T12:00:00` : null })} />
        </Row>
        <Row label={t("issue.estimate")}>
          <EstimateInput value={task.estimate_minutes} disabled={ro} onChange={(n) => void actions.update(task, { estimate_minutes: n }, { estimate_minutes: n || null })} />
        </Row>
      </div>
      <div className="flex flex-col gap-0.5 border-b border-line px-3 py-2.5">
        <Row label={t("issue.project")}>
          <button type="button" className={TRIGGER} onClick={() => navigate({ name: "project", id: task.project.id })} data-issue-project>
            <ProjectMark name={task.project.name} color={task.project.color} size={16} />
            <span className="truncate">{task.project.name}</span>
          </button>
        </Row>
        <Row label={t("issue.parent")}>
          <PropertyMenu
            label={t("issue.parent")}
            searchable
            placeholder={t("issue.parentSearch")}
            options={[
              { value: "", label: t("issue.noParent"), icon: <XIcon className="size-3.5 text-grid-muted" /> },
              ...parents.map((x) => ({ value: x.id, label: `${x.key} ${x.title}`, icon: <GitBranchIcon className="size-3.5 text-grid-muted" /> })),
            ]}
            value={task.parent_id ?? ""}
            onChange={(id) => {
              const p = siblings.find((x) => x.id === id);
              void actions.update(task, { parent: p?.key ?? "" }, { parent_id: p?.id ?? null });
            }}
            triggerClassName={TRIGGER}
            disabled={ro || !!task.subtask_count}
            trigger={
              parent ? (
                <>
                  <GitBranchIcon className="size-3.5 text-grid-muted" />
                  <LtrText className="font-mono text-[12.5px] text-grid-muted">{parent.key}</LtrText>
                  <span className="truncate">{parent.title}</span>
                </>
              ) : (
                <span className="text-grid-muted">{t("issue.noParent")}</span>
              )
            }
          />
        </Row>
      </div>
      <dl className="flex flex-col gap-1.5 px-3 py-3 text-[13px]">
        <div className="flex items-center gap-1">
          <dt className="w-[76px] shrink-0 text-grid-muted">{t("issue.created")}</dt>
          <dd className="min-w-0 truncate text-grid-body" title={date(task.created_at, { dateStyle: "medium", timeStyle: "short" })}>
            {relative(task.created_at)}
            {memberMap.get(task.created_by) ? (
              <span className="text-grid-muted">
                {" · "}
                <LtrText>{memberMap.get(task.created_by)!.email.split("@")[0]}</LtrText>
              </span>
            ) : null}
          </dd>
        </div>
        <div className="flex items-center gap-1">
          <dt className="w-[76px] shrink-0 text-grid-muted">{t("issue.updated")}</dt>
          <dd className="truncate text-grid-body" title={date(task.updated_at, { dateStyle: "medium", timeStyle: "short" })}>
            {relative(task.updated_at)}
          </dd>
        </div>
        {task.completed_at ? (
          <div className="flex items-center gap-1">
            <dt className="w-[76px] shrink-0 text-grid-muted">{t("issue.completed")}</dt>
            <dd className="truncate text-grid-body">{relative(task.completed_at)}</dd>
          </div>
        ) : null}
      </dl>
    </aside>
  );
}

function TimerButton({ task }: { task: TaskDetail }) {
  const { t } = useI18n();
  const timer = useIssueTimer();
  const on = timer.isRunning(task);
  const now = useNow(on);
  const secs = on && timer.running ? (now - Date.parse(timer.running.started_at)) / 1000 : 0;
  return (
    <button
      type="button"
      disabled={timer.busy}
      onClick={() => void timer.toggle(task)}
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-lg px-3 text-[14px] font-medium transition-colors disabled:opacity-70",
        on ? "bg-grid-action text-grid-on-action hover:opacity-90" : "border border-line bg-background text-grid-fg hover:bg-grid-soft",
      )}
      data-issue-timer={on ? "running" : "idle"}
    >
      {on ? (
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-grid-on-action opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-grid-on-action" />
        </span>
      ) : (
        <PlayIcon className="size-3.5" />
      )}
      <span className="flex-1 text-start">{on ? t("issue.stopTimer") : t("issue.startTimer")}</span>
      {on ? (
        <LtrText className="font-mono text-[13px] tabular-nums">
          <span data-issue-clock>{clock(secs)}</span>
        </LtrText>
      ) : null}
      {on ? <SquareIcon className="size-3" /> : <Kbd combo="t" />}
    </button>
  );
}

/** The date as words ("Thu, 2 Oct"), the system's own calendar to pick one (no dd/mm/yyyy mask). */
function DueInput({ value, done, disabled, onChange }: { value: string | null; done: boolean; disabled?: boolean; onChange: (v: string) => void }) {
  const { t, date } = useI18n();
  const cur = dateInputValue(value);
  const tone = dueTone(value, done);
  const picker = useRef<HTMLInputElement>(null);
  return (
    <div className="group/due relative flex items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          try {
            picker.current?.showPicker();
          } catch {
            picker.current?.focus();
          }
        }}
        className={cn(TRIGGER, !cur && "text-grid-muted", tone === "overdue" && "text-grid-danger", tone === "soon" && "text-grid-warn")}
        data-issue-due={cur || "none"}
      >
        <CalendarIcon className="size-3.5 text-grid-muted" />
        <span className="truncate">{cur ? date(`${cur}T12:00:00`, { weekday: "short", day: "numeric", month: "short", year: cur.startsWith(String(new Date().getFullYear())) ? undefined : "numeric" }) : t("issue.setDue")}</span>
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={cur}
        disabled={disabled}
        onChange={(e) => e.target.value !== cur && onChange(e.target.value)}
        className="pointer-events-none absolute start-0 bottom-0 h-px w-px opacity-0 [color-scheme:light] dark:[color-scheme:dark]"
      />
      {cur && !disabled ? (
        <button
          type="button"
          onClick={() => onChange("")}
          title={t("issue.clearDue")}
          aria-label={t("issue.clearDue")}
          className="ms-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-grid-muted opacity-0 group-hover/due:opacity-100 hover:bg-grid-soft hover:text-grid-fg"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function EstimateInput({ value, disabled, onChange }: { value: number | null; disabled?: boolean; onChange: (min: number) => void }) {
  const { t } = useI18n();
  const shown = fmtEstimate(value);
  const [draft, setDraft] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const n = parseEstimate(draft);
    if (n === null) {
      setBad(true);
      return;
    }
    setBad(false);
    if (n !== (value ?? 0)) onChange(n);
    else setDraft(shown);
  };
  return (
    <input
      value={draft}
      disabled={disabled}
      dir={draft ? "ltr" : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setDraft(shown);
          setBad(false);
          e.currentTarget.blur();
        }
      }}
      placeholder={t("issue.estimatePlaceholder")}
      aria-label={t("issue.estimate")}
      aria-invalid={bad || undefined}
      className={cn(TRIGGER, "text-start placeholder:text-grid-muted rtl:text-end", bad && "ring-1 ring-grid-danger")}
      data-issue-estimate
    />
  );
}

