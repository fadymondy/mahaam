import { Pressable, ScrollView, Text, View } from "react-native";

import type { Project } from "@/api/types";
import { useT } from "@/i18n";
import { useTheme } from "@/theme";
import { projectColor, radius, space } from "@/theme/tokens";
import { T } from "./ui";

/** Horizontal chips: "No project" + the projects you can log on. */
export function ProjectPicker({
  projects,
  value,
  onChange,
  label,
  allowNone = true,
}: {
  projects: Project[];
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  allowNone?: boolean;
}) {
  const t = useT();
  const { c } = useTheme();
  const items = [
    ...(allowNone ? [{ id: null as string | null, name: t("timer.noProject"), color: "" }] : []),
    ...projects.filter((p) => !p.archived_at),
  ];
  return (
    <View style={{ gap: space.xs }}>
      <T size="sm" tone="body" weight="500">
        {label}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <View style={{ flexDirection: "row", gap: space.sm }}>
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
                  minHeight: 44,
                  paddingHorizontal: space.md,
                  borderRadius: radius.control,
                  borderWidth: 1,
                  borderColor: on ? c.brand : c.line,
                  backgroundColor: on ? c.brand : c.elevated,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs,
                }}
              >
                {p.id ? <View style={{ width: 10, height: 10, backgroundColor: projectColor(p.color) }} /> : null}
                <Text style={{ color: on ? c.onBrand : c.fg }}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
