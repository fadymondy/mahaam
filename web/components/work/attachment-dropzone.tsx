"use client"

// Attachment upload for the task sheet: Nasaq FileUpload (drop area, validation, per-file list).
// Files upload one at a time through `upload` (POST /api/w/tasks/{key}/attachments). fetch reports no
// upload progress, so a file shows an indeterminate bar while it uploads.
import { FileUpload, type FileUploadControls, type UploadFile } from "@fadymondy/nasaq/web"

import { ApiError } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

const MAX = 25 * 1024 * 1024 // internal/work.MaxAttachment

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

  async function run(item: UploadFile, controls: FileUploadControls) {
    controls.update(item.id, { status: "uploading", progress: null })
    try {
      await upload(item.file)
      controls.update(item.id, { status: "done", progress: 100 })
      onUploaded()
    } catch (err) {
      controls.update(item.id, { status: "error", error: err instanceof ApiError ? err.message : t("upload.failed") })
    }
  }

  async function onFiles(added: UploadFile[], controls: FileUploadControls) {
    for (const item of added) await run(item, controls)
  }

  return (
    <div data-dropzone>
      <FileUpload maxSize={MAX} disabled={disabled} onFiles={onFiles} onRetry={run} />
    </div>
  )
}
