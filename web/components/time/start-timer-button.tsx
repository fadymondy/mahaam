"use client"

// "Start timer" on a task (side-over, board card). When this task's timer is running it becomes
// "Stop timer" with the running clock. Stops pointer/click/key events so a board card's drag and
// open handlers never see them.
import type { SyntheticEvent } from "react"
import { PlayIcon, SquareIcon } from "lucide-react"

import { Button } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { useTimerActions } from "@/components/time/timer-bar"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { clock, entrySeconds, useNow } from "@/lib/time"
import { cn } from "@/lib/utils"

const swallow = (e: SyntheticEvent) => e.stopPropagation()

export function StartTimerButton({
  task,
  variant = "button",
  className,
}: {
  task: { id: string; key: string; title: string }
  variant?: "button" | "icon"
  className?: string
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const { timer, busy, start, stop } = useTimerActions()
  const here = !!timer && timer.task_id === task.id
  const now = useNow(1000, here)
  if (!ws.can("time:track")) return null

  const label = here ? t("timer.stopHere") : t("timer.startOnTask", { key: task.key })
  const onClick = (e: SyntheticEvent) => {
    e.stopPropagation()
    if (here) void stop()
    else void start({ task: task.id })
  }
  const common = {
    onPointerDown: swallow,
    onKeyDown: swallow,
    onClick,
    disabled: busy,
    "aria-label": label,
    title: label,
    "data-start-timer": task.key,
    "data-running-here": here ? "true" : "false",
  }

  if (variant === "icon") {
    return (
      <Button size="icon-sm" variant={here ? "primary" : "secondary"} className={cn("bg-grid-card", here && "bg-grid-action", className)} {...common}>
        {here ? <SquareIcon /> : <PlayIcon />}
      </Button>
    )
  }
  return (
    <Button size="sm" variant={here ? "primary" : "secondary"} className={className} {...common}>
      {here ? <SquareIcon /> : <PlayIcon />}
      {here ? t("timer.stopHere") : t("timer.startHere")}
      {here && timer ? (
        <Ltr mono className="tabular-nums">
          {clock(entrySeconds(timer, now))}
        </Ltr>
      ) : null}
    </Button>
  )
}
