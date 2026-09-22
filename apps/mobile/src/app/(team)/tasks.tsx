import { router } from "expo-router";
import { View } from "react-native";

import { Badge, Button, Empty, ErrorState, ListItem, Loading, Row, Screen, SectionTitle, T, useErrorText } from "@/components/ui";
import { useMyTasks, useOpenIssues, useRunning, useStartTimer } from "@/features/team";
import { useFormat, useT } from "@/i18n";
import { boardOrder, issueOrder } from "@/lib/board";
import { usePolling } from "@/lib/live";
import { projectColor, space } from "@/theme/tokens";

export default function Tasks() {
  const t = useT();
  const f = useFormat();
  const errText = useErrorText();
  const { tasks, statuses, projectNames } = useMyTasks();
  const issues = useOpenIssues();
  const running = useRunning(usePolling());
  const start = useStartTimer();

  if (tasks.isPending) return <Loading />;
  const sections = boardOrder(tasks.data ?? [], statuses);
  const runningTask = running.data?.task_key;

  return (
    <Screen
      edges={[]}
      refreshing={tasks.isRefetching || issues.isRefetching}
      onRefresh={() => {
        void tasks.refetch();
        void issues.refetch();
      }}
    >
      {start.error ? (
        <T tone="danger" role="alert">
          {errText(start.error)}
        </T>
      ) : null}
      <SectionTitle>{t("tasks.mine")}</SectionTitle>
      {tasks.isError ? <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /> : null}
      {sections.length === 0 && !tasks.isError ? <Empty text={t("tasks.none")} /> : null}
      {sections.map((s) => (
        <View key={s.category} style={{ gap: space.sm }}>
          <T size="sm" tone="muted" weight="600" role="header">
            {`${t(`tasks.${s.category}`)} · ${s.items.length}`}
          </T>
          {s.items.map((task) => {
            const p = projectNames.get(task.project_id);
            const st = statuses.get(task.status_id);
            const isRunning = runningTask === task.key;
            return (
              <View key={task.id} style={{ gap: space.xs }}>
                <ListItem
                  accent={projectColor(p?.color)}
                  title={`${task.key} · ${task.title}`}
                  subtitle={[
                    p?.name,
                    st?.name,
                    task.due_at ? t("tasks.due", { date: f.date(task.due_at) }) : null,
                    task.checklist_total ? `☑ ${task.checklist_done}/${task.checklist_total}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  right={task.priority !== "none" ? <Badge label={t(`tasks.priority.${task.priority}`)} /> : undefined}
                  onPress={() => router.push({ pathname: "/task/[key]", params: { key: task.key } })}
                />
                {s.category !== "done" ? (
                  <Row style={{ justifyContent: "flex-end" }}>
                    <Button
                      small
                      variant={isRunning ? "secondary" : "primary"}
                      disabled={isRunning}
                      label={isRunning ? t("timer.running") : t("tasks.startTimer", { key: task.key })}
                      busy={start.isPending && start.variables?.task === task.key}
                      onPress={() => start.mutate({ task: task.key, project: task.project_id })}
                    />
                  </Row>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}

      <SectionTitle>{t("tasks.issues")}</SectionTitle>
      {issues.isError ? <ErrorState error={issues.error} onRetry={() => void issues.refetch()} /> : null}
      {(issues.data ?? []).length === 0 && !issues.isError ? <Empty text={t("tasks.noIssues")} /> : null}
      {issueOrder(issues.data ?? []).map((i) => (
        <View key={i.key} style={{ gap: space.xs }}>
          <ListItem
            title={`${i.key} · ${i.title}`}
            subtitle={[i.issue_type, i.status].join(" · ")}
            right={<Badge label={i.priority} />}
            onPress={() => router.push({ pathname: "/team-issue/[key]", params: { key: i.key } })}
          />
          <Row style={{ justifyContent: "flex-end" }}>
            <Button
              small
              label={t("tasks.startTimer", { key: i.key })}
              onPress={() => start.mutate({ description: `${i.key} ${i.title}`, project: i.project_id ?? undefined })}
            />
          </Row>
        </View>
      ))}
    </Screen>
  );
}
