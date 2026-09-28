// The project's Billing tab (renderer/views/Project.tsx renders it under the project header): its AI
// usage (pushed by agents over MCP record_ai_usage) by day and by model, the markup it is invoiced
// at, and its subscriptions (infrastructure, AI, marketing tools…). Drafting an invoice bills
// unbilled AI usage and due subscription periods next to time. Manager+; AI usage is plan-gated.
// Mirrors web/app/[locale]/w/[slug]/projects/[id]/billing.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon, ReceiptIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { AIUsageRow, Subscription, SubscriptionInput } from "../../../main/api-projectMoney";
import { EmptyState, LtrText } from "@/components/kit";
import { Badge, Group, SmallButton } from "@/components/settings/parts";
import { Confirm, Field, Gate, NoAccess, errText, inputCls, isManager } from "@/components/projectMoney/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

const CATEGORIES = ["infrastructure", "ai", "marketing", "software", "domain", "support", "other"] as const;
const INTERVALS = ["month", "quarter", "year", "one_time"] as const;

function useMoney() {
  const { number } = useI18n();
  return (minor: number, currency: string) => {
    try {
      return number(minor / 100, { style: "currency", currency: currency || "USD" });
    } catch {
      return `${number(minor / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
    }
  };
}

function useTokens() {
  const { number } = useI18n();
  return (n: number) => number(n, { notation: "compact", maximumFractionDigits: n >= 1e6 ? 2 : 1 });
}

export function ProjectBilling({ projectId }: { projectId: string }) {
  const { workspace } = useApp();
  if (!isManager(workspace?.role)) return <NoAccess />;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-5">
        <AIUsage projectId={projectId} />
        <Subscriptions projectId={projectId} />
      </div>
    </div>
  );
}

function AIUsage({ projectId }: { projectId: string }) {
  const { t, date } = useI18n();
  const ws = useApp().ws;
  const qc = useQueryClient();
  const money = useMoney();
  const tokens = useTokens();
  const byModel = useQuery({ queryKey: ["w", ws, "ai-usage", projectId, "model"], queryFn: () => api.aiUsage(projectId, "model"), enabled: !!ws });
  const byDay = useQuery({ queryKey: ["w", ws, "ai-usage", projectId, "day"], queryFn: () => api.aiUsage(projectId, "day"), enabled: !!ws });
  const markupQ = useQuery({ queryKey: ["w", ws, "ai-markup", projectId], queryFn: () => api.aiMarkup(projectId), enabled: !!ws });
  const [markup, setMarkup] = useState<string | null>(null);
  const markupValue = markup ?? (markupQ.data ? String(markupQ.data.ai_markup_bp / 100) : "");

  const save = useMutation({
    mutationFn: (percent: string) => api.setAiMarkup(projectId, percent),
    onSuccess: (out) => {
      qc.setQueryData(["w", ws, "ai-markup", projectId], out);
      setMarkup(null);
      toast.success(t("projectMoney.billing.markupSaved"));
      void qc.invalidateQueries({ queryKey: ["w", ws, "ai-usage", projectId] });
    },
    onError: (err) => toast.error(errText(err, t("projectMoney.failed"))),
  });

  const days = (byDay.data ?? []).slice(-30);
  const maxCost = Math.max(1, ...days.map((d) => d.cost_minor));
  const totals = (rows: AIUsageRow[]) => {
    const cur = rows[0]?.currency ?? "USD";
    return {
      cur,
      cost: rows.reduce((s, r) => s + r.cost_minor, 0),
      billed: rows.reduce((s, r) => s + r.billed_minor, 0),
      unbilled: rows.reduce((s, r) => s + r.unbilled_cost_minor, 0),
      mixed: rows.some((r) => r.currency !== cur),
    };
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-grid-fg">
            <SparklesIcon className="size-4 text-grid-muted" aria-hidden /> {t("projectMoney.billing.aiTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-grid-muted">{t("projectMoney.billing.aiHint")}</p>
        </div>
        {!markupQ.error ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (markup !== null && markup.trim()) save.mutate(markup.trim());
            }}
          >
            <Field label={t("projectMoney.billing.markup")} htmlFor="ai-markup">
              <input id="ai-markup" dir="ltr" inputMode="decimal" className={`${inputCls} w-24`} placeholder="0" value={markupValue} onChange={(e) => setMarkup(e.target.value)} />
            </Field>
            <SmallButton type="submit" className="mb-0.5" disabled={markup === null || !markup.trim() || save.isPending}>
              {t("projectMoney.billing.saveMarkup")}
            </SmallButton>
          </form>
        ) : null}
      </div>
      <Gate
        q={byModel}
        rows={3}
        render={(rows) => {
          if (rows.length === 0) return <EmptyState icon={<SparklesIcon />} title={t("projectMoney.billing.noUsage")} body={t("projectMoney.billing.noUsageBody")} />;
          const sum = totals(rows);
          return (
            <div className="flex flex-col gap-3">
              {!sum.mixed ? (
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["cost", sum.cost],
                      ["billed", sum.billed],
                      ["unbilled", sum.unbilled],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-line px-3 py-2">
                      <div className="text-[12px] text-grid-muted">{t(`projectMoney.billing.${k}`)}</div>
                      <div className="text-[16px] font-semibold text-grid-fg tabular-nums">{money(v, sum.cur)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {days.length > 1 ? (
                <div>
                  <div className="mb-1 text-[12px] font-medium text-grid-muted">{t("projectMoney.billing.dailyCost")}</div>
                  <div className="flex h-24 items-end gap-[3px] border-b border-line" role="img" aria-label={t("projectMoney.billing.dailyCost")}>
                    {days.map((d) => (
                      <div
                        key={d.key + d.currency}
                        title={`${date(d.key, { day: "numeric", month: "short" })}: ${money(d.cost_minor, d.currency)}`}
                        className="min-w-1 flex-1 rounded-t-[2px] bg-grid-action/70 hover:bg-grid-action"
                        style={{ height: `${Math.max(4, (d.cost_minor / maxCost) * 100)}%` }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-[13.5px]">
                  <thead className="bg-grid-soft/60 text-[12px] text-grid-muted">
                    <tr>
                      <th className="px-3 py-1.5 text-start font-medium">{t("projectMoney.billing.model")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("projectMoney.billing.requests")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("projectMoney.billing.input")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("projectMoney.billing.output")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("projectMoney.billing.cache")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("projectMoney.billing.cost")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("projectMoney.billing.billed")}</th>
                      <th className="px-3 py-1.5 text-end font-medium">{t("projectMoney.billing.unbilled")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.key + r.currency} className="hover:bg-grid-soft">
                        <td className="px-3 py-1.5">
                          <LtrText className="font-mono text-[12.5px]">{r.key}</LtrText>
                        </td>
                        <td className="px-3 py-1.5 text-end tabular-nums">{tokens(r.requests)}</td>
                        <td className="px-3 py-1.5 text-end tabular-nums">{tokens(r.input_tokens)}</td>
                        <td className="px-3 py-1.5 text-end tabular-nums">{tokens(r.output_tokens)}</td>
                        <td className="px-3 py-1.5 text-end tabular-nums">{tokens(r.cache_tokens)}</td>
                        <td className="px-3 py-1.5 text-end tabular-nums">{money(r.cost_minor, r.currency)}</td>
                        <td className="px-3 py-1.5 text-end tabular-nums">{money(r.billed_minor, r.currency)}</td>
                        <td className="px-3 py-1.5 text-end tabular-nums">{money(r.unbilled_cost_minor, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }}
      />
    </section>
  );
}

type Editing = Partial<Subscription> & { price?: string; cost?: string };

function Subscriptions({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const ws = useApp().ws;
  const qc = useQueryClient();
  const money = useMoney();
  const key = ["w", ws, "subscriptions", projectId];
  const subs = useQuery({ queryKey: key, queryFn: () => api.subscriptions(projectId), enabled: !!ws });
  const [editing, setEditing] = useState<Editing | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-grid-fg">
            <ReceiptIcon className="size-4 text-grid-muted" aria-hidden /> {t("projectMoney.billing.subsTitle")}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-grid-muted">{t("projectMoney.billing.subsHint")}</p>
        </div>
        {!subs.error ? (
          <SmallButton tone="primary" onClick={() => setEditing({ category: "infrastructure", interval: "month", billable: true, active: true, currency: "USD" })}>
            <PlusIcon /> {t("projectMoney.billing.addSub")}
          </SmallButton>
        ) : null}
      </div>
      <Gate
        q={subs}
        rows={2}
        render={(list) =>
          list.length === 0 ? (
            <EmptyState icon={<ReceiptIcon />} title={t("projectMoney.billing.noSubs")} />
          ) : (
            <Group>
              {list.map((x, i) => (
                <div key={x.id} className={`group flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2.5 text-[13.5px] ${i ? "border-t border-line" : ""}`}>
                  <span className="font-medium text-grid-fg" dir="auto">
                    {x.name}
                  </span>
                  <Badge>{t(`projectMoney.billing.cat.${x.category}`)}</Badge>
                  {x.vendor ? (
                    <span className="text-grid-muted" dir="auto">
                      {x.vendor}
                    </span>
                  ) : null}
                  {!x.active ? <Badge tone="warn">{t("projectMoney.billing.inactive")}</Badge> : null}
                  {!x.billable ? <Badge>{t("projectMoney.billing.notBillable")}</Badge> : null}
                  <span className="ms-auto tabular-nums text-grid-fg">
                    {money(x.price_minor, x.currency)} / {t(`projectMoney.billing.int.${x.interval}`)}
                    <span className="ms-2 text-[12.5px] text-grid-muted">{t("projectMoney.billing.costIs", { cost: money(x.cost_minor, x.currency) })}</span>
                  </span>
                  <SmallButton
                    aria-label={t("projectMoney.edit")}
                    title={t("projectMoney.edit")}
                    onClick={() => setEditing({ ...x, price: (x.price_minor / 100).toFixed(2), cost: (x.cost_minor / 100).toFixed(2) })}
                  >
                    <PencilIcon />
                  </SmallButton>
                  <span className="w-full text-[12.5px] text-grid-muted">
                    {x.next_period ? t("projectMoney.billing.nextPeriod", { date: x.next_period }) : t("projectMoney.billing.fullyBilled")}
                    {x.billed_until ? ` · ${t("projectMoney.billing.billedUntil", { date: x.billed_until })}` : ""}
                  </span>
                </div>
              ))}
            </Group>
          )
        }
      />
      <SubDialog projectId={projectId} value={editing} onClose={() => setEditing(null)} onSaved={() => void qc.invalidateQueries({ queryKey: key })} />
    </section>
  );
}

function SubDialog({ projectId, value, onClose, onSaved }: { projectId: string; value: Editing | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billable, setBillable] = useState(true);
  const [active, setActive] = useState(true);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setError(null);
    setBillable(value?.billable ?? true);
    setActive(value?.active ?? true);
  }, [value]);
  if (!value) return null;
  const v = value;

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(done);
      onSaved();
      onClose();
    } catch (err) {
      setError(errText(err, t("projectMoney.failed")));
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const body: SubscriptionInput = {
      name: s("name"),
      category: s("category"),
      vendor: s("vendor"),
      price: s("price") || "0",
      cost: s("cost") || "0",
      currency: (s("currency") || "USD").toUpperCase(),
      interval: s("interval"),
      starts_on: s("starts_on") || undefined,
      ends_on: s("ends_on"),
      billable,
      active,
    };
    void run(() => (v.id ? api.updateSubscription(v.id, body) : api.createSubscription(projectId, body)), t("projectMoney.saved"));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{v.id ? t("projectMoney.billing.editSub") : t("projectMoney.billing.addSub")}</DialogTitle>
            <DialogDescription>{t("projectMoney.billing.subDialogHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field label={t("projectMoney.billing.name")} htmlFor="s-name">
              <input id="s-name" name="name" dir="auto" required maxLength={200} autoFocus className={inputCls} defaultValue={v.name ?? ""} placeholder="Hetzner server" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("projectMoney.billing.category")} htmlFor="s-cat">
                <select id="s-cat" name="category" className={inputCls} defaultValue={v.category}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`projectMoney.billing.cat.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("projectMoney.billing.vendor")} htmlFor="s-vendor">
                <input id="s-vendor" name="vendor" dir="auto" maxLength={200} className={inputCls} defaultValue={v.vendor ?? ""} />
              </Field>
              <Field label={t("projectMoney.billing.price")} htmlFor="s-price">
                <input id="s-price" name="price" dir="ltr" inputMode="decimal" required className={inputCls} defaultValue={v.price ?? ""} placeholder="49.00" />
              </Field>
              <Field label={t("projectMoney.billing.ourCost")} htmlFor="s-cost">
                <input id="s-cost" name="cost" dir="ltr" inputMode="decimal" className={inputCls} defaultValue={v.cost ?? ""} placeholder="30.00" />
              </Field>
              <Field label={t("projectMoney.billing.currency")} htmlFor="s-cur">
                <input id="s-cur" name="currency" dir="ltr" maxLength={3} className={`${inputCls} uppercase`} defaultValue={v.currency ?? "USD"} />
              </Field>
              <Field label={t("projectMoney.billing.interval")} htmlFor="s-int">
                <select id="s-int" name="interval" className={inputCls} defaultValue={v.interval}>
                  {INTERVALS.map((c) => (
                    <option key={c} value={c}>
                      {t(`projectMoney.billing.int.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("projectMoney.billing.starts")} htmlFor="s-start">
                <input id="s-start" name="starts_on" type="date" dir="ltr" className={inputCls} defaultValue={v.starts_on ?? ""} />
              </Field>
              <Field label={t("projectMoney.billing.ends")} htmlFor="s-end">
                <input id="s-end" name="ends_on" type="date" dir="ltr" className={inputCls} defaultValue={v.ends_on ?? ""} />
              </Field>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-[13.5px] text-grid-fg">
                <Switch checked={billable} onCheckedChange={setBillable} /> {t("projectMoney.billing.billable")}
              </label>
              <label className="flex items-center gap-2 text-[13.5px] text-grid-fg">
                <Switch checked={active} onCheckedChange={setActive} /> {t("projectMoney.billing.active")}
              </label>
            </div>
            {error ? (
              <p className="text-[13px] text-grid-danger" role="alert" dir="auto">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-between">
            {v.id ? (
              <SmallButton tone="danger" disabled={busy} onClick={() => setConfirm(true)}>
                <Trash2Icon /> {t("projectMoney.delete")}
              </SmallButton>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <SmallButton onClick={onClose}>{t("projectMoney.cancel")}</SmallButton>
              <SmallButton type="submit" tone="primary" disabled={busy}>
                {t("projectMoney.save")}
              </SmallButton>
            </div>
          </DialogFooter>
        </form>
        <Confirm
          open={confirm}
          onOpenChange={setConfirm}
          title={t("projectMoney.billing.deleteTitle")}
          body={t("projectMoney.billing.deleteBody")}
          label={t("projectMoney.delete")}
          onConfirm={() => void run(() => api.deleteSubscription(v.id!), t("projectMoney.billing.deleted"))}
        />
      </DialogContent>
    </Dialog>
  );
}
