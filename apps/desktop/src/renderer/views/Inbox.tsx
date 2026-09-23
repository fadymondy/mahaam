// The inbox, like Linear's: the list on the start side, the selected notification's issue beside
// it. Keyboard-first — j/k (or ↓/↑) move, Enter opens the issue, e/r mark read. Selecting an item
// marks it read at once (optimistically); the live stream and the dock badge follow.
//
// There is no "mark unread": the API only marks read (one, or all).
import { useQueryClient } from "@tanstack/react-query";
import { CheckCheckIcon, InboxIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Inbox } from "../../shared/types";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/kit";
import { InboxList } from "@/components/inbox/InboxList";
import { InboxPreview, KeyHints } from "@/components/inbox/InboxPreview";
import { targetOf, type Note } from "@/components/inbox/model";
import { PaneHeader } from "@/components/inbox/PaneHeader";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/lib/app";
import { api, desktop } from "@/lib/bridge";
import { useInbox } from "@/lib/data";
import { isTyping, useHotkey } from "@/lib/hotkeys";
import { useI18n } from "@/lib/i18n";
import { qk } from "@/lib/query";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

type Filter = "all" | "unread";

export function InboxView() {
  const { t, number } = useI18n();
  const { ws } = useApp();
  const { navigate } = useRouter();
  const qc = useQueryClient();
  const inbox = useInbox();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  // Read while "Unread" is showing: kept in the list until the filter changes, so an item doesn't
  // vanish from under the cursor the moment it is looked at.
  const [kept, setKept] = useState<Set<string>>(() => new Set());

  const all = inbox.data?.notifications ?? [];
  const unread = inbox.data?.unread ?? 0;
  const notes = useMemo(() => (filter === "all" ? all : all.filter((n) => !n.read_at || kept.has(n.id))), [all, filter, kept]);
  const current = notes.find((n) => n.id === selected) ?? null;

  const patch = useCallback(
    (fn: (d: Inbox) => Inbox) => qc.setQueryData<Inbox>(qk.inbox(ws), (d) => (d ? fn(d) : d)),
    [qc, ws],
  );

  const markRead = useCallback(
    (n: Note) => {
      if (n.read_at) return;
      const now = new Date().toISOString();
      if (filter === "unread") setKept((k) => new Set(k).add(n.id));
      patch((d) => ({
        ...d,
        unread: Math.max(0, (d.unread ?? 0) - 1),
        notifications: (d.notifications ?? []).map((x) => (x.id === n.id ? { ...x, read_at: now } : x)),
      }));
      api.readNotification(n.id).catch(() => void qc.invalidateQueries({ queryKey: qk.inbox(ws) }));
    },
    [filter, patch, qc, ws],
  );

  const markAll = useCallback(() => {
    if (!unread) return;
    const now = new Date().toISOString();
    if (filter === "unread") setKept(new Set(all.filter((n) => !n.read_at).map((n) => n.id)));
    patch((d) => ({ ...d, unread: 0, notifications: (d.notifications ?? []).map((x) => (x.read_at ? x : { ...x, read_at: now })) }));
    api
      .readAllNotifications()
      .then((r) => toast.success(t("inbox.markedAllRead", { count: number(r?.read ?? unread) })))
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : t("common.error"));
        void qc.invalidateQueries({ queryKey: qk.inbox(ws) });
      });
  }, [all, filter, number, patch, qc, t, unread, ws]);

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      const n = id ? all.find((x) => x.id === id) : null;
      if (n) markRead(n);
    },
    [all, markRead],
  );

  const open = useCallback(
    (n: Note) => {
      markRead(n);
      const target = targetOf(n);
      if (!target) return;
      if (target.kind === "route") navigate(target.route);
      else void desktop.openWeb(target.path);
    },
    [markRead, navigate],
  );

  const step = (d: 1 | -1) => {
    if (!notes.length) return;
    const i = notes.findIndex((n) => n.id === selected);
    const next = i < 0 ? (d === 1 ? 0 : notes.length - 1) : Math.min(notes.length - 1, Math.max(0, i + d));
    select(notes[next]!.id);
  };
  useHotkey(["j", "arrowdown"], () => step(1));
  useHotkey(["k", "arrowup"], () => step(-1));
  useHotkey(["e", "r"], () => {
    if (!current) return;
    markRead(current);
    const i = notes.findIndex((n) => n.id === current.id);
    if (i >= 0 && i < notes.length - 1) select(notes[i + 1]!.id);
  });
  // Enter is bound by hand: a focused button or link keeps its own Enter.
  const openRef = useRef(() => {});
  openRef.current = () => current && open(current);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (isTyping(e.target)) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("button, a, [role=menuitem], [role=dialog]")) return;
      e.preventDefault();
      openRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Switching filters starts clean.
  useEffect(() => {
    setKept(new Set());
  }, [filter]);

  if (inbox.isSuccess && all.length === 0)
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-inbox="zero">
        <PaneHeader start>
          <h1 className="text-[14px] font-medium text-grid-fg">{t("nav.inbox")}</h1>
        </PaneHeader>
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl border border-line bg-grid-card">
              <InboxIcon />
            </span>
          }
          title={t("inbox.zeroTitle")}
          body={t("inbox.zeroBody")}
        />
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1" data-inbox>
      <section className="flex w-[360px] shrink-0 flex-col border-e border-line" aria-label={t("nav.inbox")}>
        <PaneHeader start>
          <h1 className="text-[14px] font-medium text-grid-fg">{t("nav.inbox")}</h1>
          {unread ? <span className="text-[13px] text-grid-muted tabular-nums">{number(unread)}</span> : null}
          <div className="ms-auto flex items-center gap-1">
            <div role="radiogroup" aria-label={t("inbox.filter")} className="flex h-7 items-center rounded-md border border-line bg-grid-card p-0.5">
              {(["all", "unread"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={filter === f}
                  data-filter={f}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "h-[22px] rounded-[4px] px-2 text-[13px]",
                    filter === f ? "bg-background font-medium text-grid-fg shadow-[0_0_0_1px_var(--grid-line)]" : "text-grid-muted hover:text-grid-fg",
                  )}
                >
                  {t(`inbox.${f}`)}
                </button>
              ))}
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={markAll}
                    disabled={!unread}
                    aria-label={t("inbox.markAllRead")}
                    data-mark-all
                    className="flex size-7 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-fg disabled:opacity-40 disabled:hover:bg-transparent"
                  />
                }
              >
                <CheckCheckIcon className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{t("inbox.markAllRead")}</TooltipContent>
            </Tooltip>
          </div>
        </PaneHeader>
        {inbox.isPending ? (
          <RowsSkeleton rows={9} />
        ) : inbox.isError ? (
          <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />
        ) : notes.length === 0 ? (
          <EmptyState
            icon={<CheckCheckIcon />}
            title={t("inbox.noUnreadTitle")}
            body={t("inbox.noUnreadBody")}
            action={
              <button type="button" onClick={() => setFilter("all")} className="rounded-md border border-line px-3 py-1 text-[13.5px] hover:bg-grid-soft">
                {t("inbox.showAll")}
              </button>
            }
          />
        ) : (
          <InboxList notes={notes} selected={selected} onSelect={select} onOpen={open} />
        )}
      </section>

      {current ? (
        <InboxPreview key={current.id} note={current} onOpen={open} />
      ) : (
        <section className="flex min-w-0 flex-1 flex-col">
          <PaneHeader>
            <span />
          </PaneHeader>
          <EmptyState
            icon={
              <span className="flex size-12 items-center justify-center rounded-xl border border-line bg-grid-card">
                <InboxIcon />
              </span>
            }
            title={t("inbox.pickTitle")}
            body={t("inbox.pickBody")}
          />
          <KeyHints />
        </section>
      )}
    </div>
  );
}
