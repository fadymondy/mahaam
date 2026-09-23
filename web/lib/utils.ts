import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// text-meta is our own font-size step (app/styles/mahaam-type.css). Without this, tailwind-merge
// reads it as a text colour and drops it next to text-grid-muted.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["meta"] }] } },
});

// cn merges class names with Tailwind-aware conflict resolution (shadcn/prism convention).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
