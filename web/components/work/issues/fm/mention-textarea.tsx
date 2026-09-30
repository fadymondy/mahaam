"use client"

// The comment box with @-suggestions: the agent loop (@agent), the workspace's members, and this
// project's own agents and skills (Project → agents & skills, synced from the local .claude/ over
// MCP or added in the UI). Picking a project agent or skill hands the item to the loop (@agent)
// and sets the item's Agent / Skill to it.
import { useMemo, useRef, useState, type KeyboardEvent } from "react"
import { BotIcon, SparklesIcon, UserRoundIcon } from "lucide-react"

import { Textarea } from "@fadymondy/nasaq/web"

import { useDirectory } from "@/components/work/people"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { useMe } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { useProjectCatalogue } from "@/lib/work"

type Suggestion = { kind: "loop" | "member" | "agent" | "skill"; label: string; hint?: string; insert: string; name?: string }

/** The handle for a member: the email's local part when unique in the workspace, else the email. */
function handleFor(email: string, all: string[]) {
  const local = email.split("@")[0]
  return all.filter((e) => e.split("@")[0].toLowerCase() === local.toLowerCase()).length > 1 ? email : local
}

export function MentionTextarea({
  value,
  onChange,
  projectId,
  onChoose,
  disabled,
  placeholder,
  rows = 3,
}: {
  value: string
  onChange: (v: string) => void
  projectId?: string | null
  /** A project agent or skill was picked: set it on the item. */
  onChoose?: (kind: "agent" | "skill", name: string) => void
  disabled?: boolean
  placeholder?: string
  rows?: number
}) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const me = useMe()
  const dir = useDirectory(me.data ? String(me.data.id) : undefined)
  const catalogue = useProjectCatalogue(ws.id, projectId ?? null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null)
  const [active, setActive] = useState(0)

  const all = useMemo<Suggestion[]>(() => {
    const emails = dir.members.map((m) => m.email)
    const out: Suggestion[] = [{ kind: "loop", label: "agent", hint: t("issues.mention.loop"), insert: "@agent" }]
    for (const m of dir.members) out.push({ kind: "member", label: handleFor(m.email, emails), hint: m.email, insert: "@" + handleFor(m.email, emails) })
    for (const a of catalogue.data?.agents ?? []) out.push({ kind: "agent", label: a.name, hint: a.description, insert: "@agent", name: a.name })
    for (const s of catalogue.data?.skills ?? []) out.push({ kind: "skill", label: s.name, hint: s.description, insert: "@agent", name: s.name })
    return out
  }, [dir.members, catalogue.data, t])

  const matches = useMemo(() => {
    if (!query) return []
    const q = query.text.toLowerCase()
    return all.filter((s) => s.label.toLowerCase().includes(q) || (s.hint ?? "").toLowerCase().includes(q)).slice(0, 8)
  }, [all, query])

  const detect = (text: string, caret: number) => {
    const m = /(^|\s)@([\w.:+-]*)$/.exec(text.slice(0, caret))
    if (m) {
      setQuery({ text: m[2], start: caret - m[2].length - 1 })
      setActive(0)
    } else setQuery(null)
  }

  const pick = (s: Suggestion) => {
    if (!query) return
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    const next = value.slice(0, query.start) + s.insert + " " + value.slice(caret)
    onChange(next)
    setQuery(null)
    if ((s.kind === "agent" || s.kind === "skill") && s.name) onChoose?.(s.kind, s.name)
    requestAnimationFrame(() => {
      const pos = query.start + s.insert.length + 1
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!matches.length) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => (i + 1) % matches.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => (i - 1 + matches.length) % matches.length)
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      pick(matches[active])
    } else if (e.key === "Escape") {
      setQuery(null)
    }
  }

  const Icon = { loop: BotIcon, member: UserRoundIcon, agent: BotIcon, skill: SparklesIcon }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={rows}
        dir="auto"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
      />
      {matches.length ? (
        <ul role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto border border-border bg-popover shadow-md">
          {matches.map((s, i) => {
            const I = Icon[s.kind]
            return (
              <li key={s.kind + s.label} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(s)}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex w-full items-center gap-2 px-3 py-2 text-start text-sm", i === active && "bg-muted")}
                >
                  <I className="size-3.5 shrink-0 text-muted-foreground" />
                  <span dir="ltr" className="font-mono">
                    {s.kind === "skill" ? s.label : "@" + s.label}
                  </span>
                  <span className="ms-auto truncate text-caption text-muted-foreground">
                    {s.kind === "agent" ? t("issues.mention.agent") : s.kind === "skill" ? t("issues.mention.skill") : s.hint}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
