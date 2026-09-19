import { BRAND, MARK_RECTS } from "../brand";

/** The Mahaam mark. Body colour follows the ground (brandOnDark on dark); the shape never changes. */
export function Mark({ size = 20, title }: { size?: number; title?: string }) {
  return (
    <svg className="mgy-mark" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={title ?? "Mahaam"}>
      {MARK_RECTS.map(([x, y, s, part]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={s} height={s} fill={part === "accent" ? BRAND.accent : "var(--mgy-mark-body)"} />
      ))}
    </svg>
  );
}
