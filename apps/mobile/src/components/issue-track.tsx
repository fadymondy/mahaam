import { View } from "react-native";

import { AppText, fonts, useColors } from "@/grid";
import { useT } from "@/i18n";
import { STAGE_TONE, STAGES } from "@/lib/stages";
import { fs } from "@/lib/type-scale";

/**
 * A project's issue track: one segment per stage, sized by its count, then the counts. The same
 * bar as the web's projects list, so a glance means the same thing on both.
 */
export function IssueTrack({ issues, compact }: { issues: Record<string, number> | undefined; compact?: boolean }) {
  const t = useT();
  const c = useColors();
  const present = STAGES.filter((s) => (issues?.[s] ?? 0) > 0);
  if (!present.length) return null;
  const label = present.map((s) => `${t(`issues.status.${s}`)}: ${issues![s]}`).join(", ");
  return (
    <View style={{ gap: 7 }} accessible accessibilityLabel={label}>
      <View style={{ flexDirection: "row", height: 5, borderRadius: 2.5, overflow: "hidden", gap: 2, backgroundColor: c.soft }}>
        {present.map((s) => (
          <View key={s} style={{ flexGrow: issues![s], backgroundColor: STAGE_TONE[s] }} />
        ))}
      </View>
      {compact ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4 }}>
          {present.map((s) => (
            <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 1.5, backgroundColor: STAGE_TONE[s] }} />
              <AppText style={{ fontFamily: fonts.regular, fontSize: fs.chip, color: c.muted }}>{t(`issues.status.${s}`)}</AppText>
              <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.body }}>{issues![s]}</AppText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
