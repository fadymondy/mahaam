// The project's Overview tab: task counts and progress, the budget burn, description, key facts,
// people and the project's activity. Mirrors the web console's project overview.
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, SettingsIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ActivityFeed } from "@/components/project/ActivityFeed";
import { BudgetMeters, LevelBadge, errorText, saveFile, TabPage, useFormat, useProjectDetail } from "@/components/project/common";
import { AvatarStack, ErrorState, LtrText, RowsSkeleton } from "@/components/kit";
import { Markdown } from "@/components/issues/Markdown";
import { useDay } from "@/components/issues/ProjectAbout";
import { ProgressBar, SectionTitle } from "@/components/issues/controls";
import { SmallButton } from "@/components/settings/parts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useMemberMap } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useRouter } from "@/lib/router";

export function ProjectOverview({ projectId }: { projectId: string }) {
  const { t, number } = useI18n();
  const { ws, workspace } = useApp();
  const role = workspace?.role;
  const isClient = role === "client";
  const detail = useProjectDetail(projectId);
  const memberMap = useMemberMap();
  const activity = useQuery({ queryKey: qk.projectActivity(ws, projectId), queryFn: () => api.projectActivity(projectId), enabled: !!ws });
  const budget = useQuery({
    queryKey: ["w", ws, "project-tab", projectId, "budget"],
    queryFn: () => api.projectBudget(projectId),
    enabled: !!ws && !isClient,
  });
  const f = useFormat();
  const day = useDay();
  const { navigate } = useRouter();

  if (detail.error) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <RowsSkeleton rows={6} />;
  const p = detail.data;
  const total = p.tasks.todo + p.tasks.doing + p.tasks.done;
  const pct = total ? Math.round((p.tasks.done / total) * 100) : 0;
  const peopleIds = Array.from(new Set([...(p.members ?? []).map((m) => m.user_id), ...(p.teams ?? []).flatMap((x) => x.member_ids ?? [])]));
  const people = peopleIds.map((id) => ({ id, email: memberMap.get(id)?.email ?? id }));

  const facts: [string, ReactNode][] = [
    [t("project.fact.client"), p.client_name ?? "—"],
    [t("project.fact.billing"), t(`project.billing.${p.billing_mode}`)],
    [t("project.fact.budgetHours"), p.budget_minutes ? <LtrText>{f.hours(p.budget_minutes * 60)}</LtrText> : "—"],
    [t("project.fact.budgetMoney"), p.budget_minor ? <LtrText>{f.money(p.budget_minor, p.currency)}</LtrText> : "—"],
    [t("project.fact.startsOn"), <LtrText key="s">{day(p.starts_on)}</LtrText>],
    [t("project.fact.endsOn"), <LtrText key="e">{day(p.ends_on)}</LtrText>],
    [t("project.fact.visibility"), t(`project.visibility.${p.visibility}`)],
  ];

  return (
    <TabPage data-project-overview>
      <section className="settings-card grid grid-cols-3 divide-x divide-line rtl:divide-x-reverse" aria-label={t("project.progress")}>
        {(["todo", "doing", "done"] as const).map((c) => (
          <div key={c} className="px-4 py-3">
            <p className="text-[12.5px] text-grid-muted">{t(`project.category.${c}`)}</p>
            <p className="mt-0.5 text-[22px] font-semibold text-grid-fg tabular-nums">{number(p.tasks[c])}</p>
          </div>
        ))}
      </section>

      <div className="flex items-center gap-3">
        <ProgressBar value={p.tasks.done} total={total} className="h-1.5 max-w-sm flex-1" />
        <span className="text-[13px] text-grid-muted">
          <LtrText>{number(pct)}%</LtrText> {t("project.doneLower")}
        </span>
        {!isClient ? <ReportMenu projectId={projectId} /> : null}
      </div>

      {!isClient && !budget.error ? (
        <section className="flex flex-col gap-2" data-budget-panel data-level={budget.data?.level ?? ""}>
          <SectionTitle actions={budget.data && budget.data.level !== "none" ? <LevelBadge level={budget.data.level} /> : null}>{t("project.budget.title")}</SectionTitle>
          <div className="settings-card px-4 py-3">
            {!budget.data ? (
              <div className="h-8 animate-pulse rounded bg-grid-soft" />
            ) : budget.data.level === "none" ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] text-grid-body">{t("project.budget.none")}</p>
                  {p.can_manage ? <p className="text-[12.5px] text-grid-muted">{t("project.budget.noneManager")}</p> : null}
                </div>
                {p.can_manage ? (
                  <SmallButton onClick={() => navigate({ name: "project", id: projectId, tab: "settings" })}>
                    <SettingsIcon />
                    {t("project.budget.setInSettings")}
                  </SmallButton>
                ) : null}
              </div>
            ) : (
              <BudgetMeters b={budget.data} />
            )}
          </div>
        </section>
      ) : null}

      {p.description?.trim() ? (
        <section className="flex flex-col gap-2">
          <SectionTitle>{t("project.description")}</SectionTitle>
          <div className="settings-card px-4 py-3">
            <Markdown source={p.description} className="text-[13.5px]" />
          </div>
        </section>
      ) : null}

      <dl className="settings-card grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="bg-grid-card px-4 py-2.5">
            <dt className="text-[12px] text-grid-muted">{label}</dt>
            <dd className="mt-0.5 truncate text-[13.5px] text-grid-fg">{value}</dd>
          </div>
        ))}
        <div className="bg-grid-card px-4 py-2.5">
          <dt className="text-[12px] text-grid-muted">{t("project.fact.people")}</dt>
          <dd className="mt-1">{people.length ? <AvatarStack people={people} max={6} /> : <span className="text-[13.5px]">—</span>}</dd>
        </div>
      </dl>

      <section className="flex flex-col gap-2">
        <SectionTitle>{t("project.activity.title")}</SectionTitle>
        <ActivityFeed items={activity.data} loading={activity.isPending} error={activity.error} memberMap={memberMap} onRetry={() => void activity.refetch()} />
      </section>
    </TabPage>
  );
}

/** "Download report": the project report as PDF or Markdown, in the UI's language. */
export function ReportMenu({ projectId, from, to }: { projectId: string; from?: string; to?: string }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = async (format: "pdf" | "md") => {
    setBusy(true);
    try {
      const file = await api.exportProjectReport(projectId, { format, lang: locale === "ar" ? "ar" : "en", from, to });
      saveFile(file);
      toast.success(t("project.exported", { name: file.name }));
    } catch (err) {
      toast.error(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SmallButton className="ms-auto" disabled={busy} data-project-report />}>
        <DownloadIcon />
        {t("project.downloadReport")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onClick={() => void run("pdf")}>{t("project.reportPdf")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("md")}>{t("project.reportMd")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
