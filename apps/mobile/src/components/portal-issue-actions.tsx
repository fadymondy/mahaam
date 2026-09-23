import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw } from "lucide-react-native";

import type { PortalIssue } from "@/api/types";
import { AppText, ErrorLine, fonts, PrimaryButton, SecondaryButton, useColors } from "@/grid";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { mahaam } from "@/lib/session";
import { fs } from "@/lib/type-scale";
import { Actions, Grow, useErrorText } from "./kit";

/** Accept (in review → done) / Reopen (→ to do), shown only when the API says it's allowed. */
export function IssueActions({ issue }: { issue: Pick<PortalIssue, "key" | "can_accept" | "can_reopen"> }) {
  const t = useT();
  const c = useColors();
  const ws = useWs();
  const qc = useQueryClient();
  const errText = useErrorText();
  const m = useMutation({
    mutationFn: (status: "done" | "todo") => mahaam.portal.updateIssue(issue.key, status),
    onSettled: () => {
      for (const k of ["portal-project", "portal-issue", "portal-issues", "portal-projects"]) void qc.invalidateQueries({ queryKey: [k, ws] });
    },
  });
  if (!issue.can_accept && !issue.can_reopen) return null;
  return (
    <>
      <Actions>
        {issue.can_accept ? (
          <Grow>
            <PrimaryButton
              label={t("portal.accept")}
              icon={<Check size={17} color={c.onAction} strokeWidth={1.8} />}
              disabled={m.isPending}
              onPress={() => m.mutate("done")}
            />
          </Grow>
        ) : null}
        {issue.can_reopen ? (
          <Grow>
            <SecondaryButton
              label={t("portal.reopen")}
              icon={<RotateCcw size={16} color={c.muted} strokeWidth={1.6} />}
              disabled={m.isPending}
              onPress={() => m.mutate("todo")}
            />
          </Grow>
        ) : null}
      </Actions>
      {m.isSuccess ? (
        <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.okText }}>{m.variables === "done" ? t("portal.accepted") : t("portal.reopened")}</AppText>
      ) : null}
      {m.error ? <ErrorLine text={errText(m.error)} /> : null}
    </>
  );
}
