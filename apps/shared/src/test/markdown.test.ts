import { describe, expect, it } from "vitest"

import { blocks, inlines } from "../ui/components/markdown"

/**
 * The renderer's job is to be boring and safe. Issue bodies reach the desktop app from the public
 * feedback intake — anyone holding a project's `pfk_` key can file one — so the injection cases
 * below are the reason this file exists, not an afterthought.
 */

describe("inline parsing", () => {
  it("reads bold, italic, code and links", () => {
    expect(inlines("**b**")).toEqual([{ text: "b", bold: true }])
    expect(inlines("*i*")).toEqual([{ text: "i", italic: true }])
    expect(inlines("`c`")).toEqual([{ text: "c", code: true }])
    expect(inlines("[t](https://a.test)")).toEqual([{ text: "t", href: "https://a.test" }])
  })

  it("does not format inside a code span", () => {
    // Half of what people paste into an issue is code full of asterisks and underscores.
    expect(inlines("`a ** b _c_`")).toEqual([{ text: "a ** b _c_", code: true }])
  })

  it("autolinks a bare URL", () => {
    expect(inlines("see https://a.test/x now")).toEqual([
      { text: "see " },
      { text: "https://a.test/x", href: "https://a.test/x" },
      { text: " now" },
    ])
  })

  it("keeps surrounding text", () => {
    expect(inlines("a **b** c")).toEqual([{ text: "a " }, { text: "b", bold: true }, { text: " c" }])
  })

  it("leaves unmatched markers alone rather than eating them", () => {
    expect(inlines("2 * 3 * 4")).toEqual([{ text: "2 " }, { text: " 3 ", italic: true }, { text: " 4" }])
    expect(inlines("a ** b")).toEqual([{ text: "a ** b" }])
  })

  describe("link targets", () => {
    // A link is the only thing here that can *do* something, so it is the only attack surface.
    const target = (md: string) => inlines(md)[0]?.href

    it("allows http, https and mailto", () => {
      expect(target("[a](https://a.test)")).toBe("https://a.test")
      expect(target("[a](http://a.test)")).toBe("http://a.test")
      expect(target("[a](mailto:x@a.test)")).toBe("mailto:x@a.test")
    })

    it("allows a path or an anchor", () => {
      expect(target("[a](/w/x)")).toBe("/w/x")
      expect(target("[a](#section)")).toBe("#section")
    })

    it("refuses javascript:, data: and file:", () => {
      for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "file:///etc/passwd"]) {
        expect(target(`[click](${bad})`), bad).toBeUndefined()
      }
    })

    it("refuses a scheme-relative URL", () => {
      // `//host` inherits the page's scheme, which in an extension popup is chrome-extension:.
      expect(target("[a](//evil.test)")).toBeUndefined()
    })

    it("keeps the text when it refuses the target, so nothing silently vanishes", () => {
      expect(inlines("[click me](javascript:alert(1))")[0]).toEqual({ text: "click me" })
    })
  })
})

describe("block parsing", () => {
  it("reads headings, paragraphs and rules", () => {
    expect(blocks("# Title")).toEqual([{ kind: "h", level: 1, text: "Title" }])
    expect(blocks("### Three")).toEqual([{ kind: "h", level: 3, text: "Three" }])
    expect(blocks("just text")).toEqual([{ kind: "p", lines: ["just text"] }])
    expect(blocks("---")).toEqual([{ kind: "hr" }])
  })

  it("reads a fenced code block and keeps it verbatim", () => {
    const out = blocks("```go\nfunc main() {\n\t// **not bold**\n}\n```")
    expect(out).toEqual([{ kind: "code", lines: ["func main() {", "\t// **not bold**", "}"], lang: "go" }])
  })

  it("runs an unterminated fence to the end instead of swallowing it as prose", () => {
    // A half-pasted snippet is common, and it should still look like code.
    expect(blocks("```\nkept\nalso kept")).toEqual([{ kind: "code", lines: ["kept", "also kept"], lang: undefined }])
  })

  it("reads both kinds of list", () => {
    expect(blocks("- a\n- b")).toEqual([{ kind: "list", ordered: false, items: ["a", "b"] }])
    expect(blocks("1. a\n2. b")).toEqual([{ kind: "list", ordered: true, items: ["a", "b"] }])
  })

  it("reads a blockquote", () => {
    expect(blocks("> quoted\n> more")).toEqual([{ kind: "quote", lines: ["quoted", "more"] }])
  })

  it("reads an indented code block", () => {
    expect(blocks("    indented()")).toEqual([{ kind: "code", lines: ["indented()"] }])
  })

  it("separates paragraphs on a blank line", () => {
    expect(blocks("one\n\ntwo")).toEqual([
      { kind: "p", lines: ["one"] },
      { kind: "p", lines: ["two"] },
    ])
  })

  it("does not run a paragraph into the block that follows it", () => {
    expect(blocks("text\n- a")).toEqual([
      { kind: "p", lines: ["text"] },
      { kind: "list", ordered: false, items: ["a"] },
    ])
  })

  it("treats raw HTML as text, because it is never interpreted", () => {
    // Nothing downstream renders this as markup — there is no dangerouslySetInnerHTML in the
    // renderer — so it must survive as characters for the reader to see.
    const out = blocks("<script>alert(1)</script>")
    expect(out).toEqual([{ kind: "p", lines: ["<script>alert(1)</script>"] }])
  })

  it("survives an empty or missing body", () => {
    expect(blocks("")).toEqual([])
    expect(blocks(undefined as unknown as string)).toEqual([])
  })

  it("handles CRLF, which is what a Windows paste produces", () => {
    expect(blocks("a\r\n\r\nb")).toEqual([
      { kind: "p", lines: ["a"] },
      { kind: "p", lines: ["b"] },
    ])
  })
})
