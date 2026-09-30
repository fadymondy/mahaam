"use client"

// Platform dashboard: headline counts, signups per day (last 30 days) and workspaces per plan.
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { SectionHeader } from "@/components/public-frame"
import { ErrorState, LoadingRows } from "@/components/states"
import { bytes, num, planName, useAdminStats, type AdminStats } from "@/lib/admin"
import { formatDay } from "@/lib/format"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function AdminDashboard() {
  const { t } = useTranslations()
  useDocumentTitle(`${t("admin.nav.dashboard")} · ${t("admin.title")}`)
  const stats = useAdminStats()
  return (
    <>
      <SectionHeader micro={t("admin.title")} title={t("admin.nav.dashboard")} description={t("admin.dashboard.hint")} />
      {stats.error ? <ErrorState error={stats.error} /> : !stats.data ? <LoadingRows rows={4} /> : <Dashboard s={stats.data} />}
    </>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="space-y-1 bg-card px-5 py-4">
      <p className="text-eyebrow uppercase">{label}</p>
      <Ltr className="block text-2xl font-semibold text-foreground tabular-nums">{value}</Ltr>
      {sub ? <p className="text-caption text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

function Dashboard({ s }: { s: AdminStats }) {
  const { t, locale } = useTranslations()
  const n = (v: number) => num(v, locale)
  const hours = Math.round(s.time_seconds / 3600)
  return (
    <div className="space-y-8 pb-10">
      <div className="grid grid-cols-2 gap-px border-y border-border bg-line lg:grid-cols-4" data-stat-tiles>
        <Tile label={t("admin.stats.users")} value={n(s.users)} sub={t("admin.stats.usersSub", { admins: n(s.admins), suspended: n(s.suspended_users) })} />
        <Tile label={t("admin.stats.activeUsers")} value={n(s.active_users_7d)} sub={t("admin.stats.last30", { n: n(s.active_users_30d) })} />
        <Tile label={t("admin.stats.workspaces")} value={n(s.workspaces)} sub={t("admin.stats.suspended", { n: n(s.suspended_workspaces) })} />
        <Tile label={t("admin.stats.activeWorkspaces")} value={n(s.active_workspaces_7d)} sub={t("admin.stats.last30", { n: n(s.active_workspaces_30d) })} />
        <Tile label={t("admin.stats.projects")} value={n(s.projects)} />
        <Tile label={t("admin.stats.tasks")} value={n(s.tasks)} />
        <Tile label={t("admin.stats.issues")} value={n(s.issues)} />
        <Tile label={t("admin.stats.time")} value={`${n(hours)}h`} sub={t("admin.stats.storage", { size: bytes(s.storage_bytes) })} />
      </div>

      <section className="space-y-3">
        <h2 className="px-6 text-sm font-medium text-foreground">{t("admin.dashboard.signups")}</h2>
        <div className="px-4">
          <SignupsChart data={s.signups ?? []} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="px-6 text-sm font-medium text-foreground">{t("admin.dashboard.plans")}</h2>
        <ul className="divide-y divide-line border-y border-border" data-plan-counts>
          {(s.plans ?? []).map((p) => (
            <li key={p.plan} className="flex items-center justify-between px-6 py-2.5 text-sm">
              <span>
                {planName(p, locale)} <Ltr className="text-caption text-muted-foreground">{p.plan}</Ltr>
              </span>
              <Ltr className="tabular-nums">{n(p.count)}</Ltr>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function SignupsChart({ data }: { data: { day: string; users: number; workspaces: number }[] }) {
  const { t, locale, isRtl } = useTranslations()
  const config = {
    users: { label: t("admin.stats.users"), color: "var(--nq-action)" },
    workspaces: { label: t("admin.stats.workspaces"), color: "var(--nq-accent)" },
  } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" role="img" aria-label={t("admin.dashboard.signups")} data-signups-chart={data.length}>
      <BarChart data={data} margin={{ top: 8, left: 4, right: 4, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          reversed={isRtl}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={12}
          tickFormatter={(d: string) => String(Number(d.slice(8)))}
        />
        <YAxis orientation={isRtl ? "right" : "left"} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => (label ? formatDay(String(label), locale) : "")}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="users" fill="var(--color-users)" isAnimationActive={false} />
        <Bar dataKey="workspaces" fill="var(--color-workspaces)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}
