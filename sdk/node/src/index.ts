/** Mahaam Feedback: zero-dependency helpers (Node >= 18, global fetch). */

export const DEFAULT_BASE_URL = "https://console.mahaam.app";

export interface FeedbackConfig {
  /** Mahaam base URL. Env: MAHAAM_URL. */
  baseUrl?: string;
  /** Project public key pfk_... Env: MAHAAM_FEEDBACK_KEY. */
  key?: string;
  /** en | ar */
  locale?: string;
  /** Optional data-endpoint override for the widget. */
  endpoint?: string;
  /** A URL on the key's allowed origins, sent as page_url by server reports. Env: MAHAAM_APP_URL. */
  appUrl?: string;
  enabled?: boolean;
}

export interface ResolvedConfig {
  baseUrl: string;
  key: string;
  locale: string;
  endpoint?: string;
  appUrl?: string;
  enabled: boolean;
}

function env(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  // MAHAAM_* first, then the pre-rebrand MANAGY_* name.
  return p?.env?.[name] || p?.env?.[name.replace(/^MAHAAM_/, "MANAGY_")] || undefined;
}

export function resolveConfig(opts: FeedbackConfig = {}): ResolvedConfig {
  const key = opts.key ?? env("MAHAAM_FEEDBACK_KEY") ?? "";
  return {
    baseUrl: (opts.baseUrl ?? env("MAHAAM_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    key,
    locale: opts.locale ?? "en",
    endpoint: opts.endpoint,
    appUrl: opts.appUrl ?? env("MAHAAM_APP_URL"),
    enabled: (opts.enabled ?? true) && key !== "",
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The widget script tag as an HTML string, or "" when disabled. */
export function scriptTag(opts: FeedbackConfig = {}): string {
  const c = resolveConfig(opts);
  if (!c.enabled) return "";
  let s = `<script src="${escapeHtml(c.baseUrl)}/embed/v1.js" data-key="${escapeHtml(c.key)}" data-locale="${escapeHtml(c.locale)}"`;
  if (c.endpoint) s += ` data-endpoint="${escapeHtml(c.endpoint)}"`;
  return s + " defer></script>";
}

export type IssueType = "bug" | "feature" | "task";
export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

export interface ReportOptions extends FeedbackConfig {
  title: string;
  body?: string;
  type?: IssueType;
  priority?: Priority;
  pageUrl?: string;
  /** Any other intake field: route, selector, user_agent, viewport, console_log, network_log. */
  extra?: Record<string, string>;
  fetch?: typeof fetch;
}

export class MahaamFeedbackError extends Error {
  constructor(public status: number, message: string) {
    super(`mahaam feedback: ${status} ${message}`);
    this.name = "MahaamFeedbackError";
  }
}

/** Pre-rebrand name, kept so existing `instanceof` checks keep working. */
export const ManagyFeedbackError = MahaamFeedbackError;

/** POSTs to the public intake. Resolves to the issue key (e.g. "MG-12"), or null when disabled. */
export async function report(opts: ReportOptions): Promise<string | null> {
  const c = resolveConfig(opts);
  if (!c.enabled) return null;
  if (!opts.title?.trim()) throw new Error("mahaam feedback: title is required");
  const form = new FormData();
  const fields: Record<string, string | undefined> = {
    ...(opts.extra ?? {}),
    public_key: c.key,
    title: Array.from(opts.title).slice(0, 200).join(""),
    body: opts.body,
    issue_type: opts.type,
    priority: opts.priority,
    page_url: opts.pageUrl ?? c.appUrl,
  };
  for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
  const res = await (opts.fetch ?? fetch)(`${c.baseUrl}/api/feedback/embed`, {
    method: "POST",
    body: form,
    headers: { Accept: "application/json" },
  });
  const text = await res.text();
  let data: { key?: string; error?: string } = {};
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) throw new MahaamFeedbackError(res.status, data.error ?? text.trim());
  return data.key ?? null;
}

/** Reports an Error as a bug. Never throws; resolves to the key or null. */
export async function reportException(err: unknown, opts: FeedbackConfig & { extra?: Record<string, string> } = {}): Promise<string | null> {
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    return await report({ ...opts, title: `${e.name}: ${e.message}`, body: e.stack ?? e.message, type: "bug", priority: "high" });
  } catch {
    return null;
  }
}

/** Installs process-level handlers that report uncaught exceptions / unhandled rejections. */
export function installExceptionHook(opts: FeedbackConfig = {}): () => void {
  const p = (globalThis as { process?: NodeJS.Process }).process;
  if (!p) return () => {};
  const onErr = (e: unknown) => void reportException(e, opts);
  p.on("unhandledRejection", onErr);
  p.on("uncaughtExceptionMonitor", onErr);
  return () => {
    p.off("unhandledRejection", onErr);
    p.off("uncaughtExceptionMonitor", onErr);
  };
}

/** Structural Express-style types, so express is not a dependency. */
interface Res {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string | number): unknown;
  removeHeader(name: string): unknown;
  send?: (body?: unknown) => unknown;
  end: (...args: any[]) => unknown;
  write: (...args: any[]) => unknown;
}

function isHtml(res: Res): boolean {
  const ct = String(res.getHeader("content-type") ?? "").toLowerCase();
  return ct.startsWith("text/html") && !res.getHeader("content-encoding");
}

function inject(html: string, tag: string): string {
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i < 0 ? html : html.slice(0, i) + tag + html.slice(i);
}

/**
 * Express/Connect middleware that injects the widget before </body> of HTML
 * responses sent via res.send() or res.end(). Streamed res.write() bodies are left alone.
 */
export function expressMiddleware(opts: FeedbackConfig = {}) {
  const tag = scriptTag(opts);
  return function mahaamFeedback(_req: unknown, res: Res, next: (err?: unknown) => void) {
    if (!tag) return next();
    let wrote = false;
    const origWrite = res.write;
    res.write = function (this: unknown, ...args: any[]) {
      wrote = true;
      return origWrite.apply(this, args);
    };
    const origEnd = res.end;
    res.end = function (this: unknown, chunk?: any, ...rest: any[]) {
      if (!wrote && chunk != null && typeof chunk !== "function" && isHtml(res)) {
        const str = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : null;
        if (str !== null) {
          const out = inject(str, tag);
          if (res.getHeader("content-length") != null) res.setHeader("content-length", Buffer.byteLength(out));
          const enc = rest.length && typeof rest[0] === "string" ? rest.slice(1) : rest;
          return origEnd.call(this, out, "utf8", ...enc);
        }
      }
      return origEnd.call(this, chunk, ...rest);
    };
    next();
  };
}
