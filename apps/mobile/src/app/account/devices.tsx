// Profile → Signed-in devices: every phone, computer and app holding a token for this account (the
// auth plugin's personal access tokens), this phone marked, and "Sign out" for any other. This
// phone signs out from the hub's own Sign out, which also forgets it here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Laptop, Puzzle, Smartphone, type LucideIcon } from "lucide-react-native";
import { View } from "react-native";

import type { AccessToken } from "@/api/endpoints";
import { useErrorText } from "@/components/kit";
import { AppText, confirmDialog, ErrorLine, fonts, ListItem, Row, Rows, Screen, SkeletonRow, StackHeader, StateRow, Tile, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { DEVICE_NAME, mahaam } from "@/lib/session";
import { fs } from "@/lib/type-scale";

const KEY = ["me", "devices"] as const;

function iconFor(name: string): LucideIcon {
  if (/iOS|Android|iPhone|Pixel|mobile/i.test(name)) return Smartphone;
  if (/Mac|Windows|Linux|desktop/i.test(name)) return Laptop;
  if (/extension|Chrome/i.test(name)) return Puzzle;
  return Globe;
}

// "2026-09-23 08:00:00" (SQL) → an ISO string every JS engine parses.
const iso = (s: string) => (s.includes("T") ? s : s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));

export default function Devices() {
  const t = useT();
  const c = useColors();
  const f = useFormat();
  const qc = useQueryClient();
  const errText = useErrorText();
  const q = useQuery({ queryKey: KEY, queryFn: () => mahaam.me.devices() });
  const revoke = useMutation({
    mutationFn: (d: AccessToken) => mahaam.me.revokeDevice(d.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  // This phone first, then the newest.
  const list = [...(q.data ?? [])].sort((a, b) => Number(b.name === DEVICE_NAME) - Number(a.name === DEVICE_NAME) || b.created_at.localeCompare(a.created_at));

  const ask = async (d: AccessToken) => {
    const ok = await confirmDialog({ title: t("account.devices.signOut"), message: t("account.devices.confirm", { name: d.name }), confirmLabel: t("account.devices.signOut"), cancelLabel: t("common.cancel"), destructive: true });
    if (ok) revoke.mutate(d);
  };

  return (
    <Screen header={<StackHeader title={t("account.devices.title")} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Rows>
        <Row>
          <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.muted }}>{t("account.devices.body")}</AppText>
        </Row>
        {q.isPending ? <SkeletonRow /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {revoke.error ? <ErrorLine text={errText(revoke.error)} /> : null}
        {list.length ? (
          <Row style={{ paddingVertical: 0 }}>
            {list.map((d, i) => {
              const mine = d.name === DEVICE_NAME;
              const Icon = iconFor(d.name);
              return (
                <ListItem
                  key={d.id}
                  last={i === list.length - 1}
                  leading={<Tile><Icon size={18} color={c.muted} strokeWidth={1.6} /></Tile>}
                  trailing={
                    mine ? (
                      <AppText style={{ fontFamily: fonts.medium, fontSize: fs.meta, color: c.goldText }}>{t("account.devices.thisDevice")}</AppText>
                    ) : (
                      <AppText
                        accessibilityRole="button"
                        onPress={() => void ask(d)}
                        style={{ fontFamily: fonts.medium, fontSize: fs.meta, color: c.dangerText, paddingVertical: 8 }}>
                        {t("account.devices.signOut")}
                      </AppText>
                    )
                  }>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="rowTitle" numberOfLines={2}>
                      {d.name}
                    </AppText>
                    <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.muted }}>{t("account.devices.signedIn", { date: f.date(iso(d.created_at)) })}</AppText>
                  </View>
                </ListItem>
              );
            })}
          </Row>
        ) : null}
      </Rows>
    </Screen>
  );
}
