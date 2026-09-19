import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { Button, Card, Empty, ErrorState, ListItem, Loading, Row, Screen, SectionTitle, T } from "@/components/ui";
import { useTimeSettings } from "@/features/team";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { usePolling } from "@/lib/live";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { addDays, formatDuration, localDay, weekStartOf } from "@/lib/time";
import { useTheme } from "@/theme";
import { projectColor, space } from "@/theme/tokens";

interface Row7 {
  project_name?: string | null;
  project_color?: string | null;
  task_key?: string | null;
  task_title?: string | null;
  seconds?: number[];
  total_s?: number;
}

export default function Timesheet() {
  const t = useT();
  const f = useFormat();
  const ws = useWs();
  const { c } = useTheme();
  const settings = useTimeSettings();
  const tz = settings.data?.timezone;
  const [offset, setOffset] = useState(0);
  const base = weekStartOf(new Date(localDay(new Date(), tz) + "T12:00:00"), settings.data?.week_start ?? 1);
  const week = addDays(base, offset * 7);
  const sheet = useQuery({
    queryKey: qk.timesheet(ws, week),
    queryFn: () => mahaam.time.timesheet(week),
    enabled: !!ws && settings.isFetched,
    refetchInterval: usePolling() && offset === 0 ? 30_000 : false,
  });

  const d = sheet.data;
  const days = d?.days ?? [];
  const totals = d?.day_totals ?? [];
  const max = Math.max(1, ...totals);
  const rows = (d?.rows ?? []) as Row7[];

  return (
    <Screen edges={[]} refreshing={sheet.isRefetching} onRefresh={() => void sheet.refetch()}>
      <Row style={{ justifyContent: "space-between" }}>
        <Button small variant="secondary" label="‹" hint={t("sheet.prev")} onPress={() => setOffset(offset - 1)} />
        <T weight="600" role="header">
          {offset === 0 ? t("sheet.thisWeek") : t("sheet.title", { date: f.date(week) })}
        </T>
        <Button small variant="secondary" label="›" hint={t("sheet.next")} disabled={offset >= 0} onPress={() => setOffset(offset + 1)} />
      </Row>
      {sheet.isPending ? <Loading /> : null}
      {sheet.isError ? <ErrorState error={sheet.error} onRetry={() => void sheet.refetch()} /> : null}
      {d ? (
        <>
          <Card>
            <Row style={{ justifyContent: "space-between" }}>
              <T weight="600">{`${t("sheet.total")}: ${formatDuration(d.total_s)}`}</T>
              <T tone="body">{`${t("sheet.billable")}: ${formatDuration(d.billable_s)}`}</T>
            </Row>
            {/* A 7-bar week chart; each bar is labelled for screen readers. */}
            <Row style={{ alignItems: "flex-end", height: 120, gap: space.xs }}>
              {days.map((day, i) => (
                <View
                  key={day}
                  style={{ flex: 1, alignItems: "center", gap: 4 }}
                  accessible
                  accessibilityLabel={`${f.day(day)}: ${formatDuration(totals[i] ?? 0)}`}
                >
                  <View
                    style={{
                      width: "70%",
                      height: Math.max(2, ((totals[i] ?? 0) / max) * 84),
                      backgroundColor: day === localDay(new Date(), tz) ? c.accent : c.brand,
                    }}
                  />
                  <T size="xs" tone="muted" numberOfLines={1}>
                    {f.day(day)}
                  </T>
                </View>
              ))}
            </Row>
          </Card>
          <SectionTitle>{t("tabs.timesheet")}</SectionTitle>
          {rows.length === 0 ? <Empty text={t("sheet.empty")} /> : null}
          {rows.map((r, i) => (
            <ListItem
              key={i}
              accent={projectColor(r.project_color)}
              title={r.task_key ? `${r.task_key} · ${r.task_title ?? ""}` : (r.project_name ?? t("timer.noProject"))}
              subtitle={[
                r.task_key ? r.project_name : null,
                (r.seconds ?? [])
                  .map((s, j) => (s ? `${f.day(days[j])} ${formatDuration(s)}` : null))
                  .filter(Boolean)
                  .join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
              right={<T weight="600">{formatDuration(r.total_s ?? 0)}</T>}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}
