// Placeholder until the view is built.
import { EmptyState, ViewHeader } from "@/components/kit";
import { useI18n } from "@/lib/i18n";

export function InboxView() {
  const { t } = useI18n();
  return (
    <>
      <ViewHeader title={t("nav.inbox")} />
      <EmptyState title={t("nav.inbox")} body={t("stub.soon")} />
    </>
  );
}
