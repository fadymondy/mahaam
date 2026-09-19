// One invoice. "View / print" fetches the printable HTML with the session and opens it: a new
// browser window on web, the system print sheet (expo-print) on devices — the print route needs the
// Bearer header, so a plain browser URL would not be signed in.
import * as Print from "expo-print";
import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";

import { ApiError } from "@/api/client";
import { Badge, Button, Card, Loading, Row, Screen, T, useErrorText } from "@/components/ui";
import { useInvoices } from "@/features/client";
import { useFormat, useI18n } from "@/i18n";
import { mahaam } from "@/lib/session";

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const f = useFormat();
  const errText = useErrorText();
  const invoices = useInvoices();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const iv = invoices.data?.find((x) => x.id === id);
  if (invoices.isPending) return <Loading />;
  if (!iv) return <Loading />;

  const open = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const html = await mahaam.portal.invoiceHtml(iv.id, locale);
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        window.open(url, "_blank", "noopener");
      } else {
        await Print.printAsync({ html });
      }
    } catch (e) {
      setMsg(e instanceof ApiError && (e.status === 403 || e.status === 404) ? t("invoice.notPrintable") : errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: iv.number }} />
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <T size="lg" weight="700" role="header">
            {iv.number}
          </T>
          <Badge label={t(`invoice.status.${iv.status}` as "invoice.status.sent")} />
        </Row>
        {iv.client_name ? <T tone="body">{iv.client_name}</T> : null}
        <T tone="body">{t("invoice.issued", { date: f.date(iv.issue_date) })}</T>
        {iv.due_date ? <T tone="body">{t("invoice.due", { date: f.date(iv.due_date) })}</T> : null}
        <Row style={{ justifyContent: "space-between" }}>
          <T>{t("invoice.total")}</T>
          <T weight="700">{f.money(iv.total_minor, iv.currency)}</T>
        </Row>
        <Row style={{ justifyContent: "space-between" }}>
          <T>{t("invoice.paid")}</T>
          <T>{f.money(iv.paid_minor, iv.currency)}</T>
        </Row>
        <Row style={{ justifyContent: "space-between" }}>
          <T weight="600">{t("invoice.balance")}</T>
          <T weight="600">{f.money(iv.total_minor - iv.paid_minor, iv.currency)}</T>
        </Row>
        {iv.notes ? <T tone="muted">{iv.notes}</T> : null}
        <Button label={t("invoice.open")} busy={busy} onPress={() => void open()} />
        {msg ? <T tone="muted">{msg}</T> : null}
      </Card>
    </Screen>
  );
}
