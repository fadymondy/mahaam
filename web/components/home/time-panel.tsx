"use client"

// This week's time on the home dashboard. Managers (time:manage) see the whole workspace with their
// own share beside it; everyone else sees their own week. The panel opens a details modal: one row
// per person (or per project for your own week), a column per day, totals in the footer.
import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Button, ChartContainer, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, type ChartConfig } from "@fadymondy/nasaq/web"

import { Ltr } from "@/components/copy-field"
import { Panel, PanelLink } from "@/components/home/panels"
import { PersonAvatar, type Directory } from "@/components/work/people"
import { ColorDot, solid } from "@/components/work/palette"
import { useWorkspace } from "@/components/workspace/workspace-context"
import { useTranslations } from "@/lib/i18n"
import { dayLabel, hm, useTeamTimesheet, useTimesheet } from "@/lib/time"

type Row = { id: string; label: ReactNode; color?: string | null; seconds: number[]; total: number }

export function TimePanel({ base, dir, meId }: { base: string; dir: Directory; meId?: string }) {
  const { t, locale, isRtl } = useTranslations()
  const ws = useWorkspace()
  const manage = ws.can("time:manage")
  const sheet = useTimesheet(ws.id)
  const team = useTeamTimesheet(ws.id, null, manage)
  const [details, setDetails] = useState(false)
  const s = sheet.data
  const tm = manage ? team.data : undefined

  const days = tm?.days ?? s?.days ?? []
  const dayTotals = tm?.day_totals ?? s?.day_totals ?? []
  const total = tm?.total_s ?? s?.total_s ?? 0
  const myTotal = s?.total_s ?? 0
  const data = days.map((d, i) => ({ day: d, h: Math.round(((dayTotals[i] ?? 0) / 3600) * 100) / 100 }))
  const short = (d: string) => dayLabel(d, locale).split(" ")[0].replace(/[,،]$/, "")

  // People for the workspace view, projects for your own week.
  const rows: Row[] = useMemo(() => {
    if (tm) {
      return tm.members
        .filter((m) => m.total_s > 0)
        .sort((a, b) => b.total_s - a.total_s)
        .map((m) => ({
          id: m.user_id,
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <PersonAvatar id={m.user_id} dir={dir} className="shrink-0" />
              <span className="truncate" dir="ltr">
                {dir.name(m.user_id).split("@")[0]}
              </span>
              {m.user_id === meId ? <span className="shrink-0 text-caption text-muted-foreground">{t("home.time.you")}</span> : null}
            </span>
          ),
          seconds: m.seconds,
          total: m.total_s,
        }))
    }
    const m = new Map<string, Row>()
    for (const r of s?.rows ?? []) {
      const key = r.project_id ?? "none"
      const cur = m.get(key) ?? { id: key, label: r.project_name ?? t("home.time.other"), color: r.project_color, seconds: (s?.days ?? []).map(() => 0), total: 0 }
      r.seconds.forEach((x, i) => (cur.seconds[i] = (cur.seconds[i] ?? 0) + x))
      cur.total += r.total_s
      m.set(key, cur)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [tm, s, dir, meId, t])

  const rest = rows.slice(4).reduce((n, x) => n + x.total, 0)
  const shown: Row[] = rest ? [...rows.slice(0, 4), { id: "rest", label: t("home.time.other"), color: null, seconds: [], total: rest }] : rows.slice(0, 4)
  const config = { h: { label: t("home.time.hours", { h: "" }).trim(), color: "var(--nq-action)" } } satisfies ChartConfig
  const loading = sheet.isLoading || (manage && team.isLoading)
  const title = manage ? t("home.time.titleTeam") : t("home.time.title")
  const more = `${base}/time${manage ? "/team" : ""}`
  const dot = (r: Row) => (r.color !== undefined ? <ColorDot color={r.color} className="shrink-0" /> : null)

  return (
    <Panel title={title} action={<PanelLink href={more}>{manage ? t("home.time.openTeam") : t("home.time.open")}</PanelLink>} data-panel="time">
      {total === 0 ? (
        <p className="flex flex-1 items-center justify-center py-6 text-center text-sm text-muted-foreground">{loading ? "…" : t("home.time.empty")}</p>
      ) : (
        <button
          type="button"
          onClick={() => setDetails(true)}
          aria-label={t("home.time.details")}
          className="-m-2 flex flex-1 flex-col gap-4 rounded-md p-2 text-start transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-nq-focus"
          data-time-details
        >
          <span className="flex items-end justify-between gap-3">
            <span className="text-2xl font-semibold leading-none tabular-nums">
              <Ltr>{hm(total, "0:00")}</Ltr>
            </span>
            {manage ? (
              <span className="text-caption text-muted-foreground">
                {t("home.time.yours")} <Ltr>{hm(myTotal, "0:00")}</Ltr>
              </span>
            ) : null}
          </span>
          <ChartContainer config={config} className="pointer-events-none aspect-auto h-36 w-full" role="img" aria-label={title}>
            <BarChart data={data} margin={{ top: 4, left: 0, right: 0, bottom: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" reversed={isRtl} tickLine={false} axisLine={false} tickMargin={6} tickFormatter={short} />
              <YAxis orientation={isRtl ? "right" : "left"} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Bar dataKey="h" fill="var(--color-h)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
          <span className="flex flex-col gap-2">
            <span className="text-caption text-muted-foreground">{manage ? t("home.time.byMember") : t("home.time.byProject")}</span>
            {shown.map((r) => (
              <span key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {dot(r)}
                  <span className="min-w-0 truncate">{r.label}</span>
                </span>
                <span className="text-caption tabular-nums text-muted-foreground">
                  <Ltr>{hm(r.total, "0:00")}</Ltr>
                </span>
                <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(2, (r.total / total) * 100)}%`, background: r.color !== undefined ? solid(r.color) : "var(--nq-action)" }}
                  />
                </span>
              </span>
            ))}
          </span>
        </button>
      )}

      <Dialog open={details} onOpenChange={setDetails}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" data-time-dialog>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {t("home.time.total")} <Ltr>{hm(total, "0:00")}</Ltr>
              {manage ? (
                <>
                  {" · "}
                  {t("home.time.yours")} <Ltr>{hm(myTotal, "0:00")}</Ltr>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-caption text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{manage ? t("home.time.member") : t("home.time.project")}</th>
                  {days.map((d) => (
                    <th key={d} className="px-2 py-2 text-end font-medium">
                      {short(d)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-end font-medium">{t("home.time.total")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-56 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {dot(r)}
                        <span className="min-w-0 truncate">{r.label}</span>
                      </span>
                    </td>
                    {days.map((d, i) => (
                      <td key={d} className="px-2 py-2 text-end tabular-nums text-muted-foreground">
                        <Ltr>{r.seconds[i] ? hm(r.seconds[i], "0:00") : "–"}</Ltr>
                      </td>
                    ))}
                    <td className="px-3 py-2 text-end font-medium tabular-nums">
                      <Ltr>{hm(r.total, "0:00")}</Ltr>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30 font-medium">
                <tr>
                  <td className="px-3 py-2">{t("home.time.total")}</td>
                  {days.map((d, i) => (
                    <td key={d} className="px-2 py-2 text-end tabular-nums">
                      <Ltr>{hm(dayTotals[i] ?? 0, "0:00")}</Ltr>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-end tabular-nums">
                    <Ltr>{hm(total, "0:00")}</Ltr>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" nativeButton={false} render={<Link href={more} />}>
              {manage ? t("home.time.openTeam") : t("home.time.open")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
