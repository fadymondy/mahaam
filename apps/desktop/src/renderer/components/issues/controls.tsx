// Small pieces the issue views share: the segmented control, header buttons, the due date, label
// chips and a thin progress bar.
import { CalendarIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Label } from "../../../shared/types";
import { ColorDot, Kbd, LtrText } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { dueTone } from "./util";

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: V;
  options: { value: V; label: ReactNode; icon?: ReactNode; count?: number; title?: string }[];
  onChange: (v: V) => void;
  label: string;
  className?: string;
}) {
  const { number } = useI18n();
  return (
    <div role="tablist" aria-label={label} className={cn("seg shrink-0", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={o.title}
            data-segment={o.value}
            onClick={() => onChange(o.value)}
            className="seg-item"
          >
            {o.icon}
            {o.label}
            {o.count !== undefined ? <span className="tabular-nums text-grid-muted">{number(o.count)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export const HEADER_BTN =
  "flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-grid-body hover:bg-grid-soft hover:text-grid-fg aria-expanded:bg-grid-soft [&_svg]:size-3.5 [&_svg]:shrink-0";

/** A quiet header button: icon, optional label and shortcut hint. */
export function HeaderButton({
  icon,
  label,
  combo,
  onClick,
  active,
  showLabel = true,
  className,
  ...rest
}: {
  icon?: ReactNode;
  label: string;
  combo?: string;
  onClick?: () => void;
  active?: boolean;
  showLabel?: boolean;
  className?: string;
  "data-action"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        HEADER_BTN,
        active && "bg-grid-soft text-grid-fg",
        !showLabel && "w-7 justify-center px-0",
        className,
      )}
      {...rest}
    >
      {icon}
      {showLabel ? <span>{label}</span> : null}
      {combo ? <Kbd combo={combo} className="ms-0.5" /> : null}
    </button>
  );
}

/** "Sep 30" with a calendar glyph; red when overdue, amber when close. */
export function DueDate({ due, done, className }: { due: string | null | undefined; done: boolean; className?: string }) {
  const { date, t } = useI18n();
  if (!due) return null;
  const tone = dueTone(due, done);
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] border border-line px-1.5 text-[12px] leading-none text-grid-body",
        tone === "overdue" && "border-grid-danger/40 text-grid-danger",
        tone === "soon" && "border-grid-warn/50 text-grid-warn",
        className,
      )}
      title={`${t("issue.due")}: ${date(due, { day: "numeric", month: "long", year: "numeric" })}`}
      data-due={tone ?? "ok"}
    >
      <CalendarIcon className="size-3" />
      <LtrText>{date(due)}</LtrText>
    </span>
  );
}

export function LabelChips({ ids, labels, max = 2, className }: { ids: string[] | null | undefined; labels: Map<string, Label>; max?: number; className?: string }) {
  const list = (ids ?? []).map((id) => labels.get(id)).filter((l): l is Label => !!l);
  if (!list.length) return null;
  return (
    <span className={cn("flex min-w-0 shrink items-center gap-1", className)}>
      {list.slice(0, max).map((l) => (
        <span key={l.id} className="inline-flex h-5 max-w-28 items-center gap-1 rounded-full border border-line px-1.5 text-[12px] leading-none text-grid-body" data-label={l.name}>
          <ColorDot color={l.color} className="size-2" />
          <span className="truncate">{l.name}</span>
        </span>
      ))}
      {list.length > max ? <span className="text-[12px] text-grid-muted">+{list.length - max}</span> : null}
    </span>
  );
}

export function ProgressBar({ value, total, className, color }: { value: number; total: number; className?: string; color?: string }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <span className={cn("relative block h-1 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--grid-muted)_20%,transparent)]", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className="absolute inset-y-0 start-0 rounded-full bg-grid-action" style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} />
    </span>
  );
}

/** A labelled micro heading for a section of the issue view or a panel. */
export function SectionTitle({ children, actions, className }: { children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-7 items-center gap-2", className)}>
      <h2 className="text-[13px] font-medium text-grid-muted">{children}</h2>
      <div className="flex flex-1 items-center justify-end gap-1">{actions}</div>
    </div>
  );
}
