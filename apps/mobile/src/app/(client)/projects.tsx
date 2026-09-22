import { router } from "expo-router";
import { View } from "react-native";

import { Micro, Progress, projectColor, TabHeader, useErrorText } from "@/components/kit";
import { usePortalProjects } from "@/features/client";
import { AppText, fonts, ForwardChevron, ListItem, Meta, Row, Rows, Screen, SkeletonRow, StateRow, useColors } from "@/grid";
import { useT } from "@/i18n";

export default function Projects() {
  const t = useT();
  const c = useColors();
  const errText = useErrorText();
  const q = usePortalProjects();
  const list = (q.data?.projects ?? []).filter((p) => !p.archived);

  return (
    <Screen header={<TabHeader title="portal.projects" count={q.data ? list.length : undefined} inbox="/updates" />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Rows inset>
        {q.isPending ? <SkeletonRow lines={3} /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {q.data && list.length === 0 ? <StateRow state="empty" message={t("portal.none")} /> : null}
        {list.length ? (
          <Row style={{ paddingVertical: 0 }}>
            {list.map((p, i) => {
              const total = p.tasks.todo + p.tasks.doing + p.tasks.done;
              const hours = Math.round(p.used_minutes / 6) / 10;
              return (
                <ListItem
                  key={p.id}
                  last={i === list.length - 1}
                  padV={16}
                  leading={<View style={{ width: 3, alignSelf: "stretch", borderRadius: 1.5, backgroundColor: projectColor(p.color) }} />}
                  trailing={<ForwardChevron />}
                  onPress={() => router.push({ pathname: "/project/[id]", params: { id: p.id } })}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <AppText variant="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
                      {p.name}
                    </AppText>
                    <AppText style={{ fontFamily: fonts.mono, fontSize: 12, color: c.goldText, writingDirection: "ltr" }}>{`${p.percent_done}%`}</AppText>
                  </View>
                  <Progress value={p.percent_done} label={t("portal.progress", { p: p.percent_done })} />
                  <Meta
                    items={
                      [
                        t("portal.tasksDone", { done: p.tasks.done, total }),
                        q.data?.rich
                          ? p.budget_minutes
                            ? t("portal.hours", { used: hours, budget: Math.round(p.budget_minutes / 60) })
                            : t("portal.hoursUsed", { used: hours })
                          : null,
                        q.data?.rich && p.open_issues ? t("portal.openIssues", { n: p.open_issues }) : null,
                        q.data?.rich && p.pending_requests ? t("portal.pendingRequests", { n: p.pending_requests }) : null,
                      ].filter(Boolean) as string[]
                    }
                  />
                </ListItem>
              );
            })}
          </Row>
        ) : null}
        {q.data && !q.data.rich ? (
          <Row>
            <Micro>{t("portal.unavailable")}</Micro>
          </Row>
        ) : null}
      </Rows>
    </Screen>
  );
}
