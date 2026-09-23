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
    <a {...props} href={href} target="_blank" rel="noreferrer noopener" className="text-grid-action underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),
  h1: ({ children }) => <h2 className="mt-5 mb-2 text-lg font-semibold text-grid-fg first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold text-grid-fg first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-sm font-semibold text-grid-fg first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-4 mb-1.5 text-sm font-semibold text-grid-fg first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 ps-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 ps-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children, className }) => (
    // GFM task-list items get a "task-list-item" class from remark-gfm; drop the default bullet
    // for those (their own checkbox is the marker).
    <li className={cn(className?.includes("task-list-item") && "ms-[-1.25rem] list-none")}>{children}</li>
  ),
  input: ({ type, checked, ...props }) =>
    type === "checkbox" ? <input {...props} type="checkbox" checked={checked} disabled className="me-1.5 align-middle accent-(--grid-action)" /> : null,
  blockquote: ({ children }) => <blockquote className="my-2 border-s-2 border-line ps-3 text-grid-muted italic">{children}</blockquote>,
  hr: () => <hr className="my-4 border-line" />,
  code: ({ className, children, ...props }) => {
    const inline = !className
    return inline ? (
      <code {...props} dir="ltr" className="ltr-isolate rounded-sm bg-grid-soft px-1 py-0.5 font-mono text-[0.9em] text-grid-fg">
        {children}
      </code>
    ) : (
      <code {...props} className={className}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre dir="ltr" className="ltr-isolate my-2 overflow-x-auto border border-line bg-grid-card p-3 font-mono text-xs leading-5 text-grid-fg">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-line bg-grid-soft px-2 py-1 text-start font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
  strong: ({ children }) => <strong className="font-semibold text-grid-fg">{children}</strong>,
}

// For our own text (the legal and help pages), not user content: a link to one of our pages, an
// anchor or an email address opens where you are; only other sites open in a new tab.
const trustedComponents: Components = {
  ...components,
  // `node` is react-markdown's syntax-tree node, not an attribute; keep it out of the HTML.
  a: ({ node, href, children, ...props }) => {
    const local = !!href && (href.startsWith("/") || href.startsWith("#") || href.startsWith("mailto:"))
    return (
      <a
        {...props}
        href={href}
        {...(local ? {} : { target: "_blank", rel: "noreferrer noopener" })}
        className="text-grid-action underline underline-offset-2 hover:no-underline"
      >
        {children}
      </a>
    )
  },
}

export function Markdown({ children, className, trusted = false }: { children: string; className?: string; trusted?: boolean }) {
  return (
    <div dir="auto" className={cn("text-sm text-grid-body [word-break:break-word]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={trusted ? trustedComponents : components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
