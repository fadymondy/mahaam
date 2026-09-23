// A 24-hour HH:MM field. The native <input type="time"> follows the OS locale (12-hour with AM/PM
// on most Macs) and cannot be narrowed; this one takes "930", "9:30", "21.5", and ↑/↓ step it by
// 5 minutes (⇧ for 15). The parent always holds a valid "HH:MM", or "" while the text is not one.
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export const fieldClass =
  "h-8 rounded-md border border-line bg-background px-2 text-[13.5px] text-grid-fg outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 [color-scheme:light] dark:[color-scheme:dark] aria-invalid:border-grid-danger";

export function normalizeTime(v: string): string {
  const s = v.trim().replace(/\s+/g, "");
  let h: number;
  let m: number;
  const sep = s.match(/^(\d{1,2})[:.](\d{1,2})$/);
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2]);
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) [h, m] = [Number(s), 0];
    else if (s.length === 3) [h, m] = [Number(s.slice(0, 1)), Number(s.slice(1))];
    else [h, m] = [Number(s.slice(0, 2)), Number(s.slice(2))];
  } else return "";
  if (h > 23 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const step = (hhmm: string, by: number) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const t = (((h * 60 + m + by) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function TimeField({
  value,
  onChange,
  className,
  disabled,
  ...rest
}: { value: string; onChange: (v: string) => void; className?: string; disabled?: boolean } & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText((cur) => (normalizeTime(cur) === value ? cur : value));
  }, [value]);
  const bad = !!text && !normalizeTime(text);
  return (
    <input
      {...rest}
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={text}
      placeholder="HH:MM"
      aria-invalid={bad || undefined}
      onChange={(e) => {
        setText(e.target.value);
        onChange(normalizeTime(e.target.value));
      }}
      onBlur={() => {
        const v = normalizeTime(text);
        if (v) setText(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = step(normalizeTime(text) || value || "09:00", (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 15 : 5));
          setText(next);
          onChange(next);
        }
      }}
      onFocus={(e) => e.currentTarget.select()}
      className={cn(fieldClass, "w-[64px] text-center font-mono tabular-nums", className)}
    />
  );
}
