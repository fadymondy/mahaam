import { Pressable, ScrollView, View } from "react-native";

import type { Project } from "@/api/types";
import { AppText, fonts, metrics, useColors } from "@/grid";
import { useT } from "@/i18n";
import { fs } from "@/lib/type-scale";
import { projectColor } from "./kit";

/**
 * Only the fields this picker renders. It used to ask for a whole Project, which meant the
 * task picker in (team)/log.tsx had to fabricate one — inventing eighteen fields it had no
 * values for just to satisfy the type.
 */
export type PickerProject = Pick<Project, "id" | "name" | "color" | "archived_at">;

/** Horizontal filter chips (the grid's FilterStrip shape): "No project" + the projects you can log on. */
export function ProjectPicker({
  projects,
  value,
  onChange,
  label,
  allowNone = true,
}: {
  projects: PickerProject[];
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  allowNone?: boolean;
}) {
  const t = useT();
  const c = useColors();
  const items = [
    ...(allowNone ? [{ id: null as string | null, name: t("timer.noProject"), color: "" }] : []),
    ...projects.filter((p) => !p.archived_at),
  ];
  return (
    <View style={{ gap: 8 }}>
      <AppText style={{ fontFamily: fonts.medium, fontSize: fs.meta, color: c.muted }}>{label}</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {items.map((p) => {
            const on = p.id === value;
            return (
              <Pressable
                key={p.id ?? "none"}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={p.name}
                onPress={() => onChange(p.id)}
                style={{
                  minHeight: 38,
                  paddingHorizontal: 14,
                  borderRadius: metrics.radius.chip,
                  borderWidth: 1,
                  borderColor: on ? c.gold : c.line,
                  backgroundColor: on ? `${c.gold}1A` : c.card,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}>
                {p.id ? <View style={{ width: 8, height: 8, borderRadius: 1.5, backgroundColor: projectColor(p.color) }} /> : null}
                <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: on ? c.goldText : c.muted }}>{p.name}</AppText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
