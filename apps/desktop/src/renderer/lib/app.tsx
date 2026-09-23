// The app's own state: config, session, preferences, the running timer, unread count and the live
// connection — all owned by the main process and mirrored here from its events.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { AppConfig, Prefs, SessionOut, TimeEntry, Workspace } from "../../shared/types";
import { desktop, on } from "./bridge";
import { invalidateFor, queryClient } from "./query";

type LiveStatus = "open" | "reconnecting" | "closed";

interface AppState {
  config: AppConfig;
  session: SessionOut | null;
  /** The workspace in use. Only null while signed out. */
  workspace: Workspace | null;
  ws: string;
  prefs: Prefs;
  running: TimeEntry | null;
  unread: number;
  live: LiveStatus;
  fullscreen: boolean;
  /** Why the session ended, to explain it on the sign-in screen. */
  ended: "expired" | null;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  setSession: (s: SessionOut | null) => void;
  selectWorkspace: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [session, setSession] = useState<SessionOut | null>(null);
  const [prefs, setPrefsState] = useState<Prefs | null>(null);
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [unread, setUnread] = useState(0);
  const [live, setLive] = useState<LiveStatus>("closed");
  const [fullscreen, setFullscreen] = useState(false);
  const [ended, setEnded] = useState<"expired" | null>(null);

  useEffect(() => {
    void Promise.all([desktop.config(), desktop.session(), desktop.running(), desktop.liveStatus()]).then(([c, s, r, l]) => {
      setConfig(c);
      setPrefsState(c.prefs);
      setSession(s);
      setRunning(r);
      setLive(l);
    });
    const offs = [
      on("session", (s, reason) => {
        setSession(s);
        if (reason === "expired") setEnded("expired");
        if (reason === "signed-in") setEnded(null);
        queryClient.clear();
      }),
      on("prefs", setPrefsState),
      on("running", setRunning),
      on("unread", setUnread),
      on("live:status", setLive),
      on("window", (w) => setFullscreen(w.fullscreen)),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const ws = session?.workspace?.id ?? "";
  useEffect(() => {
    if (!ws) return;
    return on("live", (e) => invalidateFor(ws, e));
  }, [ws]);

  const setPrefs = useCallback(async (patch: Partial<Prefs>) => {
    setPrefsState((p) => (p ? { ...p, ...patch } : p));
    setPrefsState(await desktop.setPrefs(patch));
  }, []);
  const selectWorkspace = useCallback(async (id: string) => {
    queryClient.clear();
    setSession(await desktop.selectWorkspace(id));
  }, []);
  const signOut = useCallback(async () => {
    await desktop.signOut();
    setSession(null);
    queryClient.clear();
  }, []);

  const value = useMemo<AppState | null>(
    () =>
      config && prefs
        ? {
            config,
            session,
            workspace: session?.workspace ?? null,
            ws,
            prefs,
            running,
            unread,
            live,
            fullscreen,
            ended,
            setPrefs,
            setSession,
            selectWorkspace,
            signOut,
          }
        : null,
    [config, prefs, session, ws, running, unread, live, fullscreen, ended, setPrefs, selectWorkspace, signOut],
  );
  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

/** For views under the signed-in shell: the workspace id, never empty there. */
export const useWs = () => useApp().ws;
