import { router, useLocalSearchParams } from "expo-router";
import { MessageSquarePlus, Bug } from "lucide-react-native";
import { View } from "react-native";

import type { PortalIssue } from "@/api/types";
import { InvoiceRow } from "@/components/invoice-row";
import { Actions, Chip, Grow, Micro, Progress, projectColor, StatCells, useErrorText } from "@/components/kit";
import { IssueActions } from "@/components/portal-issue-actions";
import { usePortalIssues, usePortalProject, usePortalProjects } from "@/features/client";
import { AppText, ListItem, Meta, PrimaryButton, Row, Rows, Screen, SecondaryButton, SkeletonRow, StackHeader, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <Row style={{ paddingVertical: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14, paddingBottom: 4 }}>
        <Micro style={{ flex: 1 }}>{title}</Micro>
        {count !== undefined ? <AppText variant="mono">{count}</AppText> : null}
      </View>
      {children}
    </Row>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <AppText variant="meta" style={{ paddingVertical: 14 }}>
      {text}
    </AppText>
  );
}

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const page = usePortalProject(id);
  const list = usePortalProjects();
  // Older servers: no project page → the project from the list + the issue intake's own list.
  const fallbackIssues = usePortalIssues(id, page.data === null);

  const p = page.data ?? list.data?.projects.find((x) => x.id === id);
  const rich = !!page.data;
  const issues: PortalIssue[] = rich
    ? (page.data!.issues ?? [])
    : (fallbackIssues.data ?? []).map((i) => ({ ...i, resolution: null, can_accept: false, can_reopen: false, mine: true, comment_count: 0 }));
  const weeks = page.data?.weeks ?? [];
  const maxWeek = Math.max(1, ...weeks.map((w) => w.minutes));
  const requests = page.data?.requests ?? [];
  const invoices = page.data?.invoices ?? [];

  return (
    <Screen
      header={<StackHeader title={p?.name ?? ""} subtitle={p ? `${p.percent_done}%` : undefined} />}
      refreshing={page.isRefetching}
      onRefresh={() => {
        void page.refetch();
        void fallbackIssues.refetch();
      }}
      footer={undefined}>
      <Rows>
        {page.isPending ? <SkeletonRow lines={3} /> : null}
        {page.isError ? <StateRow state="error" message={errText(page.error)} onRetry={() => void page.refetch()} /> : null}
        {p ? (
          <>
            <Row style={{ borderStartWidth: 2, borderStartColor: projectColor(p.color) }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <AppText variant="title" style={{ flex: 1 }}>
                  {p.name}
                </AppText>
                <Chip label={p.status} />
              </View>
              {p.description ? <AppText>{p.description}</AppText> : null}
              <Progress value={p.percent_done} label={t("portal.progress", { p: p.percent_done })} />
              <StatCells
                items={[
                  { label: t("tasks.done"), value: `${p.tasks.done}/${p.tasks.todo + p.tasks.doing + p.tasks.done}` },
                  { label: t("portal.hoursLabel"), value: `${Math.round(p.used_minutes / 6) / 10}${p.budget_minutes ? ` / ${Math.round(p.budget_minutes / 60)}` : ""}h` },
                  { label: t("portal.issues"), value: String(p.open_issues ?? issues.length), tone: "gold" },
                  { label: t("portal.requests"), value: String(p.pending_requests ?? requests.length) },
                ]}
              />
              {rich && page.data!.completed_7d ? <Meta items={[t("portal.completed7", { n: page.data!.completed_7d })]} /> : null}
              {weeks.length ? (
                <View style={{ flexDirection: "row", alignItems: "flex-end", height: 60, gap: 3 }}>
                  {weeks.map((w) => (
                    <View
                      key={w.week}
                      accessible
                      accessibilityLabel={`${f.date(w.week)}: ${Math.round(w.minutes / 6) / 10}h`}
                      style={{ flex: 1, borderRadius: 2, height: Math.max(2, (w.minutes / maxWeek) * 56), backgroundColor: c.brand }}
                    />
                  ))}
                </View>
              ) : null}
              {p.ends_on ? <Meta items={[`${p.starts_on ? f.date(p.starts_on) + " – " : ""}${f.date(p.ends_on)}`]} /> : null}
              <Actions>
                <Grow>
                  <PrimaryButton
                    label={t("portal.fileIssue")}
                    icon={<Bug size={17} color={c.onAction} strokeWidth={1.6} />}
                    onPress={() => router.push({ pathname: "/file", params: { project: p.id, kind: "issue" } })}
                  />
                </Grow>
                {rich ? (
                  <Grow>
                    <SecondaryButton
                      label={t("portal.fileRequest")}
                      icon={<MessageSquarePlus size={17} color={c.muted} strokeWidth={1.6} />}
                      onPress={() => router.push({ pathname: "/file", params: { project: p.id, kind: "request" } })}
                    />
                  </Grow>
                ) : null}
              </Actions>
            </Row>

            <Section title={t("portal.issues")} count={issues.length}>
              {issues.length === 0 ? <Empty text={t("portal.noIssues")} /> : null}
              {issues.map((i, n) => (
                <ListItem key={i.key} last={n === issues.length - 1} onPress={rich ? () => router.push({ pathname: "/issue/[key]", params: { key: i.key } }) : undefined}>
                  <AppText variant="rowTitle" numberOfLines={2}>
                    {i.title}
                  </AppText>
                  <Meta items={[i.key, t(`issues.status.${i.status}` as "issues.status.todo"), i.issue_type, i.mine ? t("portal.mine") : null].filter(Boolean) as string[]} />
                  <IssueActions issue={i} />
                </ListItem>
              ))}
            </Section>

            <Section title={t("portal.requests")} count={rich ? requests.length : undefined}>
              {!rich ? <Empty text={t("portal.unavailable")} /> : null}
              {rich && requests.length === 0 ? <Empty text={t("portal.noRequests")} /> : null}
              {requests.map((r, n) => (
                <ListItem key={r.key} last={n === requests.length - 1} trailing={<Chip label={r.status} />}>
                  <AppText variant="rowTitle" numberOfLines={2}>
                    {r.title}
                  </AppText>
                  <Meta items={[r.key, r.kind, r.state].filter(Boolean) as string[]} />
                  {r.reply ? <AppText variant="meta">{t("portal.reply", { text: r.reply })}</AppText> : null}
                </ListItem>
              ))}
            </Section>

            {rich && page.data!.invoices_visible ? (
              <Section title={t("portal.invoices")} count={invoices.length}>
                {invoices.length === 0 ? <Empty text={t("portal.noInvoices")} /> : null}
                {invoices.map((iv, n) => (
                  <InvoiceRow key={iv.id} iv={iv} last={n === invoices.length - 1} />
                ))}
              </Section>
            ) : null}
          </>
        ) : null}
      </Rows>
    </Screen>
  );
}
