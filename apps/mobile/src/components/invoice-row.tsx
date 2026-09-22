import { router } from "expo-router";
import { View } from "react-native";

import type { Invoice } from "@/api/types";
import { AppText, fonts, ListItem, Meta, useColors } from "@/grid";
import { useFormat, useT } from "@/i18n";
import { Chip } from "./kit";

const TONE: Record<string, "ok" | "danger" | "gold" | "neutral"> = { paid: "ok", overdue: "danger", partial: "gold", sent: "gold" };

/** An invoice in a list: number, dates, status and total. */
export function InvoiceRow({ iv, last }: { iv: Invoice; last?: boolean }) {
  const t = useT();
  const f = useFormat();
  const c = useColors();
  return (
    <ListItem
      last={last}
      onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: iv.id } })}
      trailing={
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <AppText style={{ fontFamily: fonts.medium, fontSize: 14, color: c.fg, writingDirection: "ltr" }}>{f.money(iv.total_minor, iv.currency)}</AppText>
          <Chip label={t(`invoice.status.${iv.status}` as "invoice.status.sent")} tone={TONE[iv.status] ?? "neutral"} />
        </View>
      }>
      <AppText variant="rowTitle" style={{ writingDirection: "ltr" }}>
        {iv.number}
      </AppText>
      <Meta
        items={[t("invoice.issued", { date: f.date(iv.issue_date) }), iv.due_date ? t("invoice.due", { date: f.date(iv.due_date) }) : null].filter(Boolean) as string[]}
      />
    </ListItem>
  );
}
