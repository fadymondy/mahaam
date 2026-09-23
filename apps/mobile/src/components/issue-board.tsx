// A project's issues as the web's board shows them: the project's own columns (its workflow), cards
// in board order, and a way to move a card. Board = columns side by side (swipe); list = the same
// columns stacked. A long press (or the card's move control) opens a sheet of columns to move to.
import { router } from "expo-router";
import { ArrowRightLeft, Bot, Check, MessageSquare, UserRound } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import type { IssueRow, Status } from "@/api/types";
import { AppText, BottomSheet, fonts, metrics, SheetDivider, useColors } from "@/grid";
import { useT } from "@/i18n";
import { formatDuration } from "@/lib/time";
import { fs } from "@/lib/type-scale";
import { Micro, projectColor } from "./kit";

export const PRIORITY_TONE: Record<string, string> = {
  highest: "#D9455F",
  high: "#E2661C",
  medium: "#C9A227",
  low: "#3B6FD4",
  lowest: "#6E7891",
};

export const TYPE_TONE: Record<string, string> = {
  bug: "#D9455F",
  feature: "#8C3FB5",
  task: "#3B6FD4",
  story: "#4E9A3E",
  epic: "#D08A1E",
};

/** One card: key, title, type, priority, and the markers the web board shows. */
export function IssueCard({ issue, onMove, dense }: { issue: IssueRow; onMove?: () => void; dense?: boolean }) {
  const t = useT();
  const c = useColors();
  const open = () => router.push({ pathname: "/issue/[key]", params: { key: issue.key } });
  return (
    <Pressable
      onPress={open}
      onLongPress={onMove}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityHint={onMove ? t("issues.moveHint") : undefined}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: metrics.radius.control,
        backgroundColor: pressed ? c.soft : c.card,
        paddingHorizontal: 12,
        paddingVertical: dense ? 10 : 12,
        gap: 7,
        opacity: issue.state === "closed" ? 0.65 : 1,
      })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <View style={{ width: 7, height: 7, borderRadius: 1.5, backgroundColor: TYPE_TONE[issue.issue_type] ?? c.muted }} />
        <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.muted }}>{issue.key}</AppText>
        <View style={{ flex: 1 }} />
        {issue.human_only ? <UserRound size={13} color={c.muted} strokeWidth={1.6} accessibilityLabel={t("issues.humanOnly")} /> : null}
        {issue.agent_seconds > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Bot size={13} color={c.muted} strokeWidth={1.6} />
            <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.muted }}>{formatDuration(issue.agent_seconds)}</AppText>
          </View>
        ) : null}
        <View
          accessibilityLabel={t(`issues.priority.${issue.priority}` as "issues.priority.medium")}
          style={{ width: 16, height: 4, borderRadius: 2, backgroundColor: PRIORITY_TONE[issue.priority] ?? c.soft }}
        />
      </View>
      <AppText style={{ fontFamily: fonts.medium, fontSize: fs.item, color: c.fg, lineHeight: Math.round(fs.item * 1.45) }} numberOfLines={dense ? 2 : 3}>
        {issue.title}
      </AppText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.muted }}>{t(`issues.type.${issue.issue_type}` as "issues.type.bug")}</AppText>
        {issue.comment_count ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <MessageSquare size={12} color={c.muted} strokeWidth={1.6} />
            <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.muted }}>{issue.comment_count}</AppText>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        {onMove ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("issues.moveTo")} hitSlop={10} onPress={onMove}>
            <ArrowRightLeft size={15} color={c.muted} strokeWidth={1.6} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function ColumnHead({ col, count }: { col: Status; count: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: projectColor(col.color) }} />
      <AppText style={{ fontFamily: fonts.medium, fontSize: fs.item, color: c.fg, flexShrink: 1 }} numberOfLines={1}>
        {col.name}
      </AppText>
      <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, color: c.muted }}>{count}</AppText>
    </View>
  );
}

/** Group issues into the project's columns, each in board order. */
export function useColumns(issues: IssueRow[], statuses: Status[] | null | undefined) {
  return useMemo(() => {
    const cols = [...(statuses ?? [])].sort((a, b) => a.position - b.position);
    const map = new Map<string, IssueRow[]>(cols.map((c) => [c.id, []]));
    for (const i of [...issues].sort((a, b) => a.sort_order - b.sort_order)) {
      const id = i.column_id ?? cols.find((c) => c.stage === i.status)?.id ?? cols[0]?.id ?? "";
      map.get(id)?.push(i);
    }
    return cols.map((col) => ({ col, items: map.get(col.id) ?? [] }));
  }, [issues, statuses]);
}

export function IssueBoard({
  issues,
  statuses,
  view,
  canMove,
  onMove,
}: {
  issues: IssueRow[];
  statuses: Status[] | null | undefined;
  view: "board" | "list";
  canMove: boolean;
  onMove: (issue: IssueRow, column: string) => void;
}) {
  const t = useT();
  const c = useColors();
  const { width } = useWindowDimensions();
  const columns = useColumns(issues, statuses);
  const [moving, setMoving] = useState<IssueRow | null>(null);
  const colOfMoving = moving ? columns.find((x) => x.items.some((i) => i.key === moving.key))?.col.id : undefined;

  const sheet = (
    <BottomSheet visible={!!moving} onClose={() => setMoving(null)}>
      <Micro>{t("issues.moveTo")}</Micro>
      <AppText variant="rowTitle" numberOfLines={2}>
        {moving ? `${moving.key} · ${moving.title}` : ""}
      </AppText>
      <SheetDivider />
      {columns.map(({ col }) => {
        const here = col.id === colOfMoving;
        return (
          <Pressable
            key={col.id}
            accessibilityRole="button"
            accessibilityState={{ selected: here }}
            disabled={here}
            onPress={() => {
              if (moving) onMove(moving, col.id);
              setMoving(null);
            }}
            style={{ minHeight: 46, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: projectColor(col.color) }} />
            <AppText style={{ flex: 1, fontFamily: here ? fonts.medium : fonts.regular, fontSize: fs.row, color: here ? c.goldText : c.fg }}>{col.name}</AppText>
            {here ? <Check size={17} color={c.goldText} strokeWidth={1.8} /> : null}
          </Pressable>
        );
      })}
    </BottomSheet>
  );

  const move = canMove ? (i: IssueRow) => () => setMoving(i) : () => undefined;

  if (view === "list") {
    return (
      <View style={{ gap: metrics.gap }}>
        {columns
          .filter((x) => x.items.length)
          .map(({ col, items }) => (
            <View key={col.id} style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line, backgroundColor: c.bg, paddingHorizontal: metrics.padX, paddingVertical: 14, gap: 8 }}>
              <ColumnHead col={col} count={items.length} />
              {items.map((i) => (
                <IssueCard key={i.key} issue={i} dense onMove={move(i)} />
              ))}
            </View>
          ))}
        {sheet}
      </View>
    );
  }

  // Board: one column per page-ish width, so the next column peeks in and invites a swipe.
  const colWidth = Math.min(320, width - 72);
  return (
    <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.line, backgroundColor: c.bg }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={colWidth + 12}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: metrics.padX, paddingVertical: 14, gap: 12, alignItems: "flex-start" }}>
        {columns.map(({ col, items }) => (
          <View key={col.id} style={{ width: colWidth, gap: 8 }}>
            <ColumnHead col={col} count={items.length} />
            {items.length === 0 ? (
              <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: c.line, borderRadius: metrics.radius.control, paddingVertical: 18, alignItems: "center" }}>
                <AppText variant="meta">{t("issues.emptyColumn")}</AppText>
              </View>
            ) : null}
            {items.map((i) => (
              <IssueCard key={i.key} issue={i} onMove={move(i)} />
            ))}
          </View>
        ))}
      </ScrollView>
      {sheet}
    </View>
  );
}
