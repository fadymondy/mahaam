"use client"

// Renders Markdown for issue bodies and comments (GitHub-flavoured: tables, task lists, strike-
// through, autolinks). No raw HTML is passed through — react-markdown escapes it by default, so
// a pasted <script> or an @mention that happens to look like a tag renders as plain text, not
// markup. Links open in a new tab with rel="noreferrer" since the content is user-authored.
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

const components: Components = {
  a: ({ href, children, ...props }) => (
    <a {...props} href={href} target="_blank" rel="noreferrer noopener" className="text-nq-accent-text underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),
  h1: ({ children }) => <h2 className="mt-5 mb-2 text-lg font-semibold text-foreground first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-sm font-semibold text-foreground first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-4 mb-1.5 text-sm font-semibold text-foreground first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 ps-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 ps-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children, className }) => (
    // GFM task-list items get a "task-list-item" class from remark-gfm; drop the default bullet
    // for those (their own checkbox is the marker).
    <li className={cn(className?.includes("task-list-item") && "ms-[-1.25rem] list-none")}>{children}</li>
  ),
  input: ({ type, checked, ...props }) =>
    type === "checkbox" ? <input {...props} type="checkbox" checked={checked} disabled className="me-1.5 align-middle accent-(--nq-action)" /> : null,
  blockquote: ({ children }) => <blockquote className="my-2 border-s-2 border-border ps-3 text-muted-foreground italic">{children}</blockquote>,
  hr: () => <hr className="my-4 border-border" />,
  code: ({ className, children, ...props }) => {
    const inline = !className
    return inline ? (
      <code {...props} dir="ltr" className="ltr-isolate rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">
        {children}
      </code>
    ) : (
      <code {...props} className={className}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre dir="ltr" className="ltr-isolate my-2 overflow-x-auto border border-border bg-card p-3 font-mono text-xs leading-5 text-foreground">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border bg-muted px-2 py-1 text-start font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div dir="auto" className={cn("text-sm text-nq-fg-body [word-break:break-word]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
