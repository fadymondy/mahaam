// The person behind a notification with a small badge for what happened (assigned, mentioned,
// done…), like Linear's inbox; reminders and alerts, which have no person, show the kind alone.
import {
  AtSignIcon,
  BellIcon,
  CalendarXIcon,
  CheckIcon,
  GaugeIcon,
  MessageSquareIcon,
  TimerIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";

import { Avatar, soft, solid } from "@/components/kit";
import { cn } from "@/lib/utils";

import { actorOf, kindOf, type Note, type NoteKind } from "./model";

const LOOK: Record<NoteKind, { icon: LucideIcon; color: string }> = {
  assigned: { icon: UserPlusIcon, color: "blue" },
  mentioned: { icon: AtSignIcon, color: "violet" },
  done: { icon: CheckIcon, color: "green" },
  budget: { icon: GaugeIcon, color: "orange" },
  timer: { icon: TimerIcon, color: "amber" },
  missingDay: { icon: CalendarXIcon, color: "slate" },
  request: { icon: MessageSquareIcon, color: "teal" },
  other: { icon: BellIcon, color: "slate" },
};

export function KindIcon({ note, className }: { note: Pick<Note, "kind">; className?: string }) {
  const { icon: Icon, color } = LOOK[kindOf(note)];
  return <Icon className={cn("size-3.5", className)} style={{ color: solid(color) }} aria-hidden />;
}

export function NoteGlyph({ note, size = 24 }: { note: Note; size?: number }) {
  const kind = kindOf(note);
  const { icon: Icon, color } = LOOK[kind];
  const actor = actorOf(note);
  if (!actor)
    return (
      <span
        aria-hidden
        className="flex shrink-0 items-center justify-center self-start rounded-full"
        style={{ width: size, height: size, background: soft(color), color: solid(color) }}
      >
        <Icon style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2} />
      </span>
    );
  return (
    <span className="relative flex h-fit shrink-0 self-start" aria-hidden>
      <Avatar id={actor.id} email={actor.email} size={size} className="ring-0" />
      <span
        className="absolute -end-1 -bottom-1 flex items-center justify-center rounded-full ring-2 ring-[var(--row,var(--grid-bg))]"
        style={{ width: size * 0.58, height: size * 0.58, background: solid(color), color: "var(--grid-bg)" }}
      >
        <Icon style={{ width: size * 0.38, height: size * 0.38 }} strokeWidth={2.6} />
      </span>
    </span>
  );
}
