// The small component kit both apps share. Every control has an accessibility role and label, a 44pt
// minimum touch target, and uses start/end spacing so it mirrors under RTL.
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Rect } from "react-native-svg";

import { ApiError } from "@/api/client";
import { useT } from "@/i18n";
import { useTheme } from "@/theme";
import { font, radius, space } from "@/theme/tokens";

export function Mark({ size = 40 }: { size?: number }) {
  const { scheme } = useTheme();
  const body = scheme === "dark" ? "#B784D6" : "#8C3FB5";
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="Mahaam" accessibilityRole="image">
      <Rect x={29} y={29} width={21} height={21} fill={body} />
      <Rect x={71} y={29} width={21} height={21} fill="#C9A227" />
      <Rect x={8} y={50} width={21} height={21} fill={body} />
      <Rect x={50} y={50} width={21} height={21} fill={body} />
    </Svg>
  );
}

type Tone = "fg" | "body" | "muted" | "brand" | "danger" | "ok" | "onBrand" | "accentText";

export function T({
  children,
  size = "md",
  tone = "fg",
  weight,
  style,
  numberOfLines,
  role,
}: {
  children: ReactNode;
  size?: keyof typeof font.size;
  tone?: Tone;
  weight?: "400" | "500" | "600" | "700";
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  role?: "header" | "text" | "alert";
}) {
  const { c } = useTheme();
  return (
    <Text
      accessibilityRole={role}
      numberOfLines={numberOfLines}
      style={[{ color: c[tone], fontSize: font.size[size], fontWeight: weight, textAlign: "auto" }, style]}
    >
      {children}
    </Text>
  );
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  edges = ["top"],
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  edges?: ("top" | "bottom")[];
}) {
  const { c } = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={styles.screenBody}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.brand} colors={[c.brand]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenBody, { flex: 1 }]}>{children}</View>
  );
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.bg }}>
      {body}
    </SafeAreaView>
  );
}

export function Card({ children, style, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; accent?: string }) {
  const { c } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: c.line },
        accent ? { borderStartWidth: 4, borderStartColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  hint,
  style,
  small,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const { c } = useTheme();
  const bg = { primary: c.brand, secondary: c.soft, danger: c.danger, ghost: "transparent" }[variant];
  const fg = { primary: c.onBrand, secondary: c.fg, danger: c.onDanger, ghost: c.brand }[variant];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, borderColor: variant === "secondary" ? c.line : bg, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: "600", fontSize: small ? font.size.sm : font.size.md }}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <T size="sm" tone="body" weight="500">
        {label}
      </T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={[styles.input, { color: c.fg, backgroundColor: c.elevated, borderColor: c.line, textAlign: "auto" } as TextStyle, style]}
        {...props}
      />
    </View>
  );
}

export function Badge({ label, color }: { label: string; color?: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.badge, { borderColor: color ?? c.line, backgroundColor: c.soft }]}>
      <Text style={{ color: color ?? c.body, fontSize: font.size.xs, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
  label: string;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segmented, { borderColor: c.line, backgroundColor: c.soft }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: c.brand }]}
          >
            <Text style={{ color: on ? c.onBrand : c.fg, fontWeight: on ? "600" : "400" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Progress({ value, label, color }: { value: number; label: string; color?: string }) {
  const { c } = useTheme();
  const v = Math.max(0, Math.min(100, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v) }}
      style={[styles.progress, { backgroundColor: c.soft, borderColor: c.line }]}
    >
      <View style={{ width: `${v}%`, backgroundColor: color ?? c.brand, height: "100%" }} />
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <Row style={{ justifyContent: "space-between", marginTop: space.md }}>
      <T size="lg" weight="600" role="header">
        {children}
      </T>
      {right}
    </Row>
  );
}

export function Loading() {
  const { c } = useTheme();
  const t = useT();
  return (
    <View style={styles.center} accessibilityLabel={t("common.loading")} accessible>
      <ActivityIndicator color={c.brand} size="large" />
    </View>
  );
}

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

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const text = useErrorText();
  return (
    <Card style={{ gap: space.sm }}>
      <T tone="danger" role="alert">
        {text(error)}
      </T>
      {onRetry ? <Button label={t("common.retry")} variant="secondary" onPress={onRetry} small /> : null}
    </Card>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ paddingVertical: space.lg }}>
      <T tone="muted">{text}</T>
    </View>
  );
}

export function ListItem({
  title,
  subtitle,
  right,
  onPress,
  accent,
  hint,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  accent?: string;
  hint?: string;
}) {
  const { c } = useTheme();
  const inner = (
    <Row style={{ justifyContent: "space-between" }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="500" numberOfLines={2}>
          {title}
        </T>
        {subtitle ? (
          <T size="sm" tone="muted" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
    </Row>
  );
  const style = [styles.item, { backgroundColor: c.card, borderColor: c.line }, accent ? { borderStartWidth: 4, borderStartColor: accent } : null];
  if (!onPress) return <View style={style}>{inner}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed && { backgroundColor: c.soft }]}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenBody: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: space.lg, gap: space.sm },
  button: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSmall: { minHeight: 44, paddingHorizontal: space.md },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space.md, fontSize: font.size.md },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: "flex-start" },
  segmented: { flexDirection: "row", borderWidth: 1, borderRadius: radius.control, overflow: "hidden" },
  segment: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: space.sm },
  progress: { height: 10, borderRadius: 5, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  item: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, padding: space.md, minHeight: 56, justifyContent: "center" },
});
