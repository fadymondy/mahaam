"use client"

// Saved report views: open (navigates to the view's tab with its filters), save the current tab,
// rename, share (reports:share, manager+) and delete (owner — the API decides; `mine` shows the controls).
import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { BookmarkIcon, BookmarkPlusIcon, PencilIcon, Share2Icon, Trash2Icon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { cleanFilters, reportsApi, useSavedReports, type Filters, type ReportKind, type SavedReport } from "@/lib/reports"
import { errorText } from "@/lib/work"

export function SavedViews({ kind, filters, base }: { kind: ReportKind; filters: Filters; base: string }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const router = useRouter()
  const saved = useSavedReports(ws.id)
  const canShare = ws.can("reports:share")
  const canFinance = ws.can("reports:finance")
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<{ mode: "new" } | { mode: "rename"; view: SavedReport } | null>(null)
  const [removing, setRemoving] = useState<SavedReport | null>(null)
  // A profitability view is useless to someone who cannot open that tab.
  const views = (saved.data?.reports ?? []).filter((v) => v.kind !== "profitability" || canFinance)
  const mine = views.filter((v) => v.mine)
  const others = views.filter((v) => !v.mine)

  function openView(v: SavedReport) {
    setOpen(false)
    // Navigate to the view's own permalink; it forwards to the right tab with the filters applied.
    router.push(`${base}/saved/${encodeURIComponent(v.id)}`)
  }

  async function toggleShare(v: SavedReport) {
    try {
      await reportsApi.update(ws.id, v.id, { shared: !v.shared })
      toast.success(t("saved.updated"))
      void saved.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  async function remove() {
    if (!removing) return
    try {
      await reportsApi.remove(ws.id, removing.id)
      toast.success(t("saved.deleted"))
      setRemoving(null)
      void saved.mutate()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  const row = (v: SavedReport) => (
    <li key={v.id} className="group flex items-center gap-1 px-2 py-1" data-saved-view={v.id} data-saved-name={v.name}>
      <button
        type="button"
        onClick={() => openView(v)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-start text-sm hover:bg-grid-soft"
        data-open-view={v.id}
      >
        <span className="min-w-0 flex-1 truncate" dir="auto">
          {v.name}
        </span>
        <span className="shrink-0 text-[11px] text-grid-muted">{t(`saved.kind.${v.kind}`)}</span>
        {v.shared ? (
          <Badge variant="outline" className="shrink-0 gap-1">
            <UsersIcon />
            {t("saved.shared")}
          </Badge>
        ) : null}
      </button>
      {v.mine ? (
        <span className="flex shrink-0 items-center">
          {canShare ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={v.shared ? t("saved.unshare") : t("saved.makeShared")}
                    aria-pressed={v.shared}
                    onClick={() => toggleShare(v)}
                    data-share-view={v.id}
                  />
                }
              >
                <Share2Icon />
              </TooltipTrigger>
              <TooltipContent>{v.shared ? t("saved.unshare") : t("saved.makeShared")}</TooltipContent>
            </Tooltip>
          ) : null}
          <Button variant="ghost" size="icon-sm" aria-label={t("saved.rename")} onClick={() => setDialog({ mode: "rename", view: v })} data-rename-view={v.id}>
            <PencilIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("saved.delete")} onClick={() => setRemoving(v)} data-delete-view={v.id}>
            <Trash2Icon />
          </Button>
        </span>
      ) : null}
    </li>
  )

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="outline" data-saved-views />}>
          <BookmarkIcon />
          {t("saved.open")}
          {views.length ? <span className="text-grid-muted tabular-nums">({views.length})</span> : null}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0" data-saved-list>
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="text-sm font-medium">{t("saved.title")}</p>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false)
                setDialog({ mode: "new" })
              }}
              data-save-view
            >
              <BookmarkPlusIcon />
              {t("saved.save")}
            </Button>
          </div>
          {views.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-grid-muted">{t("saved.empty")}</p>
          ) : (
            <div className="max-h-96 overflow-y-auto py-1">
              {mine.length ? (
                <>
                  <p className="grid-micro px-4 pt-2 pb-1">{t("saved.mine")}</p>
                  <ul>{mine.map(row)}</ul>
                </>
              ) : null}
              {others.length ? (
                <>
                  <p className="grid-micro px-4 pt-2 pb-1">{t("saved.fromOthers")}</p>
                  <ul>{others.map(row)}</ul>
                </>
              ) : null}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "rename" ? t("saved.renameTitle") : t("saved.saveTitle")}</DialogTitle>
            {dialog?.mode === "new" ? <DialogDescription>{t("saved.saveHint")}</DialogDescription> : null}
          </DialogHeader>
          {dialog ? (
            <ViewForm
              key={dialog.mode === "rename" ? dialog.view.id : "new"}
              view={dialog.mode === "rename" ? dialog.view : undefined}
              canShare={canShare}
              onSubmit={async (name, shared) => {
                if (dialog.mode === "rename") {
                  await reportsApi.update(ws.id, dialog.view.id, { name, ...(canShare ? { shared } : {}) })
                  toast.success(t("saved.updated"))
                } else {
                  await reportsApi.save(ws.id, { name, kind, filters: kind === "budget" ? {} : cleanFilters(filters), shared: canShare && shared })
                  toast.success(t("saved.saved"))
                }
                setDialog(null)
                void saved.mutate()
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("saved.deleteTitle", { name: removing?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("saved.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} data-confirm-delete-view>
              {t("saved.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ViewForm({
  view,
  canShare,
  onSubmit,
}: {
  view?: SavedReport
  canShare: boolean
  onSubmit: (name: string, shared: boolean) => Promise<void>
}) {
  const { t } = useTranslations()
  const [name, setName] = useState(view?.name ?? "")
  const [shared, setShared] = useState(view?.shared ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError(t("saved.nameRequired"))
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name.trim(), shared)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate data-view-form>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sv-name">{t("saved.name")}</FieldLabel>
          <Input id="sv-name" dir="auto" autoFocus maxLength={120} value={name} placeholder={t("saved.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
        </Field>
        {canShare ? (
          <Field>
            <label className="flex items-center justify-between gap-4 text-sm text-grid-body">
              <span>{t("saved.share")}</span>
              <Switch checked={shared} onCheckedChange={setShared} data-view-shared />
            </label>
            <FieldDescription>{t("saved.shareHint")}</FieldDescription>
          </Field>
        ) : null}
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? t("common.working") : t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
