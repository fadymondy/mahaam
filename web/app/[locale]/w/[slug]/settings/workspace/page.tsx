"use client"

// Settings → Workspace: the danger zone. Only the OWNER deletes a workspace, by typing its slug;
// the API refuses while a paid subscription is still running (cancel it in Settings → Plan).
// Deleting removes every project, task, issue, time entry, invoice and file — there is no undo.
import { useRef, useState } from "react"
import { mutate } from "swr"
import { useRouter } from "next/navigation"
import { Trash2Icon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button, Field, FieldLabel, Input, SettingsSection } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { SectionTitle } from "@/components/page"
import { EmptyState } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { ApiError, api, type WorkspaceSummary } from "@/lib/api"
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
  const [name, setName] = useState(ws.summary.name)
  const [slug, setSlug] = useState(ws.slug)
  const [saving, setSaving] = useState(false)
  const [slugError, setSlugError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const isOwner = ws.summary.role === "owner"

  if (!isOwner && ws.summary.role !== "admin") return <EmptyState title={t("wsSettings.adminOnly")} />

  const slugOk = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)
  const dirty = name.trim() !== ws.summary.name || slug !== ws.slug
  const logo = ws.summary.logo ?? null

  async function saveGeneral(e: React.FormEvent) {
    e.preventDefault()
    setSlugError(null)
    setSaving(true)
    try {
      const body: { name?: string; slug?: string } = {}
      if (name.trim() !== ws.summary.name) body.name = name.trim()
      if (slug !== ws.slug) body.slug = slug
      const out = await api<WorkspaceSummary>("/api/w/workspace", { method: "PATCH", json: body, workspaceId: ws.id })
      await mutate("/api/me/workspaces")
      toast.success(t("wsSettings.saved"))
      if (out.slug !== ws.slug) router.replace(`/${locale}/w/${out.slug}/settings/workspace`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setSlugError(t("wsSettings.slugTaken"))
      else toast.error(errorText(err, t("common.networkError")))
    } finally {
      setSaving(false)
    }
  }

  async function uploadLogo(f: File) {
    setSaving(true)
    const form = new FormData()
    form.append("file", f)
    try {
      await api<WorkspaceSummary>("/api/w/workspace/logo", { form, workspaceId: ws.id })
      await mutate("/api/me/workspaces")
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 415
          ? t("wsSettings.logoFormat")
          : err instanceof ApiError && err.status === 413
            ? t("wsSettings.logoTooBig")
            : errorText(err, t("common.networkError")),
      )
    } finally {
      setSaving(false)
      if (file.current) file.current.value = ""
    }
  }

  async function removeLogo() {
    setSaving(true)
    try {
      await api<WorkspaceSummary>("/api/w/workspace/logo", { method: "DELETE", workspaceId: ws.id })
      await mutate("/api/me/workspaces")
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setSaving(false)
    }
  }

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
    <div className="flex flex-col gap-6">
      <SectionTitle title={t("wsSettings.title")} description={t("wsSettings.description")} />
      <SettingsSection title={t("wsSettings.general")} description={t("wsSettings.generalHint")}>
      <form onSubmit={saveGeneral} noValidate className="space-y-4">
        <div className="flex items-center gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="size-16 rounded-lg border border-border object-cover" data-ws-logo />
          ) : (
            <span
              className="grid size-16 place-items-center rounded-lg border border-border bg-muted text-lg font-medium text-muted-foreground"
              aria-hidden
            >
              {ws.summary.name.trim().slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/gif"
              className="sr-only"
              id="ws-logo-file"
              aria-label={t("wsSettings.logo")}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void uploadLogo(f)
              }}
            />
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => file.current?.click()}>
              {logo ? t("wsSettings.logoChange") : t("wsSettings.logoUpload")}
            </Button>
            {logo ? (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void removeLogo()}>
                {t("wsSettings.logoRemove")}
              </Button>
            ) : null}
          </div>
        </div>
        <Field>
          <FieldLabel htmlFor="ws-name">{t("wsSettings.name")}</FieldLabel>
          <Input id="ws-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
        </Field>
        <Field>
          <FieldLabel htmlFor="ws-slug">{t("wsSettings.slug")}</FieldLabel>
          <Input
            id="ws-slug"
            dir="ltr"
            autoComplete="off"
            maxLength={40}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase())
              setSlugError(null)
            }}
            className="max-w-sm"
          />
          {slug !== ws.slug ? <p className="text-sm text-muted-foreground">{t("wsSettings.slugWarn")}</p> : null}
          {slugError || !slugOk ? (
            <p className="text-sm text-nq-danger-text" role="alert">
              {slugError ?? t("wsSettings.slugInvalid")}
            </p>
          ) : null}
        </Field>
        <Button type="submit" disabled={saving || !dirty || !slugOk || name.trim() === ""}>
          {t("wsSettings.save")}
        </Button>
      </form>
      </SettingsSection>
      {isOwner ? (
      <SettingsSection tone="danger" title={t("wsSettings.dangerZone")} description={t("wsSettings.deleteHint")}>
        <div className="space-y-4">
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
        <Button variant="danger" disabled={busy || confirm.trim() !== ws.slug} onClick={() => void destroy()}>
          <Trash2Icon /> {t("wsSettings.delete")}
        </Button>
        </div>
      </SettingsSection>
      ) : null}
    </div>
  )
}
