// A customer's requests across every project (what they asked for, where it stands, the team's
// reply), and the way to ask for something new — pick the project first.
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { MessageSquarePlus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { Chip, Micro, projectColor, TabHeader, useErrorText } from "@/components/kit";
import { usePortalProjects } from "@/features/client";
import { AppText, BottomSheet, FilterStrip, fonts, ListItem, Meta, PrimaryButton, Row, Rows, Screen, SheetDivider, SkeletonRow, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { usePolling } from "@/lib/live";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { fs } from "@/lib/type-scale";

type Filter = "all" | "pending" | "accepted" | "declined";

export default function Requests() {
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const ws = useWs();
  const errText = useErrorText();
  const q = useQuery({
    queryKey: qk.portalRequests(ws),
    queryFn: async () => (await mahaam.portal.requests())?.requests ?? null,
    enabled: !!ws,
    refetchInterval: usePolling() ? 60_000 : false,
  });
  const projects = usePortalProjects();
  const [filter, setFilter] = useState<Filter>("all");
  const [picking, setPicking] = useState(false);
  const list = (q.data ?? []).filter((r) => filter === "all" || r.state === filter || (filter === "accepted" && r.state === "converted"));
  const open = (projects.data?.projects ?? []).filter((p) => !p.archived);

  return (
    <Screen
      header={<TabHeader title="tabs.requests" count={q.data ? q.data.length : undefined} inbox="/updates" />}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}>
      <Rows inset>
        <Row>
          <PrimaryButton label={t("portal.fileRequest")} icon={<MessageSquarePlus size={17} color={c.onAction} strokeWidth={1.6} />} onPress={() => setPicking(true)} />
        </Row>
        <Row style={{ paddingHorizontal: 0, paddingVertical: 0 }}>
          <FilterStrip<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("projects.filter.all") },
              { value: "pending", label: t("portal.requestState.pending") },
              { value: "accepted", label: t("portal.requestState.accepted") },
              { value: "declined", label: t("portal.requestState.declined") },
            ]}
          />
        </Row>
        {q.isPending ? <SkeletonRow /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {q.data === null ? <StateRow state="empty" message={t("portal.unavailable")} /> : null}
        {q.data && list.length === 0 ? <StateRow state="empty" message={t("portal.noRequests")} /> : null}
        {list.length ? (
          <Row style={{ paddingVertical: 0 }}>
            {list.map((r, i) => (
              <ListItem
                key={r.key}
                last={i === list.length - 1}
                alignTop
                onPress={r.project_id ? () => router.push({ pathname: "/portal-project/[id]", params: { id: r.project_id! } }) : undefined}
                trailing={<Chip label={t(`portal.requestState.${r.state}` as "portal.requestState.pending")} tone={r.state === "declined" ? "danger" : r.state === "pending" ? "gold" : "ok"} />}>
                <AppText variant="rowTitle" numberOfLines={2}>
                  {r.title}
                </AppText>
                <Meta items={[r.key, r.project_name, t(`file.${r.kind}` as "file.feature"), f.date(r.created_at)].filter(Boolean) as string[]} />
                {r.reply ? (
                  <View style={{ borderStartWidth: 2, borderStartColor: c.gold, paddingStart: 10, marginTop: 4 }}>
                    <Micro>{t("portal.teamReply")}</Micro>
                    <AppText>{r.reply}</AppText>
                  </View>
                ) : null}
              </ListItem>
            ))}
          </Row>
        ) : null}
      </Rows>

      <BottomSheet visible={picking} onClose={() => setPicking(false)}>
        <Micro>{t("portal.pickProject")}</Micro>
        <SheetDivider />
        {open.length === 0 ? <AppText variant="meta">{t("portal.none")}</AppText> : null}
        {open.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => {
              setPicking(false);
              router.push({ pathname: "/file", params: { project: p.id, kind: "request" } });
            }}
            style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: projectColor(p.color) }} />
            <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: fs.row, color: c.fg }}>{p.name}</AppText>
          </Pressable>
        ))}
      </BottomSheet>
    </Screen>
  );
}
