// The week in four numbers, as the grid's edge-sharing stat cells: one hairline between cells, a
// micro label, a mono figure.
import { LtrText } from "@/components/kit";
import { cn } from "@/lib/utils";

import { hm } from "./format";

export interface Stat {
  key: string;
  label: string;
  seconds: number;
  hint?: string;
  accent?: boolean;
}

export function Summary({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid shrink-0 border-b border-line" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }} data-time-summary>
      {stats.map((s, i) => (
        <div key={s.key} className={cn("flex min-w-0 flex-col gap-1.5 px-4 py-3", i > 0 && "border-s border-line")} data-stat={s.key}>
          <span className="grid-micro truncate">{s.label}</span>
          <div className="flex items-baseline gap-2">
            <LtrText className={cn("font-mono text-[22px] leading-none font-medium tabular-nums", s.accent ? "text-grid-fg" : "text-grid-fg/90")}>
              {hm(s.seconds, "0:00")}
            </LtrText>
            {s.hint ? <span className="truncate text-[11.5px] text-grid-muted">{s.hint}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
