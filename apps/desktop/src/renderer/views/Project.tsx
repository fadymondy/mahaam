// Placeholder until the view is built.
import { EmptyState, ViewHeader } from "@/components/kit";
import { useProjectMap } from "@/lib/data";
import { useI18n } from "@/lib/i18n";

export function ProjectView({ id }: { id: string; view?: "list" | "board" }) {
  const { t } = useI18n();
  const p = useProjectMap().get(id);
  return (
    <>
      <ViewHeader title={p?.name ?? ""} />
      <EmptyState title={p?.name ?? ""} body={t("stub.soon")} />
    </>
  );
}
