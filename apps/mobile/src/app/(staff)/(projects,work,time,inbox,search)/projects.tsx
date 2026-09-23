// The team app's home: every project, as the web's projects list shows them — progress, the issue
// track, status, client, people and dates — with search and filters. A project opens its board.
import { router } from "expo-router";
import { SlidersHorizontal } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import type { Project } from "@/api/types";
import { IssueTrack } from "@/components/issue-track";
import { Chip, Micro, Progress, projectColor, TabHeader, useErrorText } from "@/components/kit";
import { LineTabs } from "@/components/line-tabs";
import { ProjectAvatar } from "@/components/project-avatar";
import { SearchField } from "@/components/search";
import { useProjectList } from "@/features/projects";
import { percentDone } from "@/features/client";
import {
  AppText,
  BottomSheet,
  FilterStrip,
  fonts,
  ForwardChevron,
  IconButton,
  ListItem,
  Meta,
  Row,
  Rows,
  Screen,
  SecondaryButton,
  SkeletonRow,
  StateRow,
  useColors,
} from "@/grid";
import { useFormat, useT } from "@/i18n";
import { openCount } from "@/lib/stages";
import { fs } from "@/lib/type-scale";

type Show = "all" | "open" | "review";

const STATUS_TONE: Record<Project["status"], "neutral" | "ok" | "gold" | "danger" | "brand"> = {
  active: "ok",
  planned: "brand",
  on_hold: "gold",
  completed: "neutral",
  cancelled: "danger",
};

function ProjectRow({ p, last }: { p: Project; last: boolean }) {
  const t = useT();
  const f = useFormat();
  const c = useColors();
  const pct = percentDone(p.tasks);
  const total = p.tasks.todo + p.tasks.doing + p.tasks.done;
  const open = openCount(p.issues);
  return (
    <ListItem
      last={last}
      padV={16}
      alignTop
      leading={<ProjectAvatar project={p} />}
      trailing={<ForwardChevron />}
      onPress={() => router.push({ pathname: "/project/[id]", params: { id: p.id } })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <AppText variant="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
          {p.name}
        </AppText>
        <Chip label={t(`project.status.${p.status}`)} tone={STATUS_TONE[p.status]} />
      </View>
      <Meta
        items={
          [
            p.client_name,
            t("projects.members", { n: p.member_count }),
            p.ends_on ? t("projects.ends", { date: f.date(p.ends_on) }) : null,
            p.visibility === "members" ? t("projects.private") : null,
          ].filter(Boolean) as string[]
        }
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Progress value={pct} label={t("portal.progress", { p: pct })} color={projectColor(p.color)} />
        </View>
        <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.goldText }}>{`${pct}%`}</AppText>
      </View>
      <Meta items={[t("portal.tasksDone", { done: p.tasks.done, total }), open ? t("portal.openIssues", { n: open }) : t("projects.noOpenIssues")]} />
      <IssueTrack issues={p.issues} />
    </ListItem>
  );
}

export default function Projects() {
  const t = useT();
  const c = useColors();
  const errText = useErrorText();
  const [archived, setArchived] = useState(false);
  const q = useProjectList(archived);
  const list = useMemo(() => q.data ?? [], [q.data]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [client, setClient] = useState<string>("all");
  const [show, setShow] = useState<Show>("all");
  const [filtering, setFiltering] = useState(false);

  const clients = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of list) if (p.client_id && p.client_name) m.set(p.client_id, p.client_name);
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [list]);

  // One small list: search and filters run here, as they do on the web.
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return list.filter((p) => {
      if (needle && !`${p.name} ${p.client_name ?? ""} ${p.description ?? ""}`.toLowerCase().includes(needle)) return false;
      if (status !== "all" && p.status !== status) return false;
      if (client !== "all" && p.client_id !== client) return false;
      if (show === "open" && !openCount(p.issues)) return false;
      if (show === "review" && !(p.issues?.in_review || p.issues?.waiting_approval)) return false;
      return true;
    });
  }, [list, search, status, client, show]);
  const filtered = status !== "all" || client !== "all" || show !== "all";

  return (
    <Screen
      header={<TabHeader title="tabs.projects" count={q.data ? shown.length : undefined} inbox="/inbox" />}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}>
      <Rows inset>
        <Row style={{ paddingHorizontal: 0, paddingVertical: 0 }}>
          <LineTabs<"active" | "archived">
            options={[
              { value: "active", label: t("projects.active") },
              { value: "archived", label: t("projects.archived") },
            ]}
            value={archived ? "archived" : "active"}
            onChange={(v) => setArchived(v === "archived")}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, paddingBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <SearchField value={search} onChange={setSearch} placeholder={t("projects.search")} />
            </View>
            <View>
              <IconButton label={t("common.filters")} onPress={() => setFiltering(true)}>
                <SlidersHorizontal size={19} color={filtered ? c.goldText : c.muted} strokeWidth={1.6} />
              </IconButton>
              {filtered ? <View style={{ position: "absolute", top: 8, end: 9, width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.gold }} /> : null}
            </View>
          </View>
        </Row>

        {q.isPending ? <SkeletonRow lines={3} /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {q.data && list.length === 0 ? <StateRow state="empty" message={t(archived ? "projects.noneArchived" : "projects.none")} /> : null}
        {q.data && list.length > 0 && shown.length === 0 ? (
          <Row style={{ alignItems: "center", paddingVertical: 24 }}>
            <AppText variant="meta">{t("projects.noMatch")}</AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSearch("");
                setStatus("all");
                setClient("all");
                setShow("all");
              }}>
              <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.goldText }}>{t("projects.clearFilters")}</AppText>
            </Pressable>
          </Row>
        ) : null}
        {shown.length ? (
          <Row style={{ paddingVertical: 0 }}>
            {shown.map((p, i) => (
              <ProjectRow key={p.id} p={p} last={i === shown.length - 1} />
            ))}
          </Row>
        ) : null}
      </Rows>

      <BottomSheet visible={filtering} onClose={() => setFiltering(false)}>
        <AppText variant="title">{t("common.filters")}</AppText>
        <Micro>{t("projects.filter.status")}</Micro>
        <FilterStrip
          flush
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: t("projects.filter.all") },
            ...(["active", "planned", "on_hold", "completed", "cancelled"] as const).map((s) => ({ value: s, label: t(`project.status.${s}`) })),
          ]}
        />
        {clients.length ? (
          <>
            <Micro>{t("projects.filter.client")}</Micro>
            <FilterStrip flush value={client} onChange={setClient} options={[{ value: "all", label: t("projects.filter.all") }, ...clients]} />
          </>
        ) : null}
        <Micro>{t("projects.filter.show")}</Micro>
        <FilterStrip<Show>
          flush
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: t("projects.filter.all") },
            { value: "open", label: t("projects.filter.open") },
            { value: "review", label: t("projects.filter.review") },
          ]}
        />
        <SecondaryButton label={t("common.done")} onPress={() => setFiltering(false)} />
      </BottomSheet>
    </Screen>
  );
}
