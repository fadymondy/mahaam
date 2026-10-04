"use client"

// Task/project field controls, composed from registry primitives: Select, Popover + Calendar
// (date picker), Popover + Command (member and label pickers).
import { useMemo, useState } from "react"
import {
  CalendarIcon,
  CheckIcon,
  MinusIcon,
  PlusIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  SirenIcon,
  TagIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"

import { Button, Calendar, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@fadymondy/nasaq/web"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"





import { Ltr } from "@/components/copy-field"
import { ColorChip, ColorDot } from "@/components/work/palette"
import { AvatarStack, type Directory } from "@/components/work/people"
import { formatDay } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { PRIORITIES, type Label, type Priority, type Status } from "@/lib/work"

// ── priority ─────────────────────────────────────────────────────────────────

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const { t } = useTranslations()
  const label = t(`priority.${priority}`)
  const cls = cn("size-3.5 shrink-0", className)
  switch (priority) {
    case "urgent":
      return <SirenIcon aria-label={label} className={cn(cls, "text-nq-danger-text")} />
    case "high":
      return <SignalHighIcon aria-label={label} className={cn(cls, "text-nq-warn-text")} />
    case "medium":
      return <SignalMediumIcon aria-label={label} className={cls} />
    case "low":
      return <SignalLowIcon aria-label={label} className={cn(cls, "text-muted-foreground")} />
    default:
      return <MinusIcon aria-label={label} className={cn(cls, "text-muted-foreground")} />
  }
}

export function PrioritySelect({ value, onChange, disabled, id }: { value: Priority; onChange: (p: Priority) => void; disabled?: boolean; id?: string }) {
  const { t } = useTranslations()
  const items = PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) }))
  return (
    <Select items={items} value={value} onValueChange={(v) => v && onChange(v as Priority)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full" aria-label={t("task.priority")}>
        <SelectValue>
          {(v: string) => (
            <span className="flex items-center gap-2">
              <PriorityIcon priority={v as Priority} />
              {t(`priority.${v}`)}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            <PriorityIcon priority={i.value} />
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── status ──────────────────────────────────────────────────────────────────

export function StatusSelect({
  statuses,
  value,
  onChange,
  disabled,
  id,
}: {
  statuses: Status[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
  id?: string
}) {
  const { t } = useTranslations()
  const items = statuses.map((s) => ({ value: s.id, label: s.name }))
  const byId = new Map(statuses.map((s) => [s.id, s]))
  return (
    <Select items={items} value={value} onValueChange={(v) => v && onChange(String(v))} disabled={disabled}>
      <SelectTrigger id={id} className="w-full" aria-label={t("task.status")}>
        <SelectValue>
          {(v: string) => (
            <span className="flex items-center gap-2">
              <ColorDot color={byId.get(v)?.color} />
              {byId.get(v)?.name ?? "—"}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {statuses.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <ColorDot color={s.color} />
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── date ────────────────────────────────────────────────────────────────────

/** Calendar + Popover date picker. value/onChange are YYYY-MM-DD (or null). */
export function DateField({
  value,
  onChange,
  disabled,
  placeholder,
  id,
  tone,
}: {
  value: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  placeholder?: string
  id?: string
  tone?: "danger"
}) {
  const { t, locale } = useTranslations()
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(value + "T00:00:00") : undefined
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="secondary"
              size="sm"
              disabled={disabled}
              className={cn("min-w-0 flex-1 justify-start font-normal", !value && "text-muted-foreground", tone === "danger" && "text-nq-danger-text")}
            />
          }
        >
          <CalendarIcon />
          {value ? <Ltr>{formatDay(value, locale)}</Ltr> : (placeholder ?? t("work.pickDate"))}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            value={selected}
            onValueChange={(d: Date | null) => {
              if (d) {
                const y = d.getFullYear()
                const m = String(d.getMonth() + 1).padStart(2, "0")
                const day = String(d.getDate()).padStart(2, "0")
                onChange(`${y}-${m}-${day}`)
              }
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {value && !disabled ? (
        <Button variant="ghost" size="icon-sm" aria-label={t("work.clearDate")} onClick={() => onChange(null)}>
          <XIcon />
        </Button>
      ) : null}
    </div>
  )
}

// ── people ──────────────────────────────────────────────────────────────────

export function MemberPicker({
  dir,
  selected,
  onChange,
  disabled,
  candidates,
  label,
}: {
  dir: Directory
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  /** Restrict the choice (e.g. to a project's people). Defaults to every active member. */
  candidates?: string[]
  label?: string
}) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  const pool = useMemo(() => {
    const ids = candidates ?? dir.members.map((m) => m.user_id)
    return Array.from(new Set([...ids, ...selected]))
  }, [candidates, dir.members, selected])
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="secondary" size="sm" disabled={disabled} className="min-w-0 flex-1 justify-start font-normal" aria-label={label ?? t("task.assignees")} />}
      >
        {selected.length ? (
          <>
            <AvatarStack ids={selected} dir={dir} />
            <span className="truncate text-caption" dir="ltr">
              {selected.length === 1 ? dir.name(selected[0]) : ""}
            </span>
          </>
        ) : (
          <>
            <UserPlusIcon />
            <span className="text-muted-foreground">{t("task.unassigned")}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("work.searchPeople")} />
          <CommandList>
            <CommandEmpty>{t("work.noPeople")}</CommandEmpty>
            <CommandGroup>
              {pool.map((id) => (
                <CommandItem key={id} value={dir.name(id)} onSelect={() => toggle(id)} data-user={id}>
                  <span className={cn("flex size-4 items-center justify-center border", selected.includes(id) ? "border-nq-action bg-nq-action text-nq-on-action" : "border-border")}>
                    {selected.includes(id) ? <CheckIcon className="size-3" /> : null}
                  </span>
                  <span className="truncate" dir="ltr">
                    {dir.name(id)}
                  </span>
                  {id === dir.me ? <span className="ms-auto text-caption text-muted-foreground">{t("people.you")}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ── labels ──────────────────────────────────────────────────────────────────

export function LabelChips({ ids, labels }: { ids: string[]; labels: Label[] }) {
  const byId = new Map(labels.map((l) => [l.id, l]))
  const list = ids.map((id) => byId.get(id)).filter(Boolean) as Label[]
  if (!list.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((l) => (
        <ColorChip key={l.id} color={l.color}>
          {l.name}
        </ColorChip>
      ))}
    </span>
  )
}

export function LabelPicker({
  labels,
  selected,
  onChange,
  onCreate,
  disabled,
  compact,
}: {
  labels: Label[]
  selected: string[]
  onChange: (ids: string[]) => void
  /** Present when the caller may create labels; resolves to the new label. */
  onCreate?: (name: string) => Promise<Label>
  disabled?: boolean
  /** Just a square "+" button (the chips are shown elsewhere). */
  compact?: boolean
}) {
  const { t } = useTranslations()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const exact = labels.some((l) => l.name.toLowerCase() === query.trim().toLowerCase())
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          compact ? (
            <Button variant="secondary" size="icon-sm" disabled={disabled} aria-label={t("td.addLabel")} />
          ) : (
            <Button variant="secondary" size="sm" disabled={disabled} className="h-auto min-h-7 min-w-0 flex-1 justify-start py-1 font-normal" aria-label={t("task.labels")} />
          )
        }
      >
        {compact ? (
          <PlusIcon />
        ) : selected.length ? (
          <LabelChips ids={selected} labels={labels} />
        ) : (
          <>
            <TagIcon />
            <span className="text-muted-foreground">{t("task.noLabels")}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("work.searchLabels")} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{onCreate ? t("work.typeToCreate") : t("work.noLabels")}</CommandEmpty>
            <CommandGroup>
              {labels.map((l) => (
                <CommandItem key={l.id} value={l.name} onSelect={() => toggle(l.id)}>
                  <span className={cn("flex size-4 items-center justify-center border", selected.includes(l.id) ? "border-nq-action bg-nq-action text-nq-on-action" : "border-border")}>
                    {selected.includes(l.id) ? <CheckIcon className="size-3" /> : null}
                  </span>
                  <ColorDot color={l.color} />
                  <span className="truncate">{l.name}</span>
                </CommandItem>
              ))}
              {onCreate && query.trim() && !exact ? (
                <CommandItem
                  value={`+ ${query}`}
                  disabled={busy}
                  onSelect={async () => {
                    setBusy(true)
                    try {
                      const l = await onCreate(query.trim())
                      onChange([...selected, l.id])
                      setQuery("")
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <PlusIcon />
                  {t("work.createLabel", { name: query.trim() })}
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
