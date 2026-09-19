"use client"

// Settings → Workspace: the danger zone. Only the OWNER deletes a workspace, by typing its slug;
// the API refuses while a paid subscription is still running (cancel it in Settings → Plan).
// Deleting removes every project, task, issue, time entry, invoice and file — there is no undo.
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { EmptyState } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

export default function WorkspaceSettingsPage() {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  useDocumentTitle(`${t("wsSettings.title")} · ${ws.summary.name}`)
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)

  if (ws.summary.role !== "owner") return <EmptyState title={t("wsSettings.ownerOnly")} />

  async function destroy() {
    setBusy(true)
    try {
      await api("/api/w/workspace", { method: "DELETE", json: { confirm }, workspaceId: ws.id })
      toast.success(t("wsSettings.deleted", { name: ws.summary.name }))
      router.replace(`/${locale}/workspaces`)
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <SectionHeader title={t("wsSettings.title")} description={t("wsSettings.description")} />
      <section className="space-y-4 border border-grid-danger/40 p-5">
        <div>
          <h2 className="text-base font-medium text-grid-danger-text">{t("wsSettings.dangerZone")}</h2>
          <p className="mt-1 text-sm text-grid-muted">{t("wsSettings.deleteHint")}</p>
        </div>
        <Field>
          <FieldLabel htmlFor="ws-confirm">
            {t("wsSettings.typeSlug")} <Ltr mono>{ws.slug}</Ltr>
          </FieldLabel>
          <Input
            id="ws-confirm"
            dir="ltr"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={ws.slug}
            className="max-w-sm"
          />
        </Field>
        <Button variant="destructive" disabled={busy || confirm.trim() !== ws.slug} onClick={() => void destroy()}>
          <Trash2Icon /> {t("wsSettings.delete")}
        </Button>
      </section>
    </div>
  )
}
