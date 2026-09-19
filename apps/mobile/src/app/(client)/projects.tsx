import { router } from "expo-router";
import { Pressable } from "react-native";

import { Card, Empty, ErrorState, Loading, Progress, Row, Screen, T } from "@/components/ui";
import { usePortalProjects } from "@/features/client";
import { useT } from "@/i18n";
import { useTheme } from "@/theme";
import { projectColor, space } from "@/theme/tokens";

export default function Projects() {
  const t = useT();
  const { c } = useTheme();
  const q = usePortalProjects();
  if (q.isPending) return <Loading />;
  const list = (q.data?.projects ?? []).filter((p) => !p.archived);

  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {list.length === 0 && !q.isError ? <Empty text={t("portal.none")} /> : null}
      {list.map((p) => {
        const total = p.tasks.todo + p.tasks.doing + p.tasks.done;
        const hours = Math.round(p.used_minutes / 6) / 10;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${t("portal.progress", { p: p.percent_done })}`}
            onPress={() => router.push({ pathname: "/project/[id]", params: { id: p.id } })}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <Card accent={projectColor(p.color)} style={{ gap: space.sm }}>
              <Row style={{ justifyContent: "space-between" }}>
                <T size="lg" weight="600" numberOfLines={1} style={{ flex: 1 }}>
                  {p.name}
                </T>
                <T weight="700" tone="brand">{`${p.percent_done}%`}</T>
              </Row>
              <Progress value={p.percent_done} label={t("portal.progress", { p: p.percent_done })} color={c.brand} />
              <T size="sm" tone="body">
                {[
                  t("portal.tasksDone", { done: p.tasks.done, total }),
                  q.data?.rich
                    ? p.budget_minutes
                      ? t("portal.hours", { used: hours, budget: Math.round(p.budget_minutes / 60) })
                      : t("portal.hoursUsed", { used: hours })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </T>
              {q.data?.rich && (p.open_issues || p.pending_requests) ? (
                <T size="sm" tone="muted">
                  {[
                    p.open_issues ? t("portal.openIssues", { n: p.open_issues }) : null,
                    p.pending_requests ? t("portal.pendingRequests", { n: p.pending_requests }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </T>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
