// The quick palette (⌘⇧Space from any app, like Spotlight): type to find an issue and open it (↵)
// or start a timer on it (⌘↵); or pick an action — new issue (captured right here, no need to
// switch apps), start or stop the timer, open Mahaam. Esc or clicking away hides it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowUpRightIcon, CircleDotIcon, InboxIcon, PlayIcon, SquareIcon, SquarePenIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Kbd, LtrText, ProjectMark } from "@/components/kit";
import { ProjectPicker } from "@/components/pickers";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useApp } from "@/lib/app";
import { api, desktop, on } from "@/lib/bridge";
import { useProjectMap, useProjects, useUserId } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useTimer } from "@/shell/Timer";

const hide = () => void desktop.hideSurface();

export function QuickPalette() {
  const { t } = useI18n();
  const { session } = useApp();
  const [mode, setMode] = useState<"search" | "create">("search");
  const [seed, setSeed] = useState("");
  // Every opening starts fresh.
  useEffect(
    () =>
      on("surface:shown", () => {
        setMode("search");
        setSeed("");
        window.dispatchEvent(new Event("mahaam:palette-reset"));
      }),
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mode === "create") setMode("search");
      else hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  return (
    <div className="qp flex h-full flex-col overflow-hidden rounded-[14px] border border-line" data-quick-palette>
      {!session?.workspace ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-[13px] text-grid-muted">{t("pop.signedOut")}</p>
          <button type="button" className="rounded-md bg-grid-action px-3 py-1.5 text-[12.5px] text-grid-on-action" onClick={() => void desktop.openMain().then(hide)}>
            {t("auth.signIn")}
          </button>
        </div>
      ) : mode === "create" ? (
        <QuickCreate seed={seed} onBack={() => setMode("search")} />
      ) : (
        <Search
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
  const { t } = useI18n();
  const { ws } = useApp();
  const byId = useProjectMap();
  const { running, start, stop } = useTimer();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(id);
  }, [query]);
  useEffect(() => {
    const reset = () => setQuery("");
    window.addEventListener("mahaam:palette-reset", reset);
    return () => window.removeEventListener("mahaam:palette-reset", reset);
  }, []);
  const issues = useQuery({ queryKey: qk.tasks(ws, { q: debounced }), queryFn: () => api.tasks({ q: debounced, limit: 10 }), enabled: debounced.length >= 2, staleTime: 10_000 });
  const text = query.trim();
  const key = /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/.test(text) ? text.toUpperCase() : null;

  const open = (k: string) => void desktop.openMain({ name: "issue", key: k }).then(hide);
  const startOn = (taskId: string) => void start({ task: taskId }).then(hide);
  const selected = useRef<string | null>(null);

  const actions: { id: string; label: string; icon: ReactNode; run: () => void; combo?: string }[] = [
    { id: "create", label: text ? t("qp.createNamed", { text }) : t("nav.newIssue"), icon: <SquarePenIcon />, run: () => onCreate(text) },
    running
      ? { id: "stop", label: t("timer.stop"), icon: <SquareIcon />, run: () => void stop().then(hide) }
      : { id: "start", label: text ? t("timer.startFree", { text }) : t("timer.startBlank"), icon: <PlayIcon />, run: () => void start(text ? { description: text } : {}).then(hide) },
    { id: "inbox", label: t("nav.inbox"), icon: <InboxIcon />, run: () => void desktop.openMain({ name: "inbox" }).then(hide) },
    { id: "app", label: t("pop.openApp"), icon: <ArrowUpRightIcon />, run: () => void desktop.openMain().then(hide) },
  ];

  return (
    <Command
      shouldFilter={false}
      loop
      className="rounded-none! bg-transparent p-0"
      onValueChange={(v) => (selected.current = v)}
      onKeyDown={(e) => {
        // ⌘↵ on an issue starts a timer on it instead of opening it.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && selected.current?.startsWith("issue:")) {
          e.preventDefault();
          const id = selected.current.split(":")[2];
          if (id) startOn(id);
        }
      }}
    >
      <div className="border-b border-line px-2 py-2 [&_[data-slot=command-input-wrapper]]:p-0 [&_[data-slot=input-group]]:h-10! [&_[data-slot=input-group]]:border-0! [&_[data-slot=input-group]]:bg-transparent! [&_input]:text-[16px]">
        <CommandInput autoFocus placeholder={t("qp.placeholder")} value={query} onValueChange={setQuery} data-qp-input />
      </div>
      <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto p-1.5">
        <CommandEmpty>{t("palette.noResults")}</CommandEmpty>
        {key ? (
          <CommandGroup heading={t("palette.issues")}>
            <CommandItem value={`key:${key}`} onSelect={() => open(key)}>
              <CircleDotIcon />
              <LtrText className="font-mono">{key}</LtrText>
            </CommandItem>
          </CommandGroup>
        ) : null}
        {(issues.data ?? []).length ? (
          <CommandGroup heading={t("palette.issues")}>
            {issues.data!.map((task) => {
              const p = byId.get(task.project_id);
              return (
                <CommandItem key={task.id} value={`issue:${task.key}:${task.id}`} onSelect={() => open(task.key)}>
                  <ProjectMark name={p?.name ?? "?"} color={p?.color} size={14} />
                  <LtrText className="w-16 shrink-0 font-mono text-[11px] text-grid-muted">{task.key}</LtrText>
                  <span className="flex-1 truncate">{task.title}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        <CommandGroup heading={t("palette.actions")}>
          {actions.map((a) => (
            <CommandItem key={a.id} value={`action:${a.id}`} onSelect={a.run}>
              {a.icon}
              <span className="flex-1 truncate">{a.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <footer className="flex items-center gap-4 border-t border-line px-3 py-2 text-[11px] text-grid-muted">
        <span className="flex items-center gap-1.5">
          <Kbd combo="enter" /> {t("qp.open")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd combo="mod+enter" /> {t("qp.startTimer")}
        </span>
        <span className="ms-auto flex items-center gap-1.5">
          <Kbd combo="esc" /> {t("common.close")}
        </span>
      </footer>
    </Command>
  );
}

/** A new issue without leaving the app you're in: project, title, Enter. */
function QuickCreate({ seed, onBack }: { seed: string; onBack: () => void }) {
  const { t } = useI18n();
  const { ws } = useApp();
  const me = useUserId();
  const qc = useQueryClient();
  const projects = useProjects();
  const [project, setProject] = useState<string | null>(null);
  const [title, setTitle] = useState(seed);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    const list = projects.data ?? [];
    const last = localStorage.getItem("mahaam.lastProject");
    setProject((p) => p ?? ((last && list.some((x) => x.id === last) ? last : list[0]?.id) || null));
  }, [projects.data]);
  const create = useMutation({
    mutationFn: () => api.createTask(project!, { title: title.trim(), assignee_ids: me ? [me] : [] }),
    onSuccess: (task) => {
      localStorage.setItem("mahaam.lastProject", project!);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === ws });
      setDone(task.key);
      setTimeout(hide, 900);
    },
  });
  const ready = useMemo(() => !!project && !!title.trim() && !create.isPending, [project, title, create.isPending]);
  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) create.mutate();
      }}
      data-qp-create
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <button type="button" onClick={onBack} aria-label={t("common.back")} className="flex size-7 items-center justify-center rounded-md text-grid-muted hover:text-grid-fg">
          <ArrowLeftIcon className="size-4 rtl:-scale-x-100" />
        </button>
        <ProjectPicker projects={projects.data ?? []} value={project} onChange={setProject} />
        <span className="text-[12px] text-grid-muted">› {t("nav.newIssue")}</span>
      </div>
      <input
        autoFocus
        dir="auto"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("create.titlePlaceholder")}
        className="h-14 w-full bg-transparent px-4 text-[18px] font-medium text-grid-fg outline-none placeholder:text-grid-muted/70"
        data-qp-title
      />
      <div className="flex-1" />
      {create.error ? <p className="px-4 pb-2 text-[12px] text-destructive">{(create.error as Error).message}</p> : null}
      <footer className="flex items-center justify-between border-t border-line px-3 py-2 text-[11px] text-grid-muted">
        {done ? (
          <span className="text-grid-fg" data-qp-created>
            {t("create.created", { key: done })}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Kbd combo="esc" /> {t("common.back")}
          </span>
        )}
        <button type="submit" disabled={!ready} className="flex items-center gap-2 rounded-md bg-grid-action px-3 py-1.5 text-[12px] font-medium text-grid-on-action disabled:opacity-50">
          {t("create.submit")}
          <Kbd combo="enter" className="border-transparent bg-transparent text-grid-on-action/80" />
        </button>
      </footer>
    </form>
  );
}
