// A customer's project — the web portal's project page (portal/projects/[id]) on a phone: Overview
// (progress, hours against budget, team), Board (only when the workspace shares it), Issues and
// Requests (file, follow, accept or reopen), Time (hours by week and by task), Invoices (when
// shared) and Activity. Everything here reads the portal routes, which only ever return what the
// workspace shares with its customers.
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Bug, MessageSquarePlus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";

import type { PortalIssue } from "@/api/types";
import { InvoiceRow } from "@/components/invoice-row";
import { Actions, Chip, Grow, Micro, Progress, projectColor, StatCells, useErrorText } from "@/components/kit";
import { LineTabs } from "@/components/line-tabs";
import { IssueActions } from "@/components/portal-issue-actions";
import { usePortalIssues, usePortalProject, usePortalProjects } from "@/features/client";
import { AppText, fonts, ListItem, Meta, PrimaryButton, Row, Rows, Screen, SecondaryButton, SkeletonRow, StackHeader, StateRow, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { formatDuration } from "@/lib/time";
import { fs } from "@/lib/type-scale";

type Tab = "overview" | "board" | "issues" | "requests" | "time" | "invoices" | "activity";

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

const hours = (minutes: number) => Math.round(minutes / 6) / 10;

function WeekBars({ weeks }: { weeks: { week: string; minutes: number }[] }) {
  const f = useFormat();
  const c = useColors();
  const max = Math.max(1, ...weeks.map((w) => w.minutes));
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 72, gap: 3 }}>
      {weeks.map((w) => (
        <View
          key={w.week}
          accessible
          accessibilityLabel={`${f.date(w.week)}: ${hours(w.minutes)}h`}
          style={{ flex: 1, borderRadius: 2, height: Math.max(2, (w.minutes / max) * 68), backgroundColor: c.brand }}
        />
      ))}
    </View>
  );
}

function Board({ id }: { id: string }) {
  const t = useT();
  const c = useColors();
  const ws = useWs();
  const errText = useErrorText();
  const q = useQuery({ queryKey: qk.portalBoard(ws, id), queryFn: () => mahaam.portal.board(id), enabled: !!ws });
  if (q.isPending) return <SkeletonRow lines={3} />;
  if (q.isError) return <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data) return <StateRow state="empty" message={t("portal.unavailable")} />;
  const columns = q.data.columns ?? [];
  const tasks = q.data.tasks ?? [];
  return (
    <>
      {columns.map((col) => {
        const items = tasks.filter((x) => x.status_id === col.id).sort((a, b) => a.position - b.position);
        return (
          <Section key={col.id} title={col.name} count={items.length}>
            {items.length === 0 ? <Empty text={t("issues.emptyColumn")} /> : null}
            {items.map((x, i) => (
              <ListItem key={x.key} last={i === items.length - 1} padV={12}>
                <AppText variant="rowTitle" numberOfLines={2}>
                  {x.title}
                </AppText>
                <Meta
                  items={
                    [
                      x.key,
                      x.checklist_total ? `${x.checklist_done}/${x.checklist_total}` : null,
                      x.assignees?.length ? x.assignees.map((a) => a.name).join(", ") : null,
                    ].filter(Boolean) as string[]
                  }
                />
                {x.labels?.length ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {x.labels.map((l) => (
                      <Chip key={l.name} label={l.name} dot={projectColor(l.color)} />
                    ))}
                  </View>
                ) : null}
              </ListItem>
            ))}
          </Section>
        );
      })}
      <Row style={{ paddingVertical: 10 }}>
        <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.muted }}>{t("portal.boardReadOnly")}</AppText>
      </Row>
    </>
  );
}

function Time({ id }: { id: string }) {
  const t = useT();
  const ws = useWs();
  const errText = useErrorText();
  const q = useQuery({ queryKey: qk.portalTime(ws, id), queryFn: () => mahaam.portal.time(id), enabled: !!ws });
  if (q.isPending) return <SkeletonRow lines={3} />;
  if (q.isError) return <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data) return <StateRow state="empty" message={t("portal.unavailable")} />;
  const d = q.data;
  const byTask = (d.by_task ?? []).filter((x) => x.minutes > 0);
  return (
    <>
      <Row>
        <StatCells
          items={[
            { label: t("portal.hoursLabel"), value: `${hours(d.used_minutes)}h` },
            { label: t("project.budget"), value: d.budget_minutes ? `${hours(d.budget_minutes)}h` : "—", tone: "gold" },
          ]}
        />
        {d.budget_minutes ? <Progress value={(d.used_minutes / d.budget_minutes) * 100} label={t("project.budget")} /> : null}
        {d.weeks?.length ? <WeekBars weeks={d.weeks} /> : null}
      </Row>
      <Section title={t("portal.byTask")} count={byTask.length}>
        {byTask.length === 0 ? <Empty text={t("portal.noTime")} /> : null}
        {byTask.map((x, i) => (
          <ListItem key={`${x.key}-${i}`} last={i === byTask.length - 1} padV={10} trailing={<AppText variant="mono">{formatDuration(x.minutes * 60)}</AppText>}>
            <AppText variant="rowTitle" numberOfLines={2}>
              {x.title ?? t("portal.otherWork")}
            </AppText>
            {x.key ? <Meta items={[x.key]} /> : null}
          </ListItem>
        ))}
      </Section>
    </>
  );
}

function Activity({ id }: { id: string }) {
  const t = useT();
  const f = useFormat();
  const ws = useWs();
  const errText = useErrorText();
  const q = useQuery({ queryKey: qk.portalActivity(ws, id), queryFn: () => mahaam.portal.activity(id), enabled: !!ws });
  if (q.isPending) return <SkeletonRow lines={3} />;
  if (q.isError) return <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} />;
  const items = q.data?.items ?? [];
  return (
    <Section title={t("project.activity")} count={items.length}>
      {items.length === 0 ? <Empty text={t("common.empty")} /> : null}
      {items.map((a, i) => (
        <ListItem key={i} last={i === items.length - 1} padV={10}>
          <AppText variant="rowTitle" numberOfLines={2}>
            {a.title}
          </AppText>
          <Meta
            items={
              [
                a.key,
                t(`portal.activity.${a.kind}` as "portal.activity.task.created", { from: a.from ?? "", to: a.to ?? "" }),
                `${f.date(a.at)} ${f.time(a.at)}`,
              ].filter(Boolean) as string[]
            }
          />
        </ListItem>
      ))}
    </Section>
  );
}

export default function PortalProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const page = usePortalProject(id);
  const list = usePortalProjects();
  // Older servers: no project page → the project from the list + the issue intake's own list.
  const fallbackIssues = usePortalIssues(id, page.data === null);
  const [tab, setTab] = useState<Tab>("overview");

  const p = page.data ?? list.data?.projects.find((x) => x.id === id);
  const rich = !!page.data;
  const issues: PortalIssue[] = rich
    ? (page.data!.issues ?? [])
    : (fallbackIssues.data ?? []).map((i) => ({ ...i, resolution: null, can_accept: false, can_reopen: false, mine: true, comment_count: 0 }));
  const requests = page.data?.requests ?? [];
  const invoices = page.data?.invoices ?? [];
  const share = page.data?.share;

  const tabs = useMemo(() => {
    const all: { value: Tab; label: string; count?: number }[] = [
      { value: "overview", label: t("portal.tab.overview") },
      { value: "issues", label: t("portal.tab.issues"), count: issues.length },
      { value: "requests", label: t("portal.tab.requests"), count: requests.length },
      { value: "board", label: t("portal.tab.board") },
      { value: "time", label: t("portal.tab.time") },
      { value: "invoices", label: t("portal.tab.invoices"), count: invoices.length },
      { value: "activity", label: t("portal.tab.activity") },
    ];
    return all.filter((x) => (x.value === "board" ? !!share?.board : x.value === "invoices" ? !!page.data?.invoices_visible : x.value === "overview" || x.value === "issues" || rich));
  }, [t, issues.length, requests.length, invoices.length, share?.board, page.data?.invoices_visible, rich]);

  const fileButtons = p ? (
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
  ) : null;

  return (
    <Screen
      header={<StackHeader title={p?.name ?? ""} subtitle={p ? `${p.percent_done}%` : undefined} />}
      refreshing={page.isRefetching}
      onRefresh={() => {
        void page.refetch();
        void fallbackIssues.refetch();
      }}>
      <Rows>
        {page.isPending ? <SkeletonRow lines={3} /> : null}
        {page.isError ? <StateRow state="error" message={errText(page.error)} onRetry={() => void page.refetch()} /> : null}
        {p ? (
          <>
            <Row style={{ paddingHorizontal: 0, paddingVertical: 0 }}>
              <LineTabs<Tab> options={tabs} value={tab} onChange={setTab} />
            </Row>

            {tab === "overview" ? (
              <>
                <Row style={{ borderStartWidth: 2, borderStartColor: projectColor(p.color) }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <AppText variant="title" style={{ flex: 1 }}>
                      {p.name}
                    </AppText>
                    <Chip label={t(`project.status.${p.status}` as "project.status.active")} tone={p.status === "active" ? "ok" : "neutral"} />
                  </View>
                  {p.description ? <AppText>{p.description}</AppText> : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Progress value={p.percent_done} color={projectColor(p.color)} label={t("portal.progress", { p: p.percent_done })} />
                    </View>
                    <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.goldText }}>{`${p.percent_done}%`}</AppText>
                  </View>
                  <StatCells
                    items={[
                      { label: t("tasks.done"), value: `${p.tasks.done}/${p.tasks.todo + p.tasks.doing + p.tasks.done}` },
                      { label: t("portal.hoursLabel"), value: `${hours(p.used_minutes)}${p.budget_minutes ? ` / ${hours(p.budget_minutes)}` : ""}h` },
                      { label: t("portal.issues"), value: String(p.open_issues ?? issues.length), tone: "gold" },
                      { label: t("portal.requests"), value: String(p.pending_requests ?? requests.length) },
                    ]}
                  />
                  {p.budget_minutes ? (
                    <View style={{ gap: 6 }}>
                      <Progress
                        value={(p.used_minutes / p.budget_minutes) * 100}
                        color={p.used_minutes > p.budget_minutes ? c.danger : c.ok}
                        label={t("project.budget")}
                      />
                      {p.used_minutes > p.budget_minutes ? (
                        <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.dangerText }}>{t("project.overBudget")}</AppText>
                      ) : null}
                    </View>
                  ) : null}
                  {rich && page.data!.completed_7d ? <Meta items={[t("portal.completed7", { n: page.data!.completed_7d })]} /> : null}
                  {page.data?.weeks?.length ? <WeekBars weeks={page.data.weeks} /> : null}
                  {p.ends_on ? <Meta items={[`${p.starts_on ? f.date(p.starts_on) + " – " : ""}${f.date(p.ends_on)}`]} /> : null}
                  {fileButtons}
                </Row>
                {share?.team && page.data?.team?.length ? (
                  <Section title={t("project.people")} count={page.data.team.length}>
                    {page.data.team.map((m, i, all) => (
                      <ListItem
                        key={`${m.name}-${i}`}
                        last={i === all.length - 1}
                        padV={10}
                        leading={
                          <View style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
                            <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.body }}>{m.initials}</AppText>
                          </View>
                        }>
                        <AppText variant="rowTitle">{m.name}</AppText>
                        {m.role ? <Meta items={[m.role]} /> : null}
                      </ListItem>
                    ))}
                  </Section>
                ) : null}
              </>
            ) : null}

            {tab === "issues" ? (
              <>
                <Row>{fileButtons}</Row>
                <Section title={t("portal.issues")} count={issues.length}>
                  {issues.length === 0 ? <Empty text={t("portal.noIssues")} /> : null}
                  {issues.map((i, n) => (
                    <ListItem key={i.key} last={n === issues.length - 1} onPress={rich ? () => router.push({ pathname: "/portal-issue/[key]", params: { key: i.key } }) : undefined}>
                      <AppText variant="rowTitle" numberOfLines={2}>
                        {i.title}
                      </AppText>
                      <Meta
                        items={[i.key, t(`issues.status.${i.status}` as "issues.status.todo"), t(`issues.type.${i.issue_type}` as "issues.type.bug"), i.mine ? t("portal.mine") : null].filter(Boolean) as string[]}
                      />
                      <IssueActions issue={i} />
                    </ListItem>
                  ))}
                </Section>
              </>
            ) : null}

            {tab === "requests" ? (
              <>
                <Row>{fileButtons}</Row>
                <Section title={t("portal.requests")} count={requests.length}>
                  {requests.length === 0 ? <Empty text={t("portal.noRequests")} /> : null}
                  {requests.map((r, n) => (
                    <ListItem key={r.key} last={n === requests.length - 1} trailing={<Chip label={t(`portal.requestState.${r.state}` as "portal.requestState.pending")} tone={r.state === "accepted" ? "ok" : r.state === "declined" ? "danger" : "gold"} />}>
                      <AppText variant="rowTitle" numberOfLines={2}>
                        {r.title}
                      </AppText>
                      <Meta items={[r.key, t(`file.${r.kind}` as "file.feature"), r.desired_on ? f.date(r.desired_on) : null].filter(Boolean) as string[]} />
                      {r.reply ? <AppText variant="meta">{t("portal.reply", { text: r.reply })}</AppText> : null}
                    </ListItem>
                  ))}
                </Section>
              </>
            ) : null}

            {tab === "board" ? <Board id={p.id} /> : null}
            {tab === "time" ? <Time id={p.id} /> : null}
            {tab === "activity" ? <Activity id={p.id} /> : null}

            {tab === "invoices" ? (
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
