// New / edit client: the same fields and body as the web's ClientForm.
import { useMutation } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { Client, ClientInput } from "../../../main/api-clients";
import { fieldClass } from "@/components/time/TimeField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/lib/app";
import { api } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { queryClient } from "@/lib/query";
import { cn } from "@/lib/utils";

import { clientErrorText } from "./util";

export function ClientFormDialog({ client, open, onOpenChange }: { client?: Client | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[520px]" data-client-form>
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-[14px]">{client ? t("clients.edit") : t("clients.new")}</DialogTitle>
          <DialogDescription className="text-[13px]">{t("clients.formHint")}</DialogDescription>
        </DialogHeader>
        {open ? <Form key={client?.id ?? "new"} client={client ?? undefined} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({ client, onDone }: { client?: Client; onDone: () => void }) {
  const { t } = useI18n();
  const { ws, workspace } = useApp();
  const [v, setV] = useState({
    name: client?.name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    company: client?.company ?? "",
    country: client?.country ?? "",
    currency: client?.currency ?? "",
    rate: client?.default_rate_minor != null ? String(client.default_rate_minor / 100) : "",
    notes: client?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));

  const save = useMutation({
    mutationFn: (body: ClientInput) => (client ? api.updateClient(client.id, body) : api.createClient(body)),
    onSuccess: () => {
      toast.success(t("clients.saved"));
      void queryClient.invalidateQueries({ queryKey: ["w", ws, "clients"] });
      if (client) void queryClient.invalidateQueries({ queryKey: ["w", ws, "client", client.id] });
      onDone();
    },
    onError: (e) => setError(clientErrorText(e, t)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const rate = v.rate.trim() === "" ? -1 : Math.round(Number(v.rate) * 100);
    if (Number.isNaN(rate)) {
      setError(t("clients.rateInvalid"));
      return;
    }
    const body: ClientInput = {
      name: v.name,
      email: v.email,
      phone: v.phone,
      company: v.company,
      country: v.country.toUpperCase(),
      notes: v.notes,
      default_rate_minor: rate,
    };
    if (v.currency.trim()) body.currency = v.currency.trim().toUpperCase();
    setError(null);
    save.mutate(body);
  }

  const wsCurrency = (workspace as { currency?: string } | null)?.currency ?? "USD";
  const field = (k: keyof typeof v, label: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}, span = false) => (
    <label className={cn("flex flex-col gap-1", span && "col-span-2")}>
      <span className="text-[12.5px] text-grid-muted">{label}</span>
      <input dir="auto" value={v[k]} onChange={(e) => set(k, e.target.value)} className={cn(fieldClass, "w-full")} data-client-field={k} {...extra} />
    </label>
  );

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid grid-cols-2 gap-3 px-4 pt-2 pb-4">
        {field("name", t("clients.name"), { autoFocus: true }, true)}
        {field("email", t("clients.email"), { type: "email", dir: "ltr" })}
        {field("phone", t("clients.phone"), { dir: "ltr" })}
        {field("company", t("clients.company"), {}, true)}
        {field("country", t("clients.country"), { dir: "ltr", maxLength: 2, placeholder: "EG", className: cn(fieldClass, "w-full uppercase") })}
        {field("currency", t("clients.currency"), { dir: "ltr", maxLength: 3, placeholder: wsCurrency, className: cn(fieldClass, "w-full uppercase") })}
        {field("rate", t("clients.rateLabel"), { dir: "ltr", inputMode: "decimal", placeholder: "0.00" }, true)}
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[12.5px] text-grid-muted">{t("clients.notes")}</span>
          <textarea dir="auto" rows={3} value={v.notes} onChange={(e) => set("notes", e.target.value)} className={cn(fieldClass, "h-auto w-full py-1.5")} data-client-field="notes" />
        </label>
        {error ? (
          <div role="alert" className="col-span-2 flex items-start gap-2 rounded-md border border-grid-danger/40 bg-grid-danger/8 px-2.5 py-2 text-[13.5px] text-grid-fg">
            <AlertCircleIcon className="mt-px size-3.5 shrink-0 text-grid-danger" />
            <span className="min-w-0 flex-1">{error}</span>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending || !v.name.trim()} data-client-save>
          {save.isPending ? t("clients.working") : t("clients.save")}
        </Button>
      </div>
    </form>
  );
}
