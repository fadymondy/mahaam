import { InvoiceRow } from "@/components/invoice-row";
import { TabHeader, useErrorText } from "@/components/kit";
import { useInvoices } from "@/features/client";
import { Row, Rows, Screen, SkeletonRow, StateRow } from "@/grid";
import { useT } from "@/i18n";

export default function Invoices() {
  const t = useT();
  const errText = useErrorText();
  const q = useInvoices();
  const list = q.data ?? [];
  return (
    <Screen header={<TabHeader title="tabs.invoices" count={q.data ? list.length : undefined} inbox="/updates" />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <Rows inset>
        {q.isPending ? <SkeletonRow /> : null}
        {q.isError ? <StateRow state="error" message={errText(q.error)} onRetry={() => void q.refetch()} /> : null}
        {q.data && list.length === 0 ? <StateRow state="empty" message={t("portal.noInvoices")} /> : null}
        {list.length ? (
          <Row style={{ paddingVertical: 0 }}>
            {list.map((iv, i) => (
              <InvoiceRow key={iv.id} iv={iv} last={i === list.length - 1} />
            ))}
          </Row>
        ) : null}
      </Rows>
    </Screen>
  );
}
