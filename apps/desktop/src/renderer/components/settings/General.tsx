// General: appearance (theme, language) and how the app behaves on this
// computer (launch at login, notifications, idle detection). All are device preferences held by the
// main process, so the whole app — menus and the menu-bar timer included — follows at once.
import { LanguageMenu } from "@/components/LanguageMenu";
import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

import { Group, Row, Section, Segmented } from "./parts";

export function GeneralSettings() {
  const { t } = useI18n();
  const { prefs, setPrefs, config } = useApp();
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);

  useEffect(() => {
    if (!config.canAutoLaunch) return;
    void desktop.autoLaunch.get().then(setAutoLaunch, () => setAutoLaunch(false));
  }, [config.canAutoLaunch]);

  return (
    <Section id="general" title={t("settings.general")} description={t("settings.generalHint")}>
      <Group title={t("settings.appearance")}>
        <Row label={t("settings.theme")} hint={t("settings.themeHint")} data-row="theme">
          <Segmented
            label={t("settings.theme")}
            value={prefs.theme}
            options={(["system", "light", "dark"] as const).map((theme) => ({ value: theme, label: t(`settings.theme.${theme}`) }))}
            onChange={(theme) => void setPrefs({ theme })}
            attr="data-theme-tile"
          />
        </Row>
        <Row label={t("settings.language")} hint={t("settings.languageHint")} data-row="language">
          <LanguageMenu />
        </Row>
      </Group>

      <Group title={t("settings.app")}>
        {config.canAutoLaunch ? (
          <Row label={t("settings.launch")} hint={t("settings.launchHint")} htmlFor="pref-launch">
            <Switch
              id="pref-launch"
              checked={!!autoLaunch}
              disabled={autoLaunch === null}
              onCheckedChange={(on) => {
                setAutoLaunch(on);
                void desktop.autoLaunch.set(on).catch(() => setAutoLaunch(!on));
              }}
            />
          </Row>
        ) : null}
        <Row label={t("settings.idle")} hint={t("settings.idleHint")} htmlFor="pref-idle">
          <Switch id="pref-idle" data-pref="idle" checked={prefs.idle} onCheckedChange={(idle) => void setPrefs({ idle })} />
        </Row>
      </Group>
    </Section>
  );
}
