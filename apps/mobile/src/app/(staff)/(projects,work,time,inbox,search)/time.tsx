import { router } from "expo-router";
import { CalendarDays, PlusCircle } from "lucide-react-native";
import { View } from "react-native";

import { Actions, Chip, Grow, Micro, projectColor, TabHeader, useErrorText } from "@/components/kit";
import { TimerCard } from "@/components/timer-card";
import { useRunning, useTimeSettings, useTodayEntries } from "@/features/team";
import { AppText, fonts, ListItem, Meta, Row, Rows, Screen, SecondaryButton, SkeletonRow, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useNow } from "@/lib/hooks";
import { useLiveMode, usePolling } from "@/lib/live";
import { entrySeconds, formatDuration, todaySummary } from "@/lib/time";

export default function Time() {
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const polling = usePolling();
  const mode = useLiveMode();
  const running = useRunning(polling);
  const entries = useTodayEntries(polling);
  const settings = useTimeSettings();
  const now = useNow(30_000);

  const { entries: list, total } = todaySummary(entries.data ?? [], running.data ?? null, now, settings.data?.timezone);

  return (
    <Screen
      header={<TabHeader title="tabs.time" inbox="/inbox" />}
      refreshing={running.isRefetching || entries.isRefetching}
      onRefresh={() => {
        void running.refetch();
        void entries.refetch();
      }}>
      <Rows inset>
        {running.isError && !running.data ? <StateRow state="error" message={errText(running.error)} onRetry={() => void running.refetch()} /> : null}
        {running.isPending ? <SkeletonRow lines={3} /> : <TimerCard running={running.data ?? null} />}
        <Row>
          <Actions>
            <Grow>
              <SecondaryButton label={t("tabs.log")} icon={<PlusCircle size={17} color={c.muted} strokeWidth={1.6} />} onPress={() => router.push("/log")} />
            </Grow>
            <Grow>
              <SecondaryButton label={t("tabs.timesheet")} icon={<CalendarDays size={17} color={c.muted} strokeWidth={1.6} />} onPress={() => router.push("/timesheet")} />
            </Grow>
          </Actions>
        </Row>
        <Row style={{ paddingVertical: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14, paddingBottom: 6 }}>
            <Micro style={{ flex: 1 }}>{t("timer.todayTotal")}</Micro>
            <AppText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.fg, writingDirection: "ltr" }}>{formatDuration(total)}</AppText>
          </View>
          {entries.isPending ? <SkeletonRow /> : null}
          {entries.isError ? <StateRow state="error" message={errText(entries.error)} onRetry={() => void entries.refetch()} /> : null}
          {entries.data && list.length === 0 ? (
            <AppText variant="meta" style={{ paddingVertical: 14 }}>
              {t("timer.noEntries")}
            </AppText>
          ) : null}
          {list.map((e, i) => (
            <ListItem
              key={e.id}
              last={i === list.length - 1}
              leading={<View style={{ width: 3, alignSelf: "stretch", borderRadius: 1.5, backgroundColor: projectColor(e.project_color) }} />}
              trailing={
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <AppText style={{ fontFamily: fonts.mono, fontSize: 13, color: c.fg, writingDirection: "ltr" }}>{formatDuration(entrySeconds(e, now))}</AppText>
                  {!e.ended_at ? <Chip label={t("timer.running")} tone="ok" /> : null}
                </View>
              }>
              <AppText variant="rowTitle" numberOfLines={2}>
                {e.task_key ? `${e.task_key} · ${e.task_title ?? ""}` : e.description || t("timer.noProject")}
              </AppText>
              <Meta items={[e.project_name, `${f.time(e.started_at)}${e.ended_at ? `–${f.time(e.ended_at)}` : ""}`].filter(Boolean) as string[]} />
            </ListItem>
          ))}
        </Row>
        <Row style={{ paddingVertical: 10 }}>
          <Meta items={[mode === "live" ? t("common.live") : t("common.polling")]} />
        </Row>
      </Rows>
    </Screen>
  );
}
