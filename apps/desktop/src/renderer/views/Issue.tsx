// Placeholder until the view is built.
import { EmptyState, ViewHeader } from "@/components/kit";
import { useI18n } from "@/lib/i18n";

export function IssueView({ issueKey }: { issueKey: string }) {
  const { t } = useI18n();
  return (
    <>
      <ViewHeader title={issueKey} />
      <EmptyState title={issueKey} body={t("stub.soon")} />
    </>
  );
}
