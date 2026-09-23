import { router } from "expo-router";
import { Play } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Chip, Micro, projectColor, TabHeader, useErrorText } from "@/components/kit";
import { useMyTasks, useOpenIssues, useRunning, useStartTimer } from "@/features/team";
import { AppText, ErrorLine, ListItem, Meta, Row, Rows, Screen, SkeletonRow, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { boardOrder, issueOrder } from "@/lib/board";
import { usePolling } from "@/lib/live";

/** A compact "start timer" control for a list row: 44pt target, gold when this item is running. */
function StartTimer({ running, busy, label, onPress }: { running: boolean; busy: boolean; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={running || busy}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: running ? c.gold : c.line,
        backgroundColor: running ? `${c.gold}1A` : pressed ? c.soft : "transparent",
        alignItems: "center",
        justifyContent: "center",
        opacity: busy ? 0.5 : 1,
      })}>
      <Play size={18} color={running ? c.goldText : c.muted} strokeWidth={1.6} />
    </Pressable>
  );
}

export default function Work() {
  const t = useT();
  const f = useFormat();
  const errText = useErrorText();
  const { tasks, statuses, projectNames } = useMyTasks();
  const issues = useOpenIssues();
  const running = useRunning(usePolling());
  const start = useStartTimer();

  const sections = boardOrder(tasks.data ?? [], statuses);
  const runningTask = running.data?.task_key;
  const openIssues = issueOrder(issues.data ?? []);

  return (
    <Screen
      header={<TabHeader title="tabs.work" count={tasks.data?.length} inbox="/inbox" />}
      refreshing={tasks.isRefetching || issues.isRefetching}
      onRefresh={() => {
        void tasks.refetch();
        void issues.refetch();
      }}>
      <Rows inset>
        {start.error ? (
          <Row>
            <ErrorLine text={errText(start.error)} />
          </Row>
        ) : null}
        {tasks.isPending ? <SkeletonRow /> : null}
        {tasks.isError ? <StateRow state="error" message={errText(tasks.error)} onRetry={() => void tasks.refetch()} /> : null}
        {tasks.data && sections.length === 0 ? <StateRow state="empty" message={t("tasks.none")} /> : null}
        {sections.map((s) => (
          <Row key={s.category} style={{ paddingVertical: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14, paddingBottom: 4, gap: 8 }}>
              <Micro style={{ flex: 1 }}>{t(`tasks.${s.category}`)}</Micro>
              <AppText variant="mono">{s.items.length}</AppText>
            </View>
            {s.items.map((task, i) => {
              const p = projectNames.get(task.project_id);
              const st = statuses.get(task.status_id);
              return (
                <ListItem
                  key={task.id}
                  last={i === s.items.length - 1}
                  leading={<View style={{ width: 3, alignSelf: "stretch", borderRadius: 1.5, backgroundColor: projectColor(p?.color) }} />}
                  onPress={() => router.push({ pathname: "/task/[key]", params: { key: task.key } })}
                  trailing={
                    s.category !== "done" ? (
                      <StartTimer
                        running={runningTask === task.key}
                        busy={start.isPending && start.variables?.task === task.key}
                        label={t("tasks.startTimer", { key: task.key })}
                        onPress={() => start.mutate({ task: task.key, project: task.project_id })}
                      />
                    ) : undefined
                  }>
                  <AppText variant="rowTitle" numberOfLines={2}>
                    {task.title}
                  </AppText>
                  <Meta
                    items={
                      [
                        task.key,
                        p?.name,
                        st?.name,
                        task.due_at ? t("tasks.due", { date: f.date(task.due_at) }) : null,
                        task.checklist_total ? `${task.checklist_done}/${task.checklist_total}` : null,
                      ].filter(Boolean) as string[]
                    }
                  />
                  {task.priority !== "none" ? <Chip label={t(`tasks.priority.${task.priority}`)} tone={task.priority === "urgent" || task.priority === "high" ? "danger" : "neutral"} /> : null}
                </ListItem>
              );
            })}
          </Row>
        ))}

        <Row style={{ paddingVertical: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14, paddingBottom: 4, gap: 8 }}>
            <Micro style={{ flex: 1 }}>{t("tasks.issues")}</Micro>
            <AppText variant="mono">{openIssues.length}</AppText>
          </View>
          {issues.isError ? <StateRow state="error" message={errText(issues.error)} onRetry={() => void issues.refetch()} /> : null}
          {issues.data && openIssues.length === 0 ? (
            <AppText variant="meta" style={{ paddingVertical: 14 }}>
              {t("tasks.noIssues")}
            </AppText>
          ) : null}
          {openIssues.map((i, n) => (
            <ListItem
              key={i.key}
              last={n === openIssues.length - 1}
              onPress={() => router.push({ pathname: "/issue/[key]", params: { key: i.key } })}
              trailing={
                <StartTimer
                  running={runningTask === i.key}
                  busy={start.isPending && start.variables?.task === i.key}
                  label={t("tasks.startTimer", { key: i.key })}
                  onPress={() => start.mutate({ task: i.key, project: i.project_id ?? undefined })}
                />
              }>
              <AppText variant="rowTitle" numberOfLines={2}>
                {i.title}
              </AppText>
              <Meta items={[i.key, t(`issues.status.${i.status}` as "issues.status.todo"), i.issue_type]} />
            </ListItem>
          ))}
        </Row>
      </Rows>
    </Screen>
  );
}
