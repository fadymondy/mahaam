import type { LiveEvent, TimeEntry, Workspace } from "@mahaam/client";
import type { LiveStatus, PanelApi, PanelHost, Session } from "@mahaam/client/ui";

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, cb: (...args: unknown[]) => void): () => void;
}
declare global {
  interface Window {
    mahaam: Bridge;
  }
}

export interface TrayConfig {
  defaultApiUrl: string;
  canRemember: boolean;
  shortcut: string;
  autoLaunch: boolean;
  platform: string;
}

/** IPC errors arrive as "Error invoking remote method 'x': Error: 401:msg" — restore message + status. */
class BridgeError extends Error {
  status?: number;
}
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await window.mahaam.invoke(channel, ...args)) as T;
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const msg = raw.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "");
    const err = new BridgeError(msg.replace(/^401:/, ""));
    if (msg.startsWith("401:")) err.status = 401;
    throw err;
  }
}

export async function trayHost(): Promise<PanelHost> {
  const cfg = await call<TrayConfig>("mgy:config");
  const api = new Proxy({} as PanelApi, {
    get: (_t, method: string) => (...args: unknown[]) => call("mgy:api", method, args),
  });
  return {
    platform: "tray",
    defaultApiUrl: cfg.defaultApiUrl,
    canRemember: cfg.canRemember,
    shortcut: cfg.shortcut,
    session: () => call<Session | null>("mgy:session"),
    signIn: (apiUrl, email, password, remember) => call<Session>("mgy:signIn", apiUrl, email, password, remember),
    signOut: () => call("mgy:signOut"),
    selectWorkspace: (ws: Workspace) => call("mgy:selectWorkspace", ws),
    api,
    subscribe(onEvent: (e: LiveEvent) => void, onStatus: (s: LiveStatus) => void, onAuth: () => void) {
      const offs = [
        window.mahaam.on("mgy:live", (e) => onEvent(e as LiveEvent)),
        window.mahaam.on("mgy:live-status", (s) => onStatus(s as LiveStatus)),
        window.mahaam.on("mgy:auth-lost", () => onAuth()),
      ];
      // The main process holds the stream all the time; report it as open once subscribed.
      onStatus("open");
      return () => offs.forEach((off) => off());
    },
    openUrl: (url) => void call("mgy:openUrl", url),
    timerChanged: (r: TimeEntry | null) => void call("mgy:timerChanged", r),
    ...(cfg.autoLaunch
      ? {
          autoLaunch: {
            get: () => call<boolean>("mgy:autoLaunch:get"),
            set: (on: boolean) => call<void>("mgy:autoLaunch:set", on),
          },
        }
      : {}),
    quit: () => void call("mgy:quit"),
  };
}
