import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { liveStream, normalizeApiUrl, type MahaamClient, type TimeEntry, type Workspace } from "@mahaam/client";
import { Panel, type PanelApi, type PanelHost, type Session } from "@mahaam/client/ui";
import "@mahaam/client/grid.css";
import "@mahaam/client/tokens.css";
import "@mahaam/client/panel.css";
import "./popup.css";
import { defaultApiUrl, loadState, makeClient, requestOrigin, saveState, takePendingPage, type ExtMessage } from "./ext";

async function boot() {
  // The Vite dev harness (npm run dev:extension) has no chrome.* — stub it.
  if (import.meta.env.DEV && !globalThis.chrome?.storage) await import("./dev/chrome-shim");

  let state = await loadState();
  let client: MahaamClient = makeClient(state, () => void saveState({ token: null }));
  const notify = (msg: ExtMessage) => chrome.runtime.sendMessage(msg).catch(() => null);

  // The panel calls the client lazily so a re-created client (new sign-in) is picked up.
  const api = new Proxy({} as PanelApi, {
    get: (_t, m: string) => (...args: unknown[]) => (client as unknown as Record<string, (...a: unknown[]) => unknown>)[m]!.apply(client, args),
  });

  const session = (): Session | null =>
    state.token && state.email ? { apiUrl: state.apiUrl, email: state.email, workspace: state.workspace } : null;

  const host: PanelHost = {
    platform: "extension",
    defaultApiUrl: state.apiUrl || defaultApiUrl(),
    canRemember: false, // token only; no password is kept by the extension
    session: async () => session(),
    async signIn(apiUrl, email, password) {
      const url = normalizeApiUrl(apiUrl || defaultApiUrl());
      // Ask for the host permission first, while still inside the click's user gesture.
      if (!import.meta.env.DEV && !(await requestOrigin(url))) throw new Error(`Mahaam needs permission to reach ${new URL(url).host}.`);
      const next = { ...state, apiUrl: url, email, token: null as string | null, workspace: state.email === email && state.apiUrl === url ? state.workspace : null };
      const c = makeClient(next, () => void saveState({ token: null }));
      next.token = await c.login(email, password);
      if (next.workspace && !(await c.workspaces()).some((w) => w.id === next.workspace!.id)) next.workspace = null;
      c.setWorkspace(next.workspace?.id ?? null);
      state = next;
      client = c;
      await saveState(state);
      notify({ type: "refresh" });
      return session()!;
    },
    async signOut() {
      state = { ...state, token: null, workspace: null };
      await saveState({ token: null, workspace: null });
      client = makeClient(state);
      notify({ type: "timer", running: null });
    },
    async selectWorkspace(ws: Workspace) {
      state = { ...state, workspace: { id: ws.id, slug: ws.slug, name: ws.name, role: ws.role, locale: ws.locale } };
      client.setWorkspace(ws.id);
      await saveState({ workspace: state.workspace });
      notify({ type: "refresh" });
    },
    api,
    subscribe(onEvent, onStatus, onAuth) {
      const h = liveStream(
        client,
        (e) => {
          onEvent(e);
          if (e.type === "timer.state") notify({ type: "timer", running: e.running });
          else if (e.type === "timer.started") notify({ type: "timer", running: e.entry });
          else if (e.type === "timer.stopped") notify({ type: "refresh" });
        },
        {
          onStatus: (s) => {
            onStatus(s);
            if (s === "closed" && !client.token) onAuth();
          },
        },
      );
      return () => h.close();
    },
    openUrl: (url) => void chrome.tabs.create({ url }),
    timerChanged: (running: TimeEntry | null) => void notify({ type: "timer", running }),
    pageContext: async () => {
      const p = await takePendingPage();
      if (!p) return null;
      const title = p.title ?? "";
      return { url: p.url, title: p.selection ? `${title}: ${p.selection.slice(0, 80)}` : title, mode: p.mode };
    },
  };

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Panel host={host} />
    </StrictMode>,
  );
}

void boot();
