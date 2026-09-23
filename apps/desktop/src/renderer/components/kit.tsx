// Desktop building blocks on top of the grid tokens and the shadcn primitives in ./ui: the status
// and priority glyphs (Linear-style, drawn not imported), avatars, the view header that doubles as
// the window's title bar, keyboard hints and empty/error states.
import { useContext, type CSSProperties, type ReactNode } from "react";

import type { Priority, Status } from "../../shared/types";
import { PanelLeftOpenIcon } from "lucide-react";

import { kbd } from "@/lib/hotkeys";
import { ShellContext } from "@/lib/shell";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ── colour ──────────────────────────────────────────────────────────────────

export const PALETTE = ["violet", "blue", "teal", "green", "amber", "orange", "red", "pink", "slate"] as const;
type PaletteKey = (typeof PALETTE)[number];
const palKey = (k?: string | null): PaletteKey => (PALETTE.includes(k as PaletteKey) ? (k as PaletteKey) : k === "purple" ? "violet" : "slate");
export const solid = (k?: string | null) => `var(--pal-${palKey(k)})`;
export const soft = (k?: string | null) => `color-mix(in oklab, ${solid(k)} var(--pal-soft-mix), transparent)`;

export function ColorDot({ color, className, square }: { color?: string | null; className?: string; square?: boolean }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0", square ? "rounded-[2px]" : "rounded-full", className)} style={{ background: solid(color) }} />;
}

export function ColorChip({ color, children, className }: { color?: string | null; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn("inline-flex h-5 max-w-40 items-center gap-1 truncate rounded-[4px] border px-1.5 text-[12px] leading-none font-medium", className)}
      style={{ background: soft(color), color: solid(color), borderColor: soft(color) }}
    >
      {children}
    </span>
  );
}

/** A project's mark: its colour as a small square with the initial. */
export function ProjectMark({ name, color, size = 16 }: { name: string; color?: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] font-medium"
      style={{ width: size, height: size, fontSize: size * 0.56, background: soft(color), color: solid(color), boxShadow: `inset 0 0 0 1px ${soft(color)}` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ── status & priority glyphs ────────────────────────────────────────────────

/** Backlog is dashed, to-do empty, in progress half, in review three-quarters, done checked. */
export function StatusIcon({ status, size = 14 }: { status?: Pick<Status, "category" | "stage" | "color"> | null; size?: number }) {
  const color = solid(status?.color);
  const stage = status?.stage ?? "";
  const cat = status?.category ?? "todo";
  const r = 6;
  const c = 2 * Math.PI * 3;
  const fill = cat === "done" ? 1 : cat === "doing" ? (stage === "review" ? 0.75 : 0.5) : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      {stage === "backlog" ? (
        <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 2" />
      ) : stage === "canceled" || stage === "cancelled" ? (
        <>
          <circle cx="7" cy="7" r={r} fill={color} />
          <path d="M5 5l4 4M9 5l-4 4" stroke="var(--grid-bg)" strokeWidth="1.4" strokeLinecap="round" />
        </>
      ) : cat === "done" ? (
        <>
          <circle cx="7" cy="7" r={r} fill={color} />
          <path d="M4.4 7.2l1.8 1.8 3.4-3.6" fill="none" stroke="var(--grid-bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="1.5" />
          {fill > 0 ? (
            <circle cx="7" cy="7" r="3" fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${c * fill} ${c}`} transform="rotate(-90 7 7)" />
          ) : null}
        </>
      )}
    </svg>
  );
}

export const PRIORITIES: Priority[] = ["urgent", "high", "medium", "low", "none"];

export function PriorityIcon({ priority, size = 14 }: { priority?: string | null; size?: number }) {
  const p = (priority ?? "none") as Priority;
  if (p === "urgent")
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--grid-action)" />
        <path d="M7 3.8v4" stroke="var(--grid-on-action)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.2" r="0.95" fill="var(--grid-on-action)" />
      </svg>
    );
  if (p === "none")
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
        {[2.5, 6, 9.5].map((x) => (
          <rect key={x} x={x} y="6.4" width="2" height="1.4" rx="0.5" fill="var(--grid-muted)" />
        ))}
      </svg>
    );
  const level = p === "high" ? 3 : p === "medium" ? 2 : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2 + i * 3.6} y={9 - i * 3} width="2.4" height={3 + i * 3} rx="0.6" fill={i < level ? "var(--grid-fg)" : "color-mix(in oklab, var(--grid-muted) 40%, transparent)"} />
      ))}
    </svg>
  );
}

// ── people ──────────────────────────────────────────────────────────────────

const initials = (email: string) => {
  const name = email.split("@")[0] ?? email;
  const parts = name.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
};

/** Everyone gets a stable colour from their id. */
const hue = (id: string) => PALETTE[[...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % (PALETTE.length - 1)];

export function Avatar({ id, email, size = 20, className }: { id: string; email: string; size?: number; className?: string }) {
  const k = hue(id || email);
  const style: CSSProperties = { width: size, height: size, fontSize: size * 0.42, background: soft(k), color: solid(k) };
  return (
    <span title={email} className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium ring-1 ring-background", className)} style={style}>
      {initials(email)}
    </span>
  );
}

export function AvatarStack({ people, size = 18, max = 3 }: { people: { id: string; email: string }[]; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center -space-x-1.5 rtl:space-x-reverse">
      {shown.map((p) => (
        <Avatar key={p.id} id={p.id} email={p.email} size={size} />
      ))}
      {people.length > max ? <span className="ps-2 text-[12px] text-grid-muted">+{people.length - max}</span> : null}
    </span>
  );
}

// ── chrome ──────────────────────────────────────────────────────────────────

export function Kbd({ combo, className }: { combo: string; className?: string }) {
  return (
    <kbd dir="ltr" className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-grid-card px-1 font-mono text-[11.5px] leading-none text-grid-muted", className)}>
      {kbd(combo)}
    </kbd>
  );
}

/**
 * A view's top row, 44px, which is also where the window is dragged from. On macOS in LTR with the
 * sidebar collapsed, and in RTL (sidebar on the right), it keeps clear of the traffic lights.
 */
export function ViewHeader({ title, icon, children, actions, className }: { title?: ReactNode; icon?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  const shell = useContext(ShellContext);
  const { t } = useI18n();
  return (
    <header data-view-header className={cn("drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-4", "view-header", className)}>
      {shell && !shell.sidebarOpen ? (
        <button
          type="button"
          onClick={shell.toggleSidebar}
          title={t("nav.expand")}
          aria-label={t("nav.expand")}
          className="-ms-1 flex size-7 items-center justify-center rounded-md text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
        >
          <PanelLeftOpenIcon className="size-4 rtl:-scale-x-100" />
        </button>
      ) : null}
      {icon}
      {title ? <h1 className="truncate text-[14px] font-medium text-grid-fg">{title}</h1> : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      {icon ? <div className="text-grid-muted [&_svg]:size-8 [&_svg]:stroke-[1.4]">{icon}</div> : null}
      <p className="text-[14px] font-medium text-grid-fg">{title}</p>
      {body ? <p className="max-w-sm text-[13.5px] text-grid-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center" role="alert">
      <p className="text-[14px] text-grid-fg">{error instanceof Error && error.message ? error.message : t("common.error")}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="rounded-md border border-line px-3 py-1 text-[13.5px] hover:bg-grid-soft">
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-grid-muted border-t-transparent", className)} />;
}

/** A row placeholder while a list loads — rows, not a spinner, so the layout does not jump. */
export function RowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 border-b border-line/60 px-4">
          <span className="size-3.5 rounded-full bg-grid-soft" />
          <span className="h-2.5 rounded bg-grid-soft" style={{ width: `${30 + ((i * 37) % 45)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function LtrText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={cn("ltr-isolate", className)}>
      {children}
    </span>
  );
}
