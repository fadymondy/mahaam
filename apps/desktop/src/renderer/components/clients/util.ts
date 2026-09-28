// Shared bits of the clients screens: role gating, money and error text.
import { ApiError } from "@/lib/bridge";

const RANK: Record<string, number> = { client: 0, member: 1, manager: 2, admin: 3, owner: 4 };

/** internal/authz/can.go: clients:read member+, clients:write / invoices:read manager+, reports:read member+. */
export function clientCaps(role: string | undefined) {
  const r = RANK[role ?? "client"] ?? 0;
  return { read: r >= 1, write: r >= 2, invoices: r >= 2, reports: r >= 1 };
}

export function money(minor: number, currency: string, locale: string): string {
  const tag = locale === "ar" ? "ar-EG" : "en-GB";
  try {
    return new Intl.NumberFormat(tag, { style: "currency", currency: currency || "USD" }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** A clear message for a failed write: a plan limit, a missing permission, else the server's words. */
export function clientErrorText(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError) {
    const code = (err.body as { code?: string } | undefined)?.code;
    if (err.status === 402 || code === "plan_limit") return `${t("clients.planLimit")}${err.message ? ` (${err.message})` : ""}`;
    if (err.status === 403) return t("clients.forbidden");
    return err.message || t("common.error");
  }
  return err instanceof Error && err.message ? err.message : t("common.error");
}

export const hmCell = (sec: number) => {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
