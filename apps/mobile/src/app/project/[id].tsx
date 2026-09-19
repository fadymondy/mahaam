import { router, Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import type { Invoice, PortalIssue } from "@/api/types";
import { IssueActions } from "@/components/portal-issue-actions";
import { Badge, Button, Card, Empty, ErrorState, ListItem, Loading, Progress, Row, Screen, SectionTitle, T } from "@/components/ui";
import { usePortalIssues, usePortalProject, usePortalProjects } from "@/features/client";
import { useFormat, useT } from "@/i18n";
import { useTheme } from "@/theme";
import { projectColor, space } from "@/theme/tokens";

function InvoiceRow({ iv }: { iv: Invoice }) {
  const t = useT();
  const f = useFormat();
  return (
    <ListItem
      title={iv.number}
      subtitle={[t(`invoice.status.${iv.status}` as "invoice.status.sent"), t("invoice.issued", { date: f.date(iv.issue_date) })].join(" · ")}
      right={<T weight="600">{f.money(iv.total_minor, iv.currency)}</T>}
      onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: iv.id } })}
    />
  );
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const f = useFormat();
  const { c } = useTheme();
  const page = usePortalProject(id);
  const list = usePortalProjects();
  // Older servers: no project page → the project from the list + the issue intake's own list.
  const fallbackIssues = usePortalIssues(id, page.data === null);

  if (page.isPending) return <Loading />;
  if (page.isError) {
    return (
      <Screen edges={[]}>
        <ErrorState error={page.error} onRetry={() => void page.refetch()} />
      </Screen>
    );
  }
  const p = page.data ?? list.data?.projects.find((x) => x.id === id);
  if (!p) return <Loading />;
  const rich = !!page.data;
  const issues: PortalIssue[] = rich
    ? (page.data!.issues ?? [])
    : (fallbackIssues.data ?? []).map((i) => ({ ...i, resolution: null, can_accept: false, can_reopen: false, mine: true, comment_count: 0 }));
  const total = p.tasks.todo + p.tasks.doing + p.tasks.done;
  const hours = Math.round(p.used_minutes / 6) / 10;
  const weeks = page.data?.weeks ?? [];
  const maxWeek = Math.max(1, ...weeks.map((w) => w.minutes));

  return (
    <Screen
      edges={[]}
      refreshing={page.isRefetching}
      onRefresh={() => {
        void page.refetch();
        void fallbackIssues.refetch();
      }}
    >
      <Stack.Screen options={{ title: p.name }} />
      <Card accent={projectColor(p.color)}>
        <Row style={{ justifyContent: "space-between" }}>
          <T size="lg" weight="700" role="header" style={{ flex: 1 }}>
            {p.name}
          </T>
          <Badge label={p.status} />
        </Row>
        {p.description ? <T tone="body">{p.description}</T> : null}
        <Progress value={p.percent_done} label={t("portal.progress", { p: p.percent_done })} color={c.brand} />
        <T tone="body">{`${t("portal.progress", { p: p.percent_done })} · ${t("portal.tasksDone", { done: p.tasks.done, total })}`}</T>
        {rich ? (
          <T tone="body">
            {p.budget_minutes
              ? t("portal.hours", { used: hours, budget: Math.round(p.budget_minutes / 60) })
              : t("portal.hoursUsed", { used: hours })}
          </T>
        ) : null}
        {rich && page.data!.completed_7d ? <T tone="ok">{t("portal.completed7", { n: page.data!.completed_7d })}</T> : null}
        {weeks.length ? (
          <Row style={{ alignItems: "flex-end", height: 60, gap: 3 }}>
            {weeks.map((w) => (
              <View
                key={w.week}
                accessible
                accessibilityLabel={`${f.date(w.week)}: ${Math.round(w.minutes / 6) / 10}h`}
                style={{ flex: 1, height: Math.max(2, (w.minutes / maxWeek) * 56), backgroundColor: c.brand }}
              />
            ))}
          </Row>
        ) : null}
        {p.ends_on ? <T size="sm" tone="muted">{`${p.starts_on ? f.date(p.starts_on) + " – " : ""}${f.date(p.ends_on)}`}</T> : null}
      </Card>

      <Row>
        <Button
          label={t("portal.fileIssue")}
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: "/file", params: { project: p.id, kind: "issue" } })}
        />
        {rich ? (
          <Button
            variant="secondary"
            label={t("portal.fileRequest")}
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: "/file", params: { project: p.id, kind: "request" } })}
          />
        ) : null}
      </Row>

      <SectionTitle>{t("portal.issues")}</SectionTitle>
      {issues.length === 0 ? <Empty text={t("portal.noIssues")} /> : null}
      {issues.map((i) => (
        <View key={i.key} style={{ gap: space.xs }}>
          <ListItem
            title={`${i.key} · ${i.title}`}
            subtitle={[i.status, i.issue_type, i.mine ? t("portal.mine") : null].filter(Boolean).join(" · ")}
            right={<Badge label={i.priority} />}
            onPress={rich ? () => router.push({ pathname: "/issue/[key]", params: { key: i.key } }) : undefined}
          />
          <IssueActions issue={i} />
        </View>
      ))}

      <SectionTitle>{t("portal.requests")}</SectionTitle>
      {!rich ? <T tone="muted">{t("portal.unavailable")}</T> : null}
      {rich && (page.data!.requests ?? []).length === 0 ? <Empty text={t("portal.noRequests")} /> : null}
      {(page.data?.requests ?? []).map((r) => (
        <ListItem
          key={r.key}
          title={`${r.key} · ${r.title}`}
          subtitle={[r.kind, r.state, r.reply ? t("portal.reply", { text: r.reply }) : null].filter(Boolean).join(" · ")}
          right={<Badge label={r.status} />}
        />
      ))}

      {rich && page.data!.invoices_visible ? (
        <>
          <SectionTitle>{t("portal.invoices")}</SectionTitle>
          {(page.data!.invoices ?? []).length === 0 ? <Empty text={t("portal.noInvoices")} /> : null}
          {(page.data!.invoices ?? []).map((iv) => (
            <InvoiceRow key={iv.id} iv={iv} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}
