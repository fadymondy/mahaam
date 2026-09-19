"use client"

// Project Overview → "Download report": the project report (GET /api/w/projects/{id}/report) as PDF or
// Markdown, in the UI's language. Markdown is the exact format for Arabic (see README P8.4).
import { useState } from "react"
import { DownloadIcon, FileCodeIcon, FileTypeIcon, LoaderIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { downloadFile } from "@/lib/reports"
import { errorText } from "@/lib/work"

export function ProjectReportMenu({ projectId, className }: { projectId: string; className?: string }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)

  async function run(format: "pdf" | "md") {
    setBusy(true)
    try {
      const name = await downloadFile(ws.id, `/api/w/projects/${encodeURIComponent(projectId)}/report?format=${format}&lang=${locale}`)
      toast.success(t("reports.exported", { name }))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className={className} disabled={busy} data-project-report />}>
        {busy ? <LoaderIcon className="animate-spin" /> : <DownloadIcon />}
        {t("project.downloadReport")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => run("pdf")} data-project-report-format="pdf">
            <FileTypeIcon />
            {t("project.reportPdf")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run("md")} data-project-report-format="md">
            <FileCodeIcon />
            {t("project.reportMd")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
