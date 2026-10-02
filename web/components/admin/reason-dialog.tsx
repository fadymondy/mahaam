"use client"

import { useState, type FormEvent } from "react"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Textarea } from "@fadymondy/nasaq/web"
import { FormError } from "@/components/form-text"




import { useTranslations } from "@/lib/i18n"
import { errorText } from "@/lib/work"

/** Asks for a reason, then runs `onSubmit(reason)`; errors stay in the dialog. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  confirmLabel: string
  onSubmit: (reason: string) => Promise<void>
}) {
  const { t } = useTranslations()
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!reason.trim()) return setError(t("admin.reasonRequired"))
    setBusy(true)
    setError(null)
    try {
      await onSubmit(reason.trim())
      setReason("")
      onOpenChange(false)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="admin-reason">{t("admin.reason")}</FieldLabel>
            <Textarea id="admin-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
            {error ? <FormError>{error}</FormError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? t("common.working") : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A status badge for users and workspaces. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslations()
  return (
    <span
      className={
        status === "suspended"
          ? "inline-flex items-center gap-1.5 text-caption text-nq-danger-text"
          : "inline-flex items-center gap-1.5 text-caption text-(--nq-ok-text)"
      }
      data-status={status}
    >
      <span aria-hidden className={status === "suspended" ? "size-1.5 rounded-full bg-nq-danger" : "size-1.5 rounded-full bg-nq-ok"} />
      {t(`admin.status.${status}`)}
    </span>
  )
}
