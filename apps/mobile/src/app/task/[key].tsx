import Ionicons from "@expo/vector-icons/Ionicons";
import { Markdown } from "../../components/markdown";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { TaskDetail } from "@/api/types";
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, Row, Screen, SectionTitle, T, useErrorText } from "@/components/ui";
import { useRunning, useStartTimer } from "@/features/team";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { useTheme } from "@/theme";
import { projectColor, space } from "@/theme/tokens";

export default function TaskScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const t = useT();
  const f = useFormat();
  const ws = useWs();
  const qc = useQueryClient();
  const { c } = useTheme();
  const errText = useErrorText();
  const task = useQuery({ queryKey: qk.task(ws, key), queryFn: () => mahaam.tasks.get(key), enabled: !!ws && !!key });
  const comments = useQuery({
    queryKey: qk.comments(ws, key),
    queryFn: async () => (await mahaam.tasks.comments(key)).comments ?? [],
    enabled: !!ws && !!key,
  });
  const running = useRunning();
  const start = useStartTimer();
  const [body, setBody] = useState("");

  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => mahaam.tasks.toggleChecklist(id, done),
    // Optimistic: flip the box now, roll back on error.
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: qk.task(ws, key) });
      const prev = qc.getQueryData<TaskDetail>(qk.task(ws, key));
      if (prev)
        qc.setQueryData<TaskDetail>(qk.task(ws, key), {
          ...prev,
          checklist: prev.checklist.map((i) => (i.id === id ? { ...i, done } : i)),
          checklist_done: prev.checklist_done + (done ? 1 : -1),
        });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.task(ws, key), ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.task(ws, key) });
      void qc.invalidateQueries({ queryKey: qk.tasks(ws) });
    },
  });

  const comment = useMutation({
    mutationFn: () => mahaam.tasks.comment(key, body.trim()),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: qk.comments(ws, key) });
    },
  });

  if (task.isPending) return <Loading />;
  if (task.isError) {
    return (
      <Screen edges={[]}>
        <ErrorState error={task.error} onRetry={() => void task.refetch()} />
      </Screen>
    );
  }
  const d = task.data;
  const isRunning = running.data?.task_key === d.key;

  return (
    <Screen edges={[]} refreshing={task.isRefetching} onRefresh={() => void task.refetch()}>
      <Stack.Screen options={{ title: d.key }} />
      <Card accent={projectColor(d.project.color)}>
        <T size="lg" weight="700" role="header">
          {d.title}
        </T>
        <Row style={{ flexWrap: "wrap" }}>
          <Badge label={d.status.name} />
          {d.priority !== "none" ? <Badge label={t(`tasks.priority.${d.priority}`)} /> : null}
          {d.due_at ? <Badge label={t("tasks.due", { date: f.date(d.due_at) })} /> : null}
        </Row>
        <T tone="body">{d.project.name}</T>
        <Button
          label={isRunning ? t("timer.running") : t("tasks.startTimer", { key: d.key })}
          disabled={isRunning || d.status.category === "done"}
          busy={start.isPending}
          onPress={() => start.mutate({ task: d.key, project: d.project_id })}
        />
        {start.error ? <T tone="danger" role="alert">{errText(start.error)}</T> : null}
      </Card>

      {d.description ? (
        <>
          <SectionTitle>{t("tasks.description")}</SectionTitle>
          <Markdown>{d.description}</Markdown>
        </>
      ) : null}

      <SectionTitle right={<T tone="muted">{`${d.checklist_done}/${d.checklist_total}`}</T>}>{t("tasks.checklist")}</SectionTitle>
      {d.checklist.length === 0 ? <Empty text={t("common.empty")} /> : null}
      {d.checklist.map((i) => (
        <Pressable
          key={i.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: i.done, disabled: !d.can_write }}
          accessibilityLabel={i.title}
          disabled={!d.can_write}
          onPress={() => toggle.mutate({ id: i.id, done: !i.done })}
          style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 }}
        >
          <Ionicons name={i.done ? "checkbox" : "square-outline"} size={24} color={i.done ? c.brand : c.muted} />
          <T tone={i.done ? "muted" : "fg"} style={i.done ? { textDecorationLine: "line-through" } : undefined}>
            {i.title}
          </T>
        </Pressable>
      ))}
      {toggle.error ? <T tone="danger" role="alert">{errText(toggle.error)}</T> : null}

      <SectionTitle>{t("tasks.comments")}</SectionTitle>
      {(comments.data ?? []).length === 0 ? <Empty text={t("tasks.noComments")} /> : null}
      {(comments.data ?? []).map((cm) => (
        <Card key={cm.id} style={{ padding: space.md }}>
          <Markdown>{cm.body}</Markdown>
          <T size="xs" tone="muted">
            {f.date(cm.created_at)} {f.time(cm.created_at)}
          </T>
        </Card>
      ))}
      <View style={{ gap: space.sm }}>
        <Field label={t("tasks.addComment")} value={body} onChangeText={setBody} multiline style={{ minHeight: 80, textAlignVertical: "top" }} />
        <Button label={t("common.send")} disabled={!body.trim()} busy={comment.isPending} onPress={() => comment.mutate()} />
        {comment.error ? <T tone="danger" role="alert">{errText(comment.error)}</T> : null}
      </View>
    </Screen>
  );
}
