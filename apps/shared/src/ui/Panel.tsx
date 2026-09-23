import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { DEFAULT_POMODORO, pomodoroState } from "../pomodoro";
import { Button } from "./components/button"
import { Input } from "./components/input"
import { IssuesView } from "./components/issues-view"
import { IssueDetailView } from "./components/issue-detail"
import { Palette } from "./components/palette"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/select"
import { Textarea } from "./components/textarea"
import { clock, duration, elapsedSeconds, entryLabel } from "../format";
import type { Inbox, NextItem, TimeEntry, Workspace, Issue } from "../types";
import type { LiveStatus, PanelHost, Session } from "./host";
import { ApiError, isMfaRequired } from "../client";
import { STRINGS, type Locale, type Strings } from "./i18n";
import { Mark } from "./Mark";

type Theme = "system" | "light" | "dark";
const LS_LOCALE = "mahaam.locale";
const LS_THEME = "mahaam.theme";
const LS_POMODORO = "mahaam.pomodoro";

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function initialLocale(): Locale {
  const nav = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
  return readPref<Locale>(LS_LOCALE, ["en", "ar"], nav);
}

/** Applies theme + direction to <html>, following the OS when the theme is "system". */
function useAppearance(locale: Locale, theme: Theme) {
  useEffect(() => {
    const html = document.documentElement;
    html.lang = locale;
    html.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

function errText(e: unknown, t: Strings): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as Error).message === "string") {
    // Electron wraps IPC errors: "Error invoking remote method 'x': Error: msg"
    return (e as Error).message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, "") || t.error;
  }
  return t.error;
}

/**
 * The task pickers' labels. Without `items` Base UI's Select.Value prints the raw value, so the
 * trigger read "taskMH-1" once something was chosen and stayed blank for "No task".
 */
function taskItems(next: NextItem[] | null, noTask: string): { value: string; label: string }[] {
  return [{ value: "", label: noTask }, ...(next ?? []).map((n) => ({ value: n.kind + n.key, label: `${n.key} ${n.title}` }))];
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function Panel({ host, footer }: { host: PanelHost; footer?: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<Theme>(() => readPref<Theme>(LS_THEME, ["system", "light", "dark"], "system"));
  const [pomodoro, setPomodoro] = useState(() => readPref<"on" | "off">(LS_POMODORO, ["on", "off"], "off") === "on");
  const t = STRINGS[locale];
  useAppearance(locale, theme);

  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    host.session().then(setSession, () => setSession(null));
  }, [host]);

  const prefs = {
    locale,
    theme,
    setLocale: (l: Locale) => {
      setLocale(l);
      try { localStorage.setItem(LS_LOCALE, l); } catch { /* private mode */ }
    },
    setTheme: (v: Theme) => {
      setTheme(v);
      try { localStorage.setItem(LS_THEME, v); } catch { /* private mode */ }
    },
    pomodoro,
    setPomodoro: (v: boolean) => {
      setPomodoro(v);
      try { localStorage.setItem(LS_POMODORO, v ? "on" : "off"); } catch { /* private mode */ }
    },
  };

  const onAuthLost = useCallback(() => {
    setNotice(t.sessionExpired);
    setSession(null);
  }, [t.sessionExpired]);

  let body: ReactNode;
  if (session === undefined) body = <div className="mgy-center mgy-muted">…</div>;
  else if (!session)
    body = (
      <SignIn
        host={host}
        t={t}
        notice={notice}
        onSignedIn={(s) => {
          setNotice(null);
          setSession(s);
        }}
      />
    );
  else if (!session.workspace)
    body = (
      <WorkspacePicker
        host={host}
        t={t}
        session={session}
        onPicked={(ws) => setSession({ ...session, workspace: ws })}
        onSignOut={async () => {
          await host.signOut();
          setSession(null);
        }}
      />
    );
  else
    body = (
      <Home
        key={session.workspace.id}
        host={host}
        t={t}
        session={session}
        prefs={prefs}
        onAuthLost={onAuthLost}
        onSwitchWorkspace={() => setSession({ ...session, workspace: null })}
        onSignOut={async () => {
          host.timerChanged?.(null);
          await host.signOut();
          setSession(null);
        }}
      />
    );

  // No inline <style> from Base UI: the extension's CSP (style-src 'self') refuses them and logs a
  // violation each time a Select opens. The one rule they carry is in panel.css.
  return (
    <CSPProvider disableStyleElements>
      <div className="mgy-panel" data-platform={host.platform}>
        {body}
        {footer}
      </div>
    </CSPProvider>
  );
}

// ── sign in ──────────────────────────────────────────────────────────────

function SignIn({ host, t, notice, onSignedIn }: { host: PanelHost; t: Strings; notice: string | null; onSignedIn: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiUrl, setApiUrl] = useState(host.defaultApiUrl);
  const [advanced, setAdvanced] = useState(false);
  const [remember, setRemember] = useState(host.canRemember);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice);
  // Two-factor sign-in (MH-341): the password was right and the server wants a code as well.
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await host.signIn(apiUrl, email.trim(), password, remember && host.canRemember, needCode ? code.trim() : undefined));
    } catch (err) {
      if (isMfaRequired(err) && !needCode) setNeedCode(true);
      else setError(needCode && err instanceof ApiError && err.status === 400 ? t.mfaWrong : errText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mgy-signin" onSubmit={submit}>
      <div className="mgy-signin-head">
        <Mark size={44} />
        <h1>Mahaam</h1>
        <p className="mgy-muted">{t.signInHint}</p>
      </div>
      {error && <p className="mgy-error" role="alert">{error}</p>}
      <label className="mgy-field">
        <span>{t.email}</span>
        <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </label>
      <label className="mgy-field">
        <span>{t.password}</span>
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {needCode && (
        <label className="mgy-field">
          <span>{t.mfaCode}</span>
          <Input
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            autoFocus
            data-mfa-code
          />
          <span className="mgy-muted">{t.mfaHint}</span>
        </label>
      )}
      {host.canRemember && (
        <label className="mgy-check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t.remember}</span>
        </label>
      )}
      <Button type="button" variant="link" className="h-auto p-0 justify-start" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
        {t.advanced}
      </Button>
      {advanced && (
        <label className="mgy-field">
          <span>{t.apiUrl}</span>
          <Input type="url" dir="ltr" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder={host.defaultApiUrl} />
        </label>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t.signingIn : t.signIn}
      </Button>
    </form>
  );
}

// ── workspace picker ─────────────────────────────────────────────────────

function WorkspacePicker({ host, t, session, onPicked, onSignOut }: { host: PanelHost; t: Strings; session: Session; onPicked: (w: Workspace) => void; onSignOut: () => void }) {
  const [list, setList] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    host.api.workspaces().then(
      async (ws) => {
        setList(ws);
        if (ws.length === 1) {
          await host.selectWorkspace(ws[0]!);
          onPicked(ws[0]!);
        }
      },
      (e) => setError(errText(e, t)),
    );
  }, [host]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mgy-picker">
      <header className="mgy-bar">
        <Mark size={20} />
        <strong>{t.chooseWorkspace}</strong>
      </header>
      {error && <p className="mgy-error">{error}</p>}
      {list === null && !error && <p className="mgy-muted mgy-pad">…</p>}
      {list?.length === 0 && (
        <div className="mgy-pad">
          <p className="mgy-muted">{t.noWorkspaces}</p>
          <Button variant="outline" onClick={() => host.openUrl(session.apiUrl)}>{t.openWeb}</Button>
        </div>
      )}
      <ul className="mgy-list">
        {list?.map((w) => (
          <li key={w.id}>
            <button
              className="mgy-row mgy-row-btn"
              onClick={async () => {
                await host.selectWorkspace(w);
                onPicked(w);
              }}
            >
              <span className="mgy-row-main">
                <span className="mgy-title">{w.name}</span>
                <span className="mgy-meta mgy-mono">{w.slug} · {w.role}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mgy-pad mgy-foot-actions">
        <span className="mgy-muted mgy-small">{session.email}</span>
        <Button variant="link" className="h-auto p-0 justify-start" onClick={onSignOut}>{t.signOut}</Button>
      </div>
    </div>
  );
}

// ── home ─────────────────────────────────────────────────────────────────

interface Prefs {
  locale: Locale;
  theme: Theme;
  /** Pomodoro is a view over the running entry, not a second timer — see ../pomodoro. */
  pomodoro: boolean;
  setLocale(l: Locale): void;
  setTheme(t: Theme): void;
  setPomodoro(v: boolean): void;
}

function Home({
  host,
  t,
  session,
  prefs,
  onAuthLost,
  onSwitchWorkspace,
  onSignOut,
}: {
  host: PanelHost;
  t: Strings;
  session: Session;
  prefs: Prefs;
  onAuthLost: () => void;
  onSwitchWorkspace: () => void;
  onSignOut: () => void;
}) {
  const ws = session.workspace!;
  const api = host.api;
  const [running, setRunning] = useState<TimeEntry | null | undefined>(undefined);
  const [next, setNext] = useState<NextItem[] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [today, setToday] = useState<TimeEntry[] | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [live, setLive] = useState<LiveStatus>("reconnecting");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"home" | "settings" | "inbox" | "issues" | "issue">("home");
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [page, setPage] = useState<{ url: string; title?: string; mode: "issue" | "log"; screenshot?: string } | null>(null);
  const now = useTick(!!running);

  const fail = useCallback(
    (e: unknown) => {
      const status = (e as { status?: number })?.status;
      if (status === 401) return onAuthLost();
      setError(errText(e, t));
    },
    [onAuthLost, t],
  );

  const setTimer = useCallback(
    (r: TimeEntry | null) => {
      setRunning(r);
      host.timerChanged?.(r);
    },
    [host],
  );

  // True once the stream has been open, so the first connect does not refetch what mount just did.
  const wasOpen = useRef(false);
  const openIssues = () => {
    setView("issues");
    api.issues({ state: "open" }).then(setIssues, () => setIssues([]));
  };

  const loadToday = useCallback(() => api.entriesToday().then(setToday, fail), [api, fail]);
  const loadAll = useCallback(() => {
    setError(null);
    api.running().then(setTimer, fail);
    api.nextUp().then(setNext, fail);
    loadToday();
    api.notifications(20).then(setInbox, () => setInbox(null));
  }, [api, fail, loadToday, setTimer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement;
      const typing = el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      setPaletteOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    loadAll();
    host.pageContext?.().then(setPage, () => null);
    const off = host.subscribe(
      (e) => {
        if (e.type === "timer.state") setTimer(e.running);
        else if (e.type === "timer.started") {
          setTimer(e.entry);
          loadToday();
        } else if (e.type === "timer.stopped") {
          setRunning((cur) => {
            const next = cur && cur.id === e.entry.id ? null : (cur ?? null);
            host.timerChanged?.(next);
            return next;
          });
          loadToday();
        } else if (e.type === "entry.changed") loadToday();
        else if (e.type === "notification") api.notifications(20).then(setInbox, () => null);
      },
      (status) => {
        setLive(status);
        // The stream replays nothing on reconnect — the server's hello frame carries the running
        // timer and nothing else — so everything else would sit stale until the user acted.
        // Only refetch on a genuine reconnect; the first open is already covered by mount.
        if (status === "open") {
          if (wasOpen.current) loadAll();
          wasOpen.current = true;
        }
      },
      onAuthLost,
    );
    return off;
  }, [host]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    }
  };

  const start = (item: NextItem) =>
    act(async () => {
      const r = await api.startOn(item);
      setTimer(r.started);
      loadToday();
    });
  const startFree = (description: string) =>
    act(async () => {
      const r = await api.start({ description });
      setTimer(r.started);
      loadToday();
    });
  const stop = () =>
    act(async () => {
      await api.stop();
      setTimer(null);
      loadToday();
    });

  const webBase = `${session.apiUrl}/${prefs.locale}/w/${ws.slug}`;

  if (view === "settings")
    return <Settings host={host} t={t} prefs={prefs} session={session} onBack={() => setView("home")} onSwitchWorkspace={onSwitchWorkspace} onSignOut={onSignOut} />;
  if (view === "issues")
    return (
      <IssuesView
        issues={issues}
        strings={{ title: t.issues, back: t.back, search: t.issuesSearch, empty: t.issuesEmpty, status: t.issueStatus }}
        onBack={() => setView("home")}
        onOpen={(i) => {
          setOpenIssue(i.key);
          setView("issue");
        }}
      />
    );
  if (view === "issue" && openIssue)
    return (
      <IssueDetailView
        issueKey={openIssue}
        strings={{
          back: t.back,
          loading: t.issueLoading,
          failed: t.issueFailed,
          retry: t.issueRetry,
          noBody: t.issueNoBody,
          comments: t.issueComments,
          noComments: t.issueNoComments,
          commentPlaceholder: t.issueCommentPlaceholder,
          send: t.issueSend,
          sending: t.issueSending,
          openInApp: t.issueOpenInApp,
          moveTo: t.issueMoveTo,
          agent: t.issueAgent,
          status: t.issueStatus,
        }}
        load={(k) => api.issue(k)}
        comment={(k, b) => api.commentOnIssue(k, b)}
        move={(k, status) => api.updateIssue(k, { status })}
        onBack={() => {
          setView("issues");
          // The list is stale the moment a stage changes here, so refetch rather than leave a
          // card sitting in a column it has just left.
          api.issues({ state: "open" }).then(setIssues, () => null);
        }}
        onOpenExternal={(target) => host.openUrl(target.startsWith("http") ? target : `${webBase}/issues/${target}`)}
      />
    );
  if (view === "inbox")
    return (
      <InboxView
        t={t}
        inbox={inbox}
        onBack={() => setView("home")}
        onOpen={(url) => host.openUrl(url.startsWith("http") ? url : `${session.apiUrl}/${prefs.locale}${url}`)}
        onReadAll={() => act(async () => {
          await api.markAllRead();
          setInbox(await api.notifications(20));
        })}
      />
    );

  return (
    <div className="mgy-home">
      <header className="mgy-bar">
        <button className="mgy-brand" onClick={() => host.openUrl(webBase)} title={t.openWeb}>
          <Mark size={20} />
          <span className="mgy-ws" title={ws.name}>{ws.name}</span>
        </button>
        <span className="mgy-spacer" />
        <span className={`mgy-live mgy-live-${live}`} title={live === "open" ? t.live : live === "reconnecting" ? t.reconnecting : t.offline} />
        <Button variant="ghost" size="icon" className="mgy-icon-btn size-[26px]" onClick={openIssues} aria-label={t.issues} title={t.issues}>
          <ListIcon />
        </Button>
        <Button variant="ghost" size="icon" className="mgy-icon-btn size-[26px]" onClick={() => setView("inbox")} aria-label={t.notifications} title={t.notifications}>
          <BellIcon />
          {!!inbox?.unread && <span className="mgy-count mgy-mono">{inbox.unread > 99 ? "99+" : inbox.unread}</span>}
        </Button>
        <Button variant="ghost" size="icon" className="mgy-icon-btn size-[26px]" onClick={loadAll} aria-label={t.refresh} title={t.refresh}>
          <RefreshIcon />
        </Button>
        <Button variant="ghost" size="icon" className="mgy-icon-btn size-[26px]" onClick={() => setView("settings")} aria-label={t.settings} title={t.settings}>
          <GearIcon />
        </Button>
      </header>

      {error && (
        <p className="mgy-error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {paletteOpen && (
        <Palette
          items={next ?? []}
          strings={{ placeholder: t.palettePlaceholder, empty: t.paletteEmpty, hint: t.paletteHint }}
          onClose={() => setPaletteOpen(false)}
          onPick={(item) => {
            setPaletteOpen(false);
            start(item);
          }}
        />
      )}
      <TimerCard t={t} pomodoro={prefs.pomodoro} running={running} now={now} onStop={stop} onStart={startFree} onDescribe={(id, d) => act(async () => setTimer(await api.updateEntry(id, { description: d })))} />

      {page && <PageCard t={t} host={host} page={page} next={next} onDone={() => { setPage(null); loadToday(); }} onError={fail} />}

      <section className="mgy-section">
        <h2 className="mgy-h">{t.nextUp}</h2>
        {next === null ? (
          <p className="mgy-muted mgy-pad">…</p>
        ) : next.length === 0 ? (
          <p className="mgy-muted mgy-pad">{t.nothingNext}</p>
        ) : (
          <ul className="mgy-list">
            {next.map((item) => {
              const isRunning = !!running && ((item.kind === "task" && running.task_id === item.task.id) || (item.kind === "issue" && !running.task_id && running.description.startsWith(item.key + " ")));
              return (
                <li key={item.kind + item.key} className={isRunning ? "mgy-row mgy-row-running" : "mgy-row"}>
                  <span className="mgy-row-main">
                    <span className="mgy-title">
                      <span className="mgy-key mgy-mono">{item.key}</span> {item.title}
                    </span>
                    <span className="mgy-meta">
                      {item.kind === "issue" && <span className="mgy-tag">{t.issue}</span>}
                      {item.doing && <span className="mgy-tag mgy-tag-doing">{t.inProgress}</span>}
                      {item.projectName}
                    </span>
                  </span>
                  {isRunning ? (
                    <Button variant="destructive" size="sm" onClick={stop}>{t.stop}</Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => start(item)} title={t.startTimer}>
                      <PlayIcon /> {running ? t.switchTo : t.start}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <QuickLog t={t} next={next} onLog={(input) => act(async () => { await api.logTime(input); loadToday(); })} />

      <TodayList t={t} entries={today} running={running ?? null} now={now} />
    </div>
  );
}

function TimerCard({ t, running, now, onStop, onStart, onDescribe, pomodoro }: { t: Strings; running: TimeEntry | null | undefined; now: number; onStop: () => void; onStart: (d: string) => void; onDescribe: (id: string, d: string) => void; pomodoro: boolean }) {
  const [desc, setDesc] = useState("");
  const [free, setFree] = useState("");
  const entryId = running?.id;
  useEffect(() => setDesc(running?.description ?? ""), [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (running === undefined) return <section className="mgy-timer mgy-timer-idle"><span className="mgy-muted">…</span></section>;
  if (!running)
    return (
      <form
        className="mgy-timer mgy-timer-idle"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(free.trim());
          setFree("");
        }}
      >
        <span className="mgy-clock mgy-mono mgy-muted">0:00</span>
        <Input placeholder={t.whatAreYouDoing} value={free} onChange={(e) => setFree(e.target.value)} aria-label={t.whatAreYouDoing} />
        <Button type="submit">
          <PlayIcon /> {t.start}
        </Button>
      </form>
    );
  const label = entryLabel(running) || t.noTask;
  return (
    <section className="mgy-timer mgy-timer-running" aria-live="polite">
      <div className="mgy-timer-top">
        <span className="mgy-pulse" aria-hidden />
        <span className="mgy-timer-label" title={label}>
          <span className="mgy-muted mgy-small">{t.running}</span>
          <span className="mgy-title">{label}</span>
          {running.project_name && label !== running.project_name && <span className="mgy-meta">{running.project_name}</span>}
        </span>
        <span className="mgy-clock mgy-mono">{clock(elapsedSeconds(running, now))}</span>
        {pomodoro ? <PomodoroBadge t={t} elapsed={elapsedSeconds(running, now)} /> : null}
      </div>
      <div className="mgy-timer-bottom">
        <Input
          value={desc}
          placeholder={t.description}
          aria-label={t.description}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== running.description && onDescribe(running.id, desc)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <Button variant="destructive" onClick={onStop}>
          <StopIcon /> {t.stop}
        </Button>
      </div>
    </section>
  );
}

function QuickLog({ t, next, onLog }: { t: Strings; next: NextItem[] | null; onLog: (i: { started_at: string; minutes: number; description?: string; task?: string; project?: string }) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [desc, setDesc] = useState("");
  const [target, setTarget] = useState("");
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const m = Math.round(Number(minutes));
    if (!m || m < 1) return;
    const item = next?.find((n) => n.kind + n.key === target);
    await onLog({
      // a block that ends now
      started_at: new Date(Date.now() - m * 60_000).toISOString(),
      minutes: m,
      ...(desc.trim() ? { description: desc.trim() } : item?.kind === "issue" ? { description: `${item.key} ${item.title}` } : {}),
      ...(item?.kind === "task" ? { task: item.task.id } : item?.kind === "issue" && item.projectId ? { project: item.projectId } : {}),
    });
    setDesc("");
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <section className="mgy-section">
      <button className="mgy-h mgy-h-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {t.quickLog} <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <form className="mgy-log" onSubmit={submit}>
          <Input className="mgy-mono mgy-minutes" type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label={t.minutes} />
          <Select items={taskItems(next, t.noTask)} value={target} onValueChange={(v) => setTarget(String(v ?? ""))}>
            <SelectTrigger className="mgy-task-select" aria-label={t.onTask}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t.noTask}</SelectItem>
              {next?.map((n) => (
                <SelectItem key={n.kind + n.key} value={n.kind + n.key}>
                  {n.key} {n.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input className="mgy-log-desc" placeholder={t.description} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Button type="submit" variant="outline">{done ? t.logged : t.log}</Button>
        </form>
      )}
    </section>
  );
}

// Pomodoro is derived from the running entry's elapsed time, never stored, so it survives a
// reload and cannot disagree with the server's clock. See ../pomodoro.
function PomodoroBadge({ t, elapsed }: { t: Strings; elapsed: number }) {
  const p = pomodoroState(elapsed, DEFAULT_POMODORO);
  if (!p) return null;
  const label = p.phase === "work" ? t.pomFocus : p.phase === "break" ? t.pomBreak : t.pomLongBreak;
  return (
    <span className="mgy-meta mgy-pom" title={`${label} · ${clock(p.remaining)}`}>
      {label} <span className="mgy-mono">{clock(p.remaining)}</span>
    </span>
  );
}
function TodayList({ t, entries, running, now }: { t: Strings; entries: TimeEntry[] | null; running: TimeEntry | null; now: number }) {
  const total = useMemo(() => (entries ?? []).reduce((s, e) => s + (e.id === running?.id ? elapsedSeconds(running, now) : elapsedSeconds(e, now)), 0), [entries, running, now]);
  return (
    <section className="mgy-section">
      <h2 className="mgy-h">
        {t.today}
        <span className="mgy-spacer" />
        <span className="mgy-mono mgy-small">{duration(total)}</span>
      </h2>
      {entries === null ? (
        <p className="mgy-muted mgy-pad">…</p>
      ) : entries.length === 0 ? (
        <p className="mgy-muted mgy-pad">{t.noEntriesToday}</p>
      ) : (
        <ul className="mgy-list mgy-list-compact">
          {entries.map((e) => (
            <li key={e.id} className="mgy-row">
              <span className="mgy-row-main">
                <span className="mgy-title">{entryLabel(e) || t.noTask}</span>
                <span className="mgy-meta">
                  <span className="mgy-mono">{new Date(e.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {e.task_key && e.description ? ` · ${e.description}` : ""}
                </span>
              </span>
              <span className={`mgy-mono mgy-small${e.ended_at ? "" : " mgy-running-text"}`}>{duration(elapsedSeconds(e, now))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PageCard({ t, host, page, next, onDone, onError }: { t: Strings; host: PanelHost; page: { url: string; title?: string; mode: "issue" | "log"; screenshot?: string }; next: NextItem[] | null; onDone: () => void; onError: (e: unknown) => void }) {
  const [mode, setMode] = useState(page.mode);
  const [title, setTitle] = useState(page.title ?? "");
  const [body, setBody] = useState(`Page: ${page.url}\n\n`);
  const [minutes, setMinutes] = useState("15");
  const [target, setTarget] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  // Attached by default when the host captured one, and removable before sending. A screenshot of
  // whatever happened to be on screen can hold far more than the person meant to report, so
  // dropping it has to be one obvious click rather than a setting somewhere.
  const [attachShot, setAttachShot] = useState(true);
  const shot = attachShot ? page.screenshot : undefined;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (mode === "issue") {
        // The multipart route only when there is actually a file for it. Its JSON sibling is the
        // simpler request and stays the path for every host that cannot capture a screen.
        const r =
          shot && host.api.fileIssueWithScreenshot
            ? await host.api.fileIssueWithScreenshot({ title: title.trim() || page.url, body, page_url: page.url }, shot)
            : await host.api.createIssue({ title: title.trim() || page.url, body });
        setOk(`${t.issueFiled}: ${r.key}`);
      } else {
        const m = Math.max(1, Math.round(Number(minutes)));
        const item = next?.find((n) => n.kind + n.key === target);
        await host.api.logTime({
          started_at: new Date(Date.now() - m * 60_000).toISOString(),
          minutes: m,
          description: `${title.trim() || page.url} — ${page.url}`,
          ...(item?.kind === "task" ? { task: item.task.id } : item?.projectId ? { project: item.projectId } : {}),
        });
        setOk(t.logged);
      }
      setTimeout(onDone, 1200);
    } catch (err) {
      onError(err);
    }
  };
  return (
    <section className="mgy-section mgy-page">
      <div className="mgy-h">
        {t.thisPage}
        <span className="mgy-spacer" />
        <span className="mgy-seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "issue"} onClick={() => setMode("issue")}>{t.fileIssue}</button>
          <button type="button" role="tab" aria-selected={mode === "log"} onClick={() => setMode("log")}>{t.quickLog}</button>
        </span>
      </div>
      <form className="mgy-page-form" onSubmit={submit}>
        <p className="mgy-meta mgy-mono mgy-url" dir="ltr" title={page.url}>{page.url}</p>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.issueTitle} aria-label={t.issueTitle} required={mode === "issue"} />
        {mode === "issue" ? (
          <>
            <Textarea ref={bodyRef} rows={3} value={body} onChange={(e) => setBody(e.target.value)} aria-label={t.issueBody} />
            {page.screenshot && (
              <div className="mgy-shot">
                {attachShot ? (
                  <>
                    {/* Shown, not just announced: nobody can decide whether to send a screenshot
                        they cannot see. */}
                    <img src={page.screenshot} alt={t.screenshotAlt} className="mgy-shot-thumb" />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setAttachShot(false)}>
                      {t.removeScreenshot}
                    </Button>
                  </>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAttachShot(true)}>
                    {t.addScreenshot}
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="mgy-log">
            <Input className="mgy-mono mgy-minutes" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label={t.minutes} />
            <Select items={taskItems(next, t.noTask)} value={target} onValueChange={(v) => setTarget(String(v ?? ""))}>
              <SelectTrigger className="mgy-task-select" aria-label={t.onTask}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t.noTask}</SelectItem>
                {next?.map((n) => (
                  <SelectItem key={n.kind + n.key} value={n.kind + n.key}>
                    {n.key} {n.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="mgy-foot-actions">
          <Button type="button" variant="link" className="h-auto p-0 justify-start" onClick={onDone}>{t.back}</Button>
          {ok ? <span className="mgy-ok">{ok}</span> : <Button type="submit">{mode === "issue" ? t.fileIssue : t.log}</Button>}
        </div>
      </form>
    </section>
  );
}

function InboxView({ t, inbox, onBack, onOpen, onReadAll }: { t: Strings; inbox: Inbox | null; onBack: () => void; onOpen: (url: string) => void; onReadAll: () => void }) {
  return (
    <div className="mgy-home">
      <header className="mgy-bar">
        <Button variant="link" className="h-auto p-0 justify-start" onClick={onBack}>← {t.back}</Button>
        <strong className="mgy-spacer mgy-center-text">{t.notifications}</strong>
        <Button variant="link" className="h-auto p-0 justify-start" onClick={onReadAll} disabled={!inbox?.unread}>{t.markAllRead}</Button>
      </header>
      {!inbox?.notifications?.length ? (
        <p className="mgy-muted mgy-pad">{t.noNotifications}</p>
      ) : (
        <ul className="mgy-list">
          {inbox.notifications.map((n) => (
            <li key={n.id} className={n.read_at ? "mgy-row" : "mgy-row mgy-row-unread"}>
              <button className="mgy-row-main mgy-row-btn" onClick={() => n.url && onOpen(n.url)}>
                <span className="mgy-title">{n.title}</span>
                {n.body && <span className="mgy-meta">{n.body}</span>}
                <span className="mgy-meta mgy-mono">{new Date(n.created_at).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Settings({ host, t, prefs, session, onBack, onSwitchWorkspace, onSignOut }: { host: PanelHost; t: Strings; prefs: Prefs; session: Session; onBack: () => void; onSwitchWorkspace: () => void; onSignOut: () => void }) {
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => {
    host.autoLaunch?.get().then(setAuto, () => setAuto(null));
  }, [host]);
  return (
    <div className="mgy-home">
      <header className="mgy-bar">
        <Button variant="link" className="h-auto p-0 justify-start" onClick={onBack}>← {t.back}</Button>
        <strong className="mgy-spacer mgy-center-text">{t.settings}</strong>
      </header>
      <div className="mgy-settings">
        <div className="mgy-setting">
          <span>{t.workspace}</span>
          <Button variant="outline" size="sm" onClick={onSwitchWorkspace}>{session.workspace?.name}</Button>
        </div>
        <div className="mgy-setting">
          <span>{t.pomodoro}</span>
          <span className="mgy-seg">
            <button aria-pressed={!prefs.pomodoro} onClick={() => prefs.setPomodoro(false)}>{t.pomodoroOff}</button>
            <button aria-pressed={prefs.pomodoro} onClick={() => prefs.setPomodoro(true)}>{t.pomodoroOn}</button>
          </span>
        </div>
        <div className="mgy-setting">
          <span>{t.language}</span>
          <span className="mgy-seg">
            <button aria-pressed={prefs.locale === "en"} onClick={() => prefs.setLocale("en")}>English</button>
            <button aria-pressed={prefs.locale === "ar"} onClick={() => prefs.setLocale("ar")}>العربية</button>
          </span>
        </div>
        <div className="mgy-setting">
          <span>{t.theme}</span>
          <span className="mgy-seg">
            {(["system", "light", "dark"] as const).map((v) => (
              <button key={v} aria-pressed={prefs.theme === v} onClick={() => prefs.setTheme(v)}>
                {v === "system" ? t.themeSystem : v === "light" ? t.themeLight : t.themeDark}
              </button>
            ))}
          </span>
        </div>
        {host.autoLaunch && auto !== null && (
          <label className="mgy-setting">
            <span>{t.autoLaunch}</span>
            <input
              type="checkbox"
              checked={auto}
              onChange={async (e) => {
                const on = e.target.checked;
                await host.autoLaunch!.set(on);
                setAuto(on);
              }}
            />
          </label>
        )}
        {host.shortcut && (
          <div className="mgy-setting">
            <span>{t.shortcut}</span>
            <kbd className="mgy-mono">{host.shortcut}</kbd>
          </div>
        )}
        <div className="mgy-setting">
          <span className="mgy-muted mgy-small" dir="ltr">{session.email} · {session.apiUrl.replace(/^https?:\/\//, "")}</span>
        </div>
        <div className="mgy-foot-actions">
          <Button variant="outline" onClick={onSignOut}>{t.signOut}</Button>
          {host.quit && <Button variant="outline" onClick={host.quit}>{t.quit}</Button>}
        </div>
      </div>
    </div>
  );
}

// ── icons (stroke, currentColor) ─────────────────────────────────────────
const I = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const PlayIcon = () => <I d="M7 4v16l13-8z" />;
const StopIcon = () => <I d="M6 6h12v12H6z" />;
const ListIcon = () => <I d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />;
const BellIcon = () => <I d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />;
const GearIcon = () => <I d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />;
const RefreshIcon = () => <I d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />;
