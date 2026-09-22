import { Fragment, type ReactNode } from "react"

/**
 * A small markdown renderer for the panel.
 *
 * Deliberately not a markdown library. The panel ships inside an Electron renderer and a browser
 * extension popup, so every kilobyte is paid for twice, and the subset an issue body actually uses
 * is small enough to read in one sitting.
 *
 * **Raw HTML is printed, never interpreted.** Issue bodies can arrive from the public feedback
 * intake — anyone with a project's `pfk_` key can file one — so treating a body as markup would be
 * a route from a stranger's form straight into the desktop app. There is no `dangerouslySetInnerHTML`
 * anywhere in this file, and that is the point of it.
 *
 * Supported, because it is what issue bodies contain: headings, bold, italic, inline code, fenced
 * and indented code blocks, links, bullet and numbered lists, blockquotes and horizontal rules.
 * Anything else renders as the text you typed, which is the right failure for a reporting tool.
 */

/** Only these can be a link target. `javascript:` and `data:` are the reason this exists. */
function safeHref(url: string): string | null {
  const trimmed = url.trim()
  // Scheme-relative (`//host`) inherits the page scheme, which inside an extension popup is
  // chrome-extension: — nothing good follows.
  if (trimmed.startsWith("//")) return null
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  // A bare path or anchor is fine; it cannot carry a scheme.
  if (/^[/#]/.test(trimmed)) return trimmed
  return null
}

type Inline = { text: string; code?: boolean; bold?: boolean; italic?: boolean; href?: string }

/**
 * Splits one line into styled runs.
 *
 * Code spans are taken first and never re-scanned, so `**` inside backticks stays literal — which
 * matters, because half of what people paste into an issue is code containing exactly these
 * characters.
 */
export function inlines(src: string): Inline[] {
  const out: Inline[] = []
  const pattern =
    /(`+)([\s\S]*?)\1|\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(\*\*|__)(.+?)\5|(\*|_)(.+?)\7|(https?:\/\/[^\s<>()]+)/g

  let last = 0
  for (const m of src.matchAll(pattern)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: src.slice(last, at) })
    if (m[1]) out.push({ text: m[2] ?? "", code: true })
    else if (m[3] !== undefined) {
      const href = safeHref(m[4] ?? "")
      // A rejected scheme keeps the link text and drops the target, so nothing silently vanishes
      // and nobody is one click from a javascript: URL.
      out.push(href ? { text: m[3] || href, href } : { text: m[3] || (m[4] ?? "") })
    } else if (m[5]) out.push({ text: m[6] ?? "", bold: true })
    else if (m[7]) out.push({ text: m[8] ?? "", italic: true })
    else if (m[9]) {
      const href = safeHref(m[9])
      out.push(href ? { text: m[9], href } : { text: m[9] })
    }
    last = at + m[0].length
  }
  if (last < src.length) out.push({ text: src.slice(last) })
  return out.length ? out : [{ text: src }]
}

function Runs({ src, onOpen }: { src: string; onOpen?: (url: string) => void }) {
  return (
    <>
      {inlines(src).map((r, i) => {
        if (r.code) return <code key={i}>{r.text}</code>
        if (r.href) {
          const href = r.href
          return (
            <a
              key={i}
              href={href}
              onClick={
                onOpen
                  ? (e) => {
                      // The host opens it in the real browser. A popover that navigates itself to
                      // an external page has no way back.
                      e.preventDefault()
                      onOpen(href)
                    }
                  : undefined
              }
              rel="noreferrer noopener"
              target="_blank"
            >
              {r.text}
            </a>
          )
        }
        if (r.bold) return <strong key={i}>{r.text}</strong>
        if (r.italic) return <em key={i}>{r.text}</em>
        return <Fragment key={i}>{r.text}</Fragment>
      })}
    </>
  )
}

type Block =
  | { kind: "p" | "quote"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "code"; lines: string[]; lang?: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "hr" }

/** Groups lines into blocks. Exported so the parsing can be tested without rendering React. */
export function blocks(src: string): Block[] {
  const lines = (src ?? "").replace(/\r\n?/g, "\n").split("\n")
  const out: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ""

    // Fenced code. An unterminated fence runs to the end of the body rather than swallowing the
    // rest as prose — a half-pasted snippet is common and should still look like code.
    const fence = /^\s*(```+|~~~+)\s*(\w+)?\s*$/.exec(line)
    if (fence) {
      const close = fence[1]![0]
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^\\s*${close}{3,}\\s*$`).test(lines[i] ?? "")) body.push(lines[i++] ?? "")
      i++ // the closing fence, or past the end
      out.push({ kind: "code", lines: body, lang: fence[2] })
      continue
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push({ kind: "hr" })
      i++
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      out.push({ kind: "h", level: heading[1]!.length, text: heading[2] ?? "" })
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) body.push((lines[i++] ?? "").replace(/^\s*>\s?/, ""))
      out.push({ kind: "quote", lines: body })
      continue
    }

    const bullet = /^\s*[-*+]\s+/
    const numbered = /^\s*\d+[.)]\s+/
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = !bullet.test(line)
      const re = ordered ? numbered : bullet
      const items: string[] = []
      while (i < lines.length && re.test(lines[i] ?? "")) items.push((lines[i++] ?? "").replace(re, ""))
      out.push({ kind: "list", ordered, items })
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    // An indented code block, but only where it is not a continuation of a list.
    if (/^(\t| {4})/.test(line)) {
      const body: string[] = []
      while (i < lines.length && (/^(\t| {4})/.test(lines[i] ?? "") || !(lines[i] ?? "").trim())) {
        body.push((lines[i++] ?? "").replace(/^(\t| {4})/, ""))
      }
      while (body.length && !body[body.length - 1]!.trim()) body.pop()
      out.push({ kind: "code", lines: body })
      continue
    }

    const para: string[] = []
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,6}\s|\s*>|\s*[-*+]\s|\s*\d+[.)]\s|\s*(```|~~~))/.test(lines[i] ?? "")) {
      para.push(lines[i++] ?? "")
    }
    if (para.length) out.push({ kind: "p", lines: para })
    else i++
  }
  return out
}

export function Markdown({ source, onOpen }: { source: string; onOpen?: (url: string) => void }) {
  return (
    <div className="mgy-md">
      {blocks(source).map((b, i) => {
        switch (b.kind) {
          case "h": {
            const H = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[Math.min(b.level, 6) - 1]!
            return (
              <H key={i}>
                <Runs src={b.text} onOpen={onOpen} />
              </H>
            )
          }
          case "code":
            // The one place text is printed verbatim, which is exactly what a code block is for.
            return (
              <pre key={i} dir="ltr">
                <code>{b.lines.join("\n")}</code>
              </pre>
            )
          case "list":
            return b.ordered ? (
              <ol key={i}>
                {b.items.map((t, j) => (
                  <li key={j}>
                    <Runs src={t} onOpen={onOpen} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i}>
                {b.items.map((t, j) => (
                  <li key={j}>
                    <Runs src={t} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            )
          case "quote":
            return (
              <blockquote key={i}>
                <Runs src={b.lines.join("\n")} onOpen={onOpen} />
              </blockquote>
            )
          case "hr":
            return <hr key={i} />
          default:
            return (
              <p key={i}>
                <Runs src={b.lines.join("\n")} onOpen={onOpen} />
              </p>
            )
        }
      })}
    </div>
  )
}
