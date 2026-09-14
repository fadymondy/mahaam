"use client"

// Who is who: user ids from the API resolved to member emails, and the avatar stack.
import { useMemo } from "react"

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useWorkspace } from "@/components/workspace/workspace-context"
import type { Member } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useMembers } from "@/lib/queries"
import { cn } from "@/lib/utils"

export type Directory = {
  members: Member[]
  name: (id: string | null | undefined) => string
  initials: (id: string | null | undefined) => string
  me: string | undefined
}

export function useDirectory(meId?: string): Directory {
  const ws = useWorkspace()
  const { t } = useTranslations()
  // Clients cannot list members (members:read is member+); they see "Someone".
  const canList = ws.can("members:read")
  const res = useMembers(canList ? ws.id : null)
  return useMemo(() => {
    const members = (res.data?.members ?? []).filter((m) => m.status === "active")
    const byId = new Map(members.map((m) => [m.user_id, m.email]))
    const name = (id: string | null | undefined) => (id ? (byId.get(id) ?? t("people.someone")) : t("people.someone"))
    const initials = (id: string | null | undefined) => {
      const e = id ? byId.get(id) : undefined
      if (!e) return "?"
      const local = e.split("@")[0].replace(/[^a-zA-Z0-9]+/g, " ").trim()
      const parts = local.split(" ").filter(Boolean)
      return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?"
    }
    return { members, name, initials, me: meId }
  }, [res.data, t, meId])
}

export function PersonAvatar({ id, dir, size = "sm", className }: { id: string; dir: Directory; size?: "sm" | "default"; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("inline-flex", className)} />}>
        <Avatar size={size} aria-label={dir.name(id)}>
          <AvatarFallback className="text-[10px] font-medium" dir="ltr">
            {dir.initials(id)}
          </AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>
        <span dir="ltr">{dir.name(id)}</span>
      </TooltipContent>
    </Tooltip>
  )
}

export function AvatarStack({ ids, dir, max = 3 }: { ids: string[]; dir: Directory; max?: number }) {
  if (ids.length === 0) return null
  const shown = ids.slice(0, max)
  return (
    <AvatarGroup>
      {shown.map((id) => (
        <PersonAvatar key={id} id={id} dir={dir} />
      ))}
      {ids.length > max ? <AvatarGroupCount className="text-[10px]">+{ids.length - max}</AvatarGroupCount> : null}
    </AvatarGroup>
  )
}
