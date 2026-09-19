import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { usePolling } from "@/lib/live";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { Badge, Button, Empty, ErrorState, ListItem, Loading, Row, Screen, T } from "./ui";

/** Notifications (both apps): tap to mark read; "mark all read". */
export function InboxScreen() {
  const t = useT();
  const f = useFormat();
  const ws = useWs();
  const qc = useQueryClient();
  const inbox = useQuery({
    queryKey: qk.inbox(ws),
    queryFn: mahaam.notifications.list,
    enabled: !!ws,
    refetchInterval: usePolling() ? 60_000 : false,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.inbox(ws) });
  const read = useMutation({ mutationFn: mahaam.notifications.read, onSettled: refresh });
  const readAll = useMutation({ mutationFn: mahaam.notifications.readAll, onSettled: refresh });

  if (inbox.isPending) return <Loading />;
  const list = inbox.data?.notifications ?? [];
  const unread = inbox.data?.unread ?? 0;

  return (
    <Screen edges={[]} refreshing={inbox.isRefetching} onRefresh={() => void inbox.refetch()}>
      {inbox.isError ? <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} /> : null}
      <Row style={{ justifyContent: "space-between" }}>
        <T tone="body">{t("inbox.unread", { n: unread })}</T>
        <Button small variant="secondary" label={t("inbox.markAll")} disabled={!unread} busy={readAll.isPending} onPress={() => readAll.mutate()} />
      </Row>
      {list.length === 0 ? <Empty text={t("inbox.empty")} /> : null}
      {list.map((n) => (
        <ListItem
          key={n.id}
          title={n.title}
          subtitle={[n.body, `${f.date(n.created_at)} ${f.time(n.created_at)}`].filter(Boolean).join(" · ")}
          right={!n.read_at ? <Badge label="●" /> : undefined}
          onPress={!n.read_at ? () => read.mutate(n.id) : undefined}
        />
      ))}
    </Screen>
  );
}
