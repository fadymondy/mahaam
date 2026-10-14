"use client"

// Editing a LimitRule in a form: the plan editor (every catalog key) and the per-workspace
// overrides (a key may also "inherit" the plan). Prices are typed in major units.
import { Checkbox, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@fadymondy/nasaq/web"



import { useTranslations } from "@/lib/i18n"
import type { LimitPolicy, LimitRule } from "@/lib/admin"

export type RuleDraft = { limit: string; policy: LimitPolicy; price: string; size: string }

export function toDraft(r: LimitRule | undefined | null): RuleDraft {
  return {
    limit: r?.limit == null ? "" : String(r.limit),
    policy: r?.policy ?? "block",
    price: r ? String((r.unit_price_minor ?? 0) / 100) : "0",
    size: r ? String(r.unit_size || 1) : "1",
  }
}

/** Parses a draft; returns an error key when a field is not a valid non-negative number. */
export function fromDraft(d: RuleDraft): { rule: LimitRule } | { error: string } {
  const limit = d.limit.trim() === "" ? null : Number(d.limit)
  const price = d.price.trim() === "" ? 0 : Math.round(Number(d.price) * 100)
  const size = d.size.trim() === "" ? 1 : Number(d.size)
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) return { error: "admin.limit.invalidLimit" }
  if (Number.isNaN(price) || price < 0) return { error: "admin.limit.invalidPrice" }
  if (!Number.isInteger(size) || size < 1) return { error: "admin.limit.invalidSize" }
  return { rule: { limit, policy: d.policy, unit_price_minor: price, unit_size: size } }
}

/** The four inputs of one rule, laid out as a row. `limit` empty = unlimited. */
export function RuleFields({ id, draft, onChange, currency }: { id: string; draft: RuleDraft; onChange: (d: RuleDraft) => void; currency: string }) {
  const { t } = useTranslations()
  const policies = [
    { value: "block", label: t("plan.policy.block") },
    { value: "overage", label: t("plan.policy.overage") },
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Input
        dir="ltr"
        inputMode="numeric"
        aria-label={t("admin.limit.limit")}
        placeholder={t("plan.unlimited")}
        value={draft.limit}
        onChange={(e) => onChange({ ...draft, limit: e.target.value })}
        className="h-8"
        data-limit-input={id}
      />
      <Select items={policies} value={draft.policy} onValueChange={(v) => onChange({ ...draft, policy: (v as LimitPolicy) ?? "block" })}>
        <SelectTrigger className="h-8 w-full" aria-label={t("plan.col.policy")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {policies.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        dir="ltr"
        inputMode="decimal"
        aria-label={t("admin.limit.unitPrice", { currency })}
        title={t("admin.limit.unitPrice", { currency })}
        placeholder="0.00"
        disabled={draft.policy !== "overage"}
        value={draft.price}
        onChange={(e) => onChange({ ...draft, price: e.target.value })}
        className="h-8"
      />
      <Input
        dir="ltr"
        inputMode="numeric"
        aria-label={t("admin.limit.unitSize")}
        title={t("admin.limit.unitSize")}
        placeholder="1"
        disabled={draft.policy !== "overage"}
        value={draft.size}
        onChange={(e) => onChange({ ...draft, size: e.target.value })}
        className="h-8"
      />
    </div>
  )
}

/** Column captions for a list of RuleFields rows. */
export function RuleHeader({ currency }: { currency: string }) {
  const { t } = useTranslations()
  return (
    <div className="grid grid-cols-2 gap-2 text-caption text-muted-foreground sm:grid-cols-4">
      <span>{t("admin.limit.limit")}</span>
      <span>{t("plan.col.policy")}</span>
      <span className="hidden sm:block">{t("admin.limit.unitPrice", { currency })}</span>
      <span className="hidden sm:block">{t("admin.limit.unitSize")}</span>
    </div>
  )
}

/** Multi-select for integrations as a row of checkboxes. */
export function IntegrationPicker({ value, onChange, options, disabled }: { value: string[]; onChange: (v: string[]) => void; options: readonly string[]; disabled?: boolean }) {
  const { t } = useTranslations()
  return (
    <div className="flex flex-wrap gap-4">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.includes(o)}
            disabled={disabled}
            onCheckedChange={(c) => onChange(c ? [...value.filter((x) => x !== o), o] : value.filter((x) => x !== o))}
          />
          {t(`plan.integration.${o}`)}
        </label>
      ))}
    </div>
  )
}
