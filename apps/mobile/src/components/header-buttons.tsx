import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable } from "react-native";

import { useT } from "@/i18n";
import { useTheme } from "@/theme";

export function SettingsButton() {
  const t = useT();
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("common.settings")}
      onPress={() => router.push("/settings")}
      style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", marginHorizontal: 8 }}
    >
      <Ionicons name="settings-outline" size={22} color={c.fg} />
    </Pressable>
  );
}
