"use client"

// The global timer bar in the workspace header, and ⌘K "Start timer on…". Every tab and device
// shows the same timer: the shell mounts the per-user live stream (lib/time.ts), which updates the
// running-timer cache on timer.started / timer.stopped.
import { useEffect, useState, type FormEvent } from "react"
import { CornerDownLeftIcon, PlayIcon, SquareIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Popover, PopoverContent, PopoverTrigger } from "@fadymondy/nasaq/web"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"





import { Ltr } from "@/components/copy-field"
import { TargetPicker, projectTarget, targetBody, taskTarget, useTargets, type Target } from "@/components/time/targets"
import { ColorDot } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { clock, entrySeconds, timeApi, useNow, useRefreshTime, useRunning, type StartBody } from "@/lib/time"
import { errorText } from "@/lib/work"

/** Start/stop with toasts and cache updates; shared by the bar, the palette and the start buttons. */
export function useTimerActions() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const running = useRunning(ws.id, ws.can("time:track"))
  const refresh = useRefreshTime()
  const [busy, setBusy] = useState(false)
  async function start(body: StartBody) {
    setBusy(true)
    try {
      const res = await timeApi.start(ws.id, body)
      await running.mutate({ timer: res.started }, { revalidate: false })
      void refresh(ws.id)
      toast.success(t("timer.started"))
      return true
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      void running.mutate()
      return false
    } finally {
      setBusy(false)
    }
  }
  async function stop() {
    setBusy(true)
    try {
      await timeApi.stop(ws.id)
      await running.mutate({ timer: null }, { revalidate: false })
      void refresh(ws.id)
      toast.success(t("timer.stopped"))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      void running.mutate()
    } finally {
      setBusy(false)
    }
  }
  return { timer: running.data?.timer ?? null, loading: running.isLoading, busy, start, stop }
}

export function TimerBar() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const canTrack = ws.can("time:track")
  const { timer, busy, start, stop } = useTimerActions()
  const now = useNow(1000, !!timer)
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState(false)

  useEffect(() => {
    if (!canTrack) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [canTrack])

  if (!canTrack) return null

  const what = timer ? timer.description || timer.task_title || timer.project_name || t("timer.running") : ""
  const where = timer ? [timer.task_key, timer.project_name].filter(Boolean).join(" · ") : ""

  return (
    <div data-timer-bar data-running={timer ? "true" : "false"} className="flex min-w-0 items-center">
      {timer ? (
        <div className="flex h-8 min-w-0 items-center gap-2 border border-border bg-card ps-2.5 pe-0.5" data-timer-running={timer.id}>
          <span className="relative flex size-2.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: "var(--nq-action)" }} />
            <ColorDot color={timer.project_color ?? "violet"} className="relative" />
          </span>
          <span className="hidden max-w-[16rem] min-w-0 truncate text-sm md:inline" title={where ? `${what} — ${where}` : what} data-timer-what>
            {what}
          </span>
          {where ? <span className="hidden max-w-[12rem] truncate text-caption text-muted-foreground xl:inline">{where}</span> : null}
          <Ltr mono className="text-sm tabular-nums" data-timer-elapsed>
            {clock(entrySeconds(timer, now))}
          </Ltr>
          <Button size="icon-sm" variant="ghost" aria-label={t("timer.stopTimer")} title={t("timer.stopTimer")} disabled={busy} onClick={stop} data-timer-stop>
            <SquareIcon />
          </Button>
        </div>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="secondary" size="sm" aria-label={t("timer.start")} title={t("timer.shortcut")} data-timer-start />}>
            <PlayIcon />
            <span className="hidden sm:inline">{t("timer.start")}</span>
            <kbd className="hidden font-mono text-xs text-muted-foreground lg:inline" dir="ltr">
              ⌘K
            </kbd>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <StartForm
              busy={busy}
              onStart={async (body) => {
                if (await start(body)) setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <StartPalette
        open={palette}
        onOpenChange={setPalette}
        onStart={async (body) => {
          if (await start(body)) setPalette(false)
        }}
      />
    </div>
  )
}

function StartForm({ onStart, busy }: { onStart: (b: StartBody) => void; busy: boolean }) {
  const { t } = useTranslations()
  const [desc, setDesc] = useState("")
  const [target, setTarget] = useState<Target>({})
  function submit(e: FormEvent) {
    e.preventDefault()
    onStart({ ...targetBody(target), description: desc.trim() || undefined })
  }
  return (
    <form onSubmit={submit} className="space-y-3 p-3" data-timer-form>
      <Input autoFocus dir="auto" placeholder={t("timer.whatAreYouDoing")} value={desc} onChange={(e) => setDesc(e.target.value)} data-timer-description />
      <TargetPicker value={target} onChange={setTarget} />
      <Button variant="primary" type="submit" className="w-full" disabled={busy}>
        <PlayIcon />
        {t("timer.start")}
      </Button>
    </form>
  )
}

/** ⌘K: type what you're doing, pick a project or task (or none), Enter starts it. */
function StartPalette({ open, onOpenChange, onStart }: { open: boolean; onOpenChange: (o: boolean) => void; onStart: (b: StartBody) => void }) {
  const { t } = useTranslations()
  const [query, setQuery] = useState("")
  const { projects, tasks, byProject } = useTargets(query, open)
  useEffect(() => {
    if (!open) setQuery("")
  }, [open])
  const text = query.trim()
  const go = (target: Target, withText = true) => onStart({ ...targetBody(target), description: withText && text ? text : undefined })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl" data-timer-palette>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("timer.palette")}</DialogTitle>
          <DialogDescription>{t("timer.paletteHint")}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput autoFocus placeholder={t("timer.palette")} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-96">
            <CommandEmpty>{t("timer.noMatch")}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__free" onSelect={() => go({})} data-palette-free>
                <PlayIcon />
                <span className="truncate">{text ? t("timer.startFree", { text }) : t("timer.startBlank")}</span>
                <CornerDownLeftIcon className="ms-auto text-muted-foreground" />
              </CommandItem>
            </CommandGroup>
            {tasks.length ? (
              <CommandGroup heading={t("timer.tasks")}>
                {tasks.map((task) => (
                  <CommandItem key={task.id} value={`t:${task.id}`} onSelect={() => go(taskTarget(task, byProject), false)} data-palette-task={task.key}>
                    <ColorDot color={byProject.get(task.project_id)?.color} />
                    <Ltr mono className="text-xs text-muted-foreground">
                      {task.key}
                    </Ltr>
                    <span className="truncate">{task.title}</span>
                    <span className="ms-auto truncate text-caption text-muted-foreground">{byProject.get(task.project_id)?.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {projects.length ? (
              <CommandGroup heading={t("timer.projects")}>
                {projects.slice(0, 8).map((p) => (
                  <CommandItem key={p.id} value={`p:${p.id}`} onSelect={() => go(projectTarget(p), false)} data-palette-project={p.id}>
                    <ColorDot color={p.color} />
                    <span className="truncate">{p.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
