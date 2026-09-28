// A project's activity (internal/work/activity.go) as sentences in the UI language, one key per
// action filled from the entry's changes — the same sentences the web console shows.
import { BotIcon } from "lucide-react";

import type { Activity, Member } from "../../../shared/types";
import { Avatar, ErrorState, LtrText, RowsSkeleton } from "@/components/kit";
import { useI18n } from "@/lib/i18n";

const TASK_FIELDS = ["title", "description", "priority", "due_at", "estimate_minutes", "parent_id", "status"];

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export function ActivityFeed({
  items,
  loading,
  error,
  memberMap,
  onRetry,
}: {
  items: Activity[] | undefined;
  loading: boolean;
  error: unknown;
  memberMap: Map<string, Member>;
  onRetry?: () => void;
}) {
  const { t, locale, relative, date } = useI18n();
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading) return <RowsSkeleton rows={4} />;
  if (!items?.length) return <p className="px-1 py-3 text-[13.5px] text-grid-muted">{t("project.activity.empty")}</p>;

  const who = (id: string) => memberMap.get(id)?.email ?? "—";
  const sentence = (a: Activity) => {
    const c = (a.changes ?? {}) as Record<string, unknown>;
    const vars: Record<string, string> = {
      key: str(c.key),
      title: str(c.title),
      name: str(c.name),
      from: str(c.from),
      to: str(c.to),
      status: str(c.status),
      item: str(c.item),
      file: str(c.file),
      team: str(c.team),
      role: c.role ? t(`project.role.${str(c.role)}`) : "",
      user: c.user_id ? who(str(c.user_id)) : "",
    };
    if (a.action === "task.updated") vars.fields = TASK_FIELDS.filter((f) => f in c).map((f) => t(`project.field.${f}`)).join(locale === "ar" ? "، " : ", ");
    const k = `project.act.${a.action}`;
    const text = t(k, vars);
    return text === k ? t("project.act.generic", { action: a.action }) : text;
  };

  return (
    <ol className="settings-card flex flex-col divide-y divide-line" aria-label={t("project.activity.title")} data-project-activity>
      {items.map((a) => {
        const email = who(a.actor_id);
        const excerpt = str((a.changes as Record<string, unknown> | null)?.excerpt);
        return (
          <li key={a.id} className="flex items-start gap-2.5 px-4 py-2.5 text-[13.5px]" data-action={a.action}>
            <Avatar id={a.actor_id} email={email} size={18} className="mt-px" />
            <div className="min-w-0 flex-1">
              <p className="text-grid-muted">
                <LtrText className="font-medium text-grid-fg">{email.split("@")[0]}</LtrText> {sentence(a)}
                {a.via === "mcp" ? (
                  <span className="ms-1.5 inline-flex items-center gap-1 text-[12px]" title={t("project.activity.viaMcp")}>
                    <BotIcon className="inline size-3" />
                    {t("project.activity.viaMcp")}
                  </span>
                ) : null}
              </p>
              {excerpt ? <p className="mt-1 line-clamp-2 border-s-2 border-line ps-2 text-grid-muted">{excerpt}</p> : null}
            </div>
            <time className="shrink-0 text-[12.5px] text-grid-muted" dateTime={a.created_at} title={date(a.created_at, { dateStyle: "medium", timeStyle: "short" })}>
              {relative(a.created_at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
