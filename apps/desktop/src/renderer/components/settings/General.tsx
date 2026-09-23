// General: appearance (theme tiles with previews, language) and how the app behaves on this
// computer (launch at login, notifications, idle detection). All are device preferences held by the
// main process, so the whole app — menus and the menu-bar timer included — follows at once.
import { LanguageMenu } from "@/components/LanguageMenu";
import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { Prefs } from "../../../shared/types";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Group, Row, Section } from "./parts";

// The grid's own light and dark grounds, so each preview shows that theme whatever the app is in.
const LOOK = {
  light: { bg: "#f0ebe1", card: "#f7f4ec", line: "#ded5c4", soft: "#e4dccd", fg: "#0e1a3c", action: "#8c3fb5" },
  dark: { bg: "#0b1429", card: "#0e1a3c", line: "#25355c", soft: "#1f2d52", fg: "#f0ebe1", action: "#b784d6" },
};

function Mini({ look }: { look: (typeof LOOK)["light"] }) {
  return (
    <div className="absolute inset-0 flex" style={{ background: look.bg }} dir="ltr">
      <div className="flex w-[34%] flex-col gap-1.5 px-2 py-2.5" style={{ background: look.card, borderInlineEnd: `1px solid ${look.line}` }}>
        <div className="mb-1 flex gap-[3px]">
          {["#ec6a5e", "#f4bf4f", "#61c554"].map((c) => (
            <span key={c} className="size-[5px] rounded-full" style={{ background: c }} />
          ))}
        </div>
        <span className="h-[5px] w-4/5 rounded-full" style={{ background: look.soft }} />
        <span className="h-[5px] w-3/5 rounded-full" style={{ background: look.action, opacity: 0.85 }} />
        <span className="h-[5px] w-2/3 rounded-full" style={{ background: look.soft }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-2.5 py-3">
        <span className="h-[6px] w-1/2 rounded-full" style={{ background: look.fg, opacity: 0.8 }} />
        {[88, 70, 80].map((w) => (
          <span key={w} className="flex items-center gap-1">
            <span className="size-[6px] rounded-full" style={{ border: `1.2px solid ${look.fg}`, opacity: 0.5 }} />
            <span className="h-[4px] rounded-full" style={{ width: `${w}%`, background: look.soft }} />
          </span>
        ))}
      </div>
    </div>
  );
}

function ThemeTile({ theme, active, onPick }: { theme: Prefs["theme"]; active: boolean; onPick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-theme-tile={theme}
      onClick={onPick}
      className="group flex flex-1 flex-col items-center gap-2 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-grid-action/50"
    >
      <span
        className={cn(
          "relative block aspect-[16/10] w-full overflow-hidden rounded-md transition-shadow",
          active ? "shadow-[0_0_0_2px_var(--grid-action)]" : "shadow-[0_0_0_1px_var(--grid-line)] group-hover:shadow-[0_0_0_1px_var(--grid-muted)]",
        )}
      >
        {theme === "dark" ? (
          <Mini look={LOOK.dark} />
        ) : theme === "light" ? (
          <Mini look={LOOK.light} />
        ) : (
          <>
            <Mini look={LOOK.light} />
            <span className="absolute inset-0" style={{ clipPath: "polygon(55% 0, 100% 0, 100% 100%, 45% 100%)" }}>
              <Mini look={LOOK.dark} />
            </span>
          </>
        )}
      </span>
      <span className={cn("flex items-center gap-1 text-[13.5px]", active ? "font-medium text-grid-fg" : "text-grid-body")}>
        {active ? <CheckIcon className="size-3.5 text-grid-action" /> : null}
        {t(`settings.theme.${theme}`)}
      </span>
    </button>
  );
}

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
        <div className="px-4 pt-3.5 pb-3">
          <p className="text-[14px] text-grid-fg">{t("settings.theme")}</p>
          <div role="radiogroup" aria-label={t("settings.theme")} className="mt-3 flex gap-3">
            {(["system", "light", "dark"] as const).map((theme) => (
              <ThemeTile key={theme} theme={theme} active={prefs.theme === theme} onPick={() => void setPrefs({ theme })} />
            ))}
          </div>
          <p className="mt-2 text-[13px] text-grid-muted">{t("settings.themeHint")}</p>
        </div>
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
        <Row label={t("settings.notify")} hint={t("settings.notifyHint")} htmlFor="pref-notify">
          <Switch id="pref-notify" data-pref="notify" checked={prefs.notify} onCheckedChange={(notify) => void setPrefs({ notify })} />
        </Row>
        <Row label={t("settings.idle")} hint={t("settings.idleHint")} htmlFor="pref-idle">
          <Switch id="pref-idle" data-pref="idle" checked={prefs.idle} onCheckedChange={(idle) => void setPrefs({ idle })} />
        </Row>
      </Group>
    </Section>
  );
}
