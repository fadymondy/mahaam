// The menu-bar popover (left-click the tray): the timer companion. What's running, with a big live
// clock and Stop; or a field to start one. Recent work to resume in one click, your open issues to
// start on, and today's total. Vibrant and borderless — it hides when you click elsewhere.
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, PlayIcon, SettingsIcon, SquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { StartInput, TimeEntry } from "../../shared/types";
import { ColorDot, Kbd, LtrText, PriorityIcon } from "@/components/kit";
import { useApp } from "@/lib/app";
import { api, desktop, on } from "@/lib/bridge";
import { useProjectMap, useUserId } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { cn } from "@/lib/utils";
import { clock, useNow, useTimer } from "@/shell/Timer";
import { Mark } from "@/views/SignIn";

const hm = (sec: number) => {
  const m = Math.max(0, Math.floor(sec / 60));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

export function Popover() {
  const { t } = useI18n();
  const { session, workspace } = useApp();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void desktop.hideSurface();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pop flex h-full flex-col overflow-hidden rounded-[12px] border border-line" data-popover>
      <header className="flex items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <Mark size={18} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-tight font-medium text-grid-fg">{t("app.name")}</p>
          {workspace ? <p className="truncate text-[12px] text-grid-muted">{workspace.name}</p> : null}
        </div>
        <IconAction label={t("pop.openApp")} onClick={() => void desktop.openMain().then(() => desktop.hideSurface())}>
          <ArrowUpRightIcon />
        </IconAction>
        <IconAction label={t("nav.settings")} onClick={() => void desktop.openSettings().then(() => desktop.hideSurface())}>
          <SettingsIcon />
        </IconAction>
      </header>
      {session?.workspace ? (
        <Signed />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-[14px] text-grid-muted">{t("pop.signedOut")}</p>
          <button
            type="button"
            className="rounded-md bg-grid-action px-3 py-1.5 text-[13.5px] font-medium text-grid-on-action"
            onClick={() => void desktop.openMain().then(() => desktop.hideSurface())}
          >
            {t("auth.signIn")}
          </button>
        </div>
      )}
    </div>
  );
}

function Signed() {
  const { t } = useI18n();
  const { ws } = useApp();
  const me = useUserId();
  const byId = useProjectMap();
  const { running, busy, start, stop } = useTimer();
  const now = useNow(!!running);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // Opening the popover puts the cursor in the field when nothing runs.
  useEffect(() => on("surface:shown", () => !running && input.current?.focus()), [running]);

  const recent = useQuery({ queryKey: qk.entries(ws, { recent: true, limit: 40 }), queryFn: () => api.entries({ limit: 40 }), enabled: !!ws, staleTime: 15_000 });
  const mine = useQuery({ queryKey: qk.tasks(ws, { assignee: me, open: true }), queryFn: () => api.tasks({ assignee: me, limit: 200 }), enabled: !!ws && !!me });
  const sheet = useQuery({ queryKey: qk.timesheet(ws), queryFn: () => api.timesheet(), enabled: !!ws, staleTime: 30_000 });

  const resume = useMemo(() => {
    const seen = new Set<string>();
    const out: TimeEntry[] = [];
    for (const e of recent.data ?? []) {
      if (!e.ended_at) continue;
      const k = `${e.task_id ?? ""}|${e.project_id ?? ""}|${e.description}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
      if (out.length === 4) break;
    }
    return out;
  }, [recent.data]);
  const issues = useMemo(() => (mine.data ?? []).filter((x) => !x.completed_at).slice(0, 5), [mine.data]);

  // Today's total in the workspace's day, running time included and ticking.
  const today = useMemo(() => {
    const s = sheet.data;
    if (!s) return null;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: s.timezone || undefined }).format(new Date());
    const i = (s.days ?? []).indexOf(day);
    return { base: i >= 0 ? (s.day_totals?.[i] ?? 0) : 0, at: Date.parse(s.now) };
  }, [sheet.data]);
  const todaySecs = today ? today.base + (running && today.at ? Math.max(0, (now - today.at) / 1000) : 0) : null;

  const go = (input: StartInput) => void start(input).then(() => setText(""));
  const label = running ? running.description || running.task_title || running.project_name || t("timer.untitled") : "";
  const where = running ? [running.task_key, running.project_name].filter(Boolean).join(" · ") : "";

  return (
    <>
      <section className={cn("border-b border-line px-3.5 py-3", running && "is-running")} data-pop-timer>
        {running ? (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[12px] text-grid-muted">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-grid-action opacity-70 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-grid-action" />
                </span>
                {t("pop.tracking")}
              </p>
              <LtrText className="pop-clock block font-mono text-[28px] leading-tight font-medium tracking-tight text-grid-action tabular-nums">
                <span data-pop-clock>{clock((now - Date.parse(running.started_at)) / 1000)}</span>
              </LtrText>
              <p className="truncate text-[13.5px] text-grid-fg" title={label}>
                {label}
              </p>
              {where ? <p className="truncate text-[12px] text-grid-muted">{where}</p> : null}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void stop()}
              aria-label={t("timer.stop")}
              title={t("timer.stop")}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-grid-action text-grid-on-action shadow-sm hover:opacity-90 disabled:opacity-60"
              data-pop-stop
            >
              <SquareIcon className="size-4 fill-current" />
            </button>
          </div>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go(text.trim() ? { description: text.trim() } : {});
            }}
          >
            <input
              ref={input}
              dir="auto"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("pop.whatNow")}
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-background px-2.5 text-[14px] outline-none placeholder:text-grid-muted focus:border-grid-action"
              data-pop-input
            />
            <button
              type="submit"
              disabled={busy}
              aria-label={t("timer.start")}
              title={t("timer.start")}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-grid-action text-grid-on-action hover:opacity-90 disabled:opacity-60"
            >
              <PlayIcon className="size-4 fill-current" />
            </button>
          </form>
        )}
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {resume.length ? (
          <Group title={t("pop.resume")}>
            {resume.map((e) => (
              <Row
                key={e.id}
                icon={<ColorDot color={e.project_color ?? "slate"} />}
                title={e.description || e.task_title || e.project_name || t("timer.untitled")}
                sub={[e.task_key, e.project_name].filter(Boolean).join(" · ")}
                onPlay={() => go({ ...(e.task_id ? { task: e.task_id } : e.project_id ? { project: e.project_id } : {}), ...(e.description ? { description: e.description } : {}), billable: e.billable })}
                playLabel={t("timer.start")}
              />
            ))}
          </Group>
        ) : null}
        {issues.length ? (
          <Group title={t("nav.myIssues")}>
            {issues.map((task) => (
              <Row
                key={task.id}
                icon={<PriorityIcon priority={task.priority} />}
                title={task.title}
                sub={[task.key, byId.get(task.project_id)?.name].filter(Boolean).join(" · ")}
                onPlay={() => go({ task: task.id })}
                playLabel={t("timer.start")}
                onOpen={() => void desktop.openMain({ name: "issue", key: task.key }).then(() => desktop.hideSurface())}
                openLabel={t("issue.open")}
              />
            ))}
          </Group>
        ) : null}
      </div>

      <footer className="flex items-center justify-between border-t border-line px-3.5 py-2 text-[12.5px] text-grid-muted">
        <span>
          {t("pop.today")}{" "}
          <LtrText className="font-mono text-grid-fg tabular-nums">{todaySecs === null ? "—" : hm(todaySecs)}</LtrText>
        </span>
        <button type="button" className="flex items-center gap-1.5 hover:text-grid-fg" onClick={() => void desktop.openPalette()}>
          {t("pop.quick")}
          <Kbd combo="mod+shift+space" />
        </button>
      </footer>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-1">
      <p className="grid-micro px-3.5 pt-1.5 pb-1 text-[11.5px]">{title}</p>
      {children}
    </section>
  );
}

function Row({
  icon,
  title,
  sub,
  onPlay,
  playLabel,
  onOpen,
  openLabel,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onPlay: () => void;
  playLabel: string;
  onOpen?: () => void;
  openLabel?: string;
}) {
  return (
    <div className="group mx-1.5 flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 hover:bg-[color-mix(in_oklab,var(--grid-fg)_7%,transparent)]">
      <span className="flex size-4 items-center justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] text-grid-fg" dir="auto">
          {title}
        </p>
        {sub ? <p className="truncate text-[12px] text-grid-muted">{sub}</p> : null}
      </div>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={openLabel} title={openLabel} className="hidden size-6 items-center justify-center rounded text-grid-muted group-hover:flex hover:text-grid-fg">
          <ArrowUpRightIcon className="size-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onPlay}
        aria-label={playLabel}
        title={playLabel}
        className="flex size-6 items-center justify-center rounded-full text-grid-muted hover:bg-grid-action hover:text-grid-on-action"
      >
        <PlayIcon className="size-3 fill-current" />
      </button>
    </div>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-md text-grid-muted hover:bg-[color-mix(in_oklab,var(--grid-fg)_7%,transparent)] hover:text-grid-fg [&_svg]:size-4"
    >
      {children}
    </button>
  );
}
