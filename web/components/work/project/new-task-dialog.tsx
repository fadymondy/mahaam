"use client"

// "New task" from the project header and overview: a title is enough, the task lands in the first column.
import { useState, type FormEvent, type ReactNode } from "react"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@fadymondy/nasaq/web"

import { FormError } from "@/components/form-text"
import { useProjectCtx } from "@/components/work/project-context"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { errorText, w, type TaskDetail } from "@/lib/work"

export function NewTaskDialog({ trigger }: { trigger: (open: () => void) => ReactNode }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const { project: p, reload, openTask } = useProjectCtx()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError(t("po.taskTitleRequired"))
      return
    }
    setBusy(true)
    setError("")
    try {
      const task = await w.post<TaskDetail>(ws.id, `/api/w/projects/${encodeURIComponent(p.id)}/tasks`, { title: title.trim() })
      toast.success(t("po.taskCreated"))
      setOpen(false)
      setTitle("")
      reload()
      openTask(task.key)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("po.newTask")}</DialogTitle>
            </DialogHeader>
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("po.taskTitlePlaceholder")} aria-label={t("po.taskTitle")} />
            {error ? <FormError>{error}</FormError> : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("po.createTask")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
