// Customer search: their projects, and the issues and requests on them — read from each project's
// portal page (GET /api/w/portal/issues lists only what the customer filed themselves), filtered
// here: the portal routes have no text filter, and a customer's lists are small.
import { useQueries, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";

import { Micro, projectColor } from "@/components/kit";
import { SearchScreen, type SearchSection } from "@/components/search-screen";
import { usePortalProjects } from "@/features/client";
import { AppText, ForwardChevron, ListItem, Row } from "@/grid";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";

const dot = (color?: string | null) => <View style={{ width: 3, alignSelf: "stretch", borderRadius: 1.5, backgroundColor: projectColor(color) }} />;

function useCustomerSections(q: string): SearchSection[] {
  const t = useT();
  const ws = useWs();
  const projects = usePortalProjects();
  const pages = useQueries({
    queries: (projects.data?.projects ?? []).map((p) => ({
      queryKey: qk.portalProject(ws, p.id),
      queryFn: () => mahaam.portal.project(p.id),
      enabled: !!ws && !!q,
    })),
  });
  const allIssues = pages.flatMap((pg) => pg.data?.issues ?? []);
  const issuesLoading = pages.some((pg) => pg.isFetching);
  const requests = useQuery({
    queryKey: qk.portalRequests(ws),
    queryFn: async () => (await mahaam.portal.requests())?.requests ?? null,
    enabled: !!ws && !!q,
  });
  if (!q) return [];
  const needle = q.toLowerCase();
  const has = (...xs: (string | null | undefined)[]) => xs.join(" ").toLowerCase().includes(needle);
  const byId = new Map((projects.data?.projects ?? []).map((p) => [p.id, p]));
  return [
    {
      title: t("tabs.projects"),
      items: (projects.data?.projects ?? [])
        .filter((p) => has(p.name, p.description))
        .map((p) => ({ key: p.id, title: p.name, meta: [`${p.percent_done}%`], leading: dot(p.color), onPress: () => router.push({ pathname: "/portal-project/[id]", params: { id: p.id } }) })),
    },
    {
      title: t("portal.issues"),
      loading: issuesLoading,
      items: allIssues
        .filter((i) => has(i.key, i.title, i.body))
        .slice(0, 20)
        .map((i) => ({
          key: i.key,
          title: i.title,
          meta: [i.key, byId.get(i.project_id ?? "")?.name, t(`issues.status.${i.status}` as "issues.status.todo")].filter(Boolean) as string[],
          leading: dot(byId.get(i.project_id ?? "")?.color),
          onPress: () => router.push({ pathname: "/portal-issue/[key]", params: { key: i.key } }),
        })),
    },
    {
      title: t("portal.requests"),
      loading: requests.isFetching,
      items: (requests.data ?? [])
        .filter((r) => has(r.key, r.title, r.body))
        .slice(0, 20)
        .map((r) => ({
          key: r.key,
          title: r.title,
          meta: [r.key, r.project_name, t(`portal.requestState.${r.state}` as "portal.requestState.pending")].filter(Boolean) as string[],
          onPress: () => (r.project_id ? router.push({ pathname: "/portal-project/[id]", params: { id: r.project_id } }) : undefined),
        })),
    },
  ];
}

function Browse() {
  const t = useT();
  const projects = usePortalProjects();
  const list = (projects.data?.projects ?? []).filter((p) => !p.archived);
  if (!list.length) return null;
  return (
    <Row style={{ paddingVertical: 0 }}>
      <Micro style={{ paddingTop: 14, paddingBottom: 4 }}>{t("tabs.projects")}</Micro>
      {list.map((p, i) => (
        <ListItem key={p.id} last={i === list.length - 1} padV={12} leading={dot(p.color)} trailing={<ForwardChevron />} onPress={() => router.push({ pathname: "/portal-project/[id]", params: { id: p.id } })}>
          <AppText variant="rowTitle">{p.name}</AppText>
        </ListItem>
      ))}
    </Row>
  );
}

export default function CustomerSearch() {
  return <SearchScreen storageKey="mahaam.search.customer" useSections={useCustomerSections} browse={<Browse />} />;
}
