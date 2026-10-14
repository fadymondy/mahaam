// Readable type, everywhere (owner request: "make the font size readable as UX everywhere").
//
// The rule: nothing a person reads is below 12pt (uppercase micro-labels: 11.5); body and row titles
// are 15–16 on a phone; meta and secondary text at least 13; Arabic (IBM Plex Sans Arabic) one point up, because
// its glyphs sit smaller than Inter's at the same size.
//
// Three layers, all outside the generated grid (src/grid is never edited here):
//  1. The grid's `type` scale is swapped for the readable one at startup, the same way lib/fonts.ts
//     swaps its faces. Every AppText variant (bigHeader … micro) and the tab labels read it at
//     render time. A language switch reloads the app, so the direction at launch says which scale.
//  2. `fs` below: the sizes Mahaam's own screens use instead of inline numbers.
//  3. A floor under every <Text>: a few grid blocks hard-code 10.5–11.5 (StackHeader's subtitle,
//     Meta's items, Field labels, form captions). Those are raised to 12 (11.5 for uppercase
//     labels; 13 for IBM Plex Sans Arabic in the Arabic UI, where Meta's Arabic items are 12). It never touches
//     text that is already large enough. Remove it once the grid's own sizes
//     (fadymondy.com-v2 packages/grid-native) meet the rule.
//
// This module must be imported first by the root layout, before anything renders.
import { createElement, type ComponentType } from "react";
import { I18nManager, StyleSheet, type StyleProp, type TextProps, type TextStyle } from "react-native";

import { type } from "@/grid";

export const arabicUi = I18nManager.isRTL;

type Scale = { -readonly [K in keyof typeof type]: number };

/** The grid's scale as shipped (for reference and tests). */
export const GRID_TYPE: Scale = { ...type };

/** The readable scale, per script. */
export const READABLE_TYPE: Record<"en" | "ar", Scale> = {
  en: { bigHeader: 27, title: 20, rowTitle: 16, body: 15, meta: 13, micro: 11.5, microAr: 12.5, tab: 12 },
  ar: { bigHeader: 27, title: 20, rowTitle: 17, body: 16, meta: 14, micro: 11.5, microAr: 13, tab: 13 },
};

Object.assign(type as Scale, READABLE_TYPE[arabicUi ? "ar" : "en"]);

/** App-level sizes for text that is not an AppText variant. Mono stays the same in both scripts. */
export const fs = {
  /** Mono counts and keys in tight spots: tab badges, board cards, day columns. */
  count: 12,
  /** Mono durations, codes, percentages. */
  mono: 13,
  /** Status chips and legends: compact labels inside a hairline. */
  chip: arabicUi ? 13.5 : 12.5,
  /** Secondary lines, labels, notes, links. */
  meta: arabicUi ? 14 : 13,
  /** Paragraphs. */
  body: arabicUi ? 16 : 15,
  /** Content inside a row: card titles, list lines, emails. */
  item: arabicUi ? 16 : 15,
  /** A row's own label (profile hub, pickers). */
  row: arabicUi ? 17 : 16,
} as const;

/** A comfortable line height for a paragraph at `size` (Arabic needs more room for its marks). */
export const lh = (size: number) => Math.round(size * (arabicUi ? 1.85 : 1.6));

export const MIN_TEXT = 12;
export const MIN_UPPERCASE = 11.5;
/** IBM Plex Sans Arabic in the Arabic UI: the Latin floor plus one. Mono (Latin digits and codes) keeps 12. */
export const MIN_ARABIC = 13;

/**
 * The style to add so `style` meets the floor, or null when it already does. A size is only ever
 * raised; a line height too tight for the new size grows with it.
 */
export function textFloor(style: StyleProp<TextStyle>, arabic: boolean = arabicUi): TextStyle | null {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const size = flat?.fontSize;
  if (typeof size !== "number") return null;
  const mono = /mono/i.test(flat?.fontFamily ?? "");
  const min = flat?.textTransform === "uppercase" ? MIN_UPPERCASE : arabic && !mono ? MIN_ARABIC : MIN_TEXT;
  if (size >= min) return null;
  const fix: TextStyle = { fontSize: min };
  if (typeof flat?.lineHeight === "number" && flat.lineHeight < min * 1.2) fix.lineHeight = Math.round((flat.lineHeight * min) / size);
  return fix;
}

// Layer 3. react-native's entry is an object of lazy getters, and `import { Text } from
// "react-native"` compiles to a property read at each use, so redefining the `Text` getter here
// reaches every Text in the app, the grid's included. If a future React Native makes the entry
// read-only this becomes a no-op (the scale and `fs` still apply) and says so in development.
type TextComponent = ComponentType<TextProps> & { __readable?: true };

function installTextFloor() {
  const RN = require("react-native") as Record<string, unknown>;
  const desc = Object.getOwnPropertyDescriptor(RN, "Text");
  const Base = (desc?.get ? desc.get.call(RN) : desc?.value) as TextComponent | undefined;
  if (!Base || Base.__readable) return;
  if (!desc?.configurable) {
    if (__DEV__) console.warn("type-scale: react-native's Text is not configurable; the text-size floor is off");
    return;
  }
  const Text: TextComponent = (props: TextProps) => {
    const fix = textFloor(props.style);
    return createElement(Base, fix ? { ...props, style: [props.style, fix] } : props);
  };
  Text.displayName = "Text";
  Text.__readable = true;
  Object.defineProperty(RN, "Text", { configurable: true, enumerable: true, get: () => Text });
}

installTextFloor();
