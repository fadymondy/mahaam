// The quick palette — Mahaam's Spotlight. ⌘⇧Space from any app: type a few letters, Enter.
// ⌥⌘N opens it straight into a new issue.
//
// One ranked list over everything: what you ran recently first (when the field is empty), then
// actions (new issue, start/stop the timer), places (Inbox, My issues, Time, a project) and issues
// (searched on the server as you type, or opened by key: "MH-12"). ↑/↓ move, ↵ runs, ⌘↵ starts a
// timer on an issue, ⌘1…9 run the nth row, Esc closes. What an action did is said inline — in the
// server's words when it refuses — and the palette closes itself a beat after a success. The window
// is always exactly as tall as what it shows.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CircleDotIcon,
  ClockIcon,
  CornerDownLeftIcon,
  InboxIcon,
  LayersIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  SquareIcon,
  SquarePenIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Route } from "../../shared/types";
import { AssigneePicker, PriorityPicker, ProjectPicker, StatusPicker } from "@/components/pickers";
import { Kbd, ProjectMark } from "@/components/kit";
import { useApp } from "@/lib/app";
import { api, desktop, on } from "@/lib/bridge";
import { useBoard, useMembers, useProjectMap, useProjects, useUserId } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { cn } from "@/lib/utils";
import { useTimer } from "@/shell/Timer";
import { Mark } from "@/views/SignIn";

type Outcome = { kind: "ok" | "error"; message: string };
type Section = "recent" | "actions" | "go" | "projects" | "issues";
type Item = {
  id: string;
  section: Section;
  title: string;
  sub?: string;
  icon: ReactNode;
  /** A project's own coloured mark: its tile stays neutral when active, or the mark disappears. */
  mark?: boolean;
  keywords?: string[];
  /** Runs it. A returned Outcome is shown inline; ok closes the palette a beat later. */
  run: () => Promise<Outcome | void> | Outcome | void;
  /** ⌘↵: an issue's timer. */
  alt?: () => Promise<Outcome | void>;
};

const RECENTS = "mahaam.palette.recents";
const recentIds = (): string[] => {
  try {
    return (JSON.parse(localStorage.getItem(RECENTS) ?? "[]") as string[]).slice(0, 5);
  } catch {
    return [];
  }
};
const remember = (id: string) => localStorage.setItem(RECENTS, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 5)));

/** Subsequence match with a bonus for word starts and contiguity; 0 = no match. */
function score(q: string, text: string): number {
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q) + (t.startsWith(q) ? 50 : 0);
  let i = 0;
  let s = 0;
  let run = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      i++;
      run++;
      s += run + (j === 0 || t[j - 1] === " " || t[j - 1] === "-" ? 3 : 0);
    } else run = 0;
  }
  return i === q.length ? s : 0;
}

const hide = () => void desktop.hideSurface();

export function QuickPalette() {
  const { t } = useI18n();
  const { session } = useApp();
  const [mode, setMode] = useState<"search" | "create">("search");
  const [seed, setSeed] = useState("");
  const [shown, setShown] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      on("surface:shown", (p) => {
        setMode(p?.mode === "create" ? "create" : "search");
        setSeed("");
        setShown((n) => n + 1);
      }),
    [],
  );

  // Exactly as tall as what it shows (the window, not just the page).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => void desktop.resizeSelf(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={root} className="qp flex flex-col overflow-hidden" data-quick-palette>
      {!session?.workspace ? (
        <div className="flex flex-col items-center gap-3 p-6">
          <Mark size={28} />
          <p className="text-[14px] text-grid-muted">{t("pop.signedOut")}</p>
          <button type="button" className="rounded-md bg-grid-action px-3 py-1.5 text-[13.5px] text-grid-on-action" onClick={() => void desktop.openMain().then(hide)}>
            {t("auth.signIn")}
          </button>
        </div>
      ) : mode === "create" ? (
        <QuickCreate key={`c${shown}`} seed={seed} onBack={() => setMode("search")} />
      ) : (
        <Search
          key={`s${shown}`}
          onCreate={(text) => {
            setSeed(text);
            setMode("create");
          }}
        />
      )}
    </div>
  );
}

function Search({ onCreate }: { onCreate: (text: string) => void }) {
  const { t, dir } = useI18n();
  const { ws } = useApp();
  const byId = useProjectMap();
  const projects = useProjects();
  const { running, start, stop } = useTimer();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);
  const [recents] = useState(recentIds);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 140);
    return () => clearTimeout(id);
  }, [query]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    setActive(0);
    setResult(null);
  }, [query]);

  const issues = useQuery({ queryKey: qk.tasks(ws, { q: debounced }), queryFn: () => api.tasks({ q: debounced, limit: 8 }), enabled: debounced.length >= 2, staleTime: 10_000 });
  const text = query.trim();
  const key = /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/.test(text) ? text.toUpperCase() : null;

  const open = (to: Route): Outcome | void => void desktop.openMain(to).then(hide);
  const label = (e: { description?: string | null; task_title?: string | null; project_name?: string | null }) =>
    e.description || e.task_title || e.project_name || t("timer.untitled");

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      { id: "create", section: "actions", title: text ? t("qp.createNamed", { text }) : t("nav.newIssue"), icon: <SquarePenIcon />, keywords: ["new", "issue", "create", "task"], run: () => onCreate(text) },
      running
        ? {
            id: "stop",
            section: "actions",
            title: t("timer.stop"),
            sub: label(running),
            icon: <SquareIcon />,
            keywords: ["stop", "timer"],
            run: async () => {
              await stop();
              return { kind: "ok", message: t("qp.stopped") };
            },
          }
        : {
            id: "start",
            section: "actions",
            title: text && !key ? t("timer.startFree", { text }) : t("timer.startBlank"),
            icon: <PlayIcon />,
            keywords: ["start", "timer", "track"],
            run: async () => {
              await start(text && !key ? { description: text } : {});
              return { kind: "ok", message: t("qp.started") };
            },
          },
      { id: "go:inbox", section: "go", title: t("nav.inbox"), icon: <InboxIcon />, keywords: ["notifications"], run: () => open({ name: "inbox" }) },
      { id: "go:mine", section: "go", title: t("nav.myIssues"), icon: <CircleDotIcon />, keywords: ["assigned"], run: () => open({ name: "my-issues" }) },
      { id: "go:time", section: "go", title: t("nav.time"), icon: <ClockIcon />, keywords: ["timesheet"], run: () => open({ name: "time" }) },
      { id: "go:projects", section: "go", title: t("nav.allProjects"), icon: <LayersIcon />, run: () => open({ name: "projects" }) },
      { id: "go:settings", section: "go", title: t("nav.settings"), icon: <SettingsIcon />, keywords: ["preferences"], run: () => void desktop.openSettings().then(hide) },
      { id: "go:app", section: "go", title: t("pop.openApp"), icon: <ArrowUpRightIcon />, run: () => open({ name: "my-issues" }) },
    ];
    for (const p of projects.data ?? [])
      out.push({ id: `project:${p.id}`, section: "projects", title: p.name, sub: p.client_name ?? undefined, mark: true, icon: <ProjectMark name={p.name} color={p.color} size={16} />, run: () => open({ name: "project", id: p.id }) });
    const issueItem = (k: string, title: string, sub: string | undefined, icon: ReactNode, taskId?: string): Item => ({
      id: `issue:${k}`,
      section: "issues",
      mark: !!taskId,
      title,
      sub: sub ? `${k} · ${sub}` : k,
      icon,
      run: () => open({ name: "issue", key: k }),
      alt: taskId
        ? async () => {
            await start({ task: taskId });
            return { kind: "ok", message: t("qp.startedOn", { key: k }) };
          }
        : undefined,
    });
    if (key) out.push(issueItem(key, key, undefined, <CircleDotIcon />));
    for (const task of issues.data ?? []) {
      const p = byId.get(task.project_id);
      if (task.key === key) continue;
      out.push(issueItem(task.key, task.title, p?.name, <ProjectMark name={p?.name ?? "?"} color={p?.color} size={16} />, task.id));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, key, running, projects.data, issues.data, byId, t]);

  // Empty field: recent first, then actions and places. Typing: everything, ranked.
  const rows = useMemo(() => {
    if (!text) {
      const recent = recents.map((id) => items.find((i) => i.id === id)).filter((i): i is Item => !!i && i.section !== "issues");
      const rest = items.filter((i) => (i.section === "actions" || i.section === "go") && !recent.includes(i));
      return [...recent.map((i) => ({ ...i, section: "recent" as Section })), ...rest];
    }
    const q = text.toLowerCase();
    return items
      .map((i) => ({ i, s: i.section === "issues" ? 1000 : Math.max(score(q, i.title), ...(i.keywords ?? []).map((k) => score(q, k) * 0.8), 0) }))
      .filter((x) => x.s > 0 || x.i.id === "create" || x.i.id === "start")
      .sort((a, b) => b.s - a.s)
      .map((x) => x.i);
  }, [text, items, recents]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  async function run(item: Item | undefined, alt = false) {
    if (!item || busy) return;
    const fn = alt ? item.alt : item.run;
    if (!fn) return;
    remember(item.id);
    setBusy(true);
    setResult(null);
    try {
      const out = await fn();
      if (out) {
        setResult(out);
        if (out.kind === "ok") setTimeout(hide, 900);
      }
    } catch (e) {
      setResult({ kind: "error", message: e instanceof Error ? e.message : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void run(rows[active], e.metaKey || e.ctrlKey);
    } else if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      void run(rows[Number(e.key) - 1]);
    }
  }

  // Grouped for display, keeping the ranked order inside each group.
  const groups: { section: Section; rows: (Item & { index: number })[] }[] = [];
  rows.slice(0, 30).forEach((r, index) => {
    const g = groups.find((x) => x.section === r.section);
    if (g) g.rows.push({ ...r, index });
    else groups.push({ section: r.section, rows: [{ ...r, index }] });
  });

  return (
    <div onKeyDown={onKeyDown} dir={dir}>
      <div className="drag flex items-center gap-3 border-b border-line px-4 py-3.5">
        <SearchIcon className="size-[18px] shrink-0 text-grid-muted" />
        <input
          ref={input}
          autoFocus
          dir="auto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("qp.placeholder")}
          aria-label={t("qp.placeholder")}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[18px] text-grid-fg outline-none placeholder:text-grid-muted"
          data-qp-input
        />
        <Mark size={18} />
      </div>
      {result ? (
        <div role="status" className={cn("border-b border-line px-4 py-2 text-[13.5px]", result.kind === "ok" ? "text-grid-fg" : "text-destructive")} data-qp-result={result.kind}>
          {result.message}
        </div>
      ) : null}
      <div ref={list} role="listbox" className="max-h-[400px] overflow-y-auto p-1.5">
        {groups.map((g) => (
          <div key={g.section} role="presentation">
            <p className="px-2.5 pt-2 pb-1 text-[11.5px] font-semibold tracking-[0.07em] text-grid-muted uppercase rtl:tracking-normal rtl:normal-case">{t(`qp.section.${g.section}`)}</p>
            {g.rows.map((r) => (
              <div
                key={r.id}
                role="option"
                aria-selected={r.index === active}
                data-index={r.index}
                data-value={r.id}
                onMouseMove={() => setActive(r.index)}
                onClick={() => void run(r)}
                className={cn(
                  "group flex min-h-[46px] items-center gap-3 rounded-[9px] px-2.5 py-1.5",
                  r.index === active && "bg-[color-mix(in_oklab,var(--grid-action)_16%,transparent)]",
                )}
              >
                <span
                  className={cn(
                    "flex size-[30px] shrink-0 items-center justify-center rounded-[7px] [&_svg]:size-4",
                    r.index === active && !r.mark ? "bg-grid-action text-grid-on-action" : "bg-grid-soft text-grid-body",
                    r.index === active && r.mark && "ring-2 ring-grid-action",
                  )}
                >
                  {r.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] text-grid-fg" dir="auto">
                    {r.title}
                  </span>
                  {r.sub ? (
                    <span className="block truncate text-[12.5px] text-grid-muted" dir="auto">
                      {r.sub}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-grid-muted">
                  {r.index === active && r.alt ? (
                    <span className="flex items-center gap-1 text-[12px]">
                      <Kbd combo="mod+enter" /> {t("qp.startTimer")}
                    </span>
                  ) : null}
                  {r.index < 9 ? <Kbd combo={`mod+${r.index + 1}`} /> : null}
                  {r.index === active ? <CornerDownLeftIcon className="size-3.5" /> : null}
                </span>
              </div>
            ))}
          </div>
        ))}
        {rows.length === 0 ? <p className="p-5 text-center text-[13.5px] text-grid-muted">{t("palette.noResults")}</p> : null}
      </div>
      <footer className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[12px] text-grid-muted">
        <span className="flex items-center gap-1.5">
          <Kbd combo="↑↓" /> <Kbd combo="enter" /> {busy ? t("common.loading") : t("qp.run")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd combo="mod+alt+n" /> {t("nav.newIssue")}
          <span className="mx-1.5 h-3 w-px bg-line" />
          <Kbd combo="esc" /> {t("common.close")}
        </span>
      </footer>
    </div>
  );
}

/** A new issue from any app: project, title, details, then status / priority / assignees. ⌘↵. */
function QuickCreate({ seed, onBack }: { seed: string; onBack: () => void }) {
  const { t, dir } = useI18n();
  const { ws } = useApp();
  const me = useUserId();
  const qc = useQueryClient();
  const projects = useProjects();
  const members = useMembers();
  const [project, setProject] = useState<string | null>(null);
  const [title, setTitle] = useState(seed);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [priority, setPriority] = useState("none");
  const [assignees, setAssignees] = useState<string[]>(me ? [me] : []);
  const [done, setDone] = useState<{ key: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const board = useBoard(project);

  useEffect(() => {
    const list = projects.data ?? [];
    const last = localStorage.getItem("mahaam.lastProject");
    setProject((p) => p ?? ((last && list.some((x) => x.id === last) ? last : list[0]?.id) || null));
  }, [projects.data]);
  const statuses = useMemo(() => [...(board.data?.statuses ?? [])].sort((a, b) => a.position - b.position), [board.data]);
  useEffect(() => {
    if (!statuses.length || (status && statuses.some((s) => s.id === status))) return;
    setStatus((statuses.find((s) => s.category === "todo" && s.stage !== "backlog") ?? statuses[0])?.id ?? null);
  }, [statuses, status]);

  const create = useMutation({
    mutationFn: () =>
      api.createTask(project!, {
        title: title.trim(),
        ...(body.trim() ? { description: body.trim() } : {}),
        ...(status ? { status } : {}),
        priority: priority as "none",
        assignee_ids: assignees,
      }),
    onSuccess: (task) => {
      localStorage.setItem("mahaam.lastProject", project!);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === ws });
      setDone({ key: task.key });
    },
  });
  // A beat after it's created the palette goes away — unless you reach for it again.
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(hide, 1800);
    return () => clearTimeout(id);
  }, [done]);

  const ready = !!project && !!title.trim() && !create.isPending;
  const submit = () => ready && create.mutate();
  const another = () => {
    setDone(null);
    setTitle("");
    setBody("");
    create.reset();
    setTimeout(() => titleRef.current?.focus(), 0);
  };

  if (done) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-4"
        dir={dir}
        data-qp-created
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void desktop.openMain({ name: "issue", key: done.key }).then(hide);
          else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") another();
          else if (e.key === "Escape") hide();
        }}
      >
        <span className="flex size-[30px] items-center justify-center rounded-[7px] bg-grid-action text-grid-on-action">
          <SquarePenIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] text-grid-fg">{t("create.created", { key: done.key })}</p>
          <p className="truncate text-[12.5px] text-grid-muted">{title}</p>
        </div>
        <button type="button" onClick={another} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-grid-muted hover:bg-grid-soft hover:text-grid-fg">
          {t("create.another")} <Kbd combo="mod+n" />
        </button>
        <button
          type="button"
          onClick={() => void desktop.openMain({ name: "issue", key: done.key }).then(hide)}
          className="flex items-center gap-1.5 rounded-md bg-grid-action px-2.5 py-1 text-[12.5px] font-medium text-grid-on-action"
        >
          {t("issue.open")} <CornerDownLeftIcon className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex min-h-[420px] flex-col"
      dir={dir}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape" && !(e.target as HTMLElement).closest("[role=menu]")) {
          e.preventDefault();
          if (seed || title) onBack();
          else hide();
        }
      }}
      data-qp-create
    >
      <div className="drag flex items-center gap-2 border-b border-line px-3 py-2.5">
        <button type="button" onClick={onBack} aria-label={t("common.back")} className="flex size-7 items-center justify-center rounded-md text-grid-muted hover:text-grid-fg">
          <ArrowLeftIcon className="size-4 rtl:-scale-x-100" />
        </button>
        <ProjectPicker projects={projects.data ?? []} value={project} onChange={setProject} />
        <span className="text-[13px] text-grid-muted">› {t("nav.newIssue")}</span>
        <span className="ms-auto">
          <Mark size={18} />
        </span>
      </div>
      <input
        ref={titleRef}
        autoFocus
        dir="auto"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("create.titlePlaceholder")}
        className="h-14 w-full bg-transparent px-4 text-[19px] font-medium text-grid-fg outline-none placeholder:text-grid-muted/70"
        data-qp-title
      />
      <textarea
        dir="auto"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("create.descriptionPlaceholder")}
        rows={3}
        className="w-full resize-none bg-transparent px-4 text-[14px] leading-relaxed text-grid-body outline-none placeholder:text-grid-muted/70"
      />
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-1 pb-3">
        <StatusPicker statuses={statuses} value={status} onChange={setStatus} />
        <PriorityPicker value={priority} onChange={setPriority} />
        <AssigneePicker members={members.data ?? []} value={assignees} onToggle={(id) => setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))} />
      </div>
      <div className="flex-1" />
      {create.error ? (
        <p role="alert" className="px-4 pb-2 text-[13px] text-destructive">
          {(create.error as Error).message}
        </p>
      ) : null}
      <footer className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[12px] text-grid-muted">
        <span className="flex items-center gap-1.5">
          <Kbd combo="esc" /> {t("common.back")}
        </span>
        <button type="submit" disabled={!ready} className="flex items-center gap-2 rounded-md bg-grid-action px-3 py-1.5 text-[13px] font-medium text-grid-on-action disabled:opacity-50" data-qp-submit>
          {create.isPending ? t("common.loading") : t("create.submit")}
          <Kbd combo="mod+enter" className="border-transparent bg-transparent text-grid-on-action/80" />
        </button>
      </footer>
    </form>
  );
}
