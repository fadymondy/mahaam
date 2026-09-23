// Log time after the fact: a day, then either start–end or a duration (the server places a bare
// duration after your last entry that day), what it was for, a note, billable. ⌘↵ saves. What the
// server refuses (an overlap, the future, a locked week) is said in the dialog, not in a toast.
import { AlertCircleIcon, TimerIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { LogInput } from "../../../shared/types";
import { Kbd, LtrText } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useProjectMap } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { useTimeWrites } from "./data";
import { errorText, hm, parseDuration } from "./format";
import { NO_TARGET, TargetPicker, type Target } from "./TargetPicker";
import { fieldClass, TimeField } from "./TimeField";

export interface LogPreset {
  date?: string;
  target?: Target;
}

type Mode = "range" | "duration";
const MODE_KEY = "mahaam.time.logMode";

export function LogTime({ open, onOpenChange, preset, today }: { open: boolean; onOpenChange: (o: boolean) => void; preset: LogPreset; today: string }) {
  const { t } = useI18n();
  const byId = useProjectMap();
  const { log } = useTimeWrites();
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) || "duration");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [dur, setDur] = useState("1:00");
  const [target, setTarget] = useState<Target>(NO_TARGET);
  const [desc, setDesc] = useState("");
  const [billable, setBillable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const descRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDate(preset.date ?? today);
    setTarget(preset.target ?? NO_TARGET);
    setDesc("");
    setBillable(null);
    setError(null);
    log.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => localStorage.setItem(MODE_KEY, mode), [mode]);

  const project = target.project ? byId.get(target.project) : undefined;
  const billableShown = billable ?? project?.billing_mode === "hourly";
  const minutes = parseDuration(dur);
  const rangeMinutes = (() => {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => n === undefined || Number.isNaN(n))) return 0;
    let m = eh! * 60 + em! - (sh! * 60 + sm!);
    if (m <= 0) m += 24 * 60; // 23:00–01:00 ends the next day
    return m;
  })();
  const valid = !!date && (mode === "duration" ? minutes > 0 && minutes <= 1440 : !!start && !!end && start !== end);

  const submit = () => {
    if (!valid || log.isPending) return;
    setError(null);
    const input: LogInput = {
      date,
      ...(target.task ? { task: target.task.id } : target.project ? { project: target.project } : {}),
      ...(desc.trim() ? { description: desc.trim() } : {}),
      ...(billable !== null ? { billable } : {}),
      ...(mode === "duration" ? { minutes } : { started_at: start, ended_at: end }),
    };
    log.mutate(input, {
      onSuccess: () => {
        toast.success(t("time.logged", { time: hm((mode === "duration" ? minutes : rangeMinutes) * 60) }));
        onOpenChange(false);
      },
      onError: (e) => setError(errorText(e, t("common.error"))),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[14%] translate-y-0 gap-0 p-0 sm:max-w-[560px]"
        data-log-time
        initialFocus={descRef}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader className="flex-row items-center gap-2 px-4 pt-3.5 pb-1">
          <TargetPicker value={target} onChange={setTarget} className="max-w-72" />
          <span className="text-grid-muted">›</span>
          <DialogTitle className="text-[12.5px] font-normal text-grid-muted">{t("time.logTime")}</DialogTitle>
          <DialogDescription className="sr-only">{t("time.logHint")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-4 pt-2 pb-4">
          <input
            ref={descRef}
            dir="auto"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("time.whatDidYouDo")}
            className="h-9 w-full bg-transparent text-[16px] font-medium text-grid-fg outline-none placeholder:text-grid-muted/70"
            data-log-description
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <span className="sr-only">{t("time.date")}</span>
              <input type="date" dir="ltr" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={cn(fieldClass, "w-[140px]")} data-log-date />
            </label>
            <div className="flex h-8 items-center rounded-md border border-line p-0.5" role="radiogroup" aria-label={t("time.mode")}>
              {(["duration", "range"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn("h-full rounded-[5px] px-2.5 text-[12px]", mode === m ? "bg-grid-soft text-grid-fg" : "text-grid-muted hover:text-grid-fg")}
                  data-log-mode={m}
                >
                  {m === "duration" ? t("time.duration") : t("time.startEnd")}
                </button>
              ))}
            </div>
            {mode === "duration" ? (
              <input
                dir="ltr"
                value={dur}
                onChange={(e) => setDur(e.target.value)}
                placeholder="1:30"
                aria-label={t("time.duration")}
                aria-invalid={!!dur && !minutes}
                className={cn(fieldClass, "w-[88px] font-mono tabular-nums")}
                data-log-duration
              />
            ) : (
              <div className="flex items-center gap-1.5" dir="ltr">
                <TimeField value={start} onChange={setStart} aria-label={t("time.start")} data-log-start />
                <span className="text-grid-muted">–</span>
                <TimeField value={end} onChange={setEnd} aria-label={t("time.end")} data-log-end />
              </div>
            )}
            <Span seconds={(mode === "duration" ? minutes : rangeMinutes) * 60} />
          </div>
          {mode === "duration" ? <p className="text-[11.5px] text-grid-muted">{t("time.durationHint")}</p> : null}
          {error ? (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-grid-danger/40 bg-grid-danger/8 px-2.5 py-2 text-[12.5px] text-grid-fg" data-log-error>
              <AlertCircleIcon className="mt-px size-3.5 shrink-0 text-grid-danger" />
              <span className="min-w-0 flex-1">{error}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <label className="flex items-center gap-2 text-[12px] text-grid-muted">
            <Switch checked={billableShown} onCheckedChange={(v) => setBillable(v)} size="sm" data-log-billable />
            {t("time.billable")}
          </label>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={submit} disabled={!valid || log.isPending} data-log-submit>
              {t("time.logTime")}
              <Kbd combo="mod+enter" className="border-primary-foreground/30 bg-transparent text-primary-foreground/80" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The length a start–end or a typed duration comes to. */
export function Span({ seconds }: { seconds: number }) {
  if (!seconds) return null;
  return (
    <span className="flex items-center gap-1 text-[12px] text-grid-muted" data-span>
      <TimerIcon className="size-3.5" />
      <LtrText className="font-mono tabular-nums">{hm(seconds)}</LtrText>
    </span>
  );
}
