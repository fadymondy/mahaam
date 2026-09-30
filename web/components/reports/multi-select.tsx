"use client"

// A filter multi-select composed from registry pieces: Popover + Command (cmdk) + Checkbox.
import type { ReactNode } from "react"
import { ChevronsUpDownIcon, XIcon } from "lucide-react"

import { Button, Checkbox, Popover, PopoverContent, PopoverTrigger } from "@fadymondy/nasaq/web"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"




import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type Option = { value: string; label: string; icon?: ReactNode; ltr?: boolean }

export function MultiSelect({
  id,
  label,
  options,
  value,
  onChange,
  className,
}: {
  id: string
  label: string
  options: Option[]
  value: string[]
  onChange: (v: string[]) => void
  className?: string
}) {
  const { t } = useTranslations()
  const chosen = options.filter((o) => value.includes(o.value))
  const summary = value.length === 0 ? t("reports.any") : value.length === 1 && chosen[0] ? chosen[0].label : t("reports.nSelected", { n: value.length })
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="grid-micro">
        {label}
      </label>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="secondary"
              className={cn("w-full min-w-0 justify-between font-normal", value.length === 0 && "text-grid-muted")}
              data-filter={id}
              data-count={value.length}
            />
          }
        >
          <span className="truncate" dir={chosen[0]?.ltr && value.length === 1 ? "ltr" : undefined}>
            {summary}
          </span>
          <ChevronsUpDownIcon className="text-grid-muted" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
          <Command>
            <CommandInput placeholder={t("reports.search")} />
            <CommandList>
              <CommandEmpty>{t("timer.noMatch")}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => toggle(o.value)} data-option={o.value}>
                    <Checkbox checked={value.includes(o.value)} tabIndex={-1} aria-hidden className="pointer-events-none" />
                    {o.icon}
                    <span className="min-w-0 truncate" dir={o.ltr ? "ltr" : undefined}>
                      {o.label}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          {value.length ? (
            <div className="border-t border-line p-1">
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => onChange([])}>
                <XIcon />
                {t("reports.clearSelection")}
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
