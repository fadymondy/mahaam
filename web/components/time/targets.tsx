"use client"

// What a timer or an entry is on: a project, a task (which implies its project), or nothing.
// Popover + Command, composed from the registry primitives the task fields already use; tasks are
// searched on the server (/api/w/tasks?q=), so the list stays short however many tasks there are.
import { useMemo, useState } from "react"
import useSWR from "swr"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import { Button, Popover, PopoverContent, PopoverTrigger } from "@fadymondy/nasaq/web"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"



import { Ltr } from "@/components/copy-field"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useProjects, type Project, type Task } from "@/lib/work"

export type Target = {
  project?: { id: string; name: string; color: string }
  task?: { id: string; key: string; title: string }
}

/** Active projects matching `query`, and tasks the server finds for it (in-progress ones when empty). */
export function useTargets(query: string, enabled = true) {
  const ws = useWorkspace()
  const projects = useProjects(ws.id)
  const q = query.trim()
  const tasks = useSWR(
    enabled ? ["/api/w/tasks", ws.id, q] : null,
    ([, id, text]: [string, string, string]) =>
      api<{ tasks: Task[] }>(`/api/w/tasks?limit=15${text ? `&q=${encodeURIComponent(text)}` : "&category=doing"}`, { workspaceId: id }),
    { keepPreviousData: true, revalidateOnFocus: false },
  )
  const all = useMemo(() => projects.data?.projects ?? [], [projects.data])
  const byProject = useMemo(() => new Map(all.map((p) => [p.id, p])), [all])
  const list = q ? all.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : all
  return { projects: list, tasks: tasks.data?.tasks ?? [], byProject }
}

export function projectTarget(p: Project): Target {
  return { project: { id: p.id, name: p.name, color: p.color } }
}

export function taskTarget(task: Task, byProject: Map<string, Project>): Target {
  const p = byProject.get(task.project_id)
  return { task: { id: task.id, key: task.key, title: task.title }, project: p ? { id: p.id, name: p.name, color: p.color } : undefined }
}

/** The API body fields for a target: a task wins over its project. */
export function targetBody(t: Target): { project?: string; task?: string } {
  if (t.task) return { task: t.task.id }
  if (t.project) return { project: t.project.id }
  return {}
}

export function TargetLabel({ target, className }: { target: Target; className?: string }) {
  const { t } = useTranslations()
  if (!target.project && !target.task) return <span className={cn("text-muted-foreground", className)}>{t("timer.noProject")}</span>
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <ColorDot color={target.project?.color} />
      {target.task ? (
        <>
          <Ltr mono className="shrink-0 text-xs text-muted-foreground">
            {target.task.key}
          </Ltr>
          <span className="truncate">{target.task.title}</span>
        </>
      ) : (
        <span className="truncate">{target.project?.name}</span>
      )}
    </span>
  )
}

export function TargetPicker({ value, onChange, id, disabled }: { value: Target; onChange: (t: Target) => void; id?: string; disabled?: boolean }) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const { projects, tasks, byProject } = useTargets(query, open)
  const pick = (next: Target) => {
    onChange(next)
    setOpen(false)
    setQuery("")
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button id={id} variant="secondary" disabled={disabled} className="w-full justify-between font-normal" data-target-picker />}
      >
        <TargetLabel target={value} />
        <ChevronsUpDownIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("timer.search")} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t("timer.noMatch")}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none" onSelect={() => pick({})}>
                <span className="text-muted-foreground">{t("timer.noProject")}</span>
                {!value.project && !value.task ? <CheckIcon className="ms-auto" /> : null}
              </CommandItem>
            </CommandGroup>
            {projects.length ? (
              <CommandGroup heading={t("timer.projects")}>
                {projects.slice(0, 8).map((p) => (
                  <CommandItem key={p.id} value={`p:${p.id}`} onSelect={() => pick(projectTarget(p))} data-target-project={p.id}>
                    <ColorDot color={p.color} />
                    <span className="truncate">{p.name}</span>
                    {value.project?.id === p.id && !value.task ? <CheckIcon className="ms-auto" /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {tasks.length ? (
              <CommandGroup heading={t("timer.tasks")}>
                {tasks.map((task) => (
                  <CommandItem key={task.id} value={`t:${task.id}`} onSelect={() => pick(taskTarget(task, byProject))} data-target-task={task.key}>
                    <ColorDot color={byProject.get(task.project_id)?.color} />
                    <Ltr mono className="text-xs text-muted-foreground">
                      {task.key}
                    </Ltr>
                    <span className="truncate">{task.title}</span>
                    {value.task?.id === task.id ? <CheckIcon className="ms-auto" /> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
