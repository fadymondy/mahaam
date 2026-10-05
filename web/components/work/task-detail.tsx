"use client"

// The task / issue detail view. An issue and its board card are one item (same key), so this one
// component reads both and renders the full page AND the side-over (`layout="sheet"`). The page has
// an info rail beside tabs; the side-over flows: header, frameless fields, description, then tabs
// with the comments first. Grid: one 4px-based rhythm (p-4 cards, gap-4 between
// them, 36px rows), logical (start/end) properties only so en/ar mirror, and every duration, key
// and date is LTR-isolated.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  HistoryIcon,
  LinkIcon,
  ListChecksIcon,
  Maximize2Icon,
  MessageSquareIcon,
  PaperclipIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"

import {
  Badge,
  Button,
  Checkbox,
  Input,
  Markdown,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Textarea,
  toast,
} from "@fadymondy/nasaq/web"

import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { NotFoundState } from "@/components/not-found-state"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { StartTimerButton } from "@/components/time/start-timer-button"
import { ActivityFeed } from "@/components/work/activity-feed"
import { AttachmentDropzone } from "@/components/work/attachment-dropzone"
import { ProjectAvatar } from "@/components/work/project-avatar"
import { DateField, LabelChips, LabelPicker, MemberPicker, PriorityIcon, PrioritySelect, StatusIcon, StatusSelect } from "@/components/work/fields"
import { IssueAgentSettings } from "@/components/work/issues/fm/issue-agent-settings"
import { IssueActionsMenu } from "@/components/work/issues/fm/issue-actions"
import { useCommentAuthor, useCommentForm } from "@/components/work/issues/fm/issue-comments"
import { MentionTextarea } from "@/components/work/issues/fm/mention-textarea"
import { copyText } from "@/components/work/issues/fm/shared"
import { ContextPanel } from "@/components/work/issues/issue-detail"
import { ColorDot } from "@/components/work/palette"
import { PersonAvatar, useDirectory, type Directory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api, ApiError } from "@/lib/api"
import { dayKey, fileSize, formatDay, isOverdue, minutes, timeAgo } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { useRunning, type TimeEntry } from "@/lib/time"
import { cn } from "@/lib/utils"
import {
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  errorText,
  issuesApi,
  useAttachments,
  useBoard,
  useComments,
  useIssue,
  useLabels,
  useProject,
  useProjects,
  useTask,
  useTaskActivity,
  w,
  type Attachment,
  type Comment,
  type Issue,
  type IssueComment,
  type IssuePriority,
  type IssueType,
  type IssuePatch,
  type Label,
  type Priority,
  type Task,
  type TaskDetail as TaskDetailData,
} from "@/lib/work"

type Call = (fn: () => Promise<unknown>) => Promise<boolean>
type Layout = "page" | "sheet"

const TABS = ["details", "activity", "attachments", "discussions", "subtasks", "time"] as const
type Tab = (typeof TABS)[number]
/** The side-over: fields and description up front, then these, comments first. */
const SHEET_TABS = ["discussions", "subtasks", "attachments", "activity", "time"] as const
const SHEET_TAB_ICON: Record<(typeof SHEET_TABS)[number], typeof ClockIcon> = {
  discussions: MessageSquareIcon,
  subtasks: ListChecksIcon,
  attachments: PaperclipIcon,
  activity: HistoryIcon,
  time: ClockIcon,
}
type SheetTab = (typeof SHEET_TABS)[number]

// ── small building blocks ───────────────────────────────────────────────────

/**
 * Set inside the side-over's tabs: cards lose their frame and their title (the tab names them),
 * and every row becomes its own rounded section so a thread is easy to follow.
 */
const Flow = createContext(false)
const flowList = (flow: boolean) => (flow ? "flex flex-col gap-2" : "divide-y divide-line")
const flowRow = (flow: boolean) => (flow ? "overflow-hidden rounded-lg border border-border bg-card" : "")

/** A bordered card: one padding (p-4), one header row (title start, action end). */
function Card({
  title,
  count,
  action,
  children,
  className,
  bodyClassName,
  bare,
  keepTitle,
}: {
  title?: ReactNode
  count?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** No frame: a heading over the content, for the side-over's flowing layout. */
  bare?: boolean
  /** In the side-over's tabs, keep the heading (a tab holding two lists). */
  keepTitle?: boolean
}) {
  const flow = useContext(Flow)
  if (bare || flow) {
    const head = flow && !keepTitle ? undefined : title
    return (
      <section className={cn("flex flex-col gap-2", className)}>
        {head || action ? (
          <header className="flex min-h-8 items-center gap-2">
            {head ? <h2 className="text-caption font-medium tracking-wide text-muted-foreground uppercase">{head}</h2> : null}
            {count != null ? <span className="text-caption text-muted-foreground tabular-nums">{count}</span> : null}
            {action ? <div className="ms-auto flex items-center gap-1">{action}</div> : null}
          </header>
        ) : null}
        <div className={bodyClassName}>{children}</div>
      </section>
    )
  }
  return (
    <section className={cn("flex flex-col border border-border bg-card", className)}>
      {title ? (
        <header className="flex min-h-12 items-center gap-2 border-b border-border px-4">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {count != null ? <span className="text-caption text-muted-foreground tabular-nums">{count}</span> : null}
          {action ? <div className="ms-auto flex items-center gap-1">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}

function CountPill({ n }: { n: number }) {
  return (
    <span dir="ltr" className="inline-flex h-5 min-w-5 items-center justify-center bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">
      {n}
    </span>
  )
}

/** A label/value row of the info rail: fixed label column, 36px tall, values start-aligned. */
function InfoRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-9 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
      <dt>
        <label htmlFor={htmlFor} className="text-sm text-muted-foreground">
          {label}
        </label>
      </dt>
      <dd className="flex min-w-0 items-center gap-2">{children}</dd>
    </div>
  )
}

const rowControl = "min-w-0 flex-1"

// ── data ─────────────────────────────────────────────────────────────────────

/** Every time entry on the project (all members with time:manage, otherwise yours), filtered to the task. */
function useTaskTime(projectId: string | undefined, taskId: string | undefined) {
  const ws = useWorkspace()
  const running = useRunning(ws.id, ws.can("time:track"))
  const all = ws.can("time:manage")
  const key =
    projectId && taskId && ws.can("time:track")
      ? [`/api/w/time/entries?project=${encodeURIComponent(projectId)}&from=2020-01-01&limit=1000${all ? "&user=*" : ""}`, ws.id, running.data?.timer?.id ?? ""]
      : null
  const res = useSWR<{ entries: TimeEntry[] }>(key, ([p, id]: [string, string]) => api<{ entries: TimeEntry[] }>(p, { workspaceId: id }), {
    revalidateOnFocus: false,
  })
  const entries = useMemo(() => (res.data?.entries ?? []).filter((e) => e.task_id === taskId), [res.data, taskId])
  const seconds = entries.reduce((n, e) => n + (e.duration_s ?? 0), 0)
  return { entries, seconds, loading: res.isLoading }
}

function hm(seconds: number) {
  return minutes(Math.round(seconds / 60))
}

// ── the component ───────────────────────────────────────────────────────────────

export function TaskDetail({
  taskKey,
  layout = "page",
  back,
  onOpen,
  onChanged,
  onClose,
}: {
  taskKey: string
  layout?: Layout
  /** Page: the list this item belongs to (breadcrumb parent link is the project; this is unused when absent). */
  back?: string
  /** Open another item (a subtask / the parent). Defaults to navigating to its page. */
  onOpen?: (key: string) => void
  /** Called after any write (the caller revalidates its board / list). */
  onChanged?: () => void
  /** Sheet: closes the side-over (after a delete). */
  onClose?: () => void
}) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const task = useTask(ws.id, taskKey)
  const issue = useIssue(ws.id, taskKey)
  const d = task.data
  const project = useProject(ws.id, d?.project_id ?? null)

  if (task.error) {
    return task.error instanceof ApiError && task.error.status === 404 ? (
      <NotFoundState
        title={t("task.notFound")}
        body={t("task.notFoundBody")}
        backHref={back ?? `/${locale}/w/${ws.slug}/projects`}
        backLabel={t("nav.projects")}
      />
    ) : (
      <ErrorState error={task.error} />
    )
  }
  if (layout === "sheet" && (!d || issue.isLoading || project.isLoading)) return <TaskSheetSkeleton />
  if (!d) return <LoadingRows rows={6} />

  const open =
    onOpen ?? ((key: string) => router.push(`/${locale}/w/${ws.slug}/projects/${d.project_id}/issues/${encodeURIComponent(key)}`))

  return (
    <Body
      key={d.id}
      d={d}
      issue={issue.data}
      statuses={project.data?.statuses ?? [d.status]}
      layout={layout}
      onOpen={open}
      onClose={onClose}
      refresh={async () => {
        await Promise.all([task.mutate(), issue.mutate()])
        onChanged?.()
      }}
      mutateIssue={(next) => issue.mutate(next, { revalidate: false })}
    />
  )
}

function Body({
  d,
  issue,
  statuses,
  layout,
  onOpen,
  onClose,
  refresh,
  mutateIssue,
}: {
  d: TaskDetailData
  issue: (Issue & { comments: IssueComment[] }) | undefined
  statuses: TaskDetailData["status"][]
  layout: Layout
  onOpen: (key: string) => void
  onClose?: () => void
  refresh: () => Promise<void>
  mutateIssue: (next: Issue & { comments: IssueComment[] }) => unknown
}) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const labels = useLabels(ws.id)
  const [tab, setTab] = useState<Tab>("details")
  const [sheetTab, setSheetTab] = useState<SheetTab>("discussions")
  const can = d.can_write
  const canIssue = ws.can("feedback:write") && !!issue
  const page = layout === "page"
  const time = useTaskTime(d.project_id, d.id)
  const comments = useComments(ws.id, d.id)
  const activity = useTaskActivity(ws.id, d.id)
  const files = useAttachments(ws.id, d.id)

  const call: Call = async (fn) => {
    try {
      await fn()
      await refresh()
      return true
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      await refresh()
      return false
    }
  }
  const patch = (body: Record<string, unknown>) => call(() => w.patch(ws.id, `/api/w/tasks/${d.id}`, body))
  const patchIssue = async (fields: IssuePatch) => {
    try {
      mutateIssue(await issuesApi.patch(ws.id, d.key, fields))
      await refresh()
      return true
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      return false
    }
  }
  const move = (statusId: string) => call(() => w.post(ws.id, `/api/w/tasks/${d.id}/move`, { status: statusId }))
  const createLabel = async (name: string): Promise<Label> => {
    const l = await w.post<Label>(ws.id, "/api/w/labels", { name, color: "slate" })
    void labels.mutate()
    return l
  }

  const done = !!d.completed_at
  const doneColumn = statuses.find((s) => s.category === "done")
  const reopenColumn = statuses.find((s) => s.category === "todo") ?? statuses[0]
  const toggleDone = () => {
    const target = done ? reopenColumn : doneColumn
    if (target) void move(target.id)
  }

  const discussionCount = (issue?.comments.length ?? 0) + (comments.data?.comments.length ?? 0)
  const subCount = d.subtasks.length + d.checklist.length
  const counts: Partial<Record<Tab, number>> = {
    attachments: files.data?.attachments.length ?? d.attachment_count,
    discussions: discussionCount,
    subtasks: subCount,
  }

  const deleteButton = d.can_delete ? (
    <div className="flex justify-end">
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
            toast.success(t("task.deleted", { key: d.key }))
            if (onClose) onClose()
            else window.location.assign(`/${locale}/w/${ws.slug}/projects/${d.project_id}/board`)
          }
        }}
      />
    </div>
  ) : null

  const rail = (
    <aside className="flex min-w-0 flex-col gap-4">
      <InfoCard
        d={d}
        issue={issue}
        statuses={statuses}
        dir={dir}
        labels={labels.data?.labels ?? []}
        can={can}
        canIssue={canIssue}
        done={done}
        loggedSeconds={time.seconds}
        call={call}
        patch={patch}
        patchIssue={patchIssue}
        move={move}
        toggleDone={toggleDone}
        canToggle={!!(done ? reopenColumn : doneColumn)}
        createLabel={ws.can("labels:create") ? createLabel : undefined}
      />
      <ProgressCard d={d} />
      {issue && ws.can("feedback:write") ? <AgentCard issue={issue} canIssue={canIssue} patchIssue={patchIssue} /> : null}
      <RecentActivity items={activity.data?.activity} loading={activity.isLoading} dir={dir} onAll={() => setTab("activity")} />
      {deleteButton}
    </aside>
  )

  const header = (
    <Header
      d={d}
      issue={issue}
      statuses={statuses}
      labels={labels.data?.labels ?? []}
      can={can}
      canIssue={canIssue}
      done={done}
      toggleDone={toggleDone}
      canToggle={!!(done ? reopenColumn : doneColumn)}
      move={move}
      patch={patch}
      patchIssue={patchIssue}
      call={call}
      refresh={refresh}
      onOpen={onOpen}
      layout={layout}
      createLabel={ws.can("labels:create") ? createLabel : undefined}
    />
  )

  if (!page) {
    const tabs = SHEET_TABS.filter((x) => (x === "time" ? ws.can("time:track") : true))
    return (
      <div className="flex w-full flex-col gap-5 p-5 lg:p-6" data-task-detail={d.key} data-layout={layout}>
        {header}
        <SheetBar
          d={d}
          issue={issue}
          statuses={statuses}
          dir={dir}
          can={can}
          canIssue={canIssue}
          loggedSeconds={time.seconds}
          call={call}
          patch={patch}
          patchIssue={patchIssue}
          move={move}
          labels={labels.data?.labels ?? []}
          createLabel={ws.can("labels:create") ? createLabel : undefined}
          actions={<SheetActions d={d} issue={issue} refresh={refresh} />}
          footer={deleteButton}
        />
        <DescriptionCard bare d={d} issue={issue} can={can} canIssue={canIssue} patch={patch} patchIssue={patchIssue} />
        {issue && issue.project_id ? <ContextPanelCard issue={issue} /> : null}

        <Tabs value={sheetTab} onValueChange={(v) => setSheetTab(v as SheetTab)} className="min-w-0" data-sheet-tabs>
          <div className="overflow-x-auto">
            <TabsList variant="segmented" className="min-w-max">
              {tabs.map((x) => {
                const Icon = SHEET_TAB_ICON[x]
                const n = x === "time" ? 0 : (counts[x] ?? 0)
                return (
                  <TabsTab key={x} value={x} className="gap-2">
                    <Icon className="size-4" />
                    {t(`td.tab.${x}`)}
                    {n > 0 ? <CountPill n={n} /> : null}
                  </TabsTab>
                )
              })}
            </TabsList>
          </div>
          <Flow.Provider value>
            <TabsPanel value="discussions" className="pt-4">
              <Discussion d={d} issue={issue} can={can} dir={dir} comments={comments} onChanged={refresh} patchIssue={patchIssue} />
            </TabsPanel>
            <TabsPanel value="subtasks" className="pt-4">
              <div className="flex flex-col gap-5">
                <ChecklistCard d={d} can={can} call={call} />
                <SubtasksCard d={d} can={can} call={call} onOpen={onOpen} />
              </div>
            </TabsPanel>
            <TabsPanel value="attachments" className="pt-4">
              <AttachmentsCard d={d} can={can} dir={dir} files={files} onChanged={refresh} />
            </TabsPanel>
            <TabsPanel value="activity" className="pt-4">
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <ActivityFeed items={activity.data?.activity} loading={activity.isLoading} error={activity.error} dir={dir} showTask={false} emptyTitle={t("activity.empty")} />
              </div>
            </TabsPanel>
            <TabsPanel value="time" className="pt-4">
              <TimeCard d={d} time={time} dir={dir} />
            </TabsPanel>
          </Flow.Provider>
        </Tabs>
      </div>
    )
  }


  return (
    <div className={cn("flex w-full flex-col gap-4", page ? "mx-auto max-w-[1400px] px-4 py-6 sm:px-6" : "p-4")} data-task-detail={d.key} data-layout={layout}>
      {page ? <Breadcrumb d={d} /> : null}

      {header}

      <div className={cn("grid items-start gap-4", page && "xl:grid-cols-[minmax(0,1fr)_21rem]")}>
        {/* The sheet shows the rail first: the fields are what you open a side-over for. */}
        {!page ? rail : null}

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-w-0">
          <div className="overflow-x-auto">
            <TabsList variant="segmented" className="min-w-max">
              {TABS.map((x) => (
                <TabsTab key={x} value={x} className="gap-2">
                  {t(`td.tab.${x}`)}
                  {counts[x] != null && counts[x]! > 0 ? <CountPill n={counts[x]!} /> : null}
                </TabsTab>
              ))}
            </TabsList>
          </div>

          <TabsPanel value="details" className="pt-4">
            <div className={cn("grid items-start gap-4", page && "2xl:grid-cols-2")}>
              <div className="flex min-w-0 flex-col gap-4">
                <DescriptionCard d={d} issue={issue} can={can} canIssue={canIssue} patch={patch} patchIssue={patchIssue} />
                {issue && !issue.project_id ? null : issue ? <ContextPanelCard issue={issue} /> : null}
                <ChecklistCard d={d} can={can} call={call} />
                <SubtasksCard d={d} can={can} call={call} onOpen={onOpen} />
              </div>
              <Discussion d={d} issue={issue} can={can} dir={dir} comments={comments} onChanged={refresh} patchIssue={patchIssue} />
            </div>
          </TabsPanel>

          <TabsPanel value="activity" className="pt-4">
            <Card title={t("td.tab.activity")} bodyClassName="p-0">
              <ActivityFeed items={activity.data?.activity} loading={activity.isLoading} error={activity.error} dir={dir} showTask={false} emptyTitle={t("activity.empty")} />
            </Card>
          </TabsPanel>

          <TabsPanel value="attachments" className="pt-4">
            <AttachmentsCard d={d} can={can} dir={dir} files={files} onChanged={refresh} />
          </TabsPanel>

          <TabsPanel value="discussions" className="pt-4">
            <Discussion d={d} issue={issue} can={can} dir={dir} comments={comments} onChanged={refresh} patchIssue={patchIssue} />
          </TabsPanel>

          <TabsPanel value="subtasks" className="pt-4">
            <div className="flex flex-col gap-4">
              <ChecklistCard d={d} can={can} call={call} />
              <SubtasksCard d={d} can={can} call={call} onOpen={onOpen} />
            </div>
          </TabsPanel>

          <TabsPanel value="time" className="pt-4">
            <TimeCard d={d} time={time} dir={dir} />
          </TabsPanel>
        </Tabs>

        {page ? rail : null}
      </div>
    </div>
  )
}

// ── breadcrumb + header ──────────────────────────────────────────────────────────

function Breadcrumb({ d }: { d: TaskDetailData }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const base = `/${locale}/w/${ws.slug}`
  const link = "truncate text-muted-foreground hover:text-foreground"
  return (
    <nav aria-label={t("td.breadcrumb")} className="flex min-w-0 items-center gap-2 text-sm">
      <Link href={`${base}/projects`} className={link}>
        {t("nav.projects")}
      </Link>
      <Sep />
      <Link href={`${base}/projects/${d.project_id}`} className={cn(link, "max-w-48")}>
        {d.project.name}
      </Link>
      {d.parent ? (
        <>
          <Sep />
          <Link href={`${base}/projects/${d.project_id}/issues/${encodeURIComponent(d.parent.key)}`} className={cn(link, "max-w-48")}>
            <Ltr mono>{d.parent.key}</Ltr>
          </Link>
        </>
      ) : null}
      <Sep />
      <span aria-current="page" className="min-w-0 truncate font-medium text-foreground">
        <Ltr mono>{d.key}</Ltr> <span dir="auto">{d.title}</span>
      </span>
    </nav>
  )
}

function Sep() {
  return <span aria-hidden className="text-muted-foreground/60 rtl:-scale-x-100">›</span>
}

function Header({
  d,
  issue,
  statuses,
  labels,
  can,
  canIssue,
  done,
  toggleDone,
  canToggle,
  move,
  patch,
  patchIssue,
  call,
  refresh,
  onOpen,
  layout,
  createLabel,
}: {
  d: TaskDetailData
  issue: (Issue & { comments: IssueComment[] }) | undefined
  statuses: TaskDetailData["status"][]
  labels: Label[]
  can: boolean
  canIssue: boolean
  done: boolean
  toggleDone: () => void
  canToggle: boolean
  move: (id: string) => Promise<boolean>
  patch: (b: Record<string, unknown>) => Promise<boolean>
  patchIssue: (f: IssuePatch) => Promise<boolean>
  call: Call
  refresh: () => Promise<void>
  onOpen: (key: string) => void
  layout: Layout
  createLabel?: (name: string) => Promise<Label>
}) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [title, setTitle] = useState(d.title)
  const [lastTitle, setLastTitle] = useState(d.title)
  if (d.title !== lastTitle) {
    setLastTitle(d.title)
    setTitle(d.title)
  }
  const saveTitle = () => {
    const v = title.trim()
    if (!v) return setTitle(d.title)
    if (v !== d.title) void patch({ title: v })
  }
  const href = `${typeof window === "undefined" ? "" : window.location.origin}/${locale}/w/${ws.slug}/projects/${d.project_id}/issues/${encodeURIComponent(d.key)}`
  const [copied, setCopied] = useState(false)

  return (
    <header className="flex flex-col gap-3">
      <div className={cn("flex items-start gap-x-3 gap-y-3", layout === "sheet" ? "pe-10" : "flex-wrap")}>
        <Button
          variant="secondary"
          size="icon"
          className="size-9 shrink-0 [&_svg]:size-5"
          disabled={!can || !canToggle}
          aria-pressed={done}
          aria-label={done ? t("td.reopen") : t("td.markDone")}
          title={done ? t("td.reopen") : t("td.markDone")}
          onClick={toggleDone}
          data-done-toggle
        >
          <StatusIcon status={d.status} />
        </Button>

        {/* The key is a fixed tag at the start of the title, not part of what you edit. */}
        <div className={cn("flex min-w-0 flex-1 items-start gap-1", layout === "page" && "min-w-48 basis-64")}>
          <Ltr mono className="mt-1.5 shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-sm leading-5 text-muted-foreground select-all" data-task-key>
            {d.key}
          </Ltr>
          <div className="min-w-0 flex-1">
          {can ? (
            <Textarea
              aria-label={t("task.title")}
              dir="auto"
              value={title}
              rows={1}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  ;(e.target as HTMLTextAreaElement).blur()
                }
              }}
              className="field-sizing-content min-h-9 resize-none border-transparent bg-transparent px-2 py-1 text-xl leading-7 font-semibold shadow-none hover:border-border focus-visible:border-border dark:bg-transparent"
            />
          ) : (
            <h1 dir="auto" className="px-2 py-1 text-xl leading-7 font-semibold text-foreground">
              {d.title}
            </h1>
          )}
          </div>
        </div>

        {layout === "page" ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <StatusSelect statuses={statuses} value={d.status_id} disabled={!can} onChange={(s) => void move(s)} />
            </div>
            <div className="w-36">
              <PrioritySelect value={d.priority} disabled={!can} onChange={(p: Priority) => void patch({ priority: p })} />
            </div>
          </div>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t("td.copyLink")}
            title={t("td.copyLink")}
            onClick={async () => {
              if (await copyText(href)) {
                setCopied(true)
                toast.success(t("td.linkCopied"))
                setTimeout(() => setCopied(false), 1800)
              }
            }}
          >
            {copied ? <CheckIcon /> : <LinkIcon />}
          </Button>
          {issue ? (
            <IssueActionsMenu
              issue={issue}
              onChanged={refresh}
              trigger={
                <Button variant="secondary" size="icon" aria-label={t("td.more")}>
                  <MoreHorizontalIcon />
                </Button>
              }
            />
          ) : null}
        </div>
        ) : null}
      </div>

      {/* labels (+) · parent — one row, indented under the title */}
      {d.label_ids.length || d.parent || layout === "page" ? (
      <div className="flex flex-wrap items-center gap-2 ps-12">
        <LabelChips ids={d.label_ids} labels={labels} />
        {layout === "page" && (ws.can("labels:read") || can) ? (
          <LabelPicker
            compact
            labels={labels}
            selected={d.label_ids}
            disabled={!can}
            onCreate={createLabel}
            onChange={(ids) => void call(() => w.put(ws.id, `/api/w/tasks/${d.id}/labels`, { label_ids: ids }))}
          />
        ) : null}
        {d.parent ? (
          <button type="button" onClick={() => onOpen(d.parent!.key)} className="text-start text-caption text-muted-foreground hover:text-foreground">
            {t("task.subtaskOf")} <Ltr mono>{d.parent.key}</Ltr> {d.parent.title}
          </button>
        ) : null}
      </div>
      ) : null}
    </header>
  )
}

// ── description ──────────────────────────────────────────────────────────────────

function DescriptionCard({
  d,
  issue,
  can,
  canIssue,
  patch,
  patchIssue,
  bare,
}: {
  d: TaskDetailData
  issue: (Issue & { comments: IssueComment[] }) | undefined
  can: boolean
  canIssue: boolean
  patch: (b: Record<string, unknown>) => Promise<boolean>
  patchIssue: (f: IssuePatch) => Promise<boolean>
  bare?: boolean
}) {
  const { t } = useTranslations()
  // A real report (SDK, portal, MCP, imported) keeps its text in the issue; a board card in the card.
  const real = !!issue && !!d.issue && !d.issue.from_board
  const text = real ? (issue!.body ?? "") : (d.description ?? "")
  const editable = real ? canIssue : can
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const save = async () => {
    const ok = real ? await patchIssue({ body: draft }) : await patch({ description: draft })
    if (ok) setEditing(false)
  }
  if (bare) {
    return (
      <section className="group/desc relative rounded-lg border border-border bg-card p-4 shadow-xs" data-description>
        {editable && !editing ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute end-2 top-2 z-10 opacity-0 group-hover/desc:opacity-100 focus-visible:opacity-100 max-lg:opacity-100"
            aria-label={t("td.editDescription")}
            onClick={() => {
              setDraft(text)
              setEditing(true)
            }}
          >
            <PencilIcon />
          </Button>
        ) : null}
        {editing ? (
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label={t("task.description")}
              dir="auto"
              rows={10}
              autoFocus
              value={draft}
              placeholder={t("task.descriptionPlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" size="sm" onClick={() => void save()}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        ) : text ? (
          <Clamp>
            <Markdown>{text}</Markdown>
          </Clamp>
        ) : (
          <p className="pe-10 text-sm text-muted-foreground">{editable ? t("task.descriptionPlaceholder") : t("task.noDescription")}</p>
        )}
      </section>
    )
  }
  return (
    <Card
      title={t("task.description")}
      action={
        editable && !editing ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("td.editDescription")}
            onClick={() => {
              setDraft(text)
              setEditing(true)
            }}
          >
            <PencilIcon />
          </Button>
        ) : null
      }
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <Textarea
            aria-label={t("task.description")}
            dir="auto"
            rows={8}
            autoFocus
            value={draft}
            placeholder={t("task.descriptionPlaceholder")}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : text ? (
        <Markdown>{text}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground">{editable ? t("task.descriptionPlaceholder") : t("task.noDescription")}</p>
      )}
    </Card>
  )
}

/** Long text folds to a fixed height with a fade and a "Show more" toggle, so the tabs stay in reach. */
function Clamp({ children, max = 320 }: { children: ReactNode; max?: number }) {
  const { t } = useTranslations()
  const ref = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setLong(el.scrollHeight > max + 48)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [max])
  const folded = long && !open
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <div ref={ref} className={cn(folded && "overflow-hidden")} style={folded ? { maxHeight: max } : undefined}>
          {children}
        </div>
        {folded ? <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-card to-transparent" /> : null}
      </div>
      {long ? (
        <Button variant="ghost" size="sm" className="self-start" aria-expanded={open} onClick={() => setOpen(!open)} data-clamp-toggle>
          <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
          {open ? t("td.showLess") : t("td.showMore")}
        </Button>
      ) : null}
    </div>
  )
}

function ContextPanelCard({ issue }: { issue: Issue }) {
  // The report behind a card (page, screenshot, logs). Renders nothing when the card has none.
  return <ContextPanel issue={issue} />
}

// ── checklist + subtasks ──────────────────────────────────────────────────────────

function AddForm({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => Promise<boolean> }) {
  const { t } = useTranslations()
  const flow = useContext(Flow)
  const [text, setText] = useState("")
  return (
    <form
      className={cn("flex items-center gap-2", flow ? "pt-1" : "border-t border-border p-4")}
      onSubmit={async (e) => {
        e.preventDefault()
        const v = text.trim()
        if (!v) return
        if (await onAdd(v)) setText("")
      }}
    >
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} dir="auto" className="h-9 flex-1" />
      <Button type="submit" variant="secondary" disabled={!text.trim()}>
        <PlusIcon />
        {t("common.add")}
      </Button>
    </form>
  )
}

function ChecklistCard({ d, can, call }: { d: TaskDetailData; can: boolean; call: Call }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const flow = useContext(Flow)
  const done = d.checklist.filter((c) => c.done).length
  return (
    <Card
      keepTitle
      title={t("task.checklist")}
      count={d.checklist.length ? <Ltr>{`${done}/${d.checklist.length}`}</Ltr> : undefined}
      bodyClassName="p-0"
    >
      {d.checklist.length ? (
        <ul data-checklist className={flowList(flow)}>
          {d.checklist.map((c) => (
            <li key={c.id} data-item={c.id} className={cn("group flex min-h-12 items-center gap-3 px-4 hover:bg-muted/50", flowRow(flow))}>
              <Checkbox
                checked={c.done}
                disabled={!can}
                aria-label={c.title}
                onCheckedChange={(v) => void call(() => w.patch(ws.id, `/api/w/checklist/${c.id}`, { done: !!v }))}
              />
              <span dir="auto" className={cn("min-w-0 flex-1 text-sm", c.done && "text-muted-foreground line-through")}>
                {c.title}
              </span>
              {can ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                  aria-label={t("task.removeItem", { item: c.title })}
                  onClick={() => void call(() => w.del(ws.id, `/api/w/checklist/${c.id}`))}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : !can ? (
        <p className="p-4 text-sm text-muted-foreground">{t("task.noChecklist")}</p>
      ) : null}
      {can ? <AddForm placeholder={t("task.addItem")} onAdd={(v) => call(() => w.post(ws.id, `/api/w/tasks/${d.id}/checklist`, { title: v }))} /> : null}
    </Card>
  )
}

function SubtasksCard({ d, can, call, onOpen }: { d: TaskDetailData; can: boolean; call: Call; onOpen: (key: string) => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const flow = useContext(Flow)
  const board = useBoard(ws.id, d.parent ? null : d.project_id)
  if (d.parent) return null // one level deep
  const byId = new Map<string, Task>((board.data?.tasks ?? []).map((x) => [x.id, x]))
  const done = d.subtasks.filter((s) => s.done).length
  return (
    <Card keepTitle title={t("task.subtasks")} count={d.subtasks.length ? <Ltr>{`${done}/${d.subtasks.length}`}</Ltr> : undefined} bodyClassName="p-0">
      {d.subtasks.length ? (
        <ul data-subtasks className={flowList(flow)}>
          {d.subtasks.map((s) => {
            const full = byId.get(s.id)
            const overdue = isOverdue(full?.due_at, full?.completed_at)
            return (
              <li key={s.id} className={flowRow(flow)}>
                <button
                  type="button"
                  onClick={() => onOpen(s.key)}
                  className="grid min-h-12 w-full grid-cols-[1rem_minmax(0,1fr)_auto_5.5rem] items-center gap-3 px-4 text-start text-sm hover:bg-muted/50"
                >
                  {s.done ? <CheckCircle2Icon className="size-4 text-nq-ok-text" /> : <CircleIcon className="size-4 text-muted-foreground" />}
                  <span className="flex min-w-0 items-center gap-2">
                    <Ltr mono className="shrink-0 text-xs text-muted-foreground">
                      {s.key}
                    </Ltr>
                    <span dir="auto" className={cn("truncate", s.done && "text-muted-foreground line-through")}>
                      {s.title}
                    </span>
                  </span>
                  <span className="flex min-w-6 justify-end">
                    {full?.assignee_ids[0] ? <PersonAvatar id={full.assignee_ids[0]} dir={dir} /> : null}
                  </span>
                  <span className={cn("text-end text-caption tabular-nums", overdue ? "text-nq-danger-text" : "text-muted-foreground")}>
                    {full?.due_at ? <Ltr>{formatDay(full.due_at, locale, "short")}</Ltr> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : !can ? (
        <p className="p-4 text-sm text-muted-foreground">{t("task.noSubtasks")}</p>
      ) : null}
      {can ? (
        <AddForm
          placeholder={t("task.addSubtask")}
          onAdd={(v) => call(() => w.post(ws.id, `/api/w/projects/${d.project_id}/tasks`, { title: v, parent: d.key }))}
        />
      ) : null}
    </Card>
  )
}

// ── attachments ─────────────────────────────────────────────────────────────────────

function ImageThumb({ ws, a }: { ws: string; a: Attachment }) {
  const [url, setUrl] = useState<string | null>(null)
  const started = useRef<string | null>(null)
  if (started.current !== a.id && typeof window !== "undefined") {
    started.current = a.id
    fetch(`/api/w/attachments/${encodeURIComponent(a.id)}`, { headers: { "X-Workspace-ID": ws }, credentials: "same-origin" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => b && setUrl(URL.createObjectURL(b)))
      .catch(() => {})
  }
  if (!url) return <span className="size-10 shrink-0 animate-pulse border border-border bg-muted" aria-hidden />
  return (
    <a href={url} target="_blank" rel="noreferrer" className="shrink-0" aria-label={a.file_name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={a.file_name} className="size-10 border border-border object-cover" />
    </a>
  )
}

async function download(ws: string, a: Attachment, failed: string) {
  try {
    const res = await fetch(`/api/w/attachments/${encodeURIComponent(a.id)}`, { headers: { "X-Workspace-ID": ws }, credentials: "same-origin", cache: "no-store" })
    if (!res.ok) throw new Error(String(res.status))
    const url = URL.createObjectURL(await res.blob())
    const link = document.createElement("a")
    link.href = url
    link.download = a.file_name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch {
    toast.error(failed)
  }
}

function AttachmentsCard({
  d,
  can,
  dir,
  files,
  onChanged,
}: {
  d: TaskDetailData
  can: boolean
  dir: Directory
  files: ReturnType<typeof useAttachments>
  onChanged: () => Promise<void>
}) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const flow = useContext(Flow)
  const list = files.data?.attachments ?? []
  return (
    <Card title={t("task.attachments")} count={list.length ? <Ltr>{list.length}</Ltr> : undefined} bodyClassName="p-0">
      {can ? (
        <div className={flow ? "pb-1" : "p-4"}>
          <AttachmentDropzone
            upload={(file) => w.upload(ws.id, `/api/w/tasks/${d.id}/attachments`, file)}
            onUploaded={() => {
              void files.mutate()
              void onChanged()
            }}
          />
        </div>
      ) : null}
      {list.length ? (
        <ul data-attachments className={cn(flowList(flow), can && !flow && "border-t border-border")}>
          {list.map((a) => (
            <li key={a.id} className={cn("flex min-h-14 items-center gap-3 px-4 py-2 text-sm", flowRow(flow))}>
              {a.content_type.startsWith("image/") ? <ImageThumb ws={ws.id} a={a} /> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" dir="auto">
                  {a.file_name}
                </p>
                <p className="text-caption text-muted-foreground">
                  <Ltr>{fileSize(a.size)}</Ltr> · <span dir="ltr">{dir.name(a.uploaded_by)}</span> · <Ltr>{timeAgo(a.created_at, locale)}</Ltr>
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={t("task.download", { file: a.file_name })} onClick={() => download(ws.id, a, t("task.downloadFailed"))}>
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
                      await w.del(ws.id, `/api/w/attachments/${a.id}`)
                      void files.mutate()
                      void onChanged()
                    } catch (err) {
                      toast.error(errorText(err, t("common.networkError")))
                    }
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : !can ? (
        <p className="p-4 text-sm text-muted-foreground">{t("task.noAttachments")}</p>
      ) : null}
    </Card>
  )
}

// ── discussion (issue comments + card comments, one thread) ────────────────────────────

const MENTION_TOKEN = /(@[A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)/g

function CardCommentBody({ c, dir }: { c: Comment; dir: Directory }) {
  const mentioned = new Set(c.mentions.map((id) => dir.name(id).toLowerCase()))
  return (
    <p className="text-sm whitespace-pre-wrap text-nq-fg-body" dir="auto">
      {c.body.split(MENTION_TOKEN).map((part, i) => {
        if (i % 2 === 1) {
          const h = part.slice(1).toLowerCase()
          const hit = [...mentioned].some((e) => e === h || e.split("@")[0] === h)
          if (hit)
            return (
              <span key={i} className="font-medium text-nq-accent-text" dir="ltr" data-mention>
                {part}
              </span>
            )
        }
        return part
      })}
    </p>
  )
}

type Entry =
  | { kind: "issue"; id: string; at: string; c: IssueComment }
  | { kind: "card"; id: string; at: string; c: Comment }

function Discussion({
  d,
  issue,
  can,
  dir,
  comments,
  onChanged,
  patchIssue,
}: {
  d: TaskDetailData
  issue: (Issue & { comments: IssueComment[] }) | undefined
  can: boolean
  dir: Directory
  comments: ReturnType<typeof useComments>
  onChanged: () => Promise<void>
  patchIssue: (f: IssuePatch) => Promise<boolean>
}) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const author = useCommentAuthor()
  const flow = useContext(Flow)
  const form = useCommentForm(d.key, onChanged)
  const [cardBody, setCardBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)

  // The issue thread already mirrors card comments; keep the card copy (it is editable).
  const cardList = comments.data?.comments ?? []
  const mirrored = (c: IssueComment) => cardList.some((x) => x.id === c.id || (x.author_id === c.author_id && x.body === c.body))
  const entries: Entry[] = [
    ...(issue?.comments ?? []).filter((c) => !mirrored(c)).map((c): Entry => ({ kind: "issue", id: c.id, at: c.created_at, c })),
    ...(comments.data?.comments ?? []).map((c): Entry => ({ kind: "card", id: c.id, at: c.created_at, c })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  // Issue comments carry @agent / skills; a card with no issue behind it falls back to card comments.
  const viaIssue = !!issue
  const canPost = viaIssue ? form.canWrite : can
  const sendCard = async () => {
    const v = cardBody.trim()
    if (!v) return
    setBusy(true)
    try {
      await w.post(ws.id, `/api/w/tasks/${d.id}/comments`, { body: v })
      setCardBody("")
      void comments.mutate()
      void onChanged()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={t("td.discussion")} count={entries.length ? <Ltr>{entries.length}</Ltr> : undefined} bodyClassName="p-0" className="min-w-0" >
      {canPost ? (
        <div className={flow ? "mb-2 rounded-lg border border-border bg-card p-3" : "border-b border-border p-4"}>
          {viaIssue ? (
            <form onSubmit={form.submit} className="flex flex-col gap-3">
              <MentionTextarea
                value={form.value}
                onChange={form.setValue}
                projectId={d.project_id}
                onChoose={(kind, name) => void patchIssue(kind === "agent" ? { agent: name } : { skill: name })}
                disabled={form.posting}
                placeholder={t("td.composerPlaceholder")}
                rows={2}
              />
              {form.error ? (
                <p role="alert" className="text-sm text-nq-danger-text">
                  {form.error}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-caption text-muted-foreground">{t("issues.mentionHint")}</p>
                <Button variant="primary" type="submit" size="sm" disabled={form.posting || !form.value.trim()}>
                  <SendIcon className="rtl:-scale-x-100" />
                  {form.posting ? t("issues.comments.posting") : t("td.send")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <Textarea aria-label={t("task.addComment")} rows={2} dir="auto" value={cardBody} onChange={(e) => setCardBody(e.target.value)} placeholder={t("task.commentPlaceholder")} />
              <div className="flex items-center justify-between gap-3">
                <p className="text-caption text-muted-foreground">{t("task.commentHint")}</p>
                <Button variant="primary" size="sm" disabled={busy || !cardBody.trim()} onClick={() => void sendCard()}>
                  <SendIcon className="rtl:-scale-x-100" />
                  {t("td.send")}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {entries.length ? (
        <ol data-comments className={cn(flowList(flow), flow && "gap-3")}>
          {entries.map((e) => {
            const authorId = e.kind === "card" ? e.c.author_id : e.c.author_id
            const isAgent = e.c.author_kind === "agent"
            const name = e.kind === "card" ? dir.name(e.c.author_id) : author(e.c)
            const mine = e.kind === "card" && e.c.author_id === dir.me && can
            return (
              <li key={`${e.kind}-${e.id}`} data-comment={e.id} className={cn("flex gap-3 p-4", flowRow(flow))}>
                {authorId ? <PersonAvatar id={authorId} dir={dir} className="mt-0.5 shrink-0" /> : <BotIcon className="mt-1 size-5 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-6 flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                    <span className="text-sm font-medium text-foreground" dir="ltr">
                      {name}
                    </span>
                    {isAgent ? (
                      <Badge variant="outline" className="gap-1">
                        <BotIcon />
                        {t("activity.viaMcp")}
                      </Badge>
                    ) : null}
                    <Ltr>{timeAgo(e.at, locale)}</Ltr>
                    {e.kind === "card" && e.c.edited_at ? <span>({t("task.edited")})</span> : null}
                    {mine ? (
                      <span className="ms-auto flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing({ id: e.id, body: (e.c as Comment).body })}>
                          {t("common.edit")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              await w.del(ws.id, `/api/w/comments/${e.id}`)
                              void comments.mutate()
                              void onChanged()
                            } catch (err) {
                              toast.error(errorText(err, t("common.networkError")))
                            }
                          }}
                        >
                          {t("common.delete")}
                        </Button>
                      </span>
                    ) : null}
                  </div>
                  {editing?.id === e.id ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <Textarea aria-label={t("task.editComment")} rows={3} dir="auto" value={editing.body} onChange={(ev) => setEditing({ id: e.id, body: ev.target.value })} />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                          {t("common.cancel")}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!editing.body.trim()}
                          onClick={async () => {
                            try {
                              await w.patch(ws.id, `/api/w/comments/${e.id}`, { body: editing.body })
                              setEditing(null)
                              void comments.mutate()
                            } catch (err) {
                              toast.error(errorText(err, t("common.networkError")))
                            }
                          }}
                        >
                          {t("common.save")}
                        </Button>
                      </div>
                    </div>
                  ) : e.kind === "card" ? (
                    <CardCommentBody c={e.c} dir={dir} />
                  ) : (
                    <Markdown className="text-sm">{e.c.body}</Markdown>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t("issues.noComments")}</p>
      )}
    </Card>
  )
}

// ── time tab ──────────────────────────────────────────────────────────────────────────

function TimeCard({ d, time, dir }: { d: TaskDetailData; time: ReturnType<typeof useTaskTime>; dir: Directory }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const flow = useContext(Flow)
  return (
    <Card
      title={t("td.tab.time")}
      count={time.seconds ? <Ltr>{hm(time.seconds)}</Ltr> : undefined}
      action={!d.project.archived ? <StartTimerButton task={{ id: d.id, key: d.key, title: d.title }} /> : null}
      bodyClassName="p-0"
    >
      {!ws.can("time:track") ? (
        <p className="p-4 text-sm text-muted-foreground">{t("td.timeHidden")}</p>
      ) : time.loading ? (
        <LoadingRows rows={2} />
      ) : time.entries.length ? (
        <ul data-time-entries className={flowList(flow)}>
          {time.entries.map((e) => (
            <li key={e.id} className={cn("grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 text-sm", flowRow(flow))}>
              <div className="flex min-w-0 items-center gap-3">
                <PersonAvatar id={e.user_id} dir={dir} />
                <div className="min-w-0">
                  <p dir="auto" className="truncate">
                    {e.description || dir.name(e.user_id)}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    <Ltr>{formatDay(e.started_at, locale)}</Ltr>
                  </p>
                </div>
              </div>
              <Ltr className="font-mono tabular-nums">{e.ended_at ? hm(e.duration_s ?? 0) : t("td.running")}</Ltr>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t("td.noTime")} />
      )}
    </Card>
  )
}

// ── the info rail ────────────────────────────────────────────────────────────────────────

function InfoCard({
  d,
  issue,
  statuses,
  dir,
  labels,
  can,
  canIssue,
  done,
  loggedSeconds,
  call,
  patch,
  patchIssue,
  move,
  toggleDone,
  canToggle,
  createLabel,
}: {
  d: TaskDetailData
  issue: (Issue & { comments: IssueComment[] }) | undefined
  statuses: TaskDetailData["status"][]
  dir: Directory
  labels: Label[]
  can: boolean
  canIssue: boolean
  done: boolean
  loggedSeconds: number
  call: Call
  patch: (b: Record<string, unknown>) => Promise<boolean>
  patchIssue: (f: IssuePatch) => Promise<boolean>
  move: (id: string) => Promise<boolean>
  toggleDone: () => void
  canToggle: boolean
  createLabel?: (name: string) => Promise<Label>
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const overdue = isOverdue(d.due_at, d.completed_at)
  const status = statuses.find((s) => s.id === d.status_id)

  return (
    <Card
      title={t("td.info")}
      action={
        can && canToggle ? (
          <Button variant={done ? "secondary" : "primary"} size="sm" onClick={toggleDone} data-finish-task>
            <CheckIcon />
            {done ? t("td.reopenTask") : t("td.finish")}
          </Button>
        ) : null
      }
    >
      <dl className="flex flex-col">
        <InfoRow label={t("task.status")} htmlFor="td-status">
          <div className={rowControl}>
            <StatusSelect id="td-status" statuses={statuses} value={d.status_id} disabled={!can} onChange={(s) => void move(s)} />
          </div>
        </InfoRow>
        <InfoRow label={t("task.priority")} htmlFor="td-priority">
          <div className={rowControl}>
            <PrioritySelect id="td-priority" value={d.priority} disabled={!can} onChange={(p: Priority) => void patch({ priority: p })} />
          </div>
        </InfoRow>
        <InfoRow label={t("td.project")}>
          <TaskProjectAvatar project={d.project} className="size-5 text-[0.55rem]" />
          <span className="truncate text-sm">{d.project.name}</span>
        </InfoRow>
        <InfoRow label={t("td.list")}>
          <ColorDot color={status?.color} />
          <span className="truncate text-sm">{status?.name ?? "—"}</span>
        </InfoRow>
        <InfoRow label={t("task.assignees")}>
          <MemberPicker
            dir={dir}
            selected={d.assignee_ids}
            disabled={!can}
            onChange={(ids) => void call(() => w.put(ws.id, `/api/w/tasks/${d.id}/assignees`, { user_ids: ids }))}
          />
        </InfoRow>
        <InfoRow label={t("task.due")} htmlFor="td-due">
          <DateField id="td-due" value={dayKey(d.due_at)} disabled={!can} tone={overdue ? "danger" : undefined} onChange={(v) => void patch({ due_at: v ?? "" })} />
        </InfoRow>
        <InfoRow label={t("task.estimate")} htmlFor="td-estimate">
          <EstimateField d={d} can={can} patch={patch} />
        </InfoRow>
        {ws.can("time:track") ? (
          <InfoRow label={t("td.logged")}>
            <ClockIcon className="size-4 shrink-0 text-muted-foreground" />
            <Ltr className="text-sm tabular-nums">{loggedSeconds ? hm(loggedSeconds) : "—"}</Ltr>
            {!d.project.archived ? <StartTimerButton task={{ id: d.id, key: d.key, title: d.title }} variant="icon" className="ms-auto" /> : null}
          </InfoRow>
        ) : null}
        {issue ? (
          <>
            <InfoRow label={t("issues.typeLabel")} htmlFor="td-type">
              <div className={rowControl}>
                <SimpleSelect
                  id="td-type"
                  value={issue.issue_type}
                  disabled={!canIssue}
                  items={ISSUE_TYPES.map((x) => ({ value: x, label: t(`issues.type.${x}`) }))}
                  onChange={(v) => void patchIssue({ issue_type: v as IssueType })}
                />
              </div>
            </InfoRow>
            <InfoRow label={t("td.issuePriority")} htmlFor="td-ipriority">
              <div className={rowControl}>
                <SimpleSelect
                  id="td-ipriority"
                  value={issue.priority}
                  disabled={!canIssue}
                  items={ISSUE_PRIORITIES.map((x) => ({ value: x, label: t(`issues.priority.${x}`) }))}
                  onChange={(v) => void patchIssue({ priority: v as IssuePriority })}
                />
              </div>
            </InfoRow>
          </>
        ) : null}
        <InfoRow label={t("task.labels")}>
          <div className="flex min-w-0 flex-wrap items-center gap-1 py-1">
            {d.label_ids.length ? <LabelChips ids={d.label_ids} labels={labels} /> : <span className="text-sm text-muted-foreground">{t("task.noLabels")}</span>}
          </div>
        </InfoRow>
      </dl>
    </Card>
  )
}

/** The task's project as its avatar; the task payload has no avatar, so it comes from the (cached) project list. */
function TaskProjectAvatar({ project, className }: { project: TaskDetailData["project"]; className?: string }) {
  const ws = useWorkspace()
  const list = useProjects(ws.id)
  const avatar = list.data?.projects.find((p) => p.id === project.id)?.avatar
  return <ProjectAvatar project={{ ...project, avatar }} className={className} />
}

function EstimateField({ d, can, patch }: { d: TaskDetailData; can: boolean; patch: (b: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useTranslations()
  const [estimate, setEstimate] = useState(d.estimate_minutes ? String(d.estimate_minutes) : "")
  const [lastEstimate, setLastEstimate] = useState(d.estimate_minutes)
  if (d.estimate_minutes !== lastEstimate) {
    setLastEstimate(d.estimate_minutes)
    setEstimate(d.estimate_minutes ? String(d.estimate_minutes) : "")
  }
  return (
    <>
      <Input
        id="td-estimate"
        dir="ltr"
        inputMode="numeric"
        className="h-7 w-20"
        disabled={!can}
        value={estimate}
        placeholder="0"
        onChange={(e) => setEstimate(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          const n = Number(estimate || 0)
          if (n !== (d.estimate_minutes ?? 0)) void patch({ estimate_minutes: n })
        }}
      />
      <span className="text-caption text-muted-foreground">{t("task.minutes")}</span>
    </>
  )
}

/**
 * The side-over's property bar, Linear-style: one line of pills right under the title (status,
 * priority, assignees, due), the rest behind "⋯", and the item actions at the end of the same line.
 */
function SheetBar({
  d,
  issue,
  statuses,
  dir,
  can,
  canIssue,
  loggedSeconds,
  call,
  patch,
  patchIssue,
  move,
  labels,
  createLabel,
  actions,
  footer,
}: {
  d: TaskDetailData
  issue: (Issue & { comments: IssueComment[] }) | undefined
  statuses: TaskDetailData["status"][]
  dir: Directory
  can: boolean
  canIssue: boolean
  loggedSeconds: number
  call: Call
  patch: (b: Record<string, unknown>) => Promise<boolean>
  patchIssue: (f: IssuePatch) => Promise<boolean>
  move: (id: string) => Promise<boolean>
  labels: Label[]
  createLabel?: (name: string) => Promise<Label>
  /** Copy link, the item menu, open full page: pinned to the end of the line. */
  actions: ReactNode
  /** Rendered at the bottom of the "⋯" panel (delete). */
  footer?: ReactNode
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const overdue = isOverdue(d.due_at, d.completed_at)
  const total = d.checklist.length + d.subtasks.length
  const finished = d.checklist.filter((c) => c.done).length + d.subtasks.filter((x) => x.done).length
  const pct = total ? Math.round((finished / total) * 100) : 0
  const agent = !!issue && ws.can("feedback:write")
  return (
    <div className="flex flex-wrap items-center gap-2" data-sheet-bar>
      <div className="w-36">
        <StatusSelect statuses={statuses} value={d.status_id} disabled={!can} onChange={(s) => void move(s)} />
      </div>
      <div className="w-32">
        <PrioritySelect value={d.priority} disabled={!can} onChange={(p: Priority) => void patch({ priority: p })} />
      </div>
      <div className="flex max-w-48 min-w-0">
        <MemberPicker
          dir={dir}
          selected={d.assignee_ids}
          disabled={!can}
          onChange={(ids) => void call(() => w.put(ws.id, `/api/w/tasks/${d.id}/assignees`, { user_ids: ids }))}
        />
      </div>
      <DateField value={dayKey(d.due_at)} disabled={!can} tone={overdue ? "danger" : undefined} onChange={(v) => void patch({ due_at: v ?? "" })} />

      <Popover>
        <PopoverTrigger render={<Button variant="secondary" size="icon-sm" aria-label={t("td.moreFields")} title={t("td.moreFields")} data-sheet-more />}>
          <MoreHorizontalIcon />
        </PopoverTrigger>
        <PopoverContent align="start" className="flex max-h-[70dvh] w-80 flex-col gap-3 overflow-y-auto p-3">
          <dl className="flex flex-col">
            <InfoRow label={t("td.project")}>
              <TaskProjectAvatar project={d.project} className="size-5 text-[0.55rem]" />
              <span className="truncate text-sm">{d.project.name}</span>
            </InfoRow>
            <InfoRow label={t("task.estimate")} htmlFor="td-estimate">
              <EstimateField d={d} can={can} patch={patch} />
            </InfoRow>
            {ws.can("labels:read") || can ? (
              <InfoRow label={t("task.labels")}>
                <div className={rowControl}>
                  <LabelPicker
                    labels={labels}
                    selected={d.label_ids}
                    disabled={!can}
                    onCreate={createLabel}
                    onChange={(ids) => void call(() => w.put(ws.id, `/api/w/tasks/${d.id}/labels`, { label_ids: ids }))}
                  />
                </div>
              </InfoRow>
            ) : null}
            {ws.can("time:track") ? (
              <InfoRow label={t("td.logged")}>
                <ClockIcon className="size-4 shrink-0 text-muted-foreground" />
                <Ltr className="text-sm tabular-nums">{loggedSeconds ? hm(loggedSeconds) : "—"}</Ltr>
                {!d.project.archived ? <StartTimerButton task={{ id: d.id, key: d.key, title: d.title }} variant="icon" className="ms-auto" /> : null}
              </InfoRow>
            ) : null}
            {total ? (
              <InfoRow label={t("td.progress")}>
                <Progress value={pct} aria-label={t("td.progress")} className="min-w-0 flex-1" />
                <Ltr className="text-caption tabular-nums text-muted-foreground">{`${finished}/${total}`}</Ltr>
              </InfoRow>
            ) : null}
            {issue ? (
              <>
                <InfoRow label={t("issues.typeLabel")} htmlFor="td-type">
                  <div className={rowControl}>
                    <SimpleSelect
                      id="td-type"
                      value={issue.issue_type}
                      disabled={!canIssue}
                      items={ISSUE_TYPES.map((x) => ({ value: x, label: t(`issues.type.${x}`) }))}
                      onChange={(v) => void patchIssue({ issue_type: v as IssueType })}
                    />
                  </div>
                </InfoRow>
                <InfoRow label={t("td.issuePriority")} htmlFor="td-ipriority">
                  <div className={rowControl}>
                    <SimpleSelect
                      id="td-ipriority"
                      value={issue.priority}
                      disabled={!canIssue}
                      items={ISSUE_PRIORITIES.map((x) => ({ value: x, label: t(`issues.priority.${x}`) }))}
                      onChange={(v) => void patchIssue({ priority: v as IssuePriority })}
                    />
                  </div>
                </InfoRow>
              </>
            ) : null}
          </dl>
          {agent ? (
            <section className="flex flex-col gap-3 border-t border-border pt-3" data-sheet-agent>
              <h2 className="flex items-center gap-2 text-caption font-medium tracking-wide text-muted-foreground uppercase">
                <BotIcon className="size-3.5" />
                {t("issues.agent.title")}
              </h2>
              <AgentCard bare issue={issue!} canIssue={canIssue} patchIssue={patchIssue} />
            </section>
          ) : null}
          {footer ? <div className="border-t border-border pt-3">{footer}</div> : null}
        </PopoverContent>
      </Popover>

      <div className="ms-auto flex items-center gap-1">{actions}</div>
    </div>
  )
}

/** The side-over while the task loads: the same shape as the real thing, shimmering. */
export function TaskSheetSkeleton() {
  return (
    <div className="flex w-full flex-col gap-5 p-5 lg:p-6" aria-busy data-task-skeleton>
      <div className="flex items-start gap-3 pe-10">
        <Skeleton className="size-9 shrink-0 rounded-md" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-6 w-2/5" />
        </div>
      </div>
      <Skeleton className="ms-12 h-4 w-20" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-36 rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="ms-auto size-8 rounded-md" />
        <Skeleton className="size-8 rounded-md" />
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      <div className="flex gap-5 border-b border-border pb-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  )
}

/** The side-over's item actions, at the end of the property bar: copy link, the item menu, full page. */
function SheetActions({ d, issue, refresh }: { d: TaskDetailData; issue: (Issue & { comments: IssueComment[] }) | undefined; refresh: () => Promise<void> }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [copied, setCopied] = useState(false)
  const path = `/${locale}/w/${ws.slug}/projects/${d.project_id}/issues/${encodeURIComponent(d.key)}`
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("td.copyLink")}
        title={t("td.copyLink")}
        onClick={async () => {
          if (await copyText(`${window.location.origin}${path}`)) {
            setCopied(true)
            toast.success(t("td.linkCopied"))
            setTimeout(() => setCopied(false), 1800)
          }
        }}
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t("task.openFullPage")} title={t("task.openFullPage")} nativeButton={false} render={<Link href={path} />}>
        <Maximize2Icon />
      </Button>
      {issue ? (
        <IssueActionsMenu
          issue={issue}
          onChanged={refresh}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={t("td.more")} title={t("td.more")}>
              <EllipsisVerticalIcon />
            </Button>
          }
        />
      ) : null}
    </>
  )
}

function SimpleSelect({ id, value, items, onChange, disabled }: { id: string; value: string; items: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Select items={items} value={value} onValueChange={(v) => v && onChange(String(v))} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AgentCard({ issue, canIssue, patchIssue, bare }: { issue: Issue; canIssue: boolean; patchIssue: (f: IssuePatch) => Promise<boolean>; bare?: boolean }) {
  const { t } = useTranslations()
  return (
    <Card title={bare ? undefined : t("issues.agent.title")} bare={bare}>
      <div className="flex flex-col gap-4">
        <label className="flex items-start gap-3 border border-border p-3">
          <Switch checked={issue.human_only} disabled={!canIssue} onCheckedChange={(v) => void patchIssue({ human_only: Boolean(v) })} />
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-sm">
              <UserRoundIcon className="size-3.5" />
              {t("issues.humanOnly")}
            </span>
            <span className="text-caption text-muted-foreground">{t("issues.humanOnlyHint")}</span>
          </span>
        </label>
        <IssueAgentSettings issue={issue} onPatch={patchIssue} disabled={!canIssue} />
      </div>
    </Card>
  )
}

function ProgressCard({ d }: { d: TaskDetailData }) {
  const { t } = useTranslations()
  const total = d.checklist.length + d.subtasks.length
  const done = d.checklist.filter((c) => c.done).length + d.subtasks.filter((s) => s.done).length
  const pct = total ? Math.round((done / total) * 100) : d.completed_at ? 100 : 0
  return (
    <Card
      title={t("td.progress")}
      action={
        <span dir="ltr" className="text-lg font-semibold tabular-nums">
          {pct}%
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <Progress value={pct} aria-label={t("td.progress")} />
        <p className="text-caption text-muted-foreground">
          {total ? t("td.progressOf", { done, total }) : t("td.noProgress")}
        </p>
      </div>
    </Card>
  )
}

function RecentActivity({
  items,
  loading,
  dir,
  onAll,
}: {
  items: ReturnType<typeof useTaskActivity>["data"] extends infer T ? (T extends { activity: infer A } ? A | undefined : never) : never
  loading: boolean
  dir: Directory
  onAll: () => void
}) {
  const { t, locale } = useTranslations()
  const recent = (items ?? []).slice(0, 3)
  return (
    <Card title={t("td.recent")} bodyClassName="p-0">
      {loading ? (
        <LoadingRows rows={2} />
      ) : recent.length ? (
        <ul className="divide-y divide-line">
          {recent.map((a) => (
            <li key={a.id} className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-sm">
              <PersonAvatar id={a.actor_id} dir={dir} />
              <span className="min-w-0 truncate text-nq-fg-body">
                <span className="font-medium text-foreground" dir="ltr">
                  {dir.name(a.actor_id)}
                </span>{" "}
                {activityVerb(a.action, t)}
              </span>
              <Ltr className="text-caption text-muted-foreground">{timeAgo(a.created_at, locale)}</Ltr>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t("activity.empty")}</p>
      )}
      <div className="border-t border-border p-2">
        <Button variant="ghost" size="sm" className="w-full" onClick={onAll}>
          {t("td.viewAllActivity")}
        </Button>
      </div>
    </Card>
  )
}

function activityVerb(action: string, t: (k: string, v?: Record<string, string | number>) => string) {
  const k = `activity.${action}.here`
  const s = t(k, { fields: "", from: "", to: "", key: "", title: "" })
  return s === k ? t("activity.generic", { action }) : s.replace(/\s+/g, " ").trim()
}

