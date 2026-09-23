// Workspaces: every workspace the person belongs to with their role there; the current one is
// marked, the others switch in place (the session and the live stream follow).
import { ArrowUpRightIcon, CheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LtrText, Spinner } from "@/components/kit";
import { useApp } from "@/lib/app";
import { desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

import { Badge, Group, Row, Section, SmallButton } from "./parts";

export function WorkspaceSettings() {
  const { t } = useI18n();
  const { session, workspace, selectWorkspace } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const list = session?.workspaces ?? [];

  const choose = async (id: string, name: string) => {
    setBusy(id);
    try {
      await selectWorkspace(id);
      toast.success(t("settings.switched", { name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section id="workspaces" title={t("settings.workspaces")} description={t("settings.workspacesHint")}>
      <Group>
        {list.map((w) => {
          const current = w.id === workspace?.id;
          return (
            <Row
              key={w.id}
              data-row="workspace"
              icon={
                <span className="flex size-8 items-center justify-center rounded-md bg-grid-action text-[13px] font-semibold text-grid-on-action">
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
              }
              label={
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{w.name}</span>
                  {current ? <Badge tone="action">{t("settings.current")}</Badge> : null}
                </span>
              }
              hint={
                <span className="flex items-center gap-1.5">
                  <LtrText>{w.slug}</LtrText>
                  <span aria-hidden>·</span>
                  {t(`role.${w.role}`)}
                </span>
              }
            >
              {current ? (
                <CheckIcon className="me-1 size-4 text-grid-action" aria-label={t("settings.current")} />
              ) : (
                <SmallButton onClick={() => void choose(w.id, w.name)} disabled={!!busy} data-switch={w.slug}>
                  {busy === w.id ? <Spinner /> : null}
                  {t("settings.switch")}
                </SmallButton>
              )}
            </Row>
          );
        })}
      </Group>

      <Group>
        <Row label={t("settings.manageWorkspace")} hint={t("settings.manageWorkspaceHint")}>
          <SmallButton onClick={() => void desktop.openWeb("/settings/workspace")}>
            {t("settings.open")}
            <ArrowUpRightIcon className="rtl:-scale-x-100" />
          </SmallButton>
        </Row>
      </Group>
    </Section>
  );
}
