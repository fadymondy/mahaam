import { Pressable, ScrollView, View } from "react-native";

import { AppText, fonts, metrics, useColors } from "@/grid";
import { fs } from "@/lib/type-scale";

export type LineTab<T extends string> = { value: T; label: string; count?: number };

/**
 * The grid's filter strip, scrolling sideways when the options outgrow the width (a project's
 * sections, a portal's tabs). Starts on the reading side in both directions.
 */
export function LineTabs<T extends string>({ options, value, onChange }: { options: LineTab<T>[]; value: T; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: metrics.padX, paddingVertical: 12, gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              minHeight: 38,
              paddingHorizontal: 14,
              borderRadius: metrics.radius.chip,
              borderWidth: 1,
              borderColor: on ? c.gold : c.line,
              backgroundColor: on ? `${c.gold}1A` : c.card,
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
            }}>
            <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: on ? c.goldText : c.muted }}>{o.label}</AppText>
            {o.count !== undefined ? (
              <View style={{ minWidth: 18, paddingHorizontal: 5, borderRadius: 4, backgroundColor: on ? `${c.gold}26` : c.soft, alignItems: "center" }}>
                <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: on ? c.goldText : c.muted }}>{o.count}</AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
