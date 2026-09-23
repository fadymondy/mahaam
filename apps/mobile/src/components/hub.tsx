// The Profile hub's building blocks: a group of rows under a micro-label, and a row that opens one
// setting's page (icon · label · current value · chevron), on the grid's list shapes.
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { AppText, fonts, ForwardChevron, ListItem, Row, Tile, useColors } from "@/grid";
import { fs } from "@/lib/type-scale";
import { Micro } from "./kit";

export function HubGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Row style={{ paddingVertical: 0 }}>
      <Micro style={{ paddingTop: 14, paddingBottom: 2 }}>{title}</Micro>
      {children}
    </Row>
  );
}

export function HubItem({
  Icon,
  label,
  value,
  onPress,
  last,
  danger,
  trailing,
}: {
  Icon: LucideIcon;
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  danger?: boolean;
  trailing?: ReactNode;
}) {
  const c = useColors();
  return (
    <ListItem
      last={last}
      padV={10}
      onPress={onPress}
      leading={
        <Tile size={34} radius={8}>
          <Icon size={17} color={danger ? c.dangerText : c.muted} strokeWidth={1.6} />
        </Tile>
      }
      trailing={trailing ?? (onPress ? <ForwardChevron /> : undefined)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: fs.row, color: danger ? c.dangerText : c.fg }}>{label}</AppText>
        {value ? (
          <AppText numberOfLines={1} style={{ maxWidth: "55%", fontFamily: fonts.regular, fontSize: fs.meta, color: c.muted }}>
            {value}
          </AppText>
        ) : null}
      </View>
    </ListItem>
  );
}
