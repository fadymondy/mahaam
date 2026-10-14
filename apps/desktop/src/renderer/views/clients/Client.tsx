// One client, as on the web: contact facts and notes, their projects, tracked time (reports:read)
// and — for managers — the unbilled value and their invoices (opened in the web console).
import { useQuery } from "@tanstack/react-query";
import { ArchiveIcon, ArchiveRestoreIcon, BriefcaseIcon, ChevronLeftIcon, ExternalLinkIcon, PencilIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ClientFormDialog } from "@/components/clients/ClientForm";
import { clientCaps, clientErrorText, hmCell, money } from "@/components/clients/util";
import { EmptyState, ErrorState, LtrText, ProjectMark, RowsSkeleton, ViewHeader } from "@/components/kit";
import { HeaderButton, SectionTitle } from "@/components/issues/controls";
import { ProjectStatusChip } from "@/components/issues/ProjectAbout";
import { useApp } from "@/lib/app";
import { api, ApiError, desktop } from "@/lib/bridge";
import { useProjects } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

export function ClientView({ id }: { id: string }) {
  const { t, locale, date } = useI18n();
  const { navigate } = useRouter();
  const { ws, workspace } = useApp();
  const caps = clientCaps(workspace?.role);
  const [editing, setEditing] = useState(false);

  const client = useQuery({ queryKey: ["w", ws, "client", id], queryFn: () => api.client(id), enabled: !!ws && caps.read });
  const projects = useProjects(false);
  const time = useQuery({ queryKey: ["w", ws, "client", id, "time"], queryFn: () => api.clientTime(id), enabled: !!ws && caps.read && caps.reports });
  const unbilled = useQuery({ queryKey: ["w", ws, "client", id, "unbilled"], queryFn: () => api.clientUnbilled(id), enabled: !!ws && caps.invoices });
  const invoices = useQuery({ queryKey: ["w", ws, "client", id, "invoices"], queryFn: () => api.clientInvoices(id), enabled: !!ws && caps.invoices });

  const c = client.data;
  const back = (
    <button
      type="button"
      onClick={() => navigate({ name: "clients" })}
      className="no-drag -ms-1 flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
      data-back
    >
      <ChevronLeftIcon className="size-3.5 rtl:-scale-x-100" />
      {t("clients.title")}
    </button>
  );

  async function toggleArchive() {
    if (!c) return;
    try {
      if (c.archived_at) await api.restoreClient(c.id);
      else await api.archiveClient(c.id);
      toast.success(c.archived_at ? t("clients.restored") : t("clients.archivedDone"));
      void queryClient.invalidateQueries({ queryKey: ["w", ws, "client", c.id] });
      void queryClient.invalidateQueries({ queryKey: ["w", ws, "clients"] });
    } catch (e) {
      toast.error(clientErrorText(e, t));
    }
  }

  if (!caps.read) {
    return (
      <>
        <ViewHeader>{back}</ViewHeader>
        <EmptyState icon={<BriefcaseIcon />} title={t("clients.noPermission")} />
      </>
    );
  }
  if (client.isError) {
    const notFound = client.error instanceof ApiError && client.error.status === 404;
    return (
      <>
        <ViewHeader>{back}</ViewHeader>
        {notFound ? (
          <EmptyState icon={<BriefcaseIcon />} title={t("clients.notFound")} body={t("clients.notFoundBody")} />
        ) : (
          <ErrorState error={new Error(clientErrorText(client.error, t))} onRetry={() => void client.refetch()} />
        )}
      </>
    );
  }
  if (!c) {
    return (
      <>
        <ViewHeader>{back}</ViewHeader>
        <RowsSkeleton rows={5} />
      </>
    );
  }

  const clientProjects = (projects.data ?? []).filter((p) => p.client_id === c.id);
  const cur = c.currency || "USD";
  const facts: [string, ReactNode][] = [
    [t("clients.email"), c.email ? <LtrText>{c.email}</LtrText> : "—"],
    [t("clients.phone"), c.phone ? <LtrText>{c.phone}</LtrText> : "—"],
    [t("clients.company"), c.company ? <span dir="auto">{c.company}</span> : "—"],
    [t("clients.country"), c.country ? <LtrText className="font-mono">{c.country}</LtrText> : "—"],
    [
      t("clients.rate"),
      c.default_rate_minor != null ? (
        <LtrText>
          {money(c.default_rate_minor, c.currency, locale)}/{t("clients.hourShort")}
        </LtrText>
      ) : (
        <LtrText className="font-mono">{c.currency}</LtrText>
      ),
    ],
    [t("clients.created"), date(c.created_at, { day: "numeric", month: "short", year: "numeric" })],
  ];

  return (
    <>
      <ViewHeader
        actions={
          caps.write ? (
            <>
              <HeaderButton icon={<PencilIcon />} label={t("clients.edit")} onClick={() => setEditing(true)} data-action="edit" />
              <HeaderButton
                icon={c.archived_at ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                label={c.archived_at ? t("clients.restore") : t("clients.archive")}
                onClick={() => void toggleArchive()}
                data-action="archive"
              />
            </>
          ) : null
        }
      >
        {back}
        <span className="text-grid-muted">/</span>
        <h1 className="truncate text-[14px] font-medium text-grid-fg" dir="auto">
          {c.name}
        </h1>
        {c.archived_at ? <span className="rounded bg-grid-soft px-1.5 py-0.5 text-[12px] text-grid-muted">{t("clients.archivedBadge")}</span> : null}
      </ViewHeader>

      <div className="min-h-0 flex-1 overflow-y-auto" data-client={c.id}>
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13.5px]">
              {facts.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="mb-0.5 text-[12.5px] text-grid-muted">{label}</dt>
                  <dd className="truncate text-grid-fg">{value}</dd>
                </div>
              ))}
            </dl>
            {c.notes ? (
              <div>
                <p className="mb-1 text-[12.5px] text-grid-muted">{t("clients.notes")}</p>
                <p className="text-[13.5px] whitespace-pre-wrap text-grid-body" dir="auto">
                  {c.notes}
                </p>
              </div>
            ) : null}

            <section>
              <SectionTitle>{t("clients.detail.projects")}</SectionTitle>
              {projects.isError ? (
                <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />
              ) : projects.isPending ? (
                <RowsSkeleton rows={2} />
              ) : !clientProjects.length ? (
                <p className="py-3 text-[13.5px] text-grid-muted">{t("clients.detail.noProjects")}</p>
              ) : (
                <div className="border-t border-line/60">
                  {clientProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => navigate({ name: "project", id: p.id })}
                      className="flex h-9 w-full items-center gap-2.5 border-b border-line/50 px-1 text-start text-[14px] hover:bg-grid-soft/70"
                      data-client-project={p.id}
                    >
                      <ProjectMark name={p.name} color={p.color} id={p.id} size={18} />
                      <span className="min-w-0 flex-1 truncate font-medium text-grid-fg">{p.name}</span>
                      <ProjectStatusChip status={p.status} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="flex min-w-0 flex-col gap-6">
            <section>
              <SectionTitle>{t("clients.detail.time")}</SectionTitle>
              {!caps.reports ? (
                <p className="text-[13.5px] text-grid-muted">{t("clients.detail.timeNoPermission")}</p>
              ) : time.isError ? (
                <p className="text-[13.5px] text-grid-muted">{clientErrorText(time.error, t)}</p>
              ) : !time.data ? (
                <RowsSkeleton rows={2} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label={t("clients.detail.tracked")}>
                    <LtrText className="font-mono">{hmCell(time.data.total.seconds)}</LtrText>
                  </Stat>
                  <Stat label={t("clients.detail.billable")}>
                    <LtrText className="font-mono">{hmCell(time.data.total.billable_rounded_s)}</LtrText>
                  </Stat>
                </div>
              )}
            </section>

            {caps.invoices ? (
              <section>
                <SectionTitle
                  actions={
                    <button type="button" onClick={() => void desktop.openWeb("/invoices")} className="flex items-center gap-1 text-[12.5px] text-grid-action hover:underline">
                      {t("clients.detail.newInvoice")}
                      <ExternalLinkIcon className="size-3" />
                    </button>
                  }
                >
                  {t("clients.detail.invoices")}
                </SectionTitle>
                <Stat label={t("clients.detail.unbilledValue")}>
                  {unbilled.isError ? "—" : <LtrText>{money(unbilled.data?.amount_minor ?? 0, unbilled.data?.currency ?? cur, locale)}</LtrText>}
                </Stat>
                {invoices.isError ? (
                  <p className="py-3 text-[13px] text-grid-muted">{clientErrorText(invoices.error, t)}</p>
                ) : !(invoices.data ?? []).length ? (
                  <p className="py-3 text-[13px] text-grid-muted">{invoices.isPending ? "…" : t("clients.detail.noInvoices")}</p>
                ) : (
                  <div className="mt-3 border-t border-line/60">
                    {(invoices.data ?? []).map((iv) => (
                      <button
                        key={iv.id}
                        type="button"
                        onClick={() => void desktop.openWeb(`/invoices/${encodeURIComponent(iv.number)}`)}
                        title={t("clients.detail.openInvoice")}
                        className="flex h-9 w-full items-center justify-between gap-2 border-b border-line/50 px-1 text-[13.5px] hover:bg-grid-soft/70"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <LtrText className="font-mono">{iv.number}</LtrText>
                          <span className={cn("rounded px-1.5 py-0.5 text-[12px]", STATUS_TONE[iv.status] ?? "bg-grid-soft text-grid-muted")}>
                            {t(`clients.invoiceStatus.${iv.status}`)}
                          </span>
                        </span>
                        <LtrText className="text-grid-body tabular-nums">{money(iv.total_minor, iv.currency, locale)}</LtrText>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </aside>
        </div>
      </div>

      {caps.write ? <ClientFormDialog client={c} open={editing} onOpenChange={setEditing} /> : null}
    </>
  );
}

const STATUS_TONE: Record<string, string> = {
  draft: "bg-grid-soft text-grid-muted",
  sent: "bg-grid-action/15 text-grid-action",
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  overdue: "bg-grid-danger/15 text-grid-danger",
  void: "border border-line text-grid-muted",
};

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line px-3 py-2.5">
      <p className="text-[12.5px] text-grid-muted">{label}</p>
      <p className="mt-0.5 text-[18px] font-medium text-grid-fg tabular-nums">{children}</p>
    </div>
  );
}
