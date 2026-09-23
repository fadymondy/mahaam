// Placeholder until the view is built.
import { EmptyState, ViewHeader } from "@/components/kit";
import { useI18n } from "@/lib/i18n";

export function ProjectsView() {
  const { t } = useI18n();
  return (
    <>
      <ViewHeader title={t("nav.allProjects")} />
      <EmptyState title={t("nav.allProjects")} body={t("stub.soon")} />
    </>
  );
}
