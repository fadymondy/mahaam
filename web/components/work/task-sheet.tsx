"use client"

// The task side-over (?task=MH-12 on any project tab): the same TaskDetail as the full page,
// in its single-column "sheet" layout. Every field saves on its own; the board and lists
// revalidate through onChanged. Its inner edge drags to resize; the width is remembered.
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetTitle } from "@fadymondy/nasaq/web"
import { useState, type CSSProperties, type PointerEvent } from "react"

import { TaskDetail } from "@/components/work/task-detail"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Status } from "@/lib/work"

const WIDTH_KEY = "mahaam.taskSheet.width"
const MIN_WIDTH = 480

function storedWidth(): number | null {
  if (typeof window === "undefined") return null
  const n = Number(window.localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(n) && n >= MIN_WIDTH ? n : null
}

export function TaskSheet({
  taskKey,
  onClose,
  onOpen,
  onChanged,
}: {
  taskKey: string | null
  /** Kept for the caller's signature; the detail reads the project's columns itself. */
  statuses?: Status[]
  onClose: () => void
  onOpen: (key: string) => void
  onChanged: () => void
}) {
  const { t } = useTranslations()
  const [width, setWidth] = useState<number | null>(storedWidth)

  // The sheet sits at the inline end, so its handle is on the start edge: dragging toward the
  // start widens it (left in LTR, right in RTL).
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const rtl = getComputedStyle(handle).direction === "rtl"
    let last = width
    const move = (ev: globalThis.PointerEvent) => {
      const raw = rtl ? ev.clientX : window.innerWidth - ev.clientX
      last = Math.round(Math.min(Math.max(raw, MIN_WIDTH), window.innerWidth - 48))
      setWidth(last)
    }
    const up = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      if (last) window.localStorage.setItem(WIDTH_KEY, String(last))
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  }
  const resetWidth = () => {
    setWidth(null)
    window.localStorage.removeItem(WIDTH_KEY)
  }

  return (
    <Sheet open={!!taskKey} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="end"
        className={cn(
          "w-full gap-0 overflow-hidden p-0",
          width ? "sm:w-(--task-sheet-w) sm:max-w-[calc(100vw-3rem)]!" : "sm:max-w-2xl! lg:max-w-4xl!",
        )}
        style={width ? ({ "--task-sheet-w": `${width}px` } as CSSProperties) : undefined}
        data-task-sheet={taskKey ?? ""}
      >
        <SheetTitle className="sr-only">{taskKey ?? t("task.title")}</SheetTitle>
        <SheetDescription className="sr-only">{t("td.info")}</SheetDescription>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("task.resizeSheet")}
          title={t("task.resizeSheet")}
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
          className="group/resize absolute inset-y-0 start-0 z-20 hidden w-2 cursor-col-resize touch-none sm:block"
          data-sheet-resize
        >
          <span className="absolute inset-y-0 start-0 w-0.5 bg-transparent transition-colors group-hover/resize:bg-nq-action group-active/resize:bg-nq-action" />
        </div>
        {/* The panel itself stays put so the resize handle spans its full height; this scrolls. */}
        <SheetBody>
          {taskKey ? <TaskDetail taskKey={taskKey} layout="sheet" onOpen={onOpen} onChanged={onChanged} onClose={onClose} /> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
