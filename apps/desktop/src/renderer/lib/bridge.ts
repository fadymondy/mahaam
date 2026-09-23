// The renderer's side of preload.ts. Every call goes to the main process, which owns the session,
// the network and the OS; errors come back as data and are rebuilt here as ApiError.
import type { Api } from "../../main/api";
import type { AppConfig, Command, LiveEvent, Prefs, SessionOut, SignInResult, TimeEntry } from "../../shared/types";

interface Bridge {
  platform: NodeJS.Platform;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, cb: (...args: unknown[]) => void): () => void;
}

declare global {
  interface Window {
    mahaam: Bridge;
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope = { ok: true; value: unknown } | { ok: false; status: number; message: string; body?: unknown };

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const out = (await window.mahaam.invoke(channel, ...args)) as Envelope;
  if (!out.ok) throw new ApiError(out.status, out.message, out.body);
  return out.value as T;
}

type Promisified<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

/** The API, as the main process exposes it: `await api.task("MH-12")`. */
export const api = new Proxy({} as Promisified<Api>, {
  get: (_t, method: string) => (...args: unknown[]) => call("api", method, args),
});

export const desktop = {
  platform: () => window.mahaam.platform,
  config: () => call<AppConfig>("app:config"),
  setPrefs: (patch: Partial<Prefs>) => call<Prefs>("app:prefs", patch),
  openExternal: (url: string) => call<void>("app:openExternal", url),
  openWeb: (path?: string) => call<void>("app:openWeb", path),
  autoLaunch: { get: () => call<boolean>("app:autoLaunch:get"), set: (on: boolean) => call<void>("app:autoLaunch:set", on) },
  pendingRoute: () => call<import("../../shared/types").Route | null>("app:pendingRoute"),
  session: () => call<SessionOut | null>("session:get"),
  signIn: (apiUrl: string, email: string, password: string, second?: { code?: string; recovery_code?: string }) =>
    call<SignInResult>("session:signIn", apiUrl, email, password, second),
  signInWithBrowser: (apiUrl: string) => call<SignInResult | null>("session:signInBrowser", apiUrl),
  cancelBrowserSignIn: () => call<void>("session:cancelBrowser"),
  signOut: () => call<void>("session:signOut"),
  selectWorkspace: (id: string) => call<SessionOut>("session:selectWorkspace", id),
  running: () => call<TimeEntry | null>("timer:running"),
  update: {
    state: () => call<import("../../main/updates").UpdateState>("update:state"),
    check: () => call<void>("update:check"),
    install: () => call<void>("update:install"),
  },
  /** Hide the window this renderer is in (the popover, the palette). */
  hideSurface: () => call<null>("surface:hide"),
  openSettings: (section?: string) => call<void>("surface:settings", section),
  openPalette: () => call<void>("surface:palette"),
  /** Bring the main window forward, optionally at a route. */
  openMain: (to?: import("../../shared/types").Route) => call<void>("surface:main", to),
  /** A command for the main window (e.g. open quick create there). */
  mainCommand: (c: import("../../shared/types").Command) => call<void>("surface:command", c),
  liveStatus: () => call<"open" | "reconnecting" | "closed">("live:status"),
};

type Events = {
  session: [SessionOut | null, "signed-in" | "signed-out" | "workspace" | "expired"];
  live: [LiveEvent];
  "live:status": ["open" | "reconnecting" | "closed"];
  running: [TimeEntry | null];
  unread: [number];
  prefs: [Prefs];
  command: [Command];
  window: [{ fullscreen: boolean }];
  "surface:shown": [];
  update: [import("../../main/updates").UpdateState];
};

export function on<K extends keyof Events>(event: K, cb: (...args: Events[K]) => void): () => void {
  return window.mahaam.on(event, (...args) => cb(...(args as Events[K])));
}
