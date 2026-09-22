// One invoice. "View / print" fetches the printable HTML with the session and opens it: a new
// browser window on web, the system print sheet (expo-print) on devices — the print route needs the
// Bearer header, so a plain browser URL would not be signed in.
import * as Print from "expo-print";
import { useLocalSearchParams } from "expo-router";
import { Printer } from "lucide-react-native";
import { useState } from "react";
import { Platform, View } from "react-native";

import { ApiError } from "@/api/client";
import { Chip, StatCells, useErrorText } from "@/components/kit";
import { useInvoices } from "@/features/client";
import { AppText, FooterBar, Meta, PrimaryButton, Row, Rows, Screen, SkeletonRow, StackHeader, useColors } from "@/grid";
import { useFormat, useI18n } from "@/i18n";
import { mahaam } from "@/lib/session";

export default function InvoiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, locale } = useI18n();
  const f = useFormat();
  const c = useColors();
  const errText = useErrorText();
  const invoices = useInvoices();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const iv = invoices.data?.find((x) => x.id === id);

  const open = async () => {
    if (!iv) return;
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
    <Screen
      header={<StackHeader title={iv?.number ?? ""} subtitle={iv?.client_name ?? undefined} />}
      footer={
        iv ? (
          <FooterBar>
            <PrimaryButton label={t("invoice.open")} icon={<Printer size={17} color={c.onAction} strokeWidth={1.6} />} disabled={busy} onPress={() => void open()} />
          </FooterBar>
        ) : null
      }>
      <Rows>
        {invoices.isPending ? <SkeletonRow lines={3} /> : null}
        {iv ? (
          <>
            <Row>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <AppText variant="title" style={{ flex: 1, writingDirection: "ltr" }}>
                  {iv.number}
                </AppText>
                <Chip label={t(`invoice.status.${iv.status}` as "invoice.status.sent")} tone={iv.status === "paid" ? "ok" : iv.status === "overdue" ? "danger" : "gold"} />
              </View>
              <Meta
                items={[t("invoice.issued", { date: f.date(iv.issue_date) }), iv.due_date ? t("invoice.due", { date: f.date(iv.due_date) }) : null].filter(Boolean) as string[]}
              />
              <StatCells
                columns={3}
                items={[
                  { label: t("invoice.total"), value: f.money(iv.total_minor, iv.currency) },
                  { label: t("invoice.paid"), value: f.money(iv.paid_minor, iv.currency), tone: "ok" },
                  { label: t("invoice.balance"), value: f.money(iv.total_minor - iv.paid_minor, iv.currency), tone: iv.total_minor > iv.paid_minor ? "gold" : undefined },
                ]}
              />
              {iv.notes ? <AppText>{iv.notes}</AppText> : null}
              {msg ? <AppText variant="meta">{msg}</AppText> : null}
            </Row>
          </>
        ) : null}
      </Rows>
    </Screen>
  );
}
