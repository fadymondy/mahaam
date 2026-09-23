// Profile → Language & appearance. Language is a list, one row per entry in LOCALES, so another
// language is one more row (the owner's request), not a wider toggle; switching to Arabic flips the
// whole app to RTL (the grid's setLocale reloads once). The language is also saved to the profile,
// so email and push speak it. Appearance stays the grid's three-way strip.
import { Check } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Pressable, View } from "react-native";

import { AppText, FilterStrip, fonts, ListItem, Row, Rows, Screen, StackHeader, Tile, useColors, usePrefs, type ThemeName } from "@/grid";
import { HubGroup } from "@/components/hub";
import { useT, type TKey } from "@/i18n";
import { LOCALES } from "@/i18n/locales";
import { mahaam, useSession } from "@/lib/session";
import { fs } from "@/lib/type-scale";

export default function Preferences() {
  const t = useT();
  const { locale } = usePrefs();
  const { status } = useSession();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (status === "signedIn" && locale) void mahaam.me.update({ locale }).catch(() => undefined);
  }, [locale, status]);
  return (
    <Screen header={<StackHeader title={t("account.preferences.title")} />}>
      <Rows>
        <LanguageList />
        <AppearanceRow />
      </Rows>
    </Screen>
  );
}

function LanguageList() {
  const t = useT();
  const c = useColors();
  const { locale, setLocale } = usePrefs();
  const current = locale ?? "en";
  return (
    <HubGroup title={t("settings.language")}>
      <View accessibilityRole="radiogroup">
        {LOCALES.map((l, i) => {
          const on = l.code === current;
          // The name in the UI language, when it differs from the language's own name.
          const named = t(`languages.${l.code}` as TKey);
          return (
            <Pressable
              key={l.code}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={named === l.native ? l.native : `${l.native}, ${named}`}
              onPress={on ? undefined : () => void setLocale(l.code)}
              android_ripple={{ color: c.soft }}>
              <ListItem
                last={i === LOCALES.length - 1}
                padV={10}
                leading={
                  <Tile size={34} radius={8} gold={on}>
                    <AppText style={{ fontFamily: fonts.mono, fontSize: fs.count, letterSpacing: 1, color: on ? c.goldText : c.muted, writingDirection: "ltr" }}>
                      {l.code.toUpperCase()}
                    </AppText>
                  </Tile>
                }
                trailing={on ? <Check size={20} strokeWidth={2.2} color={c.goldText} /> : undefined}>
                <AppText style={{ fontFamily: on ? fonts.medium : fonts.regular, fontSize: fs.row, color: c.fg }}>{l.native}</AppText>
                {named !== l.native ? <AppText variant="meta">{named}</AppText> : null}
              </ListItem>
            </Pressable>
          );
        })}
      </View>
    </HubGroup>
  );
}

function AppearanceRow() {
  const t = useT();
  const { themeSetting, setTheme } = usePrefs();
  return (
    <Row style={{ paddingHorizontal: 0, paddingBottom: 0 }}>
      <AppText variant="micro" style={{ paddingHorizontal: 28 }}>
        {t("settings.theme")}
      </AppText>
      <FilterStrip<ThemeName | "system">
        options={[
          { value: "dark", label: t("settings.theme.dark") },
          { value: "light", label: t("settings.theme.light") },
          { value: "system", label: t("settings.theme.system") },
        ]}
        value={themeSetting}
        onChange={setTheme}
      />
    </Row>
  );
}
