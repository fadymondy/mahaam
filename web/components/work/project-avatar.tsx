"use client"

// A project's avatar: its uploaded image, or a tile in the project colour with its initials.
import { useRef, useState } from "react"
import { ImageUpIcon, Trash2Icon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Button } from "@fadymondy/nasaq/web"

import { soft, solid } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { errorText, w } from "@/lib/work"

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?"
}

export function ProjectAvatar({ project, className }: { project: { name: string; color: string; avatar?: string | null }; className?: string }) {
  if (project.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={project.avatar} alt="" className={cn("size-10 shrink-0 border border-border object-cover", className)} />
  }
  return (
    <span
      aria-hidden
      className={cn("flex size-10 shrink-0 items-center justify-center text-sm font-semibold uppercase", className)}
      style={{ background: soft(project.color), color: solid(project.color), boxShadow: `inset 0 0 0 1px ${solid(project.color)}` }}
    >
      {initials(project.name)}
    </span>
  )
}

/** Downsize to a 256px square (cover) and encode as WebP/PNG so it stays small enough to inline. */
async function toAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const size = 256
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = size
  const side = Math.min(bitmap.width, bitmap.height)
  canvas
    .getContext("2d")!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  const webp = canvas.toDataURL("image/webp", 0.9)
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png")
}

export function ProjectAvatarField({ project, onChanged }: { project: { id: string; name: string; color: string; avatar?: string | null }; onChanged: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const save = async (avatar: string) => {
    setBusy(true)
    try {
      await w.put(ws.id, `/api/w/projects/${project.id}/avatar`, { avatar })
      toast.success(t("common.saved"))
      onChanged()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <ProjectAvatar project={project} className="size-16 text-lg" />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            <ImageUpIcon />
            {project.avatar ? t("project.avatarChange") : t("project.avatarUpload")}
          </Button>
          {project.avatar ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void save("")}>
              <Trash2Icon />
              {t("project.avatarRemove")}
            </Button>
          ) : null}
        </div>
        <p className="text-caption text-muted-foreground">{t("project.avatarHint")}</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          try {
            await save(await toAvatar(file))
          } catch {
            toast.error(t("project.avatarBad"))
          }
        }}
      />
    </div>
  )
}
