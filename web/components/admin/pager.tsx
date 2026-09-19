"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Ltr } from "@/components/copy-field"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Previous / next with "page X of Y · N total". Arrows flip in RTL. */
export function Pager({ page, perPage, total, onPage }: { page: number; perPage: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslations()
  const pages = Math.max(1, Math.ceil(total / Math.max(1, perPage)))
  return (
    <div className="flex items-center justify-between gap-3 px-6 py-3 text-sm text-grid-muted" data-pager>
      <span>
        {t("admin.pager", { page: "⁨" + page + "⁩", pages: "⁨" + pages + "⁩" })} · <Ltr>{total}</Ltr> {t("admin.total")}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("admin.prev")}>
          <ChevronLeftIcon className="rtl:rotate-180" />
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t("admin.next")}>
          <ChevronRightIcon className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  )
}

/** A filter <Select> whose "" value means "all" (same shape as the issues filters). */
export function FilterSelect({
  value,
  onChange,
  items,
  label,
  className,
}: {
  value: string
  onChange: (v: string) => void
  items: { value: string; label: string }[]
  label: string
  className?: string
}) {
  return (
    <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? ""))}>
      <SelectTrigger className={cn("h-9 w-full sm:w-40", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((p) => (
          <SelectItem key={p.value || "all"} value={p.value}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A debounced search input: `onSearch` fires 300 ms after typing stops. */
export function SearchBox({ onSearch, placeholder }: { onSearch: (q: string) => void; placeholder: string }) {
  const [q, setQ] = useState("")
  const cb = useRef(onSearch)
  cb.current = onSearch
  useEffect(() => {
    const id = window.setTimeout(() => cb.current(q.trim()), 300)
    return () => window.clearTimeout(id)
  }, [q])
  return (
    <div className="relative w-full sm:w-72">
      <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-grid-muted" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 ps-8" type="search" />
    </div>
  )
}
