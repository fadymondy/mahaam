// Placeholder until the view is built.
import { EmptyState, ViewHeader } from "@/components/kit";
import { useI18n } from "@/lib/i18n";

export function SettingsView(_: { section?: string }) {
  const { t } = useI18n();
  return (
    <>
      <ViewHeader title={t("nav.settings")} />
      <EmptyState title={t("nav.settings")} body={t("stub.soon")} />
    </>
  );
}
