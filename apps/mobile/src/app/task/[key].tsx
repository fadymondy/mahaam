import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Play } from "lucide-react-native";
import { View } from "react-native";

import type { TaskDetail } from "@/api/types";
import { Chip, Micro, projectColor, useErrorText } from "@/components/kit";
import { Thread } from "@/components/thread";
import { useRunning, useStartTimer } from "@/features/team";
import { AppText, Checkbox, ErrorLine, fonts, Markdown, Meta, PrimaryButton, Row, Rows, Screen, SkeletonRow, StackHeader, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";

export default function TaskScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const task = useQuery({ queryKey: qk.task(ws, key), queryFn: () => mahaam.tasks.get(key), enabled: !!ws && !!key });
  const comments = useQuery({
    queryKey: qk.comments(ws, key),
    queryFn: async () => (await mahaam.tasks.comments(key)).comments ?? [],
    enabled: !!ws && !!key,
  });
  const running = useRunning();
  const start = useStartTimer();

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
    mutationFn: (body: string) => mahaam.tasks.comment(key, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.comments(ws, key) }),
  });

  const d = task.data;
  const isRunning = !!d && running.data?.task_key === d.key;

  return (
    <Screen header={<StackHeader title={d?.title ?? key} subtitle={key} />} refreshing={task.isRefetching} onRefresh={() => void task.refetch()}>
      <Rows>
        {task.isPending ? <SkeletonRow lines={3} /> : null}
        {task.isError ? <StateRow state="error" message={errText(task.error)} onRetry={() => void task.refetch()} /> : null}
        {d ? (
          <>
            <Row style={{ borderStartWidth: 2, borderStartColor: projectColor(d.project.color) }}>
              <AppText variant="title">{d.title}</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                <Chip label={d.status.name} dot={d.status.color} />
                {d.priority !== "none" ? <Chip label={t(`tasks.priority.${d.priority}`)} tone={d.priority === "urgent" || d.priority === "high" ? "danger" : "neutral"} /> : null}
                {d.due_at ? <Chip label={t("tasks.due", { date: f.date(d.due_at) })} tone="gold" /> : null}
              </View>
              <Meta items={[d.project.name]} />
              <PrimaryButton
                label={isRunning ? t("timer.running") : t("tasks.startTimer", { key: d.key })}
                icon={<Play size={17} color={c.onAction} strokeWidth={1.8} />}
                disabled={isRunning || d.status.category === "done" || start.isPending}
                onPress={() => start.mutate({ task: d.key, project: d.project_id })}
              />
              {start.error ? <ErrorLine text={errText(start.error)} /> : null}
            </Row>

            {d.description ? (
              <Row>
                <Micro>{t("tasks.description")}</Micro>
                <Markdown source={d.description} />
              </Row>
            ) : null}

            <Row>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Micro style={{ flex: 1 }}>{t("tasks.checklist")}</Micro>
                <AppText variant="mono">{`${d.checklist_done}/${d.checklist_total}`}</AppText>
              </View>
              {d.checklist.length === 0 ? <AppText variant="meta">{t("common.empty")}</AppText> : null}
              {d.checklist.map((i) => (
                <Checkbox key={i.id} checked={i.done} onChange={(done) => d.can_write && toggle.mutate({ id: i.id, done })}>
                  <AppText
                    style={{ fontFamily: fonts.regular, fontSize: 13.5, color: i.done ? c.muted : c.fg, textDecorationLine: i.done ? "line-through" : "none" }}>
                    {i.title}
                  </AppText>
                </Checkbox>
              ))}
              {toggle.error ? <ErrorLine text={errText(toggle.error)} /> : null}
            </Row>

            <Thread
              comments={(comments.data ?? []).map((cm) => ({ id: cm.id, body: cm.body, created_at: cm.created_at, agent: cm.author_kind === "agent" }))}
              onSend={(body) => comment.mutateAsync(body)}
              sending={comment.isPending}
              error={comment.error}
              canWrite={d.can_write}
            />
          </>
        ) : null}
      </Rows>
    </Screen>
  );
}
