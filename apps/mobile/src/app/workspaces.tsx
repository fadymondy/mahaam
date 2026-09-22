import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { LogOut } from "lucide-react-native";
import { useEffect } from "react";

import { Chip, useErrorText } from "@/components/kit";
import { isTeam } from "@/config";
import { AppText, ForwardChevron, Header, ListItem, Row, Rows, Screen, SecondaryButton, SkeletonRow, StateRow, useColors } from "@/grid";
import { useT } from "@/i18n";
import { fitsApp, mahaam, useSession } from "@/lib/session";

export default function Workspaces() {
  const t = useT();
  const c = useColors();
  const errText = useErrorText();
  const { status, workspace, chooseWorkspace, signOut, user } = useSession();
  const q = useQuery({ queryKey: ["workspaces", user?.id], queryFn: mahaam.workspaces, enabled: status === "signedIn" });
  const list = q.data?.workspaces ?? [];
  const fitting = list.filter(fitsApp);

  // One workspace that fits and none chosen yet → take it.
  useEffect(() => {
    if (!workspace && fitting.length === 1 && list.length === 1) {
      void chooseWorkspace(fitting[0]!).then(() => router.replace("/"));
    }
  }, [workspace, fitting, list.length, chooseWorkspace]);

  if (status === "signedOut") return <Redirect href="/sign-in" />;

  return (
    <Screen header={<Header title={t("ws.title")} count={q.data ? list.length : undefined} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Rows inset>
        {q.isPending ? <SkeletonRow /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {q.data && list.length === 0 ? <StateRow state="empty" message={t("ws.none")} /> : null}
        {list.length ? (
          <Row style={{ paddingVertical: 0 }}>
            {list.map((w, i) => {
              const ok = fitsApp(w);
              return (
                <ListItem
                  key={w.id}
                  last={i === list.length - 1}
                  trailing={ok ? <ForwardChevron /> : undefined}
                  onPress={ok ? () => void chooseWorkspace(w).then(() => router.replace("/")) : undefined}>
                  <AppText variant="rowTitle">{w.name}</AppText>
                  {ok ? (
                    <Chip label={t(`ws.role.${w.role}` as "ws.role.member")} />
                  ) : (
                    <AppText variant="meta" color={c.dangerText}>
                      {t(isTeam ? "ws.wrongAppTeam" : "ws.wrongAppClient")}
                    </AppText>
                  )}
                </ListItem>
              );
            })}
          </Row>
        ) : null}
        <Row>
          <AppText variant="micro">{t("auth.email")}</AppText>
          <AppText variant="rowTitle" style={{ writingDirection: "ltr" }}>
            {user?.email}
          </AppText>
          <SecondaryButton label={t("auth.signOut")} icon={<LogOut size={17} color={c.muted} strokeWidth={1.6} />} onPress={() => void signOut()} />
        </Row>
      </Rows>
    </Screen>
  );
}
