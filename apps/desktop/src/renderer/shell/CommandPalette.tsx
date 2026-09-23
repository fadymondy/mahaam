// ⌘K: go anywhere and do anything from the keyboard — views, projects, issues (searched on the
// server as you type, or opened directly by key: "MH-12"), and actions.
import { useQuery } from "@tanstack/react-query";
import {
  ClockIcon,
  CircleDotIcon,
  InboxIcon,
  LanguagesIcon,
  LayersIcon,
  LogOutIcon,
  MoonIcon,
  PlayIcon,
  SettingsIcon,
  SquareIcon,
  SquarePenIcon,
  SunIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { Route } from "../../shared/types";
import { Kbd, LtrText, ProjectMark } from "@/components/kit";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApp } from "@/lib/app";
import { api, desktop } from "@/lib/bridge";
import { useProjectMap, useProjects } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useRouter } from "@/lib/router";

import { useTimer } from "./Timer";

function useDebounced<T>(value: T, ms = 180): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function CommandPalette({
  open,
  onOpenChange,
  onCreate,
  onTimer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: () => void;
  onTimer: () => void;
}) {
  const { t, locale } = useI18n();
  const { ws, prefs, setPrefs, signOut } = useApp();
  const { navigate } = useRouter();
  const { running, stop } = useTimer();
  const projects = useProjects();
  const byId = useProjectMap();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const issues = useQuery({
    queryKey: qk.tasks(ws, { q }),
    queryFn: () => api.tasks({ q, limit: 12 }),
    enabled: open && q.length >= 2,
    staleTime: 10_000,
  });

  const run = (fn: () => void) => {
    onOpenChange(false);
    // After the dialog's close animation starts, so focus returns to the view first.
    setTimeout(fn, 0);
  };
  const go = (to: Route) => run(() => navigate(to));
  const text = query.trim().toLowerCase();
  const match = (label: string) => !text || label.toLowerCase().includes(text);
  const key = /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/.test(query.trim()) ? query.trim().toUpperCase() : null;
  const dark = prefs.theme === "dark" || (prefs.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const nav: { label: string; icon: ReactNode; to: Route; combo: string }[] = [
    { label: t("nav.inbox"), icon: <InboxIcon />, to: { name: "inbox" }, combo: "g i" },
    { label: t("nav.myIssues"), icon: <CircleDotIcon />, to: { name: "my-issues" }, combo: "g m" },
    { label: t("nav.allProjects"), icon: <LayersIcon />, to: { name: "projects" }, combo: "g p" },
    { label: t("nav.time"), icon: <ClockIcon />, to: { name: "time" }, combo: "g t" },
  ];
  const actions: { label: string; icon: ReactNode; do: () => void; combo?: string }[] = [
    { label: t("nav.newIssue"), icon: <SquarePenIcon />, do: onCreate, combo: "c" },
    running
      ? { label: t("timer.stop"), icon: <SquareIcon />, do: () => void stop() }
      : { label: t("timer.start"), icon: <PlayIcon />, do: onTimer, combo: "mod+shift+t" },
    { label: t("palette.theme"), icon: dark ? <SunIcon /> : <MoonIcon />, do: () => void setPrefs({ theme: dark ? "light" : "dark" }) },
    { label: t("palette.language"), icon: <LanguagesIcon />, do: () => void setPrefs({ locale: locale === "ar" ? "en" : "ar" }) },
    { label: t("nav.settings"), icon: <SettingsIcon />, do: () => void desktop.openSettings(), combo: "mod+," },
    { label: t("common.openInBrowser"), icon: <ExternalLinkIcon />, do: () => void desktop.openWeb() },
    { label: t("nav.signOut"), icon: <LogOutIcon />, do: () => void signOut() },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[14%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[620px]" data-palette>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("palette.placeholder")}</DialogTitle>
          <DialogDescription>{t("palette.placeholder")}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} loop>
          <CommandInput autoFocus placeholder={t("palette.placeholder")} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[420px]">
            <CommandEmpty>{t("palette.noResults")}</CommandEmpty>
            {key ? (
              <CommandGroup heading={t("palette.issues")}>
                <CommandItem value={`key:${key}`} onSelect={() => go({ name: "issue", key })}>
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
                    <CommandItem key={task.id} value={`issue:${task.key}`} onSelect={() => go({ name: "issue", key: task.key })}>
                      <ProjectMark name={p?.name ?? "?"} color={p?.color} size={14} />
                      <LtrText className="w-16 shrink-0 font-mono text-[11px] text-grid-muted">{task.key}</LtrText>
                      <span className="truncate">{task.title}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
            {actions.some((a) => match(a.label)) ? (
              <CommandGroup heading={t("palette.actions")}>
                {actions
                  .filter((a) => match(a.label))
                  .map((a) => (
                    <CommandItem key={a.label} value={`action:${a.label}`} onSelect={() => run(a.do)}>
                      {a.icon}
                      <span className="flex-1 truncate">{a.label}</span>
                      {a.combo ? <Kbd combo={a.combo} /> : null}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ) : null}
            {nav.some((n) => match(n.label)) ? (
              <CommandGroup heading={t("palette.navigation")}>
                {nav
                  .filter((n) => match(n.label))
                  .map((n) => (
                    <CommandItem key={n.label} value={`nav:${n.label}`} onSelect={() => go(n.to)}>
                      {n.icon}
                      <span className="flex-1 truncate">{n.label}</span>
                      <Kbd combo={n.combo} />
                    </CommandItem>
                  ))}
              </CommandGroup>
            ) : null}
            {(projects.data ?? []).some((p) => match(p.name)) ? (
              <CommandGroup heading={t("palette.projects")}>
                {(projects.data ?? [])
                  .filter((p) => match(p.name))
                  .slice(0, 8)
                  .map((p) => (
                    <CommandItem key={p.id} value={`project:${p.id}`} onSelect={() => go({ name: "project", id: p.id })}>
                      <ProjectMark name={p.name} color={p.color} size={14} />
                      <span className="truncate">{p.name}</span>
                    </CommandItem>
                  ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
