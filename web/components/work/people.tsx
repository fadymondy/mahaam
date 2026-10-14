"use client"

// Who is who: user ids from the API resolved to member emails, and the avatar stack.
import { useMemo } from "react"

import { Avatar, TooltipRoot, TooltipContent, TooltipTrigger } from "@fadymondy/nasaq/web"


import { useWorkspace } from "@/components/workspace/workspace-context"
import type { Member } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useMembers, usePeople } from "@/lib/queries"
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
  // Members list everyone (members:read). A customer (MH-1176) gets the people on their own
  // projects instead, with display names, so the project page shows and assigns them too.
  const canList = ws.can("members:read")
  const res = useMembers(canList ? ws.id : null)
  const people = usePeople(canList ? null : ws.id)
  return useMemo(() => {
    if (!canList) {
      const list = people.data?.people ?? []
      const byId = new Map(list.map((p) => [p.user_id, p]))
      const members: Member[] = list.map((p) => ({ user_id: p.user_id, email: p.name, role: "member", status: "active", joined_at: null }))
      const name = (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? t("people.someone")) : t("people.someone"))
      const initials = (id: string | null | undefined) => (id ? (byId.get(id)?.initials ?? "?") : "?")
      return { members, name, initials, me: meId }
    }
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
  }, [canList, res.data, people.data, t, meId])
}

export function PersonAvatar({ id, dir, size = "sm", className }: { id: string; dir: Directory; size?: "xs" | "sm" | "md"; className?: string }) {
  return (
    <TooltipRoot>
      <TooltipTrigger render={<span className={cn("inline-flex", className)} />}>
        <Avatar size={size} name={dir.name(id)} />
      </TooltipTrigger>
      <TooltipContent>
        <span dir="ltr">{dir.name(id)}</span>
      </TooltipContent>
    </TooltipRoot>
  )
}

export function AvatarStack({ ids, dir, max = 3 }: { ids: string[]; dir: Directory; max?: number }) {
  if (ids.length === 0) return null
  const shown = ids.slice(0, max)
  return (
    <div className="flex -space-x-1.5 rtl:space-x-reverse">
      {shown.map((id) => (
        <PersonAvatar key={id} id={id} dir={dir} />
      ))}
      {ids.length > max ? <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-caption">+{ids.length - max}</span> : null}
    </div>
  )
}
