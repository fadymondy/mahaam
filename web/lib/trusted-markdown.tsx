import type { MarkdownProps } from "@fadymondy/nasaq/web"

// For our own text (the legal and help pages), not user content: a link to one of our pages, an
// anchor or an email address opens where you are; only other sites open in a new tab. Pass as
// Nasaq <Markdown components={TRUSTED_MARKDOWN}>; user text keeps Nasaq's defaults.
export const TRUSTED_MARKDOWN: MarkdownProps["components"] = {
  // `node` is react-markdown's syntax-tree node, not an attribute; keep it out of the HTML.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a: ({ node, href, children, ...props }) => {
    const local = !!href && (href.startsWith("/") || href.startsWith("#") || href.startsWith("mailto:"))
    return (
      <a
        {...props}
        href={href}
        {...(local ? {} : { target: "_blank", rel: "noreferrer noopener" })}
        className="text-primary underline underline-offset-2 hover:no-underline"
      >
        {children}
      </a>
    )
  },
}
