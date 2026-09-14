"use client"

// Create / edit a project. Budgets are entered in hours and whole currency units and sent in
// the API's units (minutes, minor units); 0 or empty clears them.
import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DateField } from "@/components/work/fields"
import { ColorPicker } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { BILLING_MODES, PROJECT_STATUSES, errorText, useClients, w, type ProjectDetail } from "@/lib/work"

type Values = {
  name: string
  description: string
  color: string
  status: string
  billing_mode: string
  visibility: string
  client_id: string
  currency: string
  budget_hours: string
  budget_money: string
  starts_on: string | null
  ends_on: string | null
}

function initial(p?: ProjectDetail): Values {
  return {
    name: p?.name ?? "",
    description: p?.description ?? "",
    color: p?.color ?? "violet",
    status: p?.status ?? "active",
    billing_mode: p?.billing_mode ?? "non_billable",
    visibility: p?.visibility ?? "workspace",
    client_id: p?.client_id ?? "",
    currency: p?.currency ?? "",
    budget_hours: p?.budget_minutes ? String(Math.round((p.budget_minutes / 60) * 10) / 10) : "",
    budget_money: p?.budget_minor ? String(p.budget_minor / 100) : "",
    starts_on: p?.starts_on ?? null,
    ends_on: p?.ends_on ?? null,
  }
}

function SelectField({ id, label, value, onChange, items }: { id: string; label: string; value: string; onChange: (v: string) => void; items: { value: string; label: string }[] }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(v) => onChange(String(v ?? ""))}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value || "none"} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function ProjectForm({ project, onSaved, onCancel }: { project?: ProjectDetail; onSaved: (p: ProjectDetail) => void; onCancel?: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const canClients = ws.can("clients:read")
  const clients = useClients(ws.id, false, canClients)
  const [v, setV] = useState<Values>(() => initial(project))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((s) => ({ ...s, [k]: val }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.name.trim()) {
      setError(t("project.nameRequired"))
      return
    }
    const hours = Number(v.budget_hours || 0)
    const money = Number(v.budget_money || 0)
    if (Number.isNaN(hours) || hours < 0 || Number.isNaN(money) || money < 0) {
      setError(t("project.budgetInvalid"))
      return
    }
    const body: Record<string, unknown> = {
      name: v.name.trim(),
      description: v.description,
      color: v.color,
      status: v.status,
      billing_mode: v.billing_mode,
      visibility: v.visibility,
      currency: v.currency.trim().toUpperCase(),
      budget_minutes: Math.round(hours * 60),
      budget_minor: Math.round(money * 100),
      starts_on: v.starts_on ?? "",
      ends_on: v.ends_on ?? "",
    }
    if (canClients) body.client_id = v.client_id
    setBusy(true)
    setError(null)
    try {
      const saved = project
        ? await w.patch<ProjectDetail>(ws.id, `/api/w/projects/${project.id}`, body)
        : await w.post<ProjectDetail>(ws.id, "/api/w/projects", body)
      onSaved(saved)
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  const clientItems = [{ value: "", label: t("project.noClient") }, ...(clients.data?.clients ?? []).map((c) => ({ value: c.id, label: c.name }))]

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="p-name">{t("project.name")}</FieldLabel>
          <Input id="p-name" autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} placeholder={t("project.namePlaceholder")} />
        </Field>
        <Field>
          <FieldLabel htmlFor="p-desc">
            {t("project.description")} <span className="text-grid-muted">({t("common.optional")})</span>
          </FieldLabel>
          <Textarea id="p-desc" rows={3} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>{t("work.color")}</FieldLabel>
          <ColorPicker value={v.color} onChange={(c) => set("color", c)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField id="p-status" label={t("project.status")} value={v.status} onChange={(x) => set("status", x)} items={PROJECT_STATUSES.map((s) => ({ value: s, label: t(`projectStatus.${s}`) }))} />
          {canClients ? <SelectField id="p-client" label={t("project.client")} value={v.client_id} onChange={(x) => set("client_id", x)} items={clientItems} /> : null}
          <SelectField id="p-billing" label={t("project.billing")} value={v.billing_mode} onChange={(x) => set("billing_mode", x)} items={BILLING_MODES.map((b) => ({ value: b, label: t(`billing.${b}`) }))} />
          <SelectField
            id="p-visibility"
            label={t("project.visibility")}
            value={v.visibility}
            onChange={(x) => set("visibility", x)}
            items={[
              { value: "workspace", label: t("visibility.workspace") },
              { value: "members", label: t("visibility.members") },
            ]}
          />
          <Field>
            <FieldLabel htmlFor="p-hours">{t("project.budgetHours")}</FieldLabel>
            <Input id="p-hours" dir="ltr" inputMode="decimal" value={v.budget_hours} onChange={(e) => set("budget_hours", e.target.value)} placeholder="0" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-money">{t("project.budgetMoney")}</FieldLabel>
            <div className="flex gap-2">
              <Input id="p-money" dir="ltr" inputMode="decimal" value={v.budget_money} onChange={(e) => set("budget_money", e.target.value)} placeholder="0" />
              <Input aria-label={t("project.currency")} dir="ltr" className="w-20 uppercase" maxLength={3} value={v.currency} onChange={(e) => set("currency", e.target.value)} placeholder="USD" />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="p-start">{t("project.startsOn")}</FieldLabel>
            <DateField id="p-start" value={v.starts_on} onChange={(x) => set("starts_on", x)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-end">{t("project.endsOn")}</FieldLabel>
            <DateField id="p-end" value={v.ends_on} onChange={(x) => set("ends_on", x)} />
          </Field>
        </div>
        <FieldDescription>{t("project.visibilityHint")}</FieldDescription>
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? t("common.working") : project ? t("common.save") : t("project.create")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
