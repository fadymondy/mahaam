// Settings, laid out like macOS System Settings / Linear: its own section list on the start side and
// the section on the other. The route's `section` picks it (⌘, and the menu open General).
import { ChevronRightIcon, InfoIcon, KeyboardIcon, LayersIcon, SlidersHorizontalIcon, UserRoundIcon, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { ViewHeader } from "@/components/kit";
import { AboutSettings } from "@/components/settings/About";
import { AccountSettings } from "@/components/settings/Account";
import { GeneralSettings } from "@/components/settings/General";
import { ShortcutSettings } from "@/components/settings/Shortcuts";
import { WorkspaceSettings } from "@/components/settings/Workspaces";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "@/lib/router";
import { cn } from "@/lib/utils";

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

  // Braced: Chromium's scrollTo now returns a promise, which React would take for a cleanup.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [current]);

  const go = (id: SectionId) => navigate({ name: "settings", section: id });

  return (
    <>
      <ViewHeader title={t("nav.settings")}>
        <ChevronRightIcon className="size-3.5 text-grid-muted rtl:-scale-x-100" />
        <span className="truncate text-[14px] text-grid-muted">{t(`settings.${current}`)}</span>
      </ViewHeader>
      <div className="flex min-h-0 flex-1" data-settings={current}>
        <nav
          aria-label={t("settings.sections")}
          className="flex w-[200px] shrink-0 flex-col gap-px border-e border-line px-2 py-3"
          onKeyDown={(e) => {
            // ↑/↓ walk the list like a native sidebar.
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const i = SECTIONS.findIndex((s) => s.id === current);
            const next = SECTIONS[(i + (e.key === "ArrowDown" ? 1 : SECTIONS.length - 1)) % SECTIONS.length]!;
            go(next.id);
            requestAnimationFrame(() => (document.querySelector(`[data-settings-nav="${next.id}"]`) as HTMLElement | null)?.focus());
          }}
        >
          {SECTIONS.map(({ id, icon: Icon }) => {
            const active = id === current;
            return (
              <button
                key={id}
                type="button"
                data-settings-nav={id}
                aria-current={active ? "page" : undefined}
                onClick={() => go(id)}
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-start text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-grid-action/40",
                  active ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-body hover:bg-grid-soft/70 hover:text-grid-fg",
                )}
              >
                <Icon className={cn("size-3.5 shrink-0", active ? "text-grid-fg" : "text-grid-muted")} />
                <span className="truncate">{t(`settings.${id}`)}</span>
              </button>
            );
          })}
        </nav>
        <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[660px] px-10 pt-8 pb-16">
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
    </>
  );
}
