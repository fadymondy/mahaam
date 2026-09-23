// The Search tab, modelled on Apple Health's search (and Zekra's src/features/search/native-search.tsx).
//
// iOS 26+: this screen is the root of the Search tab's native stack and the tab is the system
// search tab (components/shell-tabs.tsx), so `headerSearchBarOptions` becomes the stack's
// UISearchController, which iOS hosts in the tab bar — the Liquid Glass field at the bottom that
// morphs out of the search button. Large title on an opaque bar in the app's ground colour.
// Elsewhere: the grid's header with a search field under it.
//
// The body is the grid either way: hatch ground between the rails, full-bleed rows. Empty field →
// browse (recent searches + quick links); typing → live results (debounced), grouped.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack } from "expo-router";
import { Clock } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";

import { AppText, fonts, ForwardChevron, HatchFill, Header, ListItem, Meta, metrics, Rails, Row, Rows, Screen, SkeletonRow, StateRow, usePrefs } from "@/grid";
import { useT } from "@/i18n";
import { isLiquidGlass } from "@/lib/platform";
import { fs } from "@/lib/type-scale";
import { Micro } from "./kit";
import { SearchField, useDebounced } from "./search";

export type SearchItem = { key: string; title: string; meta?: string[]; leading?: ReactNode; onPress: () => void };
export type SearchSection = { title: string; items: SearchItem[]; loading?: boolean };

const RECENT_MAX = 8;

function useRecent(storageKey: string) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    void AsyncStorage.getItem(storageKey).then((v) => setRecent(v ? (JSON.parse(v) as string[]) : []));
  }, [storageKey]);
  const add = useCallback(
    (q: string) =>
      setRecent((prev) => {
        const next = [q, ...prev.filter((x) => x !== q)].slice(0, RECENT_MAX);
        void AsyncStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      }),
    [storageKey],
  );
  const clear = useCallback(() => {
    setRecent([]);
    void AsyncStorage.removeItem(storageKey);
  }, [storageKey]);
  return { recent, add, clear };
}

function Results({ sections, onOpen }: { sections: SearchSection[]; onOpen: () => void }) {
  const t = useT();
  const any = sections.some((s) => s.items.length);
  const loading = sections.some((s) => s.loading);
  return (
    <>
      {sections
        .filter((s) => s.items.length)
        .map((s) => (
          <Row key={s.title} style={{ paddingVertical: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14, paddingBottom: 4 }}>
              <Micro style={{ flex: 1 }}>{s.title}</Micro>
              <AppText variant="mono">{s.items.length}</AppText>
            </View>
            {s.items.map((it, i) => (
              <ListItem
                key={it.key}
                last={i === s.items.length - 1}
                leading={it.leading}
                trailing={<ForwardChevron />}
                onPress={() => {
                  onOpen();
                  it.onPress();
                }}>
                <AppText variant="rowTitle" numberOfLines={2}>
                  {it.title}
                </AppText>
                {it.meta?.length ? <Meta items={it.meta} /> : null}
              </ListItem>
            ))}
          </Row>
        ))}
      {loading && !any ? <SkeletonRow lines={2} /> : null}
      {!loading && !any ? <StateRow state="empty" message={t("search.noResults")} /> : null}
    </>
  );
}

export function SearchScreen({
  storageKey,
  useSections,
  browse,
}: {
  /** AsyncStorage key for this shell's recent searches. */
  storageKey: string;
  /** The live results for a query (hooks allowed). */
  useSections: (q: string) => SearchSection[];
  /** What an empty field shows under the recent searches. */
  browse?: ReactNode;
}) {
  const t = useT();
  const { colors: c, isRTL } = usePrefs();
  const glass = isLiquidGlass();
  const bar = useRef<SearchBarCommands>(null);
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const { recent, add, clear } = useRecent(storageKey);
  const sections = useSections(q.length >= 2 ? q : "");

  const runRecent = (r: string) => {
    bar.current?.setText(r);
    setText(r);
  };

  const options = useMemo(
    () => ({
      title: t("common.search"),
      headerShown: true,
      headerLargeTitleEnabled: true,
      headerTransparent: false,
      headerStyle: { backgroundColor: c.bg },
      headerLargeStyle: { backgroundColor: c.bg },
      headerShadowVisible: false,
      headerLargeTitleShadowVisible: false,
      headerTintColor: c.gold,
      headerTitleStyle: { fontFamily: fonts.semibold, color: c.fg },
      headerLargeTitleStyle: { fontFamily: fonts.semibold, color: c.fg },
      contentStyle: { backgroundColor: c.bg },
      headerSearchBarOptions: {
        ref: bar,
        placeholder: t("search.placeholder"),
        tintColor: c.gold,
        textColor: c.fg,
        autoCapitalize: "none" as const,
        hideNavigationBar: false,
        // Keep the field on screen instead of revealing it on pull-down.
        hideWhenScrolling: false,
        obscureBackground: false,
        onChangeText: (e: { nativeEvent: { text: string } }) => setText(e.nativeEvent.text),
        onSearchButtonPress: (e: { nativeEvent: { text: string } }) => e.nativeEvent.text.trim() && add(e.nativeEvent.text.trim()),
        onCancelButtonPress: () => setText(""),
      },
    }),
    [t, c, add],
  );

  const body = (
    <Rows>
      {q.length >= 2 ? (
        <Results sections={sections} onOpen={() => add(q)} />
      ) : (
        <>
          {recent.length ? (
            <Row style={{ paddingVertical: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 14, paddingBottom: 4 }}>
                <Micro style={{ flex: 1 }}>{t("search.recent")}</Micro>
                <Pressable accessibilityRole="button" hitSlop={10} onPress={clear}>
                  <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.goldText }}>{t("common.clear")}</AppText>
                </Pressable>
              </View>
              {recent.map((r, i) => (
                <ListItem key={r} last={i === recent.length - 1} padV={10} leading={<Clock size={16} color={c.muted} strokeWidth={1.6} />} onPress={() => runRecent(r)}>
                  <AppText style={{ fontFamily: fonts.regular, fontSize: fs.item, color: c.fg }}>{r}</AppText>
                </ListItem>
              ))}
            </Row>
          ) : null}
          {browse}
        </>
      )}
    </Rows>
  );

  if (glass) {
    return (
      <>
        <Stack.Screen options={options} />
        {/* The scroll view itself is pinned LTR; only its content is RTL. RN's iOS ScrollView does
            RTL by mirroring the UIScrollView (scaleX -1), and on iOS 26+ UIKit hosts the scrolling
            large title inside it — an RTL scroll view drew the title glyph-mirrored (Zekra). */}
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1, backgroundColor: c.bg, direction: "ltr" }}
          contentContainerStyle={{ flexGrow: 1, direction: isRTL ? "rtl" : "ltr" }}>
          <HatchFill />
          <View style={{ paddingTop: metrics.gap, paddingBottom: metrics.gap + 8 }}>{body}</View>
          <Rails />
        </ScrollView>
      </>
    );
  }

  return (
    <Screen header={<Header title={t("common.search")} />}>
      <Rows inset>
        <Row>
          <SearchField value={text} onChange={setText} placeholder={t("search.placeholder")} />
        </Row>
      </Rows>
      <View style={{ paddingTop: metrics.gap }}>{body}</View>
    </Screen>
  );
}
