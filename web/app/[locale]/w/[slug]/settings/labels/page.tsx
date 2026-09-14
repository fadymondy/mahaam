"use client"

import { useState, type FormEvent } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SectionHeader } from "@/components/public-frame"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ColorChip, ColorPicker } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText, useLabels, w, type Label } from "@/lib/work"

export default function LabelsPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("nav.labels")} · ${ws.summary.name}`)
  const labels = useLabels(ws.id)
  const canCreate = ws.can("labels:create")
  const canManage = ws.can("labels:manage")
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>("slate")
  const [editing, setEditing] = useState<Label | null>(null)
  const list = labels.data?.labels ?? []

  async function create(e: FormEvent) {
    e.preventDefault()
    try {
      await w.post(ws.id, "/api/w/labels", { name: name.trim(), color })
      setName("")
      void labels.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  return (
    <>
      <SectionHeader micro={ws.summary.name} title={t("nav.labels")} description={t("labels.hint")} />
      {canCreate ? (
        <form onSubmit={create} className="flex flex-wrap items-end gap-4 border-t border-line px-6 py-4">
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="l-name">{t("labels.newName")}</FieldLabel>
            <Input id="l-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t("labels.placeholder")} />
          </Field>
          <ColorPicker value={color} onChange={setColor} />
          <Button type="submit" disabled={!name.trim()}>
            <PlusIcon />
            {t("labels.create")}
          </Button>
        </form>
      ) : null}
      {labels.error ? (
        <ErrorState error={labels.error} />
      ) : labels.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={t("labels.empty")} />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-6 py-2.5 text-sm" data-label={l.id}>
              <ColorChip color={l.color}>{l.name}</ColorChip>
              <span className="flex-1 text-xs text-grid-muted">
                {t("labels.taskCount", { n: l.task_count })}
                <Ltr> </Ltr>
              </span>
              {canManage ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                    {t("common.edit")}
                  </Button>
                  <ConfirmButton
                    label={t("common.delete")}
                    title={t("labels.deleteTitle", { name: l.name })}
                    description={t("labels.deleteBody", { n: l.task_count })}
                    confirmLabel={t("common.delete")}
                    onConfirm={async () => {
                      try {
                        await w.del(ws.id, `/api/w/labels/${l.id}`)
                        void labels.mutate()
                      } catch (err) {
                        toast.error(errorText(err, t("common.networkError")))
                      }
                    }}
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!canManage ? <p className="px-6 py-4 text-xs text-grid-muted">{t("labels.manageHint")}</p> : null}
      <EditLabel
        label={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void labels.mutate()
        }}
      />
    </>
  )
}

function EditLabel({ label, onClose, onSaved }: { label: Label | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [key, setKey] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>("slate")
  if ((label?.id ?? null) !== key) {
    setKey(label?.id ?? null)
    setName(label?.name ?? "")
    setColor(label?.color ?? "slate")
  }
  return (
    <Dialog open={!!label} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("labels.edit")}</DialogTitle>
          <DialogDescription>{t("labels.editHint")}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="le-name">{t("labels.newName")}</FieldLabel>
          <Input id="le-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <ColorPicker value={color} onChange={setColor} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await w.patch(ws.id, `/api/w/labels/${label!.id}`, { name: name.trim(), color })
                onSaved()
              } catch (err) {
                toast.error(errorText(err, t("common.networkError")))
              }
            }}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
