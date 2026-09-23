// Issue bodies and comments as markdown, through the shared safe renderer (raw HTML is printed,
// never interpreted; only http(s)/mailto links, opened in the real browser).
import { Markdown as SafeMarkdown } from "../../../../../shared/src/ui/components/markdown";

import { desktop } from "@/lib/bridge";
import { cn } from "@/lib/utils";

const PROSE = [
  "selectable text-[14px] leading-[1.6] text-grid-body [overflow-wrap:anywhere]",
  "[&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_blockquote]:my-1.5 [&_pre]:my-2",
  "[&>div>*:first-child]:mt-0 [&>div>*:last-child]:mb-0",
  "[&_h1]:mt-4 [&_h1]:mb-1.5 [&_h1]:text-[16px] [&_h1]:font-semibold [&_h1]:text-grid-fg",
  "[&_h2]:mt-3.5 [&_h2]:mb-1 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-grid-fg",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:text-grid-fg",
  "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-5 [&_ol]:ps-5 [&_li]:my-0.5 [&_li::marker]:text-grid-muted",
  "[&_strong]:font-semibold [&_strong]:text-grid-fg",
  "[&_a]:text-grid-action [&_a]:underline [&_a]:underline-offset-2 [&_a]:cursor-pointer",
  "[&_code]:rounded-[3px] [&_code]:bg-grid-soft [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-grid-fg",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-grid-card [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:whitespace-pre",
  "[&_blockquote]:border-s-2 [&_blockquote]:border-line [&_blockquote]:ps-3 [&_blockquote]:text-grid-muted",
  "[&_hr]:my-3 [&_hr]:border-line",
].join(" ");

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div dir="auto" className={cn(PROSE, className)}>
      <SafeMarkdown source={source} onOpen={(url) => void (/^(https?:|mailto:)/i.test(url) ? desktop.openExternal(url) : null)} />
    </div>
  );
}
