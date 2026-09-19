"use client"

import { useEffect, useState } from "react"
import { BotIcon, SparklesIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Issue, IssuePatch } from "@/lib/work"

/**
 * How an agent should pick this issue up: which model, how hard to think, and
 * whether a specific agent or skill is required.
 *
 * Mahaam has no agent/skill catalogue endpoint, so Agent and Skill are free
 * text in the same block (empty = any / none).
 */
const MODELS = ["opus", "sonnet", "haiku", "fable"] as const
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const

/** Select has no null value, so "unset" needs a sentinel. */
const DEFAULT = "__default__"

export function IssueAgentSettings({
  issue,
  onPatch,
  disabled,
  className,
}: {
  issue: Issue
  onPatch: (fields: IssuePatch) => void | Promise<unknown>
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslations()

  const selects: { key: "ai_model" | "ai_effort"; label: string; value: string; options: readonly string[] }[] = [
    { key: "ai_model", label: t("issues.agent.model"), value: issue.ai_model ?? "", options: MODELS },
    { key: "ai_effort", label: t("issues.agent.effort"), value: issue.ai_effort ?? "", options: EFFORTS },
  ]
  const texts: { key: "agent" | "skill"; label: string; value: string; emptyLabel: string; Icon: typeof BotIcon }[] = [
    { key: "agent", label: t("issues.agent.agent"), value: issue.agent ?? "", emptyLabel: t("issues.agent.any"), Icon: BotIcon },
    { key: "skill", label: t("issues.agent.skill"), value: issue.skill ?? "", emptyLabel: t("issues.agent.none"), Icon: SparklesIcon },
  ]

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {selects.map((field) => (
        <div key={field.key} className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-grid-muted uppercase">{field.label}</span>
          <Select
            value={field.value || DEFAULT}
            disabled={disabled}
            onValueChange={(v) => onPatch({ [field.key]: !v || v === DEFAULT ? "" : v } as IssuePatch)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(v) => (!v || v === DEFAULT ? t("issues.agent.default") : String(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT}>{t("issues.agent.default")}</SelectItem>
              {field.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      {texts.map((field) => (
        <div key={field.key} className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-grid-muted uppercase">
            <field.Icon className="size-3.5" />
            {field.label}
          </span>
          <FreeText value={field.value} placeholder={field.emptyLabel} disabled={disabled} label={field.label} onCommit={(v) => onPatch({ [field.key]: v } as IssuePatch)} />
        </div>
      ))}
    </div>
  )
}

function FreeText({
  value,
  placeholder,
  label,
  disabled,
  onCommit,
}: {
  value: string
  placeholder: string
  label: string
  disabled?: boolean
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const v = draft.trim()
    if (v !== value) onCommit(v)
  }
  return (
    <Input
      dir="ltr"
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={100}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape") setDraft(value)
      }}
    />
  )
}
