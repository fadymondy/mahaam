"use client"

// The report's charts, on the registry's shadcn `chart` (recharts): stacked billable / non-billable
// hours per day from `series`, and — for grouped views — the rounded hours of the top groups.
// Colours come from theme tokens and the palette keys; nothing is hardcoded.
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { solid } from "@/components/work/palette"
import { useTranslations } from "@/lib/i18n"
import { dayLabel } from "@/lib/time"
import { hmCell, type ReportPoint } from "@/lib/reports"

const hours = (s: number) => Math.round((s / 3600) * 100) / 100

export function SeriesChart({ series }: { series: ReportPoint[] }) {
  const { t, locale, isRtl } = useTranslations()
  const config = {
    billable: { label: t("reports.chart.billable"), color: "var(--grid-action)" },
    non_billable: { label: t("reports.chart.nonBillable"), color: "var(--grid-muted)" },
  } satisfies ChartConfig
  const data = series.map((p) => ({ day: p.day, billable: hours(p.billable_rounded_s), non_billable: hours(p.non_billable_rounded_s) }))
  const long = data.length > 16
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" role="img" aria-label={t("reports.chart.label")} data-series-chart={data.length}>
      <BarChart data={data} margin={{ top: 8, left: 4, right: 4, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          reversed={isRtl}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={long ? 12 : 4}
          tickFormatter={(d: string) => (long ? String(Number(d.slice(8))) : dayLabel(d, locale))}
        />
        <YAxis orientation={isRtl ? "right" : "left"} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => {
                const d = (p?.[0]?.payload as { day?: string } | undefined)?.day
                return d ? dayLabel(d, locale, "long") : ""
              }}
              formatter={(value, name, item) => (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 shrink-0 rounded-[2px]" style={{ background: item.color }} />
                    {config[name as keyof typeof config]?.label ?? name}
                  </span>
                  <span className="font-mono text-foreground tabular-nums" dir="ltr">
                    {hmCell(Number(value) * 3600)}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="non_billable" stackId="h" fill="var(--color-non_billable)" isAnimationActive={false} />
        <Bar dataKey="billable" stackId="h" fill="var(--color-billable)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

export type BreakdownItem = { key: string; name: string; color?: string | null; seconds: number }

export function BreakdownChart({ items, colored }: { items: BreakdownItem[]; colored: boolean }) {
  const { t, isRtl } = useTranslations()
  const config = { hours: { label: t("reports.chart.hours"), color: "var(--grid-action)" } } satisfies ChartConfig
  const data = items.map((r) => ({ key: r.key || "none", name: r.name, hours: hours(r.seconds), fill: colored ? solid(r.color) : "var(--color-hours)" }))
  const height = Math.max(120, data.length * 30 + 24)
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} data-breakdown-chart={data.length}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, left: 0, right: 12, bottom: 0 }} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" reversed={isRtl} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="name"
          orientation={isRtl ? "right" : "left"}
          tickLine={false}
          axisLine={false}
          width={132}
          // "end" in both directions: in RTL text, SVG's end is the left edge, so the label runs away from the plot.
          tick={({ x, y, payload }: { x: number | string; y: number | string; payload: { value: string } }) => {
            const v = String(payload.value)
            return (
              <text x={Number(x)} y={Number(y)} dx={isRtl ? 6 : -6} dy={4} textAnchor="end" className="fill-muted-foreground text-xs">
                {v.length > 20 ? v.slice(0, 19) + "…" : v}
              </text>
            )
          }}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={(value) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {hmCell(Number(value) * 3600)}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="hours" isAnimationActive={false} barSize={18}>
          {data.map((d) => (
            <Cell key={d.key} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
