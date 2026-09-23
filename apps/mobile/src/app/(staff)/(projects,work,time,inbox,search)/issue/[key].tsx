import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Play } from "lucide-react-native";
import { View } from "react-native";

import { Chip, Micro, useErrorText } from "@/components/kit";
import { Thread } from "@/components/thread";
import { useRunning, useStartTimer } from "@/features/team";
import { AppText, ErrorLine, FilterStrip, fonts, Markdown, Meta, PrimaryButton, Row, Rows, Screen, SkeletonRow, StackHeader, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";

/**
 * A workspace issue, for the team side.
 *
 * Separate from `issue/[key].tsx`, which is the *client portal's* view of an issue: different
 * endpoint, different shape, and a different set of things the reader is allowed to do. Sharing
 * one screen between them would mean branching on role in half a dozen places, which is how a
 * customer ends up seeing an internal comment.
 */

/** The stages a member can move an issue to. `waiting_approval` is deliberately absent: it means
 *  "an agent is asking a human", and a person moving an issue there by hand is not that. */
const STAGES = ["backlog", "todo", "in_progress", "in_review", "done"] as const;

export default function TeamIssueScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const running = useRunning();
  const start = useStartTimer();

  const q = useQuery({ queryKey: qk.issue(ws, key), queryFn: () => mahaam.issues.get(key), enabled: !!ws && !!key });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.issue(ws, key) });
    // The list behind this screen is stale the moment a stage changes, so it goes too.
    void qc.invalidateQueries({ queryKey: qk.issues(ws) });
  };

  const comment = useMutation({ mutationFn: (body: string) => mahaam.issues.comment(key, body), onSuccess: refresh });
  const move = useMutation({ mutationFn: (status: string) => mahaam.issues.move(key, status), onSuccess: refresh });

  const i = q.data;
  const isRunning = !!i && running.data?.task_key === i.key;

  return (
    <Screen header={<StackHeader title={i?.title ?? key} subtitle={key} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Rows>
        {q.isPending ? <SkeletonRow lines={3} /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {!q.isPending && !q.isError && !i ? <StateRow state="empty" message={t("issues.unavailable")} /> : null}
        {i ? (
          <>
            <Row>
              <AppText variant="title">{i.title}</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                <Chip label={t(`issues.status.${i.status}` as "issues.status.todo")} tone="gold" />
                <Chip label={i.issue_type} />
                <Chip label={i.priority} tone={i.priority === "highest" || i.priority === "high" ? "danger" : "neutral"} />
              </View>
              <Meta items={[f.date(i.created_at)]} />
              <PrimaryButton
                label={isRunning ? t("timer.running") : t("tasks.startTimer", { key: i.key })}
                icon={<Play size={17} color={c.onAction} strokeWidth={1.8} />}
                disabled={isRunning || i.state === "closed" || start.isPending}
                onPress={() => start.mutate({ task: i.key, project: i.project_id ?? undefined })}
              />
              {start.error ? <ErrorLine text={errText(start.error)} /> : null}
            </Row>
            <Row>
              <Micro>{t("tasks.description")}</Micro>
              {i.body ? <Markdown source={i.body} /> : <AppText variant="meta">{t("issues.noBody")}</AppText>}
              {i.resolution ? <AppText style={{ fontFamily: fonts.regular, fontSize: 13, color: c.okText }}>{i.resolution}</AppText> : null}
            </Row>
            <Row style={{ paddingHorizontal: 0 }}>
              <Micro style={{ paddingHorizontal: 28 }}>{t("issues.moveTo")}</Micro>
              <FilterStrip<string>
                options={STAGES.map((s) => ({ value: s, label: t(`issues.status.${s}`) }))}
                value={i.status}
                onChange={(s) => s !== i.status && !move.isPending && move.mutate(s)}
              />
              {move.error ? (
                <View style={{ paddingHorizontal: 28 }}>
                  <ErrorLine text={errText(move.error)} />
                </View>
              ) : null}
            </Row>
            <Thread
              comments={(i.comments ?? []).map((cm) => ({ id: cm.id, body: cm.body, created_at: cm.created_at, agent: cm.author_kind === "agent" }))}
              onSend={(body) => comment.mutateAsync(body)}
              sending={comment.isPending}
              error={comment.error}
            />
          </>
        ) : null}
      </Rows>
    </Screen>
  );
}
