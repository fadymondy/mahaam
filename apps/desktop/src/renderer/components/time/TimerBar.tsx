// The top of the Time view: what is running (live clock, inline-editable description and target,
// stop, discard), or — when nothing is — a composer: "What are you working on?", a project or
// issue, Enter starts. Like Toggl's timer bar, drawn in the grid.
import { PlayIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { TimeEntry } from "../../../shared/types";
import { ColorDot, Kbd, LtrText } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { clock, useNow } from "@/shell/Timer";

import { useTimeWrites } from "./data";
import { errorText, timeIn } from "./format";
import { NO_TARGET, sameTarget, TargetPicker, targetOf, type Target } from "./TargetPicker";

const targetStart = (tg: Target) => (tg.task ? { task: tg.task.id } : tg.project ? { project: tg.project } : {});

export function TimerBar({ running, tz, onDiscard }: { running: TimeEntry | null; tz: string; onDiscard: (e: TimeEntry) => void }) {
  return running ? <Running key={running.id} entry={running} tz={tz} onDiscard={onDiscard} /> : <Composer />;
}

function Composer() {
  const { t } = useI18n();
  const { start } = useTimeWrites();
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target>(NO_TARGET);
  const go = () => {
    if (start.isPending) return;
    start.mutate(
      { ...targetStart(target), ...(text.trim() ? { description: text.trim() } : {}) },
      {
        onSuccess: () => {
          setText("");
          setTarget(NO_TARGET);
        },
        onError: (e) => toast.error(errorText(e, t("common.error"))),
      },
    );
  };
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-grid-card ps-4 pe-3" data-time-composer>
      <PlayIcon className="size-4 shrink-0 text-grid-muted" />
      <input
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            go();
          } else if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        placeholder={t("time.whatAreYouDoing")}
        className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-grid-fg outline-none placeholder:text-grid-muted/80"
        data-time-composer-input
      />
      <TargetPicker value={target} onChange={setTarget} variant="ghost" className="max-w-64" />
      <LtrText className="w-[76px] text-end font-mono text-[18px] text-grid-muted tabular-nums">0:00:00</LtrText>
      <Button size="sm" onClick={go} disabled={start.isPending} className="gap-1.5 bg-grid-action text-grid-on-action hover:bg-grid-action/90" data-time-start>
        <PlayIcon className="size-3 fill-current" />
        {t("time.start")}
        <Kbd combo="enter" className="border-grid-on-action/30 bg-transparent text-grid-on-action/80" />
      </Button>
    </div>
  );
}

function Running({ entry, tz, onDiscard }: { entry: TimeEntry; tz: string; onDiscard: (e: TimeEntry) => void }) {
  const { t } = useI18n();
  const { update, stop } = useTimeWrites();
  const now = useNow(true);
  const [draft, setDraft] = useState(entry.description);
  const editing = useRef(false);
  // Follow changes made elsewhere unless the person is mid-edit.
  useEffect(() => {
    if (!editing.current) setDraft(entry.description);
  }, [entry.description]);

  const commit = () => {
    editing.current = false;
    const v = draft.trim();
    if (v === entry.description) return;
    update.mutate({ id: entry.id, patch: { description: v } }, { onError: (e) => (toast.error(errorText(e, t("common.error"))), setDraft(entry.description)) });
  };
  const retarget = (tg: Target) => {
    if (sameTarget(tg, targetOf(entry))) return;
    update.mutate({ id: entry.id, patch: { project: tg.project ?? "", task: tg.task?.id ?? "" } }, { onError: (e) => toast.error(errorText(e, t("common.error"))) });
  };
  const secs = (now - Date.parse(entry.started_at)) / 1000;

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-grid-card ps-4 pe-3" data-time-running={entry.id}>
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-grid-action opacity-60 motion-reduce:animate-none" />
        <ColorDot color={entry.project_color ?? "violet"} className="relative size-2" />
      </span>
      <input
        dir="auto"
        value={draft}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            editing.current = false;
            setDraft(entry.description);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        placeholder={entry.task_title || t("time.whatAreYouDoing")}
        className="h-9 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[14px] text-grid-fg outline-none placeholder:text-grid-muted hover:bg-grid-soft/60 focus:bg-background"
        data-time-running-description
      />
      <TargetPicker value={targetOf(entry)} onChange={retarget} variant="ghost" className="max-w-64" />
      <span className="hidden shrink-0 text-[12px] text-grid-muted md:inline">
        {t("time.since")} <LtrText className="font-mono tabular-nums">{timeIn(entry.started_at, tz)}</LtrText>
      </span>
      <LtrText className="min-w-[76px] text-end font-mono text-[18px] font-medium text-grid-fg tabular-nums">
        <span data-time-clock>{clock(secs)}</span>
      </LtrText>
      <button
        type="button"
        onClick={() => onDiscard(entry)}
        title={t("time.discard")}
        aria-label={t("time.discard")}
        className="flex size-8 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-danger"
        data-time-discard
      >
        <Trash2Icon className="size-4" />
      </button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => stop.mutate(undefined, { onError: (e) => toast.error(errorText(e, t("common.error"))) })}
        disabled={stop.isPending}
        className="gap-1.5"
        data-time-stop
      >
        <SquareIcon className="size-3 fill-current" />
        {t("time.stop")}
      </Button>
    </div>
  );
}
