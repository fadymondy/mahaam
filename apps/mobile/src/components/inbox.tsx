import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react-native";
import { View } from "react-native";

import { Header, ListItem, Meta, AppText, Row, Rows, Screen, SecondaryButton, SkeletonRow, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { usePolling } from "@/lib/live";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { useErrorText } from "./kit";

/** Notifications (both apps): tap to mark read; "mark all read". */
export function InboxScreen() {
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const inbox = useQuery({
    queryKey: qk.inbox(ws),
    queryFn: mahaam.notifications.list,
    enabled: !!ws,
    refetchInterval: usePolling() ? 60_000 : false,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.inbox(ws) });
  const read = useMutation({ mutationFn: mahaam.notifications.read, onSettled: refresh });
  const readAll = useMutation({ mutationFn: mahaam.notifications.readAll, onSettled: refresh });

  const list = inbox.data?.notifications ?? [];
  const unread = inbox.data?.unread ?? 0;

  return (
    <Screen header={<Header title={t("inbox.title")} count={inbox.data ? unread : undefined} />} refreshing={inbox.isRefetching} onRefresh={() => void inbox.refetch()}>
      <Rows inset>
        {inbox.isPending ? <SkeletonRow /> : null}
        {inbox.isError ? <StateRow state="error" message={errText(inbox.error)} onRetry={() => void inbox.refetch()} /> : null}
        {unread ? (
          <Row>
            <SecondaryButton
              label={t("inbox.markAll")}
              icon={<CheckCheck size={17} color={c.muted} strokeWidth={1.6} />}
              disabled={readAll.isPending}
              onPress={() => readAll.mutate()}
            />
          </Row>
        ) : null}
        {inbox.data && list.length === 0 ? <StateRow state="empty" message={t("inbox.empty")} /> : null}
        {list.length ? (
          <Row style={{ paddingVertical: 0 }}>
            {list.map((n, i) => (
              <ListItem
                key={n.id}
                alignTop
                last={i === list.length - 1}
                leading={<View style={{ width: 7, height: 7, marginTop: 8, borderRadius: 1.5, backgroundColor: n.read_at ? "transparent" : c.gold }} />}
                onPress={!n.read_at ? () => read.mutate(n.id) : undefined}>
                <AppText variant="rowTitle" color={n.read_at ? c.body : c.fg}>
                  {n.title}
                </AppText>
                {n.body ? <AppText numberOfLines={3}>{n.body}</AppText> : null}
                <Meta items={[`${f.date(n.created_at)} ${f.time(n.created_at)}`]} />
              </ListItem>
            ))}
          </Row>
        ) : null}
      </Rows>
    </Screen>
  );
}
