// Placeholder until the view is built.
import { EmptyState, ViewHeader } from "@/components/kit";
import { useI18n } from "@/lib/i18n";

export function TimeView() {
  const { t } = useI18n();
  return (
    <>
      <ViewHeader title={t("nav.time")} />
      <EmptyState title={t("nav.time")} body={t("stub.soon")} />
    </>
  );
}
