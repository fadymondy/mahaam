"use client"

// The employee KPI dashboard (internal/work/kpi.go): date range, headline tiles, hours by week,
// GitHub by project, AI usage, manager reviews (+ "Add review" for managers) and "Copy AI prompt",
// which copies the prompt + markdown dossier an AI writes the performance report from.
import { useState, type FormEvent, type ReactNode } from "react"
import { ClipboardCopyIcon, GitBranchIcon, PlusIcon, StarIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { money } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { compact, defaultRange, kpiApi, useGitHubStatus, useMemberKPI, type KPIKeyed } from "@/lib/kpi"
import { dayLabel, hm } from "@/lib/time"
import { errorText } from "@/lib/work"

export function RangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useTranslations()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field className="w-auto">
        <FieldLabel htmlFor="kpi-from">{t("kpi.from")}</FieldLabel>
        <Input id="kpi-from" type="date" dir="ltr" className="w-40" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} />
      </Field>
      <Field className="w-auto">
        <FieldLabel htmlFor="kpi-to">{t("kpi.to")}</FieldLabel>
        <Input id="kpi-to" type="date" dir="ltr" className="w-40" value={to} min={from} onChange={(e) => e.target.value && onChange(from, e.target.value)} />
      </Field>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="bg-grid-bg px-5 py-4">
      <div className="grid-micro mb-1">{label}</div>
      <div className="text-xl font-medium tabular-nums text-grid-fg">{value}</div>
      {hint ? <div className="mt-0.5 text-meta text-grid-muted">{hint}</div> : null}
    </div>
  )
}

/** Horizontal bars (CSS only: logical properties, so they grow from the start edge in RTL too). */
function Bars({ items, value, label, render }: { items: KPIKeyed[]; value: (k: KPIKeyed) => number; label: (k: KPIKeyed) => ReactNode; render: (k: KPIKeyed) => ReactNode }) {
  const max = Math.max(1, ...items.map(value))
  return (
    <ul className="space-y-2">
      {items.map((k) => (
        <li key={k.key || "none"} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <span className="truncate text-grid-fg" dir="auto">
            {label(k)}
          </span>
          <span className="h-2.5 rounded-sm bg-grid-soft">
            <span className="block h-full rounded-sm bg-grid-action/80" style={{ width: `${Math.max(2, (value(k) / max) * 100)}%` }} />
          </span>
          <span className="text-end text-meta tabular-nums text-grid-muted">{render(k)}</span>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3 bg-grid-bg px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function KpiDashboard({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const { t, locale } = useTranslations()
  const ws = useWorkspace()
  const [range, setRange] = useState(defaultRange)
  const subject = isSelf ? "me" : userId
  const kpi = useMemberKPI(ws.id, subject, range.from, range.to)
  const canReview = ws.can("kpi:review") && !isSelf
  const canManage = ws.can("kpi:all")
  const [reviewing, setReviewing] = useState(false)
  const [mapping, setMapping] = useState(false)

  const copyPrompt = async () => {
    try {
      const d = await kpiApi.dossier(ws.id, subject, range.from, range.to)
      await navigator.clipboard.writeText(`${d.prompt}\n\n---\n\n${d.markdown}`)
      toast.success(t("kpi.promptCopied"))
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    }
  }

  const k = kpi.data
  return (
    <div className="border-y border-line">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 py-4">
        <div>
          <h2 className="text-base font-medium">{t("kpi.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-grid-muted">{t("kpi.hint")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <RangePicker from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
          <Button variant="outline" onClick={() => void copyPrompt()} disabled={!k}>
            <ClipboardCopyIcon /> {t("kpi.copyPrompt")}
          </Button>
        </div>
      </div>

      {kpi.error ? (
        <ErrorState error={kpi.error} />
      ) : !k ? (
        <LoadingRows rows={4} />
      ) : (
        <div className="grid gap-px border-t border-line bg-grid-line">
          <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={t("kpi.hours")} value={<Ltr mono>{hm(k.time.tracked_s, "0:00")}</Ltr>} hint={t("kpi.billableHours", { h: hm(k.time.billable_s, "0:00") })} />
            <Tile label={t("kpi.daysTracked")} value={k.time.days_tracked} />
            <Tile label={t("kpi.tasksDone")} value={k.tasks.completed} hint={t("kpi.tasksOpen", { open: k.tasks.open_assigned, overdue: k.tasks.overdue })} />
            <Tile label={t("kpi.issuesFinished")} value={k.issues.finished} hint={t("kpi.agentTime", { h: hm(k.issues.agent_seconds, "0:00") })} />
            <Tile
              label={t("kpi.commits")}
              value={k.github.connected ? k.github.commits : "—"}
              hint={k.github.connected ? t("kpi.prs", { prs: k.github.pull_requests, merged: k.github.prs_merged }) : t("kpi.noGitHub")}
            />
            <Tile
              label={t("kpi.aiTokens")}
              value={<Ltr>{compact(k.ai.input_tokens + k.ai.output_tokens + k.ai.cache_tokens)}</Ltr>}
              hint={k.ai.cost_minor != null ? <Ltr>{money(k.ai.cost_minor, k.ai.currency, locale)}</Ltr> : t("kpi.mcpActions", { n: k.activity.mcp_actions })}
            />
          </div>

          <div className="grid gap-px lg:grid-cols-2">
            <Section title={t("kpi.hoursByWeek")}>
              {(k.time.by_week ?? []).length === 0 ? (
                <p className="text-sm text-grid-muted">{t("kpi.noTime")}</p>
              ) : (
                <Bars
                  items={k.time.by_week ?? []}
                  value={(r) => r.seconds ?? 0}
                  label={(r) => t("kpi.weekOf", { day: dayLabel(r.key, locale) })}
                  render={(r) => <Ltr mono>{hm(r.seconds ?? 0, "0:00")}</Ltr>}
                />
              )}
            </Section>
            <Section title={t("kpi.hoursByProject")}>
              {(k.time.by_project ?? []).length === 0 ? (
                <p className="text-sm text-grid-muted">{t("kpi.noTime")}</p>
              ) : (
                <Bars
                  items={k.time.by_project ?? []}
                  value={(r) => r.seconds ?? 0}
                  label={(r) => r.name || t("kpi.noProject")}
                  render={(r) => <Ltr mono>{hm(r.seconds ?? 0, "0:00")}</Ltr>}
                />
              )}
            </Section>

            <Section
              title={t("kpi.github")}
              action={
                <span className="flex items-center gap-2 text-meta text-grid-muted">
                  <GitBranchIcon className="size-3.5" aria-hidden />
                  {k.github_account ? (
                    <>
                      <Ltr>@{k.github_account.login}</Ltr>
                      <Badge variant="outline">{t(`kpi.via.${k.github_account.connected_via}`)}</Badge>
                    </>
                  ) : (
                    t("kpi.notConnected")
                  )}
                  {canManage ? (
                    <Button variant="ghost" size="sm" onClick={() => setMapping(true)}>
                      {t("kpi.mapGitHub")}
                    </Button>
                  ) : null}
                </span>
              }
            >
              {!k.github.connected ? (
                <p className="text-sm text-grid-muted">{t("kpi.noGitHubBody")}</p>
              ) : (k.github.by_project ?? []).length === 0 ? (
                <p className="text-sm text-grid-muted">{t("kpi.noCommits")}</p>
              ) : (
                <>
                  <Bars
                    items={k.github.by_project ?? []}
                    value={(r) => r.commits ?? 0}
                    label={(r) => r.name}
                    render={(r) => t("kpi.commitsPrs", { c: r.commits ?? 0, p: r.pull_requests ?? 0 })}
                  />
                  <p className="text-meta text-grid-muted">
                    {t("kpi.deploys", { n: k.github.deployments, ok: k.github.deployments_succeeded })}
                  </p>
                </>
              )}
            </Section>

            <Section title={t("kpi.ai")}>
              {(k.ai.by_model ?? []).length === 0 ? (
                <p className="text-sm text-grid-muted">{t("kpi.noAI")}</p>
              ) : (
                <Bars
                  items={k.ai.by_model ?? []}
                  value={(r) => r.tokens ?? 0}
                  label={(r) => <Ltr>{r.name}</Ltr>}
                  render={(r) => (
                    <Ltr>
                      {compact(r.tokens ?? 0)}
                      {r.cost_minor != null ? ` · ${money(r.cost_minor, k.ai.currency, locale)}` : ""}
                    </Ltr>
                  )}
                />
              )}
              <p className="text-meta text-grid-muted">
                {t("kpi.agentLine", {
                  started: k.issues.started,
                  reviewed: k.issues.reviewed,
                  mentions: k.issues.mentions_answered,
                  mcp: k.activity.mcp_actions,
                })}
              </p>
            </Section>
          </div>

          <Section
            title={t("kpi.reviews")}
            action={
              canReview ? (
                <Button size="sm" onClick={() => setReviewing(true)}>
                  <PlusIcon /> {t("kpi.addReview")}
                </Button>
              ) : null
            }
          >
            {(k.reviews.items ?? []).length === 0 ? (
              <EmptyState title={t("kpi.noReviews")} />
            ) : (
              <>
                {k.reviews.avg_rating != null ? (
                  <p className="flex items-center gap-1 text-sm text-grid-muted">
                    <StarIcon className="size-3.5" aria-hidden /> {t("kpi.avgRating", { r: k.reviews.avg_rating.toFixed(1) })}
                  </p>
                ) : null}
                <ul className="divide-y divide-line border-y border-line">
                  {(k.reviews.items ?? []).map((r) => (
                    <li key={r.id} className="space-y-1 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-meta text-grid-muted">
                        <Ltr>
                          {r.period_start} → {r.period_end}
                        </Ltr>
                        {r.rating != null ? <Badge variant="secondary">{t("kpi.ratingOf", { r: r.rating })}</Badge> : null}
                        <Ltr>{r.author_email}</Ltr>
                        {canReview ? (
                          <span className="ms-auto">
                            <ConfirmButton
                              label={t("kpi.deleteReview")}
                              title={t("kpi.deleteReviewTitle")}
                              description={t("kpi.deleteReviewBody")}
                              confirmLabel={t("kpi.deleteReview")}
                              onConfirm={async () => {
                                try {
                                  await kpiApi.deleteReview(ws.id, r.id)
                                  void kpi.mutate()
                                } catch (err) {
                                  toast.error(errorText(err, t("common.networkError")))
                                }
                              }}
                            />
                          </span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-grid-fg" dir="auto">
                        {r.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        </div>
      )}

      {reviewing ? (
        <ReviewDialog
          userId={userId}
          from={range.from}
          to={range.to}
          onClose={() => setReviewing(false)}
          onSaved={() => {
            setReviewing(false)
            void kpi.mutate()
          }}
        />
      ) : null}
      {mapping ? (
        <MapGitHubDialog
          userId={userId}
          onClose={() => setMapping(false)}
          onSaved={() => {
            setMapping(false)
            void kpi.mutate()
          }}
        />
      ) : null}
    </div>
  )
}

function ReviewDialog({ userId, from, to, onClose, onSaved }: { userId: string; from: string; to: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const rating = Number(f.get("rating") || 0)
    setBusy(true)
    try {
      await kpiApi.addReview(ws.id, userId, {
        period_start: String(f.get("period_start")),
        period_end: String(f.get("period_end")),
        rating: rating >= 1 && rating <= 5 ? rating : undefined,
        body: String(f.get("body") ?? ""),
      })
      toast.success(t("kpi.reviewSaved"))
      onSaved()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("kpi.addReview")}</DialogTitle>
            <DialogDescription>{t("kpi.reviewHint")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="rv-start">{t("kpi.periodStart")}</FieldLabel>
                <Input id="rv-start" name="period_start" type="date" dir="ltr" required defaultValue={from} />
              </Field>
              <Field>
                <FieldLabel htmlFor="rv-end">{t("kpi.periodEnd")}</FieldLabel>
                <Input id="rv-end" name="period_end" type="date" dir="ltr" required defaultValue={to} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="rv-rating">{t("kpi.rating")}</FieldLabel>
              <select id="rv-rating" name="rating" className="h-8 w-full rounded-lg border border-line bg-transparent px-2 text-sm" defaultValue="">
                <option value="">{t("kpi.noRating")}</option>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {t("kpi.ratingOf", { r: n })}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="rv-body">{t("kpi.reviewBody")}</FieldLabel>
              <Textarea id="rv-body" name="body" dir="auto" required rows={6} maxLength={20000} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("kpi.saveReview")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MapGitHubDialog({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslations()
  const ws = useWorkspace()
  const status = useGitHubStatus(ws.id, userId)
  const [busy, setBusy] = useState(false)
  const acc = status.data?.account
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const emails = String(f.get("emails") ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    setBusy(true)
    try {
      await kpiApi.mapMember(ws.id, userId, String(f.get("login") ?? ""), emails)
      toast.success(t("kpi.mapped"))
      onSaved()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  const unmap = async () => {
    setBusy(true)
    try {
      await kpiApi.unmapMember(ws.id, userId)
      onSaved()
    } catch (err) {
      toast.error(errorText(err, t("common.networkError")))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {status.isLoading ? (
          <LoadingRows rows={2} />
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{t("kpi.mapGitHub")}</DialogTitle>
              <DialogDescription>{t("kpi.mapHint")}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="gh-login">{t("kpi.login")}</FieldLabel>
                <Input id="gh-login" name="login" dir="ltr" required maxLength={39} defaultValue={acc?.login ?? ""} placeholder="octocat" />
              </Field>
              <Field>
                <FieldLabel htmlFor="gh-emails">{t("kpi.emails")}</FieldLabel>
                <Textarea id="gh-emails" name="emails" dir="ltr" rows={3} defaultValue={(acc?.emails ?? []).join("\n")} placeholder="dev@example.com" />
              </Field>
            </FieldGroup>
            <DialogFooter>
              {acc ? (
                <Button type="button" variant="ghost" className="me-auto text-grid-danger-text" disabled={busy} onClick={() => void unmap()}>
                  {t("kpi.unmap")}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("kpi.saveMapping")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
