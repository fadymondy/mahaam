import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useEffect } from "react";

import type { Workspace } from "@/api/types";
import { Badge, Button, Empty, ErrorState, ListItem, Loading, Screen, T } from "@/components/ui";
import { isTeam } from "@/config";
import { useT } from "@/i18n";
import { fitsApp, mahaam, useSession } from "@/lib/session";


export default function Workspaces() {
  const t = useT();
  const { status, workspace, chooseWorkspace, signOut, user } = useSession();
  const q = useQuery({ queryKey: ["workspaces", user?.id], queryFn: mahaam.workspaces, enabled: status === "signedIn" });
  const list = q.data?.workspaces ?? [];
  const fitting = list.filter(fitsApp);

  // One workspace that fits and none chosen yet → take it.
  useEffect(() => {
    if (!workspace && fitting.length === 1 && list.length === 1) {
      void chooseWorkspace(fitting[0]).then(() => router.replace("/"));
    }
  }, [workspace, fitting, list.length, chooseWorkspace]);

  if (status === "signedOut") return <Redirect href="/sign-in" />;
  if (q.isPending) return <Loading />;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()} edges={[]}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {list.length === 0 && !q.isError ? <Empty text={t("ws.none")} /> : null}
      {list.map((w) => {
        const ok = fitsApp(w);
        return (
          <ListItem
            key={w.id}
            title={w.name}
            subtitle={ok ? w.slug : t(isTeam ? "ws.wrongAppTeam" : "ws.wrongAppClient")}
            right={<Badge label={t(`ws.role.${w.role}` as "ws.role.member")} />}
            onPress={
              ok
                ? () => {
                    void chooseWorkspace(w).then(() => router.replace("/"));
                  }
                : undefined
            }
          />
        );
      })}
      <T size="sm" tone="muted">
        {user?.email}
      </T>
      <Button variant="secondary" label={t("auth.signOut")} onPress={() => void signOut()} />
    </Screen>
  );
}
