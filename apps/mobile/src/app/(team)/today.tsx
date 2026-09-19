import { TimerCard } from "@/components/timer-card";
import { Badge, Empty, ErrorState, ListItem, Loading, Row, Screen, SectionTitle, T } from "@/components/ui";
import { useRunning, useTimeSettings, useTodayEntries } from "@/features/team";
import { useFormat, useT } from "@/i18n";
import { useNow } from "@/lib/hooks";
import { useLiveMode, usePolling } from "@/lib/live";
import { entrySeconds, formatDuration, todaySummary } from "@/lib/time";
import { projectColor } from "@/theme/tokens";

export default function Today() {
  const t = useT();
  const f = useFormat();
  const polling = usePolling();
  const mode = useLiveMode();
  const running = useRunning(polling);
  const entries = useTodayEntries(polling);
  const settings = useTimeSettings();
  const now = useNow(30_000);

  if (running.isPending && entries.isPending) return <Loading />;
  const { entries: list, total } = todaySummary(entries.data ?? [], running.data ?? null, now, settings.data?.timezone);

  return (
    <Screen
      edges={[]}
      refreshing={running.isRefetching || entries.isRefetching}
      onRefresh={() => {
        void running.refetch();
        void entries.refetch();
      }}
    >
      {running.isError && !running.data ? <ErrorState error={running.error} onRetry={() => void running.refetch()} /> : null}
      <TimerCard running={running.data ?? null} />
      <SectionTitle right={<T weight="600">{`${t("timer.todayTotal")}: ${formatDuration(total)}`}</T>}>{t("timer.today")}</SectionTitle>
      {entries.isError ? <ErrorState error={entries.error} onRetry={() => void entries.refetch()} /> : null}
      {list.length === 0 ? <Empty text={t("timer.noEntries")} /> : null}
      {list.map((e) => (
        <ListItem
          key={e.id}
          accent={projectColor(e.project_color)}
          title={e.task_key ? `${e.task_key} · ${e.task_title ?? ""}` : e.description || t("timer.noProject")}
          subtitle={[e.project_name, `${f.time(e.started_at)}${e.ended_at ? `–${f.time(e.ended_at)}` : ""}`]
            .filter(Boolean)
            .join(" · ")}
          right={
            <Row>
              {!e.ended_at ? <Badge label={t("timer.running")} /> : null}
              <T weight="600">{formatDuration(entrySeconds(e, now))}</T>
            </Row>
          }
        />
      ))}
      <T size="xs" tone="muted">
        {mode === "live" ? `● ${t("common.live")}` : t("common.polling")}
      </T>
    </Screen>
  );
}
