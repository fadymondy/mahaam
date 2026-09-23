// The inbox's left pane: notifications grouped Today / Yesterday / Earlier, two lines each (what it
// is about, then who did what), an unread dot and a compact age. Selection is driven from the view
// (j/k, clicks), so this component only draws and reports clicks.
import { useEffect, useRef } from "react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { dayOf, headline, issueKeyOf, sublineParts, type Day, type Note } from "./model";
import { NoteGlyph } from "./NoteGlyph";
import { LtrText } from "@/components/kit";

/** "now", "5m", "3h", "2d", then a date — in the locale's digits. */
export function useShortAge(): (iso: string) => string {
  const { number, date, locale } = useI18n();
  return (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    const unit = (n: number, u: "minute" | "hour" | "day") => number(n, { style: "unit", unit: u, unitDisplay: "narrow" });
    if (s < 60) return locale === "ar" ? "الآن" : "now";
    if (s < 3600) return unit(Math.floor(s / 60), "minute");
    if (s < 86400) return unit(Math.floor(s / 3600), "hour");
    if (s < 7 * 86400) return unit(Math.floor(s / 86400), "day");
    return date(iso, { day: "numeric", month: "short" });
  };
}

function Subline({ note }: { note: Note }) {
  const { t } = useI18n();
  const { lead, quote } = sublineParts(note, t);
  if (!quote) return <span className="min-w-0 truncate">{lead}</span>;
  return (
    <>
      <span className="max-w-[60%] shrink-0 truncate">{lead}:</span>
      <span dir="auto" className="min-w-0 flex-1 truncate rtl:text-right">
        {quote}
      </span>
    </>
  );
}

export function InboxList({
  notes,
  selected,
  onSelect,
  onOpen,
}: {
  notes: Note[];
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (n: Note) => void;
}) {
  const { t } = useI18n();
  const age = useShortAge();
  const rows = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (selected) rows.current.get(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const groups: { day: Day; notes: Note[] }[] = [];
  for (const n of notes) {
    const day = dayOf(n.created_at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.notes.push(n);
    else groups.push({ day, notes: [n] });
  }

  return (
    <div role="listbox" aria-label={t("nav.inbox")} className="min-h-0 flex-1 overflow-y-auto pb-2" data-inbox-list>
      {groups.map((g) => (
        <div key={g.day} role="group" aria-label={t(`inbox.${g.day}`)}>
          <div className="sticky top-0 z-10 flex h-8 items-end bg-background/95 px-4 pb-1.5 backdrop-blur-sm">
            <span className="grid-micro">{t(`inbox.${g.day}`)}</span>
          </div>
          {g.notes.map((n) => {
            const active = n.id === selected;
            const unread = !n.read_at;
            const key = issueKeyOf(n);
            return (
              <div
                key={n.id}
                ref={(el) => {
                  if (el) rows.current.set(n.id, el);
                  else rows.current.delete(n.id);
                }}
                role="option"
                aria-selected={active}
                data-note={n.id}
                data-unread={unread || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(n.id)}
                onDoubleClick={() => onOpen(n)}
                className={cn(
                  "group relative mx-2 flex gap-3 rounded-md py-2 ps-5 pe-3 [--row:var(--grid-bg)]",
                  active ? "bg-grid-soft [--row:var(--grid-soft)]" : "hover:bg-grid-soft/50",
                )}
              >
                {unread ? <span aria-hidden className="absolute start-2 top-[17px] size-1.5 rounded-full bg-grid-action" /> : null}
                <span className="pt-0.5">
                  <NoteGlyph note={n} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span dir="auto" className={cn("min-w-0 flex-1 truncate text-[13px] rtl:text-right", unread ? "font-medium text-grid-fg" : "text-grid-body")}>{headline(n, t)}</span>
                    <span className="shrink-0 text-[11.5px] text-grid-muted tabular-nums">{age(n.created_at)}</span>
                  </span>
                  <span className="flex min-w-0 items-baseline gap-1.5 text-[12px] text-grid-muted">
                    {key ? <LtrText className="shrink-0 font-mono text-[11px]">{key}</LtrText> : null}
                    <Subline note={n} />
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
