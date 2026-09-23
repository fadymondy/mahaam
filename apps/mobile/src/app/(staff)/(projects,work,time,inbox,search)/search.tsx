// Staff search: projects (the list, filtered here), issues and tasks (the API's `q`), grouped.
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";

import { projectColor } from "@/components/kit";
import { ProjectAvatar } from "@/components/project-avatar";
import { SearchScreen, type SearchSection } from "@/components/search-screen";
import { useProjectList } from "@/features/projects";
import { AppText, ForwardChevron, ListItem, Row } from "@/grid";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { mahaam } from "@/lib/session";
import { Micro } from "@/components/kit";

const dot = (color?: string | null) => <View style={{ width: 3, alignSelf: "stretch", borderRadius: 1.5, backgroundColor: projectColor(color) }} />;

function useStaffSections(q: string): SearchSection[] {
  const t = useT();
  const ws = useWs();
  const projects = useProjectList(false);
  const issues = useQuery({
    queryKey: ["search", ws, "issues", q],
    queryFn: async () => (await mahaam.issues.query({ q, board: true })).issues ?? [],
    enabled: !!ws && !!q,
    staleTime: 30_000,
  });
  const tasks = useQuery({
    queryKey: ["search", ws, "tasks", q],
    queryFn: async () => (await mahaam.tasks.search(q)).tasks ?? [],
    enabled: !!ws && !!q,
    staleTime: 30_000,
  });
  if (!q) return [];
  const needle = q.toLowerCase();
  const names = new Map((projects.data ?? []).map((p) => [p.id, p]));
  const issueKeys = new Set((issues.data ?? []).map((i) => i.key));
  return [
    {
      title: t("tabs.projects"),
      items: (projects.data ?? [])
        .filter((p) => `${p.name} ${p.client_name ?? ""} ${p.description ?? ""}`.toLowerCase().includes(needle))
        .slice(0, 10)
        .map((p) => ({
          key: p.id,
          title: p.name,
          meta: [p.client_name, t(`project.status.${p.status}`)].filter(Boolean) as string[],
          leading: <ProjectAvatar project={p} size={32} />,
          onPress: () => router.push({ pathname: "/project/[id]", params: { id: p.id } }),
        })),
    },
    {
      title: t("project.tab.issues"),
      loading: issues.isFetching,
      items: (issues.data ?? []).slice(0, 20).map((i) => ({
        key: i.key,
        title: i.title,
        meta: [i.key, names.get(i.project_id ?? "")?.name, t(`issues.status.${i.status}` as "issues.status.todo")].filter(Boolean) as string[],
        leading: dot(names.get(i.project_id ?? "")?.color),
        onPress: () => router.push({ pathname: "/issue/[key]", params: { key: i.key } }),
      })),
    },
    {
      title: t("tabs.tasks"),
      loading: tasks.isFetching,
      // Issues are task cards too; show each key once.
      items: (tasks.data ?? [])
        .filter((x) => !issueKeys.has(x.key))
        .slice(0, 20)
        .map((x) => ({
          key: x.key,
          title: x.title,
          meta: [x.key, names.get(x.project_id)?.name].filter(Boolean) as string[],
          leading: dot(names.get(x.project_id)?.color),
          onPress: () => router.push({ pathname: "/task/[key]", params: { key: x.key } }),
        })),
    },
  ];
}

function Browse() {
  const t = useT();
  const projects = useProjectList(false);
  const list = (projects.data ?? []).slice(0, 8);
  if (!list.length) return null;
  return (
    <Row style={{ paddingVertical: 0 }}>
      <Micro style={{ paddingTop: 14, paddingBottom: 4 }}>{t("tabs.projects")}</Micro>
      {list.map((p, i) => (
        <ListItem key={p.id} last={i === list.length - 1} padV={12} leading={dot(p.color)} trailing={<ForwardChevron />} onPress={() => router.push({ pathname: "/project/[id]", params: { id: p.id } })}>
          <AppText variant="rowTitle">{p.name}</AppText>
        </ListItem>
      ))}
    </Row>
  );
}

export default function StaffSearch() {
  return <SearchScreen storageKey="mahaam.search.staff" useSections={useStaffSections} browse={<Browse />} />;
}
