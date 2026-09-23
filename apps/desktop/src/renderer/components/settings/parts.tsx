// Settings building blocks, laid out like macOS System Settings: a section title, then grouped
// cards of rows divided by hairlines — label and hint on the start side, the control on the end.
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Section({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-[18px]" data-settings-section={id}>
      {/* The window names the section in its title row and tabs: the heading is for assistive tech. */}
      <header>
        <h2 className="sr-only">{title}</h2>
        {description ? <p className="px-1 text-[13.5px] leading-snug text-grid-muted">{description}</p> : null}
      </header>
      {children}
    </div>
  );
}

export function Group({ title, footer, action, children, className }: { title?: string; footer?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className="flex flex-col gap-2">
      {title || action ? (
        <div className="flex min-h-5 items-end justify-between gap-3 px-1">
          {title ? <h3 className="text-[13px] font-semibold text-grid-muted">{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      <div className={cn("settings-card", className)}>{children}</div>
      {footer ? <div className="px-1 text-[12.5px] leading-snug text-grid-muted">{footer}</div> : null}
    </section>
  );
}

export function Row({
  label,
  hint,
  icon,
  children,
  htmlFor,
  className,
  ...rest
}: {
  label: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  className?: string;
  "data-row"?: string;
}) {
  const Label = htmlFor ? "label" : "div";
  return (
    <div className={cn("flex min-h-[52px] items-center gap-4 px-4 py-2.5", className)} {...rest}>
      {icon ? <span className="flex shrink-0 items-center justify-center text-grid-muted">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor} className="block text-[14px] text-grid-fg">
          {label}
        </Label>
        {hint ? <div className="mt-0.5 text-[12.5px] leading-snug text-grid-muted">{hint}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** A compact desktop button: quiet by default, `danger` for destructive actions. */
export function SmallButton({ className, tone = "default", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "danger" | "primary" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[13.5px] whitespace-nowrap disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        tone === "primary"
          ? "border-transparent bg-grid-action font-medium text-grid-on-action hover:opacity-90"
          : tone === "danger"
            ? "border-line bg-background text-grid-danger hover:bg-grid-danger/10"
            : "border-line bg-background text-grid-fg hover:bg-grid-soft",
        className,
      )}
      {...props}
    />
  );
}

/** Two to four choices in one control (a macOS segmented control). */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
  attr,
}: {
  value: V;
  options: { value: V; label: ReactNode; dir?: "ltr" | "rtl"; lang?: string }[];
  onChange: (v: V) => void;
  label: string;
  /** An extra data attribute carrying each option's value (for tests and styles). */
  attr?: `data-${string}`;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          data-value={o.value}
          {...(attr ? { [attr]: o.value } : {})}
          dir={o.dir}
          lang={o.lang}
          onClick={() => onChange(o.value)}
          className="seg-item"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "action" }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[12px] leading-none font-medium",
        tone === "ok" && "bg-grid-ok/15 text-grid-ok",
        tone === "warn" && "bg-grid-warn/15 text-grid-warn",
        tone === "action" && "bg-grid-action/12 text-grid-action",
        tone === "muted" && "bg-grid-soft text-grid-muted",
      )}
    >
      {children}
    </span>
  );
}
