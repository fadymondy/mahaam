/**
 * Mahaam error monitoring: Sentry-shaped, a DSN rather than the feedback widget's pfk_ key, and
 * it reports to the project's board as an issue rather than the "report a problem" intake. Get a
 * DSN from a project's Settings → Monitoring in Mahaam. Zero-dependency (Node >= 18, global
 * fetch), separate from index.ts's feedback widget helpers — a project has its own key for each.
 */

export interface MonitorConfig {
  /** https://<public_key>@host/monitor/<project_id>. Env: MAHAAM_DSN. */
  dsn?: string;
  environment?: string;
  release?: string;
  serverName?: string;
  enabled?: boolean;
  fetch?: typeof fetch;
}

interface ParsedDSN {
  ingestUrl: string;
  publicKey: string;
}

function env(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return p?.env?.[name] || undefined;
}

function parseDSN(dsn: string): ParsedDSN | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const project = u.pathname.replace(/^\/?(monitor\/)?/, "").replace(/\/+$/, "");
    if (!publicKey || !project) return null;
    return { publicKey, ingestUrl: `${u.protocol}//${u.host}/api/monitor/${project}/envelope` };
  } catch {
    return null;
  }
}

export type Level = "fatal" | "error" | "warning" | "info" | "debug";

export interface MonitorEvent {
  level?: Level;
  message?: string;
  type?: string;
  value?: string;
  stacktrace?: string;
  /** Override automatic grouping; leave unset in the normal case. */
  fingerprint?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/** A DSN-configured client. Inert (every method a safe no-op) with no DSN — construct it
 * unconditionally and just leave MAHAAM_DSN unset in development. */
export class Monitor {
  private parsed: ParsedDSN | null;
  private cfg: MonitorConfig;

  constructor(opts: MonitorConfig = {}) {
    this.cfg = opts;
    const dsn = opts.dsn ?? env("MAHAAM_DSN") ?? "";
    this.parsed = dsn ? parseDSN(dsn) : null;
  }

  get enabled(): boolean {
    return (this.cfg.enabled ?? true) && this.parsed !== null;
  }

  /** Sends one event. Never throws — logs to stderr and resolves, so a monitoring hiccup is
   * never the reason a request fails. */
  async capture(ev: MonitorEvent): Promise<void> {
    if (!this.enabled || !this.parsed) return;
    try {
      const res = await (this.cfg.fetch ?? fetch)(this.parsed.ingestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_key: this.parsed.publicKey,
          level: ev.level ?? "error",
          message: ev.message,
          exception_type: ev.type,
          exception_value: ev.value,
          stacktrace: ev.stacktrace,
          environment: this.cfg.environment,
          release: this.cfg.release,
          server_name: this.cfg.serverName,
          fingerprint: ev.fingerprint,
          tags: ev.tags,
          extra: ev.extra,
        }),
      });
      if (!res.ok) {
        console.error(`mahaam monitor: ${res.status} ${await res.text().catch(() => "")}`);
      }
    } catch (err) {
      console.error("mahaam monitor: send failed", err);
    }
  }

  /** Reports a caught error/exception. */
  captureException(err: unknown, extra?: Record<string, unknown>): Promise<void> {
    const e = err instanceof Error ? err : new Error(String(err));
    return this.capture({ type: e.name, value: e.message, stacktrace: e.stack, extra });
  }
}

/** Installs process-level handlers that report uncaught exceptions / unhandled rejections —
 * they do NOT crash the process themselves; Node's own default behaviour after them is unchanged. */
export function installMonitorHook(monitor: Monitor): () => void {
  const p = (globalThis as { process?: NodeJS.Process }).process;
  if (!p) return () => {};
  const onErr = (e: unknown) => void monitor.captureException(e);
  p.on("uncaughtExceptionMonitor", onErr);
  p.on("unhandledRejection", onErr);
  return () => {
    p.off("uncaughtExceptionMonitor", onErr);
    p.off("unhandledRejection", onErr);
  };
}

/** Structural Express-style types, so express is not a dependency. */
interface ExpressLikeReq {
  method?: string;
  originalUrl?: string;
  url?: string;
}
interface ExpressLikeRes {
  statusCode?: number;
}

/**
 * Express/Connect error-handling middleware: mount it LAST, after your routes (Express calls a
 * 4-argument middleware only when `next(err)` was called or a route threw). Reports, then calls
 * `next(err)` so your own error page/handler still runs — this never swallows the error.
 */
export function expressErrorHandler(monitor: Monitor) {
  return function mahaamMonitor(err: unknown, req: ExpressLikeReq, res: ExpressLikeRes, next: (err: unknown) => void) {
    void monitor.captureException(err, {
      route: req.originalUrl ?? req.url,
      method: req.method,
      status: res.statusCode,
    });
    next(err);
  };
}
