"use client"

// Workspace time settings: timezone (days are cut at midnight here), week start, rounding (report
// time only), currency, workspace language (default columns of new projects), default rates and
// reminders. Everyone reads them (the timesheets depend on them); admins change them.
import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { SectionHeader } from "@/components/public-frame"
import { ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { LOCALE_NAMES } from "@/lib/i18n-locale"
import { intlTag } from "@/lib/i18n-locale"
import { useTranslations } from "@/lib/i18n"
import { timeApi, useRefreshTime, useTimeSettings, type TimeSettings } from "@/lib/time"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

const ROUNDING = [0, 1, 5, 6, 10, 15, 30, 60]

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone")
  } catch {
    return ["UTC", "Africa/Cairo", "Europe/London", "America/New_York", "Asia/Dubai", "Asia/Riyadh"]
  }
}

function Row({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line px-6 py-5 md:grid-cols-[18rem_1fr] md:gap-8">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium text-grid-fg">
          {label}
        </label>
        {hint ? <p className="mt-1 text-xs text-grid-muted">{hint}</p> : null}
      </div>
      <div className="flex max-w-xl items-center">{children}</div>
    </div>
  )
}

export default function TimeSettingsPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("timeSettings.title")} · ${ws.summary.name}`)
  const s = useTimeSettings(ws.id)
  return (
    <>
      <SectionHeader micro={ws.summary.name} title={t("timeSettings.title")} description={t("timeSettings.hint")} />
      {s.error ? (
        <ErrorState error={s.error} />
      ) : !s.data ? (
        <LoadingRows rows={5} />
      ) : (
        <SettingsForm key={JSON.stringify(s.data)} initial={s.data} onSaved={() => void s.mutate()} />
      )}
    </>
  )
}

function SettingsForm({ initial, onSaved }: { initial: TimeSettings; onSaved: () => void }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const { mutate } = useSWRConfig()
  const refresh = useRefreshTime()
  const canEdit = initial.can_manage
  const canRates = ws.can("rates:read")
  const ratesEditable = canEdit && ws.can("rates:manage")
  const major = (v?: number | null) => (v != null ? String(v / 100) : "")
  const [v, setV] = useState({
    timezone: initial.timezone,
    week_start: initial.week_start,
    rounding: initial.rounding_minutes,
    currency: initial.currency,
    locale: initial.locale,
    bill: major(initial.default_bill_rate_minor),
    cost: major(initial.default_cost_rate_minor),
    hours: String(initial.reminder_running_hours),
    daily: initial.reminder_daily,
  })
  const [tzOpen, setTzOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allZones = useMemo(zones, [])
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => ({
        value: String(i),
        label: new Intl.DateTimeFormat(intlTag(locale), { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 8, 13 + i))),
      })),
    [locale],
  )
  const roundings = ROUNDING.map((n) => ({ value: String(n), label: n ? t("timeSettings.roundingMinutes", { n }) : t("timeSettings.roundingNone") }))
  const languages = (["en", "ar"] as const).map((l) => ({ value: l, label: LOCALE_NAMES[l] }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const toMinor = (s: string) => (s.trim() === "" ? 0 : Math.round(Number(s) * 100))
    const bill = toMinor(v.bill)
    const cost = toMinor(v.cost)
    const hours = Number(v.hours)
    if (Number.isNaN(bill) || Number.isNaN(cost) || bill < 0 || cost < 0) return setError(t("rates.invalid"))
    const body: Record<string, unknown> = {
      timezone: v.timezone,
      week_start: v.week_start,
      rounding_minutes: v.rounding,
      currency: v.currency.trim().toUpperCase(),
      locale: v.locale,
      reminder_running_hours: Math.min(24, Math.max(1, Number.isFinite(hours) ? Math.round(hours) : 8)),
      reminder_daily: v.daily,
    }
    if (ratesEditable) Object.assign(body, { default_bill_rate_minor: bill, default_cost_rate_minor: cost })
    setBusy(true)
    try {
      await timeApi.settings(ws.id, body)
      toast.success(t("timeSettings.saved"))
      onSaved()
      void refresh(ws.id)
      void mutate(["/api/w/current", ws.id])
    } catch (err) {
      setError(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-line" data-time-settings>
      {!canEdit ? <p className="border-b border-line bg-grid-soft px-6 py-3 text-sm text-grid-body">{t("timeSettings.readOnly")}</p> : null}
      <fieldset disabled={!canEdit || busy} className="contents">
        <Row label={t("timeSettings.timezone")} hint={t("timeSettings.timezoneHint")} htmlFor="ts-tz">
          <Popover open={tzOpen} onOpenChange={setTzOpen}>
            <PopoverTrigger render={<Button id="ts-tz" variant="outline" disabled={!canEdit} className="w-full justify-between font-normal" data-timezone={v.timezone} />}>
              <span dir="ltr">{v.timezone}</span>
              <ChevronsUpDownIcon className="text-grid-muted" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
              <Command>
                <CommandInput placeholder={t("timeSettings.timezoneSearch")} />
                <CommandList>
                  <CommandEmpty>{t("timer.noMatch")}</CommandEmpty>
                  {allZones.map((z) => (
                    <CommandItem
                      key={z}
                      value={z}
                      onSelect={() => {
                        setV((s) => ({ ...s, timezone: z }))
                        setTzOpen(false)
                      }}
                    >
                      <span dir="ltr">{z}</span>
                      {z === v.timezone ? <CheckIcon className="ms-auto" /> : null}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Row>
        <Row label={t("timeSettings.weekStart")} htmlFor="ts-week">
          <Select items={weekdays} value={String(v.week_start)} onValueChange={(x) => x != null && setV((s) => ({ ...s, week_start: Number(x) }))} disabled={!canEdit}>
            <SelectTrigger id="ts-week" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weekdays.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t("timeSettings.rounding")} hint={t("timeSettings.roundingHint")} htmlFor="ts-round">
          <Select items={roundings} value={String(v.rounding)} onValueChange={(x) => x != null && setV((s) => ({ ...s, rounding: Number(x) }))} disabled={!canEdit}>
            <SelectTrigger id="ts-round" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roundings.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t("timeSettings.currency")} hint={t("timeSettings.currencyHint")} htmlFor="ts-cur">
          <Input id="ts-cur" dir="ltr" maxLength={3} className="w-28 font-mono uppercase" value={v.currency} onChange={(e) => setV((s) => ({ ...s, currency: e.target.value.toUpperCase() }))} />
        </Row>
        <Row label={t("timeSettings.language")} hint={t("timeSettings.languageHint")} htmlFor="ts-lang">
          <Select items={languages} value={v.locale} onValueChange={(x) => x && setV((s) => ({ ...s, locale: String(x) }))} disabled={!canEdit}>
            <SelectTrigger id="ts-lang" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        {canRates ? (
          <Row label={t("timeSettings.rates")} hint={t("timeSettings.defaultsHint")}>
            <div className="grid w-full gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-grid-muted">
                <span>{t("timeSettings.defaultBill")}</span>
                <span className="flex items-center gap-2">
                  <Input dir="ltr" inputMode="decimal" disabled={!ratesEditable} value={v.bill} onChange={(e) => setV((s) => ({ ...s, bill: e.target.value }))} placeholder="0.00" />
                  <span className="font-mono text-grid-muted">{v.currency}</span>
                </span>
              </label>
              <label className="space-y-1.5 text-xs text-grid-muted">
                <span>{t("timeSettings.defaultCost")}</span>
                <span className="flex items-center gap-2">
                  <Input dir="ltr" inputMode="decimal" disabled={!ratesEditable} value={v.cost} onChange={(e) => setV((s) => ({ ...s, cost: e.target.value }))} placeholder="0.00" />
                  <span className="font-mono text-grid-muted">{v.currency}</span>
                </span>
              </label>
            </div>
          </Row>
        ) : null}
        <Row label={t("timeSettings.reminders")} hint={t("timeSettings.remindersHint")}>
          <div className="w-full space-y-3">
            <label className="flex items-center justify-between gap-4 text-sm text-grid-body">
              <span>{t("timeSettings.runningHours")}</span>
              <Input dir="ltr" type="number" min={1} max={24} className="w-20" value={v.hours} onChange={(e) => setV((s) => ({ ...s, hours: e.target.value }))} />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm text-grid-body">
              <span>{t("timeSettings.daily")}</span>
              <Switch checked={v.daily} disabled={!canEdit} onCheckedChange={(x) => setV((s) => ({ ...s, daily: x }))} />
            </label>
          </div>
        </Row>
      </fieldset>
      {canEdit ? (
        <div className="flex items-center justify-end gap-3 px-6 py-4">
          {error ? <FieldError className="me-auto">{error}</FieldError> : null}
          <Button type="submit" disabled={busy} data-save-settings>
            {busy ? t("common.working") : t("common.save")}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
