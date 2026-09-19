"use client"

import { useEffect, useState } from "react"
import { BotIcon, PlusIcon, SparklesIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { catalogueApi, errorText, useProjectCatalogue, type Issue, type IssuePatch } from "@/lib/work"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { toast } from "sonner"

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
  const ws = useWorkspace()
  const catalogue = useProjectCatalogue(ws.id, issue.project_id ?? null)

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

      {texts.map((field) => {
        const options = (field.key === "agent" ? catalogue.data?.agents : catalogue.data?.skills) ?? []
        const names = options.map((o) => o.name)
        if (field.value && !names.includes(field.value)) names.unshift(field.value)
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-grid-muted uppercase">
              <field.Icon className="size-3.5" />
              {field.label}
            </span>
            <Select
              value={field.value || DEFAULT}
              disabled={disabled}
              onValueChange={(v) => onPatch({ [field.key]: !v || v === DEFAULT ? "" : v } as IssuePatch)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v) => (!v || v === DEFAULT ? field.emptyLabel : String(v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>{field.emptyLabel}</SelectItem>
                {names.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}

      <CatalogueFooter
        projectId={issue.project_id ?? null}
        agents={catalogue.data?.agents?.length ?? 0}
        skills={catalogue.data?.skills?.length ?? 0}
        onAdded={() => void catalogue.mutate()}
      />
    </div>
  )
}

/** "1 agent and 13 skills in this project" + add one from the UI (MCP sync_project_agents fills it from .claude/). */
function CatalogueFooter({ projectId, agents, skills, onAdded }: { projectId: string | null; agents: number; skills: number; onAdded: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<"agent" | "skill">("agent")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  if (!projectId) return null
  const add = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await catalogueApi.add(ws.id, projectId, { kind, name: name.trim() })
      setName("")
      setOpen(false)
      onAdded()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 font-mono text-[11px] text-grid-muted">
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span>{t("issues.agent.counts", { agents, skills })}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 hover:text-grid-fg">
          <PlusIcon className="size-3.5" />
          {t("issues.agent.add")}
        </button>
      </p>
      {open ? (
        <div className="flex flex-col gap-2 border border-line p-2">
          <Select value={kind} onValueChange={(v) => setKind(v === "skill" ? "skill" : "agent")}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue>{(v) => (v === "skill" ? t("issues.agent.skill") : t("issues.agent.agent"))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">{t("issues.agent.agent")}</SelectItem>
              <SelectItem value="skill">{t("issues.agent.skill")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            dir="ltr"
            className="h-8"
            value={name}
            maxLength={100}
            placeholder="code-reviewer"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add()
            }}
          />
          <button type="button" disabled={busy || !name.trim()} onClick={() => void add()} className="self-end text-grid-action hover:underline disabled:opacity-50">
            {t("issues.agent.addSave")}
          </button>
        </div>
      ) : null}
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
