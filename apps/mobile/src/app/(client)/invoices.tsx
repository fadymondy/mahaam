import { router } from "expo-router";

import { Badge, Empty, ErrorState, ListItem, Loading, Screen, T } from "@/components/ui";
import { useInvoices } from "@/features/client";
import { useFormat, useT } from "@/i18n";

export default function Invoices() {
  const t = useT();
  const f = useFormat();
  const q = useInvoices();
  if (q.isPending) return <Loading />;
  const list = q.data ?? [];
  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {list.length === 0 && !q.isError ? <Empty text={t("portal.noInvoices")} /> : null}
      {list.map((iv) => (
        <ListItem
          key={iv.id}
          title={iv.number}
          subtitle={[
            t("invoice.issued", { date: f.date(iv.issue_date) }),
            iv.due_date ? t("invoice.due", { date: f.date(iv.due_date) }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          right={
            <>
              <Badge label={t(`invoice.status.${iv.status}` as "invoice.status.sent")} />
              <T weight="600">{f.money(iv.total_minor, iv.currency)}</T>
            </>
          }
          onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: iv.id } })}
        />
      ))}
    </Screen>
  );
}
