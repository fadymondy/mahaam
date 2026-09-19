import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";

import { IssueActions } from "@/components/portal-issue-actions";
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, Row, Screen, SectionTitle, T, useErrorText } from "@/components/ui";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { space } from "@/theme/tokens";

export default function PortalIssueScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const t = useT();
  const f = useFormat();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const [body, setBody] = useState("");
  const q = useQuery({ queryKey: qk.portalIssue(ws, key), queryFn: () => mahaam.portal.issue(key), enabled: !!ws && !!key });
  const comment = useMutation({
    mutationFn: () => mahaam.portal.commentIssue(key, body.trim()),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: qk.portalIssue(ws, key) });
    },
  });

  if (q.isPending) return <Loading />;
  if (q.isError || !q.data) {
    return (
      <Screen edges={[]}>
        {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <T tone="muted">{t("portal.unavailable")}</T>}
      </Screen>
    );
  }
  const i = q.data;
  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Stack.Screen options={{ title: i.key }} />
      <Card>
        <T size="lg" weight="700" role="header">
          {i.title}
        </T>
        <Row style={{ flexWrap: "wrap" }}>
          <Badge label={i.status} />
          <Badge label={i.issue_type} />
          <Badge label={i.priority} />
        </Row>
        {i.body ? <T tone="body">{i.body}</T> : null}
        {i.resolution ? <T tone="ok">{i.resolution}</T> : null}
        <T size="xs" tone="muted">
          {f.date(i.created_at)}
        </T>
        <IssueActions issue={i} />
      </Card>
      <SectionTitle>{t("tasks.comments")}</SectionTitle>
      {(i.comments ?? []).length === 0 ? <Empty text={t("tasks.noComments")} /> : null}
      {(i.comments ?? []).map((cm) => (
        <Card key={cm.id} style={{ padding: space.md }}>
          <T>{cm.body}</T>
          <T size="xs" tone="muted">{`${cm.mine ? t("portal.mine") + " · " : ""}${f.date(cm.created_at)} ${f.time(cm.created_at)}`}</T>
        </Card>
      ))}
      <Field label={t("tasks.addComment")} value={body} onChangeText={setBody} multiline style={{ minHeight: 80, textAlignVertical: "top" }} />
      <Button label={t("common.send")} disabled={!body.trim()} busy={comment.isPending} onPress={() => comment.mutate()} />
      {comment.error ? (
        <T tone="danger" role="alert">
          {errText(comment.error)}
        </T>
      ) : null}
    </Screen>
  );
}
