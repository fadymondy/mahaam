"use client"

// Add or edit a time entry. The date picker is the registry composition the task fields use
// (Calendar + Popover, components/work/fields DateField); times are HH:MM in the WORKSPACE timezone.
// New entries send date + HH:MM and the server places them (an end at or before the start is the
// next day); edits send exact instants computed here in the workspace timezone (DST-safe).
import { useState, type FormEvent } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { TargetPicker, targetBody, type Target } from "@/components/time/targets"
import { DateField } from "@/components/work/fields"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { addDays, dayIn, timeApi, timeIn, zonedToUtc, type TimeEntry } from "@/lib/time"
import { errorText } from "@/lib/work"

function entryTarget(e: TimeEntry): Target {
  return {
    project: e.project_id ? { id: e.project_id, name: e.project_name ?? "", color: e.project_color ?? "slate" } : undefined,
    task: e.task_id ? { id: e.task_id, key: e.task_key ?? "", title: e.task_title ?? "" } : undefined,
  }
}

export function EntryForm({
  entry,
  day,
  tz,
  user,
  onDone,
}: {
  entry?: TimeEntry
  day: string
  tz: string
  user?: string | null
  onDone: () => void
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const running = !!entry && !entry.ended_at
  const [date, setDate] = useState(entry ? dayIn(entry.started_at, tz) : day)
  const [from, setFrom] = useState(entry ? timeIn(entry.started_at, tz) : "09:00")
  const [to, setTo] = useState(entry?.ended_at ? timeIn(entry.ended_at, tz) : "10:00")
  const [target, setTarget] = useState<Target>(entry ? entryTarget(entry) : {})
  const [desc, setDesc] = useState(entry?.description ?? "")
  const [billable, setBillable] = useState<boolean | null>(entry ? entry.billable : null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!date || !from || (!running && !to)) {
      setError(t("time.timesNeeded"))
      return
    }
    setBusy(true)
    try {
      if (entry) {
        const start = zonedToUtc(date, from, tz)
        const body: Record<string, unknown> = { description: desc.trim() }
        if (start !== new Date(entry.started_at).toISOString().replace(".000Z", "Z")) body.started_at = start
        if (!running) {
          const endDay = to <= from ? addDays(date, 1) : date
          body.ended_at = zonedToUtc(endDay, to, tz)
        }
        const before = entryTarget(entry)
        if ((before.task?.id ?? "") !== (target.task?.id ?? "") || (before.project?.id ?? "") !== (target.project?.id ?? "")) {
          body.project = target.project?.id ?? ""
          if (target.task) body.task = target.task.id
        }
        if (billable !== null && billable !== entry.billable) body.billable = billable
        await timeApi.update(ws.id, entry.id, body)
      } else {
        await timeApi.log(ws.id, {
          ...targetBody(target),
          ...(user ? { user } : {}),
          date,
          started_at: from,
          ended_at: to,
          description: desc.trim() || undefined,
          ...(billable !== null ? { billable } : {}),
        })
      }
      toast.success(t("time.saved"))
      onDone()
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate data-entry-form={entry ? "edit" : "add"}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="te-desc">{t("time.description")}</FieldLabel>
          <Input id="te-desc" dir="auto" autoFocus value={desc} placeholder={t("time.descriptionPlaceholder")} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="te-target">{t("time.target")}</FieldLabel>
          <TargetPicker id="te-target" value={target} onChange={setTarget} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
          <Field>
            <FieldLabel htmlFor="te-date">{t("time.date")}</FieldLabel>
            <DateField id="te-date" value={date} onChange={(v) => v && setDate(v)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="te-from">{t("time.from")}</FieldLabel>
            <Input id="te-from" type="time" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="te-to">{t("time.to")}</FieldLabel>
            <Input id="te-to" type="time" dir="ltr" value={running ? "" : to} disabled={running} onChange={(e) => setTo(e.target.value)} required={!running} />
            {running ? <FieldDescription>{t("time.stopFirst")}</FieldDescription> : null}
          </Field>
        </div>
        <FieldDescription>{t(entry ? "time.editHint" : "time.addHint", { tz })}</FieldDescription>
        <label className="flex items-center gap-2 text-sm text-grid-body">
          <Switch checked={billable ?? false} onCheckedChange={(v) => setBillable(v)} />
          {t("time.billable")}
        </label>
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? t("common.working") : t("time.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
