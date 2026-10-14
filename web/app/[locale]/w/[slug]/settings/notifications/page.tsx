"use client"

// My notification settings in this workspace: email + daily digest (only when the server can send
// email — otherwise the server refuses those fields with 409, so the switches are replaced by a
// notice) and per-kind mutes (a muted kind is not stored in the inbox at all).
import { useState, type ReactNode } from "react"
import { MailWarningIcon } from "lucide-react"
import { toast } from "@fadymondy/nasaq/web"

import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { Panel, SectionTitle } from "@/components/page"
import { ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { reportsApi, useNotificationSettings, type NotificationSettings } from "@/lib/reports"
import { useDocumentTitle } from "@/lib/title"
import { errorText } from "@/lib/work"

function Row({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 px-4 py-5 md:grid-cols-[18rem_1fr] md:gap-8">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {hint ? <p className="mt-1 text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="min-w-0 max-w-xl">{children}</div>
    </div>
  )
}

export default function NotificationSettingsPage() {
  const { t } = useTranslations()
  const ws = useWorkspace()
  useDocumentTitle(`${t("nset.title")} · ${ws.summary.name}`)
  const s = useNotificationSettings(ws.id)
  return (
    <div className="flex flex-col gap-6">
      <SectionTitle title={t("nset.title")} description={t("nset.hint")} />
      {s.error ? <ErrorState error={s.error} /> : !s.data ? <LoadingRows rows={4} /> : <Form data={s.data} onSaved={(d) => void s.mutate(d, { revalidate: false })} />}
    </div>
  )
}

function Form({ data, onSaved }: { data: NotificationSettings; onSaved: (d: NotificationSettings) => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState<string | null>(null)
  const configured = data.email.configured

  async function patch(field: string, body: Parameters<typeof reportsApi.notificationSettings>[1]) {
    setBusy(field)
    try {
      const next = await reportsApi.notificationSettings(ws.id, body)
      onSaved(next)
      toast.success(t("nset.saved"))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(null)
    }
  }

  const hours = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }))
  const muted = new Set(data.muted_kinds ?? [])

  return (
    <Panel flush contentClassName="divide-y divide-line" data-notification-settings data-email-configured={configured}>
      {configured ? (
        <>
          <Row label={t("nset.email")} hint={t("nset.emailHint", { address: `⁦${data.address}⁩` })} htmlFor="ns-email">
            <label className="flex items-center justify-between gap-4 text-sm text-nq-fg-body">
              <span>{t("nset.emailEnabled")}</span>
              <Switch
                id="ns-email"
                checked={data.email_enabled}
                disabled={busy !== null}
                onCheckedChange={(v) => patch("email", { email_enabled: v })}
                data-email-enabled
              />
            </label>
          </Row>
          <Row label={t("nset.digest")} hint={t("nset.digestHourHint", { tz: data.timezone })} htmlFor="ns-digest">
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-4 text-sm text-nq-fg-body">
                <span>{t("nset.digestEnabled")}</span>
                <Switch
                  id="ns-digest"
                  checked={data.digest_enabled}
                  disabled={busy !== null || !data.email_enabled}
                  onCheckedChange={(v) => patch("digest", { digest_enabled: v })}
                  data-digest-enabled
                />
              </label>
              <label className="flex items-center justify-between gap-4 text-sm text-nq-fg-body">
                <span>{t("nset.digestHour")}</span>
                <Select
                  items={hours}
                  value={String(data.digest_hour)}
                  disabled={busy !== null || !data.email_enabled || !data.digest_enabled}
                  onValueChange={(v) => v != null && patch("hour", { digest_hour: Number(v) })}
                >
                  <SelectTrigger className="w-28" dir="ltr" data-digest-hour>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hours.map((h) => (
                      <SelectItem key={h.value} value={h.value}>
                        <span dir="ltr">{h.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </Row>
        </>
      ) : (
        <div role="status" className="flex items-start gap-3 bg-muted px-4 py-4" data-email-not-configured>
          <MailWarningIcon className="mt-0.5 size-4 shrink-0 text-(--nq-warn-text)" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{t("nset.notConfigured")}</p>
            <p className="max-w-3xl text-sm text-nq-fg-body">{t("nset.notConfiguredBody", { driver: data.email.driver })}</p>
          </div>
        </div>
      )}

      <Row label={t("nset.kinds")} hint={t("nset.kindsHint")}>
        <ul className="divide-y divide-line rounded-lg border border-border" data-kinds>
          {data.kinds.map((k) => {
            const id = `ns-kind-${k.replace(/\W/g, "-")}`
            const on = muted.has(k)
            return (
              <li key={k} className="flex items-center gap-3 px-3 py-2.5" data-kind={k} data-muted={on}>
                <Checkbox
                  id={id}
                  checked={on}
                  disabled={busy !== null}
                  onCheckedChange={(v) => {
                    const next = new Set(muted)
                    if (v) next.add(k)
                    else next.delete(k)
                    void patch(`kind:${k}`, { muted_kinds: [...next] })
                  }}
                />
                <label htmlFor={id} className="min-w-0 flex-1 text-sm text-nq-fg-body">
                  {t(`nset.kind.${k}`) === `nset.kind.${k}` ? <Ltr>{k}</Ltr> : t(`nset.kind.${k}`)}
                </label>
                <span className="text-caption text-muted-foreground">{on ? t("nset.muted") : ""}</span>
              </li>
            )
          })}
        </ul>
      </Row>
    </Panel>
  )
}
