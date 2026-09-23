// The tab bar for both shells (staff and customer).
//
// iOS 26+: the system UITabBarController with Liquid Glass (expo-router native tabs), laid out like
// Apple Health — the main tabs, and Search as the system search tab (role="search"), which iOS
// draws as its own round glass button at the trailing edge; its screen's native search controller
// becomes the glass field at the bottom (see components/search-screen.tsx). The bar follows the
// app's theme and language: `colorScheme` pins the glass to the chosen light/dark, and `direction`
// is a UIKit layout trait, so the bar is RTL for Arabic even before forceRTL applies. Gold is the
// selection colour, as in the grid's bar. (Pattern from Zekra: src/features/nav/native-tabs.tsx.)
//
// Older iOS and Android: the grid's tab bar, Search included as an ordinary tab.
import { Tabs } from "expo-router/js-tabs";
import { NativeTabs, type SFSymbolIcon } from "expo-router/unstable-native-tabs";
import type { LucideIcon } from "lucide-react-native";

import { fonts, GridTabBar, usePrefs, type GridTab } from "@/grid";
import { useT, type TKey } from "@/i18n";
import { isLiquidGlass } from "@/lib/platform";

type Sf = Extract<NonNullable<SFSymbolIcon["sf"]>, string>;

export type ShellTab = {
  /** The route group, e.g. "(projects)". */
  name: string;
  label: TKey;
  Icon: LucideIcon;
  /** SF Symbols for the native bar. */
  sf: { default: Sf; selected: Sf };
  search?: boolean;
};

export function ShellTabs({ tabs }: { tabs: ShellTab[] }) {
  const t = useT();
  const { colors, theme, isRTL } = usePrefs();
  if (isLiquidGlass()) {
    return (
      <NativeTabs
        tintColor={colors.gold}
        minimizeBehavior="onScrollDown"
        labelStyle={{ default: { fontFamily: fonts.regular }, selected: { fontFamily: fonts.medium } }}
        unstable_nativeProps={{ colorScheme: theme, direction: isRTL ? "rtl" : "ltr" }}>
        {tabs.map((tab) => (
          <NativeTabs.Trigger key={tab.name} name={tab.name} role={tab.search ? "search" : undefined} accessibilityLabel={t(tab.label)}>
            <NativeTabs.Trigger.Icon sf={tab.search ? "magnifyingglass" : tab.sf} />
            <NativeTabs.Trigger.Label>{t(tab.label)}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    );
  }
  const grid: GridTab[] = tabs.map((x) => ({ name: x.name, label: x.label, Icon: x.Icon }));
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(p) => <GridTabBar {...p} tabs={grid} />}>
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}
