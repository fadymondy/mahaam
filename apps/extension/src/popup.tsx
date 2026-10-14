import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isBrowserSessionMissing, liveStream, normalizeApiUrl, type MahaamClient, type TimeEntry, type Workspace } from "@mahaam/client";
import { Panel, type PanelApi, type PanelHost, type Session } from "@mahaam/client/ui";
import "@mahaam/client/grid.css";
import "@mahaam/client/tokens.css";
import "@mahaam/client/panel.css";
import "./popup.css";
import { defaultApiUrl, deviceName, loadState, makeClient, requestOrigin, saveState, takePendingPage, type ExtMessage } from "./ext";

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

  /** Ask for the host permission first, while still inside the click's user gesture. */
  const permit = async (apiUrl: string): Promise<string> => {
    const url = normalizeApiUrl(apiUrl || defaultApiUrl());
    if (!import.meta.env.DEV && !(await requestOrigin(url))) throw new Error(`Mahaam needs permission to reach ${new URL(url).host}.`);
    return url;
  };

  /** A client for `url` that is about to be signed in; keeps the chosen workspace only for the same account. */
  const candidate = (url: string, email: string | null) => {
    const next = { ...state, apiUrl: url, email, token: null as string | null, workspace: state.email === email && state.apiUrl === url ? state.workspace : null };
    return { next, c: makeClient(next, () => void saveState({ token: null })) };
  };

  /** Adopt a signed-in client: drop a workspace the account has left, persist, tell the worker. */
  const commit = async (next: typeof state, c: MahaamClient): Promise<Session> => {
    next.token = c.token;
    if (next.workspace && !(await c.workspaces()).some((w) => w.id === next.workspace!.id)) next.workspace = null;
    c.setWorkspace(next.workspace?.id ?? null);
    state = next;
    client = c;
    await saveState(state);
    notify({ type: "refresh" });
    return session()!;
  };

  const host: PanelHost = {
    platform: "extension",
    defaultApiUrl: state.apiUrl || defaultApiUrl(),
    canRemember: false, // token only; no password is kept by the extension
    session: async () => session(),
    async signIn(apiUrl, email, password, _remember, code) {
      const url = await permit(apiUrl);
      const { next, c } = candidate(url, email);
      // With two-factor sign-in the first call throws isMfaRequired and the panel asks for the
      // code; the second call brings it (MH-341).
      await c.login(email, password, code ? { code } : undefined);
      // Swap the 24h JWT for a personal access token named for this browser. The JWT cannot be
      // revoked and forces a silent re-login — which is why the password used to have to be kept.
      // A PAT can be revoked from the server and shows up in the user's own device list.
      // An older self-hosted server has no /api/auth/tokens; keeping the JWT there is the same
      // behaviour as before rather than a broken sign-in.
      try {
        c.setToken(await c.replaceAccessToken(deviceName()));
      } catch {
        /* keep the JWT */
      }
      return commit(next, c);
    },
    // Google and GitHub accounts have no password (the auth plugin stores "!sso"), so the form
    // above can never sign them in. The browser they use Mahaam in already holds their session;
    // with host permission the popup's requests carry that cookie, and the server mints this
    // browser's PAT from it. The cookie itself is never read or stored here.
    async signInWithBrowser(apiUrl) {
      const url = await permit(apiUrl);
      const { next, c } = candidate(url, null);
      try {
        next.email = (await c.tokenFromBrowserSession(deviceName())).email || null;
      } catch (err) {
        if (isBrowserSessionMissing(err)) void chrome.tabs.create({ url: `${url}/` });
        throw err;
      }
      // Keep the workspace only when it is the same account signing in again.
      next.workspace = next.email && next.email === state.email && url === state.apiUrl ? state.workspace : null;
      // An older server's /api/auth/me may carry no email; the panel only shows it.
      next.email ??= new URL(url).host;
      return commit(next, c);
    },
    async signOut() {
      // Revoke it rather than just forget it. A token this browser drops but the server still
      // honours is exactly the thing signing out is supposed to end.
      if (state.token?.startsWith("togo_pat_")) {
        try {
          const name = deviceName();
          for (const t of await client.accessTokens()) if (t.name === name) await client.revokeAccessToken(t.id);
        } catch {
          // Offline, or the server does not list them. Sign out locally regardless — refusing to
          // would leave someone signed in on a machine they are trying to leave.
        }
      }
      state = { ...state, token: null, workspace: null };
      await saveState({ token: null, workspace: null });
      client = makeClient(state);
      notify({ type: "timer", running: null });
    },
    async selectWorkspace(ws: Workspace) {
      state = { ...state, workspace: { id: ws.id, slug: ws.slug, name: ws.name, role: ws.role, locale: ws.locale, logo: ws.logo } };
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
      return {
        url: p.url,
        title: p.selection ? `${title}: ${p.selection.slice(0, 80)}` : title,
        mode: p.mode,
        ...(p.screenshot ? { screenshot: p.screenshot } : {}),
      };
    },
  };

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Panel host={host} />
    </StrictMode>,
  );
}

void boot();
