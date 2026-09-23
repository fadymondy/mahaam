// One project, team side — the web's project page on a phone: Overview (progress, facts, budget,
// people, activity), Issues (the board or a list, searched and filtered on the server, cards
// movable between the project's columns), and Reports (hours by member and week, open issues, the
// PDF / Markdown report to share).
import { router, useLocalSearchParams } from "expo-router";
import { FileText, KanbanSquare, List, Play, Plus, Share2, SlidersHorizontal } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { IssueBoard } from "@/components/issue-board";
import { IssueTrack } from "@/components/issue-track";
import { Actions, Chip, Grow, Micro, Progress, projectColor, StatCells, useErrorText } from "@/components/kit";
import { LineTabs } from "@/components/line-tabs";
import { ProjectAvatar } from "@/components/project-avatar";
import { SearchField, useDebounced } from "@/components/search";
import { useMembers, useMoveToColumn, useProject, useProjectIssues, useProjectList, useProjectReport } from "@/features/projects";
import { percentDone } from "@/features/client";
import { useRunning, useStartTimer } from "@/features/team";
import {
  AppText,
  BottomSheet,
  ErrorLine,
  FilterStrip,
  fonts,
  IconButton,
  ListItem,
  Meta,
  PrimaryButton,
  Row,
  Rows,
  Screen,
  SecondaryButton,
  SkeletonRow,
  StackHeader,
  StateRow,
  useColors,
} from "@/grid";
import { useFormat, useI18n } from "@/i18n";
import { formatDuration } from "@/lib/time";
import { shareReportMarkdown, shareReportPdf } from "@/lib/share-report";
import { fs } from "@/lib/type-scale";

type Section = "overview" | "issues" | "reports";

function Band({ title, count, children }: { title: string; count?: number | string; children: React.ReactNode }) {
  return (
    <Row>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Micro style={{ flex: 1 }}>{title}</Micro>
        {count !== undefined ? <AppText variant="mono">{count}</AppText> : null}
      </View>
      {children}
    </Row>
  );
}

/** Horizontal bars for a report breakdown (hours by member or week, or a count per column). */
function Bars({ rows, color, count }: { rows: { label: string; seconds: number }[]; color: string; count?: boolean }) {
  const c = useColors();
  const max = Math.max(1, ...rows.map((r) => r.seconds));
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <View key={i} style={{ gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: fs.meta, color: c.body }} numberOfLines={1}>
              {r.label}
            </AppText>
            <AppText style={{ fontFamily: fonts.mono, fontSize: fs.mono, color: c.fg }}>{count ? r.seconds : formatDuration(r.seconds)}</AppText>
          </View>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: c.soft, overflow: "hidden" }}>
            <View style={{ width: `${(r.seconds / max) * 100}%`, height: 4, backgroundColor: color }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Overview({ id }: { id: string }) {
  const { t } = useI18n();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const project = useProject(id);
  const report = useProjectReport(id);
  const members = useMembers();
  const listed = useProjectList(false);
  const running = useRunning();
  const start = useStartTimer();
  const p = project.data;
  if (project.isPending) return <SkeletonRow lines={4} />;
  if (project.isError) return <StateRow state="error" message={errText(project.error)} onRetry={() => void project.refetch()} />;
  if (!p) return null;
  const pct = percentDone(p.tasks);
  const b = report.data?.budget;
  const emails = new Map((members.data ?? []).map((m) => [m.user_id, m.email]));
  const onThis = running.data?.project_id === p.id;
  return (
    <>
      <Row style={{ borderStartWidth: 2, borderStartColor: projectColor(p.color) }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <ProjectAvatar project={p} size={48} />
          <AppText variant="title" style={{ flex: 1 }}>
            {p.name}
          </AppText>
          <Chip label={t(`project.status.${p.status}`)} tone={p.status === "active" ? "ok" : "neutral"} />
        </View>
        {p.client_name ? <Meta items={[p.client_name]} /> : null}
        {p.description ? <AppText>{p.description}</AppText> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Progress value={pct} color={projectColor(p.color)} label={t("portal.progress", { p: pct })} />
          </View>
          <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.goldText }}>{`${pct}%`}</AppText>
        </View>
        <StatCells
          columns={3}
          items={[
            { label: t("tasks.todo"), value: String(p.tasks.todo) },
            { label: t("tasks.doing"), value: String(p.tasks.doing), tone: "gold" },
            { label: t("tasks.done"), value: String(p.tasks.done), tone: "ok" },
          ]}
        />
        <IssueTrack issues={listed.data?.find((x) => x.id === id)?.issues ?? p.issues} />
        <PrimaryButton
          label={onThis ? t("timer.running") : t("project.startTimer")}
          icon={<Play size={17} color={c.onAction} strokeWidth={1.8} />}
          disabled={onThis || start.isPending}
          onPress={() => start.mutate({ project: p.id })}
        />
        {start.error ? <ErrorLine text={errText(start.error)} /> : null}
      </Row>

      {b && b.budget_minutes ? (
        <Band title={t("project.budget")} count={b.hours_percent != null ? `${Math.round(b.hours_percent)}%` : undefined}>
          <Progress
            value={b.hours_percent ?? 0}
            color={b.level === "over" ? c.danger : b.level === "warn" || b.level === "warning" ? c.warn : c.ok}
            label={t("project.budget")}
          />
          <Meta items={[t("portal.hours", { used: Math.round(b.spent_s / 360) / 10, budget: Math.round(b.budget_minutes / 60) })]} />
          {b.level === "over" ? <ErrorLine text={t("project.overBudget")} /> : null}
        </Band>
      ) : null}

      <Band title={t("project.facts")}>
        <StatCells
          items={[
            { label: t("project.billing"), value: t(`project.billingMode.${p.billing_mode}`) },
            { label: t("project.visibility"), value: t(p.visibility === "members" ? "projects.private" : "project.workspace") },
            { label: t("project.starts"), value: p.starts_on ? f.date(p.starts_on) : "—" },
            { label: t("project.ends"), value: p.ends_on ? f.date(p.ends_on) : "—" },
          ]}
        />
      </Band>

      {p.members?.length ? (
        <Band title={t("project.people")} count={p.members.length}>
          {p.members.map((m, i) => (
            <ListItem key={m.user_id} last={i === p.members!.length - 1} padV={10}>
              <AppText variant="rowTitle" style={{ writingDirection: "ltr" }}>
                {emails.get(m.user_id) ?? m.user_id}
              </AppText>
              <Meta items={[t(`ws.role.${m.role}` as "ws.role.member")]} />
            </ListItem>
          ))}
        </Band>
      ) : null}

      {report.data?.activity?.length ? (
        <Band title={t("project.activity")}>
          {report.data.activity.slice(0, 12).map((a, i, all) => (
            <ListItem key={i} last={i === all.length - 1} padV={10}>
              <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.body }}>{`${a.actor} · ${a.action.replace(/[._]/g, " ")}`}</AppText>
              <Meta items={[`${f.date(a.at)} ${f.time(a.at)}`, a.subject]} />
            </ListItem>
          ))}
        </Band>
      ) : null}
    </>
  );
}

function Issues({ id }: { id: string }) {
  const { t } = useI18n();
  const c = useColors();
  const errText = useErrorText();
  const project = useProject(id);
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [type, setType] = useState("all");
  const [priority, setPriority] = useState("all");
  const [state, setState] = useState("open");
  const [filtering, setFiltering] = useState(false);
  const filters = useMemo(
    () => ({ q: q || undefined, type: type === "all" ? undefined : type, priority: priority === "all" ? undefined : priority, state: state === "all" ? undefined : state }),
    [q, type, priority, state],
  );
  const issues = useProjectIssues(id, filters);
  const move = useMoveToColumn(id);
  const filtered = type !== "all" || priority !== "all" || state !== "open";

  return (
    <>
      <Row style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <SearchField value={search} onChange={setSearch} placeholder={t("issues.search")} />
          </View>
          <View>
            <IconButton label={t("common.filters")} onPress={() => setFiltering(true)}>
              <SlidersHorizontal size={19} color={filtered ? c.goldText : c.muted} strokeWidth={1.6} />
            </IconButton>
            {filtered ? <View style={{ position: "absolute", top: 8, end: 9, width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.gold }} /> : null}
          </View>
          <IconButton label={t(view === "board" ? "issues.listView" : "issues.boardView")} onPress={() => setView(view === "board" ? "list" : "board")}>
            {view === "board" ? <List size={19} color={c.muted} strokeWidth={1.6} /> : <KanbanSquare size={19} color={c.muted} strokeWidth={1.6} />}
          </IconButton>
        </View>
        {project.data?.can_write ? (
          <SecondaryButton
            label={t("issues.new")}
            icon={<Plus size={17} color={c.muted} strokeWidth={1.6} />}
            onPress={() => router.push({ pathname: "/new-issue", params: { project: id } })}
          />
        ) : null}
        {move.error ? <ErrorLine text={errText(move.error)} /> : null}
      </Row>
      {issues.isPending || project.isPending ? <SkeletonRow lines={3} /> : null}
      {issues.isError ? <StateRow state="error" message={errText(issues.error)} onRetry={() => void issues.refetch()} /> : null}
      {issues.data && issues.data.length === 0 ? <StateRow state="empty" message={t(filtered || q ? "issues.noMatch" : "issues.none")} /> : null}
      {issues.data?.length && project.data ? (
        <IssueBoard
          issues={issues.data}
          statuses={project.data.statuses}
          view={view}
          canMove={!!project.data.can_write}
          onMove={(i, column) => move.mutate({ key: i.key, column })}
        />
      ) : null}

      <BottomSheet visible={filtering} onClose={() => setFiltering(false)}>
        <AppText variant="title">{t("common.filters")}</AppText>
        <Micro>{t("issues.filter.state")}</Micro>
        <FilterStrip
          flush
          value={state}
          onChange={setState}
          options={[
            { value: "open", label: t("issues.state.open") },
            { value: "closed", label: t("issues.state.closed") },
            { value: "all", label: t("projects.filter.all") },
          ]}
        />
        <Micro>{t("issues.filter.type")}</Micro>
        <FilterStrip
          flush
          value={type}
          onChange={setType}
          options={[{ value: "all", label: t("projects.filter.all") }, ...(["bug", "feature", "task", "story", "epic"] as const).map((x) => ({ value: x, label: t(`issues.type.${x}`) }))]}
        />
        <Micro>{t("issues.filter.priority")}</Micro>
        <FilterStrip
          flush
          value={priority}
          onChange={setPriority}
          options={[
            { value: "all", label: t("projects.filter.all") },
            ...(["highest", "high", "medium", "low", "lowest"] as const).map((x) => ({ value: x, label: t(`issues.priority.${x}`) })),
          ]}
        />
        <SecondaryButton label={t("common.done")} onPress={() => setFiltering(false)} />
      </BottomSheet>
    </>
  );
}

function Reports({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const report = useProjectReport(id);
  const [busy, setBusy] = useState<"pdf" | "md" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const r = report.data;
  if (report.isPending) return <SkeletonRow lines={4} />;
  if (report.isError) return <StateRow state="error" message={errText(report.error)} onRetry={() => void report.refetch()} />;
  if (!r) return null;
  const color = projectColor(r.project.color);
  const share = async (kind: "pdf" | "md") => {
    setBusy(kind);
    setErr(null);
    try {
      if (kind === "pdf") await shareReportPdf(id, r.project.name, locale);
      else await shareReportMarkdown(id, r.project.name, locale);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const members = (r.by_member?.rows ?? []).filter((x) => x.seconds > 0);
  const weeks = (r.by_week?.rows ?? []).slice(-8);
  return (
    <>
      <Row>
        <Meta items={[`${f.date(r.from)} – ${f.date(r.to)}`, r.timezone]} />
        <StatCells
          items={[
            { label: t("report.done"), value: `${r.percent_done}%`, tone: "gold" },
            { label: t("report.tasks"), value: String(r.total_tasks) },
            { label: t("report.hours"), value: formatDuration(r.by_member?.total?.seconds ?? 0) },
            { label: t("report.openIssues"), value: String(r.open_issue_count), tone: r.open_issue_count ? "danger" : "ok" },
          ]}
        />
        <Actions>
          <Grow>
            <SecondaryButton label={t("report.pdf")} icon={<Share2 size={16} color={c.muted} strokeWidth={1.6} />} disabled={!!busy} onPress={() => void share("pdf")} />
          </Grow>
          <Grow>
            <SecondaryButton label={t("report.md")} icon={<FileText size={16} color={c.muted} strokeWidth={1.6} />} disabled={!!busy} onPress={() => void share("md")} />
          </Grow>
        </Actions>
        {err ? <ErrorLine text={err} /> : null}
      </Row>
      {r.statuses?.length ? (
        <Band title={t("report.byStatus")}>
          <Bars count rows={r.statuses.map((s) => ({ label: s.name, seconds: s.task_count }))} color={color} />
        </Band>
      ) : null}
      {members.length ? (
        <Band title={t("report.byMember")}>
          <Bars rows={members.map((m) => ({ label: m.name, seconds: m.seconds }))} color={color} />
        </Band>
      ) : null}
      {weeks.some((w) => w.seconds) ? (
        <Band title={t("report.byWeek")}>
          <Bars rows={weeks.map((w) => ({ label: f.date(w.key), seconds: w.seconds }))} color={c.gold} />
        </Band>
      ) : null}
      {r.issues_visible && r.open_issues?.length ? (
        <Band title={t("report.openIssues")} count={r.open_issue_count}>
          {r.open_issues.slice(0, 20).map((i, n, all) => (
            <ListItem key={i.key} last={n === all.length - 1} padV={10} onPress={() => router.push({ pathname: "/issue/[key]", params: { key: i.key } })}>
              <AppText variant="rowTitle" numberOfLines={2}>
                {i.title}
              </AppText>
              <Meta items={[i.key, t(`issues.status.${i.status}` as "issues.status.todo"), t(`issues.priority.${i.priority}` as "issues.priority.medium")]} />
            </ListItem>
          ))}
        </Band>
      ) : null}
    </>
  );
}

export default function TeamProject() {
  const { id, section: initial } = useLocalSearchParams<{ id: string; section?: Section }>();
  const { t } = useI18n();
  const project = useProject(id);
  const report = useProjectReport(id);
  const [section, setSection] = useState<Section>(initial ?? "issues");
  const listed = useProjectList(false);
  const p = project.data;
  // Stage counts come with the projects list (the detail route does not carry them).
  const counts = listed.data?.find((x) => x.id === id)?.issues ?? p?.issues;
  const open = counts ? Object.entries(counts).reduce((n, [k, v]) => (k === "done" ? n : n + v), 0) : undefined;

  return (
    <Screen
      header={<StackHeader title={p?.name ?? ""} subtitle={p?.client_name ?? undefined} />}
      refreshing={project.isRefetching}
      onRefresh={() => {
        void project.refetch();
        void report.refetch();
      }}>
      <Rows>
        <Row style={{ paddingHorizontal: 0, paddingVertical: 0 }}>
          <LineTabs<Section>
            options={[
              { value: "issues", label: t("project.tab.issues"), count: open },
              { value: "overview", label: t("project.tab.overview") },
              { value: "reports", label: t("project.tab.reports") },
            ]}
            value={section}
            onChange={setSection}
          />
        </Row>
        {section === "overview" ? <Overview id={id} /> : null}
        {section === "issues" ? <Issues id={id} /> : null}
        {section === "reports" ? <Reports id={id} /> : null}
      </Rows>
    </Screen>
  );
}

