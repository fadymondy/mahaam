import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { Micro, projectColor, StatCells, useErrorText } from "@/components/kit";
import { useTimeSettings } from "@/features/team";
import { AppText, fonts, IconButton, ListItem, Meta, Row, Rows, Screen, SkeletonRow, StackHeader, StateRow, useChevrons, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { usePolling } from "@/lib/live";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { addDays, formatDuration, localDay, weekStartOf } from "@/lib/time";
import { fs } from "@/lib/type-scale";

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
  const c = useColors();
  const ws = useWs();
  const errText = useErrorText();
  const { Back, Forward } = useChevrons();
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
  const today = localDay(new Date(), tz);

  return (
    <Screen header={<StackHeader title={t("tabs.timesheet")} />} refreshing={sheet.isRefetching} onRefresh={() => void sheet.refetch()}>
      <Rows inset>
        <Row style={{ flexDirection: "row", alignItems: "center" }}>
          <IconButton label={t("sheet.prev")} onPress={() => setOffset(offset - 1)}>
            <Back size={20} color={c.muted} strokeWidth={1.6} />
          </IconButton>
          <AppText variant="rowTitle" style={{ flex: 1, textAlign: "center" }}>
            {offset === 0 ? t("sheet.thisWeek") : t("sheet.title", { date: f.date(week) })}
          </AppText>
          <View style={{ opacity: offset >= 0 ? 0.35 : 1 }}>
            <IconButton label={t("sheet.next")} onPress={offset >= 0 ? undefined : () => setOffset(offset + 1)}>
              <Forward size={20} color={c.muted} strokeWidth={1.6} />
            </IconButton>
          </View>
        </Row>
        {sheet.isPending ? <SkeletonRow lines={3} /> : null}
        {sheet.isError ? <StateRow state="error" message={errText(sheet.error)} onRetry={() => void sheet.refetch()} /> : null}
        {d ? (
          <>
            <Row>
              <StatCells
                items={[
                  { label: t("sheet.total"), value: formatDuration(d.total_s) },
                  { label: t("sheet.billable"), value: formatDuration(d.billable_s), tone: "gold" },
                ]}
              />
              {/* A 7-bar week chart; each bar is labelled for screen readers. */}
              {/* Weekday over date: a seventh of a phone is too narrow for both on one line at a
                  readable size. */}
              <View style={{ flexDirection: "row", alignItems: "flex-end", height: 140, gap: 4 }}>
                {days.map((day, i) => (
                  <View key={day} style={{ flex: 1, alignItems: "center", gap: 6 }} accessible accessibilityLabel={`${f.day(day)}: ${formatDuration(totals[i] ?? 0)}`}>
                    <View
                      style={{
                        width: "62%",
                        height: Math.max(2, ((totals[i] ?? 0) / max) * 84),
                        borderRadius: 2,
                        backgroundColor: day === today ? c.gold : c.brand,
                      }}
                    />
                    <View style={{ alignItems: "center" }}>
                      <AppText style={{ fontFamily: fonts.regular, fontSize: fs.count, color: day === today ? c.goldText : c.muted }} numberOfLines={1}>
                        {f.weekday(day)}
                      </AppText>
                      <AppText style={{ fontFamily: fonts.regular, fontSize: fs.count, color: day === today ? c.goldText : c.muted }} numberOfLines={1}>
                        {f.dayOfMonth(day)}
                      </AppText>
                    </View>
                  </View>
                ))}
              </View>
            </Row>
            <Row style={{ paddingVertical: 0 }}>
              <Micro style={{ paddingTop: 14, paddingBottom: 4 }}>{t("tabs.timesheet")}</Micro>
              {rows.length === 0 ? (
                <AppText variant="meta" style={{ paddingVertical: 14 }}>
                  {t("sheet.empty")}
                </AppText>
              ) : null}
              {rows.map((r, i) => (
                <ListItem
                  key={i}
                  last={i === rows.length - 1}
                  leading={<View style={{ width: 3, alignSelf: "stretch", borderRadius: 1.5, backgroundColor: projectColor(r.project_color) }} />}
                  trailing={<AppText style={{ fontFamily: fonts.mono, fontSize: fs.mono, color: c.fg, writingDirection: "ltr" }}>{formatDuration(r.total_s ?? 0)}</AppText>}>
                  <AppText variant="rowTitle" numberOfLines={2}>
                    {r.task_key ? `${r.task_key} · ${r.task_title ?? ""}` : (r.project_name ?? t("timer.noProject"))}
                  </AppText>
                  <Meta
                    items={
                      [
                        r.task_key ? r.project_name : null,
                        ...(r.seconds ?? []).map((s, j) => (s && days[j] ? `${f.day(days[j]!)} ${formatDuration(s)}` : null)),
                      ].filter(Boolean) as string[]
                    }
                  />
                </ListItem>
              ))}
            </Row>
          </>
        ) : null}
      </Rows>
    </Screen>
  );
}
