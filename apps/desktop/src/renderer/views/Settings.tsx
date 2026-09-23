// Settings, a native preferences window like Zekra's and Health Debug's (and macOS's own): a title
// row naming the section, a row of toolbar tabs (icon over label) and the section's grouped rows
// below. The route's `section` picks it (⌘, and the menus open General); ⌘W or Esc closes it.
import { InfoIcon, KeyboardIcon, LayersIcon, SlidersHorizontalIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AboutSettings } from "@/components/settings/About";
import { AccountSettings } from "@/components/settings/Account";
import { GeneralSettings } from "@/components/settings/General";
import { ShortcutSettings } from "@/components/settings/Shortcuts";
import { WorkspaceSettings } from "@/components/settings/Workspaces";
import { desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";

const SECTIONS = [
  { id: "general", icon: SlidersHorizontalIcon },
  { id: "account", icon: UserRoundIcon },
  { id: "workspaces", icon: LayersIcon },
  { id: "shortcuts", icon: KeyboardIcon },
  { id: "about", icon: InfoIcon },
] as const satisfies readonly { id: string; icon: LucideIcon }[];

type SectionId = (typeof SECTIONS)[number]["id"];

const isSection = (s?: string): s is SectionId => SECTIONS.some((x) => x.id === s);

export function SettingsView({ section }: { section?: string }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const current: SectionId = isSection(section) ? section : "general";
  const scroller = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(document.hasFocus());

  // Braced: Chromium's scrollTo now returns a promise, which React would take for a cleanup.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [current]);
  useEffect(() => {
    document.title = `${t("nav.settings")} — ${t(`settings.${current}`)}`;
  }, [t, current]);
  // A window in the background dims its toolbar, like any macOS window.
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  // Esc closes the window, unless something inside it (a field, a menu) takes it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.documentElement.dataset.surface !== "settings") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      void desktop.hideSurface();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (id: SectionId) => navigate({ name: "settings", section: id });

  return (
    <div className="flex h-full min-h-0 flex-col" data-settings={current}>
      <header className="settings-toolbar drag app-chrome shrink-0" data-blurred={!focused || undefined}>
        <div className="settings-title">
          <span className="truncate">{t(`settings.${current}`)}</span>
        </div>
        <nav
          role="tablist"
          aria-label={t("settings.sections")}
          className="flex flex-wrap justify-center gap-0.5 px-3 pb-2"
          onKeyDown={(e) => {
            // ←/→ walk the tabs like a native toolbar (mirrored in RTL).
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const forward = (e.key === "ArrowRight") !== (document.documentElement.dir === "rtl");
            const i = SECTIONS.findIndex((s) => s.id === current);
            const next = SECTIONS[(i + (forward ? 1 : SECTIONS.length - 1)) % SECTIONS.length]!;
            go(next.id);
            requestAnimationFrame(() => (document.querySelector(`[data-settings-nav="${next.id}"]`) as HTMLElement | null)?.focus());
          }}
        >
          {SECTIONS.map(({ id, icon: Icon }) => {
            const on = id === current;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                data-active={on || undefined}
                data-settings-nav={id}
                onClick={() => go(id)}
                className="settings-tab"
              >
                <Icon aria-hidden />
                <span>{t(`settings.${id}`)}</span>
              </button>
            );
          })}
        </nav>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-background">
        {/* Keyed so a section's own state (forms, fetches) starts fresh. */}
        <div key={current} className="mx-auto w-full max-w-[640px] px-7 pt-5 pb-10">
          {current === "general" ? (
            <GeneralSettings />
          ) : current === "account" ? (
            <AccountSettings />
          ) : current === "workspaces" ? (
            <WorkspaceSettings />
          ) : current === "shortcuts" ? (
            <ShortcutSettings />
          ) : (
            <AboutSettings />
          )}
        </div>
      </div>
    </div>
  );
}
