// Mahaam's pieces on top of the grid (src/grid is generated — never edit it; add here instead).
// Everything is drawn with the grid's palette, metrics and type: hairlines, 6/8 radii, no card
// islands.
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Settings } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View, type ViewStyle } from "react-native";

import { ApiError } from "@/api/client";
import { AppText, fonts, Header, IconButton, metrics, useColors, usePrefs } from "@/grid";
import { useT, type TKey } from "@/i18n";
import { useWs } from "@/lib/hooks";
import { qk } from "@/lib/query";
import { mahaam } from "@/lib/session";
import { fs } from "@/lib/type-scale";

// Project colours are palette keys on the web (app/styles/mahaam-palette.css); approximate here.
const PROJECT: Record<string, string> = {
  violet: "#8C3FB5", purple: "#8C3FB5", blue: "#3B6FD4", sky: "#2A93C9", cyan: "#1F9EA8", teal: "#1F8F7A",
  green: "#4E9A3E", lime: "#7FA12B", yellow: "#C9A227", amber: "#D08A1E", orange: "#E2661C", red: "#D9455F",
  rose: "#D6457F", pink: "#C8509F", slate: "#6E7891", gray: "#7A7A7A", brown: "#8B5E3C",
};
export const projectColor = (c?: string | null) => (c && (c.startsWith("#") ? c : PROJECT[c])) || "#8C3FB5";

/** An API or network error as a sentence the user can act on. */
export function useErrorText() {
  const t = useT();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.isNetwork) return t("common.networkError");
      if (e.status === 429) return t("common.rateLimited");
      return e.message || t("common.error");
    }
    return (e as Error)?.message || t("common.error");
  };
}

/** Before the first frame of a gated screen: the ground and a gold spinner, nothing else. */
export function FullLoading() {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={c.gold} />
    </View>
  );
}

/** The section micro-label (mono uppercase in English, Lusail 11.5 in Arabic). */
export function Micro({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <AppText variant="micro" style={style}>
      {children}
    </AppText>
  );
}

type Tone = "neutral" | "gold" | "ok" | "danger" | "brand";

/** A small read-only status chip: 6 radius, hairline, the tone as text colour. */
export function Chip({ label, tone = "neutral", dot }: { label: string; tone?: Tone; dot?: string }) {
  const c = useColors();
  const color = { neutral: c.body, gold: c.goldText, ok: c.okText, danger: c.dangerText, brand: c.brand }[tone];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 24,
        paddingHorizontal: 8,
        borderRadius: metrics.radius.chip,
        borderWidth: 1,
        borderColor: tone === "neutral" ? c.line : color,
        backgroundColor: c.card,
        alignSelf: "flex-start",
      }}>
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 1.5, backgroundColor: dot }} /> : null}
      <AppText style={{ fontFamily: fonts.regular, fontSize: fs.chip, color }}>{label}</AppText>
    </View>
  );
}

/** A 4px progress track that fills from the reading start. */
export function Progress({ value, color, label }: { value: number; color?: string; label?: string }) {
  const c = useColors();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={{ height: 4, borderRadius: 2, backgroundColor: c.soft, overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: 4, backgroundColor: color ?? c.brand }} />
    </View>
  );
}

/**
 * The edge-sharing cell grid (the reference's outcomes table): the container draws the top and
 * start edges, every cell its own end and bottom edge, so neighbours share one hairline.
 */
export function StatCells({ items, columns = 2 }: { items: { label: string; value: string; tone?: Tone }[]; columns?: number }) {
  const c = useColors();
  const width = `${100 / columns}%` as ViewStyle["width"];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderStartWidth: 1, borderColor: c.soft }}>
      {items.map((it, i) => (
        <View key={i} style={{ width, paddingVertical: 12, paddingHorizontal: 10, borderEndWidth: 1, borderBottomWidth: 1, borderColor: c.soft, gap: 4 }}>
          <Micro>{it.label}</Micro>
          <AppText
            style={{
              fontFamily: fonts.medium,
              fontSize: 18,
              color: it.tone === "danger" ? c.dangerText : it.tone === "ok" ? c.okText : it.tone === "gold" ? c.goldText : c.fg,
              writingDirection: "ltr",
              textAlign: "left",
              alignSelf: "flex-start",
            }}>
            {it.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/** The destructive twin of the grid's SecondaryButton. */
export function DangerButton({ label, onPress, disabled }: { label: string; onPress?: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: metrics.button,
        borderRadius: metrics.radius.control,
        borderWidth: 1,
        borderColor: c.danger,
        backgroundColor: pressed ? `${c.danger}1A` : c.card,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 18,
        opacity: disabled ? 0.5 : 1,
      })}>
      <AppText style={{ fontFamily: fonts.regular, fontSize: 14.5 }} color={c.dangerText}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Unread notifications for the header bell. Shares the inbox's cache entry. */
export function useUnread() {
  const ws = useWs();
  const inbox = useQuery({ queryKey: qk.inbox(ws), queryFn: mahaam.notifications.list, enabled: !!ws, staleTime: 60_000 });
  return inbox.data?.unread ?? 0;
}

/**
 * A tab root's header: the grid's large header, with the bell (→ inbox) and settings. `inbox` is
 * the route of this variant's inbox tab; omit it on the inbox itself.
 */
export function TabHeader({ title, count, inbox }: { title: TKey; count?: number; inbox?: string }) {
  const t = useT();
  const c = useColors();
  const unread = useUnread();
  return (
    <Header
      title={t(title)}
      count={count}
      onBell={inbox ? () => router.navigate(inbox as never) : undefined}
      unread={unread > 0}
      trailing={
        <IconButton label={t("common.settings")} onPress={() => router.push("/settings")}>
          <Settings size={20} color={c.muted} strokeWidth={1.6} />
        </IconButton>
      }
    />
  );
}

/** A horizontal row of controls with the grid's 10px gap; children share the width. */
export function Actions({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>{children}</View>;
}

export function Grow({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, minWidth: 120 }}>{children}</View>;
}

/** Numbers, durations and keys read LTR in both languages but still start on the reading side. */
export function useLtrNumber() {
  const { isRTL } = usePrefs();
  return { writingDirection: "ltr" as const, textAlign: (isRTL ? "right" : "left") as "right" | "left" };
}
