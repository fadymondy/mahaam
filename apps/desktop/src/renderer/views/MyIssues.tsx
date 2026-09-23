// Placeholder until the view is built.
import { EmptyState, ViewHeader } from "@/components/kit";
import { useI18n } from "@/lib/i18n";

export function MyIssuesView() {
  const { t } = useI18n();
  return (
    <>
      <ViewHeader title={t("nav.myIssues")} />
      <EmptyState title={t("nav.myIssues")} body={t("stub.soon")} />
    </>
  );
}
