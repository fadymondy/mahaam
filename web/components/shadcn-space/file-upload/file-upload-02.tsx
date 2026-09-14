"use client"
// Adapted from @shadcnspace/file-upload-02 (react-dropzone): the drop area and per-file status
// list are the block's; the demo files and simulated progress are gone. Files upload one at a
// time through `upload` (POST /api/w/tasks/{key}/attachments). fetch reports no upload
// progress, so the list shows an honest state — uploading, uploaded, failed — not a fake bar.
import { useCallback, useState } from "react"
import { useDropzone, type FileRejection } from "react-dropzone"
import { CheckCircle2, CloudUpload, FileIcon, Loader2, TriangleAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Ltr } from "@/components/copy-field"
import { ApiError } from "@/lib/api"
import { fileSize } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const MAX = 25 * 1024 * 1024 // internal/work.MaxAttachment

type Item = { id: string; name: string; size: number; status: "uploading" | "done" | "error"; message?: string }

export function AttachmentDropzone({
  upload,
  onUploaded,
  disabled,
}: {
  upload: (file: File) => Promise<unknown>
  onUploaded: () => void
  disabled?: boolean
}) {
  const { t } = useTranslations()
  const [items, setItems] = useState<Item[]>([])

  const set = (id: string, patch: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  const onDrop = useCallback(
    async (accepted: File[], rejected: FileRejection[]) => {
      const rejectedItems: Item[] = rejected.map((r) => ({
        id: Math.random().toString(36).slice(2),
        name: r.file.name,
        size: r.file.size,
        status: "error",
        message: r.errors.some((e) => e.code === "file-too-large") ? t("upload.tooLarge") : t("upload.failed"),
      }))
      const queued = accepted.map((file) => ({ file, item: { id: Math.random().toString(36).slice(2), name: file.name, size: file.size, status: "uploading" as const } }))
      setItems((prev) => [...queued.map((q) => q.item), ...rejectedItems, ...prev].slice(0, 8))
      for (const { file, item } of queued) {
        try {
          await upload(file)
          set(item.id, { status: "done" })
          onUploaded()
        } catch (err) {
          set(item.id, { status: "error", message: err instanceof ApiError ? err.message : t("upload.failed") })
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upload, onUploaded, t],
  )

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ onDrop, maxSize: MAX, disabled, noClick: true, noKeyboard: true })

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        data-dropzone
        className={cn(
          "flex flex-col items-center justify-center gap-2 border border-dashed border-line px-4 py-5 text-center transition-colors",
          isDragActive && "border-grid-action bg-grid-soft",
          disabled && "opacity-50",
        )}
      >
        <input {...getInputProps()} aria-label={t("upload.choose")} />
        <CloudUpload className="size-5 text-grid-muted" />
        <p className="text-sm text-grid-body">{isDragActive ? t("upload.drop") : t("upload.hint")}</p>
        <p className="text-xs text-grid-muted">{t("upload.limit")}</p>
        <Button type="button" variant="outline" size="sm" onClick={open} disabled={disabled}>
          {t("upload.browse")}
        </Button>
      </div>
      {items.length > 0 ? (
        <ul className="space-y-1" aria-live="polite">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 border border-line bg-grid-card px-3 py-2 text-sm">
              <FileIcon className="size-4 shrink-0 text-grid-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" dir="auto">
                  {i.name}
                </p>
                <p className={cn("flex items-center gap-1.5 text-xs", i.status === "error" ? "text-grid-danger-text" : "text-grid-muted")}>
                  <Ltr>{fileSize(i.size)}</Ltr>
                  <span aria-hidden>·</span>
                  {i.status === "uploading" ? <Loader2 className="size-3 animate-spin" /> : null}
                  {i.status === "done" ? <CheckCircle2 className="size-3 text-grid-ok-text" /> : null}
                  {i.status === "error" ? <TriangleAlert className="size-3" /> : null}
                  {i.status === "uploading" ? t("upload.uploading") : i.status === "done" ? t("upload.done") : i.message}
                </p>
              </div>
              {i.status !== "uploading" ? (
                <Button type="button" variant="ghost" size="icon-xs" aria-label={t("upload.dismiss")} onClick={() => setItems((prev) => prev.filter((x) => x.id !== i.id))}>
                  <X />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default AttachmentDropzone
