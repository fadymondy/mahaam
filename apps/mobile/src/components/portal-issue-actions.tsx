import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { PortalIssue } from "@/api/types";
import { useT } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { mahaam } from "@/lib/session";
import { Button, Row, T, useErrorText } from "./ui";

/** Accept (in review → done) / Reopen (→ to do), shown only when the API says it's allowed. */
export function IssueActions({ issue }: { issue: Pick<PortalIssue, "key" | "can_accept" | "can_reopen"> }) {
  const t = useT();
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
      <Row>
        {issue.can_accept ? (
          <Button small label={t("portal.accept")} busy={m.isPending && m.variables === "done"} onPress={() => m.mutate("done")} />
        ) : null}
        {issue.can_reopen ? (
          <Button small variant="secondary" label={t("portal.reopen")} busy={m.isPending && m.variables === "todo"} onPress={() => m.mutate("todo")} />
        ) : null}
      </Row>
      {m.isSuccess ? <T tone="ok">{m.variables === "done" ? t("portal.accepted") : t("portal.reopened")}</T> : null}
      {m.error ? (
        <T tone="danger" role="alert">
          {errText(m.error)}
        </T>
      ) : null}
    </>
  );
}
