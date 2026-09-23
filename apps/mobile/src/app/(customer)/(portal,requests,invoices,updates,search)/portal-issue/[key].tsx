import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { Chip, useErrorText } from "@/components/kit";
import { IssueActions } from "@/components/portal-issue-actions";
import { Thread } from "@/components/thread";
import { AppText, fonts, Markdown, Meta, Row, Rows, Screen, SkeletonRow, StackHeader, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { fs } from "@/lib/type-scale";

/** The client portal's view of an issue: what the customer filed, its status, and the thread. */
export default function PortalIssueScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const q = useQuery({ queryKey: qk.portalIssue(ws, key), queryFn: () => mahaam.portal.issue(key), enabled: !!ws && !!key });
  const comment = useMutation({
    mutationFn: (body: string) => mahaam.portal.commentIssue(key, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.portalIssue(ws, key) }),
  });

  const i = q.data;
  return (
    <Screen header={<StackHeader title={i?.title ?? key} subtitle={key} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Rows>
        {q.isPending ? <SkeletonRow lines={3} /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {!q.isPending && !q.isError && !i ? <StateRow state="empty" message={t("portal.unavailable")} /> : null}
        {i ? (
          <>
            <Row>
              <AppText variant="title">{i.title}</AppText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                <Chip label={t(`issues.status.${i.status}` as "issues.status.todo")} tone="gold" />
                <Chip label={i.issue_type} />
                <Chip label={i.priority} />
              </View>
              <Meta items={[f.date(i.created_at)]} />
              {i.body ? <Markdown source={i.body} /> : null}
              {i.resolution ? <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.okText }}>{i.resolution}</AppText> : null}
              <IssueActions issue={i} />
            </Row>
            <Thread
              comments={(i.comments ?? []).map((cm) => ({
                id: cm.id,
                body: cm.body,
                created_at: cm.created_at,
                author: cm.mine ? t("portal.mine") : null,
                agent: cm.author_kind === "agent",
              }))}
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
