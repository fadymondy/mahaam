"use client"

import { useState } from "react"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input } from "@fadymondy/nasaq/web"

import { ColorPicker } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { errorText, w, type Label } from "@/lib/work"

/** Rename or recolour a workspace label; open while `label` is set. labels:manage. */
export function EditLabel({ label, onClose, onSaved }: { label: Label | null; onClose: () => void; onSaved: () => void }) {
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
            variant="primary"
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
