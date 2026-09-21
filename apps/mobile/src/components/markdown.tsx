import { marked, type Token, type Tokens } from "marked";
import { Fragment, useMemo, type ReactNode } from "react";
import { Linking, ScrollView, Text, View } from "react-native";

import { useTheme } from "../theme";
import { font, space, type Palette } from "../theme/tokens";
import { T } from "./ui";

/**
 * Markdown drawn with native views, ported from fadymondy.com-v2's grid-native renderer so issue
 * bodies read the same on mobile as they do on the web and in the desktop panel.
 *
 * Parsed with `marked` — the same parser the web surfaces use — so the three renderers agree on
 * what a document means. Raw HTML is printed as text and never interpreted: issue bodies are
 * user-authored, and a phone is the last place to start rendering untrusted markup.
 *
 * Colours are passed down explicitly rather than read from a component's default, because a
 * default resolves against the app palette and quietly goes invisible inside a themed block.
 */

type Ctx = { c: Palette; open: (href: string) => void };

/** Only schemes a reader expects a tap to open. No javascript:, no file:. */
const SAFE_LINK = /^(https?:|mailto:)/i;

const HEADING_SIZE: Record<number, number> = { 1: 22, 2: 19, 3: 16.5, 4: 15, 5: 14, 6: 14 };

function inline(tokens: Token[] | undefined, ctx: Ctx, key = "i"): ReactNode[] {
  if (!tokens) return [];
  const { c } = ctx;
  return tokens.map((tok, i) => {
    const k = `${key}.${i}`;
    switch (tok.type) {
      case "text":
        // Inline HTML arrives as 'text' with no child tokens — printed, not interpreted.
        return "tokens" in tok && tok.tokens?.length ? <Fragment key={k}>{inline(tok.tokens, ctx, k)}</Fragment> : tok.text;
      case "escape":
        return tok.text;
      case "strong":
        return (
          <Text key={k} style={{ fontWeight: "600", color: c.fg }}>
            {inline(tok.tokens, ctx, k)}
          </Text>
        );
      case "em":
        // Lusail ships no italic and Android would substitute another face mid-sentence, so
        // emphasis is the brighter text colour instead — same choice as grid-native.
        return (
          <Text key={k} style={{ color: c.fg }}>
            {inline(tok.tokens, ctx, k)}
          </Text>
        );
      case "del":
        return (
          <Text key={k} style={{ textDecorationLine: "line-through" }}>
            {inline(tok.tokens, ctx, k)}
          </Text>
        );
      case "codespan":
        return (
          <Text key={k} style={{ fontFamily: "monospace", fontSize: 12.5, backgroundColor: c.soft, color: c.fg }}>
            {` ${tok.text} `}
          </Text>
        );
      case "link":
      case "image":
        return (
          <Text
            key={k}
            accessibilityRole="link"
            style={{ color: c.accentText, textDecorationLine: "underline" }}
            onPress={SAFE_LINK.test(tok.href) ? () => ctx.open(tok.href) : undefined}
          >
            {tok.type === "link" ? inline(tok.tokens, ctx, k) : tok.text || tok.href}
          </Text>
        );
      case "br":
        return "\n";
      default:
        return "raw" in tok ? (tok.raw as string) : null;
    }
  });
}

function Block({ tok, ctx }: { tok: Token; ctx: Ctx }): ReactNode {
  const { c } = ctx;
  switch (tok.type) {
    case "space":
      return null;

    case "heading": {
      const size = HEADING_SIZE[tok.depth] ?? 14;
      const text = <Text style={{ fontWeight: "600", fontSize: size, lineHeight: size * 1.5, color: c.fg }}>{inline(tok.tokens, ctx)}</Text>;
      // h1 and h2 carry a hairline, matching the web and desktop reading style.
      return tok.depth <= 2 ? (
        <View style={{ borderBottomWidth: 1, borderBottomColor: c.line, paddingBottom: 6, marginTop: 6 }}>{text}</View>
      ) : (
        text
      );
    }

    case "paragraph":
      return <Text style={{ color: c.body, fontSize: font.size.sm, lineHeight: 22 }}>{inline(tok.tokens, ctx)}</Text>;

    case "text":
      return (
        <Text style={{ color: c.body, fontSize: font.size.sm, lineHeight: 22 }}>
          {"tokens" in tok && tok.tokens?.length ? inline(tok.tokens, ctx) : tok.text}
        </Text>
      );

    case "list": {
      const list = tok as Tokens.List;
      const start = typeof list.start === "number" ? list.start : 1;
      return (
        <View style={{ gap: 6 }}>
          {list.items.map((item, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              {item.task ? (
                <View
                  style={{
                    width: 14,
                    height: 14,
                    marginTop: 6,
                    borderRadius: 3,
                    borderWidth: 1,
                    borderColor: item.checked ? c.accent : c.line,
                    backgroundColor: item.checked ? c.accent : "transparent",
                  }}
                />
              ) : (
                <Text style={{ fontFamily: "monospace", color: c.accentText, minWidth: 18, lineHeight: 24 }}>
                  {list.ordered ? `${start + i}.` : "—"}
                </Text>
              )}
              <View style={{ flex: 1, gap: 6 }}>
                {item.tokens.map((child, j) => (
                  <Block key={j} tok={child} ctx={ctx} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    }

    case "code":
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: c.soft, borderRadius: 6 }}>
          <Text style={{ fontFamily: "monospace", fontSize: 12.5, color: c.fg, padding: space.sm }}>{tok.text}</Text>
        </ScrollView>
      );

    case "blockquote":
      return (
        <View style={{ borderLeftWidth: 2, borderLeftColor: c.line, paddingLeft: space.sm, gap: 6 }}>
          {("tokens" in tok ? (tok.tokens ?? []) : []).map((child, i) => (
            <Block key={i} tok={child} ctx={ctx} />
          ))}
        </View>
      );

    case "hr":
      return <View style={{ height: 1, backgroundColor: c.line, marginVertical: space.xs }} />;

    case "html":
      // Never interpreted. Shown verbatim so a pasted <script> reads as text.
      return <Text style={{ fontFamily: "monospace", fontSize: 12.5, color: c.muted }}>{tok.raw}</Text>;

    default:
      return "raw" in tok ? <Text style={{ color: c.body }}>{tok.raw as string}</Text> : null;
  }
}

export function Markdown({ children }: { children: string | null | undefined }) {
  const { c } = useTheme();
  const tokens = useMemo(() => (children ? marked.lexer(children) : []), [children]);
  if (!children) return null;
  const ctx: Ctx = { c, open: (href) => void Linking.openURL(href).catch(() => null) };
  return (
    <View style={{ gap: space.sm }}>
      {tokens.map((tok, i) => (
        <Block key={i} tok={tok} ctx={ctx} />
      ))}
    </View>
  );
}
