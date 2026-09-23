// An issue description, through the shared safe markdown renderer (raw HTML is printed, never
// interpreted; only http(s)/mailto links), styled for the desktop's 13px density.
import { Markdown } from "../../../../../shared/src/ui/components/markdown";

import { desktop } from "@/lib/bridge";
import { cn } from "@/lib/utils";

export function Prose({ source, className }: { source: string; className?: string }) {
  return (
    <div
      dir="auto"
      className={cn(
        "selectable text-[13.5px] leading-[1.65] text-grid-body",
        "[&_.mgy-md>*+*]:mt-3",
        "[&_h1]:text-[17px] [&_h2]:text-[15.5px] [&_h3]:text-[14px] [&_h4]:text-[13.5px] [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:text-grid-fg [&_.mgy-md>:is(h1,h2,h3)]:mt-5",
        "[&_strong]:font-semibold [&_strong]:text-grid-fg [&_em]:italic",
        "[&_a]:text-grid-action [&_a]:underline [&_a]:decoration-grid-action/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-grid-action",
        "[&_ul]:list-disc [&_ol]:list-decimal [&_:is(ul,ol)]:ps-5 [&_li]:my-0.5 [&_li::marker]:text-grid-muted",
        "[&_blockquote]:border-s-2 [&_blockquote]:border-line [&_blockquote]:ps-3 [&_blockquote]:text-grid-muted",
        "[&_code]:rounded-[4px] [&_code]:bg-grid-soft [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-grid-fg",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-grid-card [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_hr]:border-line",
        className,
      )}
    >
      <Markdown source={source} onOpen={(url) => void desktop.openExternal(url)} />
    </div>
  );
}
