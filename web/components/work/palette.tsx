"use client"

// User-chosen colours are palette KEYS (the API stores "teal", never a colour). These helpers map a
// key to the Nasaq tag tokens (--nq-tag-*), so light/dark come for free.
import { CheckIcon } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"

import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export const PALETTE = ["violet", "blue", "teal", "green", "amber", "orange", "red", "pink", "slate"] as const
export type PaletteKey = (typeof PALETTE)[number]

const key = (k?: string | null): PaletteKey => (PALETTE.includes(k as PaletteKey) ? (k as PaletteKey) : "slate")
// Nasaq calls the neutral tag "gray"; the API key stays "slate".
const tag = (k?: string | null) => (key(k) === "slate" ? "gray" : key(k))
export const solid = (k?: string | null) => `var(--nq-tag-${tag(k)})`
export const soft = (k?: string | null) => `var(--nq-tag-${tag(k)}-soft)`

export function ColorDot({ color, className, square = false }: { color?: string | null; className?: string; square?: boolean }) {
  return (
    <span
      aria-hidden
      data-color={key(color)}
      className={cn("inline-block size-2.5 shrink-0", square ? "" : "rounded-full", className)}
      style={{ background: solid(color) }}
    />
  )
}

/** A label/tag chip: soft tint, solid text. */
export function ColorChip({ color, children, className }: { color?: string | null; children: ReactNode; className?: string }) {
  const style: CSSProperties = { background: soft(color), color: solid(color), borderColor: soft(color) }
  return (
    <span
      className={cn("inline-flex h-5 max-w-40 items-center gap-1 truncate border px-1.5 text-xs leading-none font-medium", className)}
      style={style}
    >
      {children}
    </span>
  )
}

/** Radio group of palette swatches. */
export function ColorPicker({ value, onChange, label }: { value: string; onChange: (v: PaletteKey) => void; label?: string }) {
  const { t } = useTranslations()
  return (
    <div role="radiogroup" aria-label={label ?? t("work.color")} className="flex flex-wrap gap-1.5">
      {PALETTE.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          aria-label={t(`palette.${k}`)}
          title={t(`palette.${k}`)}
          onClick={() => onChange(k)}
          className={cn(
            "flex size-7 items-center justify-center border transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-grid-action",
            value === k ? "border-grid-fg" : "border-line",
          )}
          style={{ background: soft(k) }}
        >
          <span className="flex size-4 items-center justify-center rounded-full" style={{ background: solid(k) }}>
            {value === k ? <CheckIcon className="size-3 text-grid-bg" /> : null}
          </span>
        </button>
      ))}
    </div>
  )
}
