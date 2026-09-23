// A project's avatar, as on the web (web/components/work/project-avatar.tsx): its uploaded image (a
// data URL), or a tile in the project colour with its initials.
import { Image } from "expo-image";
import { View } from "react-native";

import { AppText, fonts, metrics, useColors } from "@/grid";
import { fs } from "@/lib/type-scale";
import { projectColor } from "./kit";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function ProjectAvatar({ project, size = 40 }: { project: { name: string; color: string; avatar?: string | null }; size?: number }) {
  const c = useColors();
  const box = { width: size, height: size, borderRadius: metrics.radius.control, borderWidth: 1, borderColor: c.line };
  if (project.avatar) return <Image source={{ uri: project.avatar }} style={box} contentFit="cover" accessibilityIgnoresInvertColors />;
  const tone = projectColor(project.color);
  return (
    <View style={[box, { backgroundColor: `${tone}26`, borderColor: `${tone}66`, alignItems: "center", justifyContent: "center" }]}>
      <AppText style={{ fontFamily: fonts.medium, fontSize: Math.max(fs.count, size * 0.36), color: tone, writingDirection: "ltr" }}>{initials(project.name)}</AppText>
    </View>
  );
}
