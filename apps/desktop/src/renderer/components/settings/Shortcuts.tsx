// Keyboard shortcuts: a reference of every key the app answers to — the native menu's accelerators
// (main.ts), the shell's keys (AppShell: C, /, g-sequences), history (router: ⌘[ ⌘]), lists and
// the inbox (j/k/Enter/e), the issue view (s/p/a/l/t) and the system-wide timer toggle.
import { Fragment } from "react";

import { Kbd } from "@/components/kit";
import { useApp } from "@/lib/app";
import { useI18n } from "@/lib/i18n";

import { Group, Section } from "./parts";

/** A key, a sequence ("g i") or a range ("mod+1".."mod+4"), with alternatives. */
type Keys = { any: string[] } | { range: [string, string] };
type Entry = { label: string; keys: Keys; hint?: string };

function KeysView({ keys }: { keys: Keys }) {
  const { t } = useI18n();
  if ("range" in keys)
    return (
      <span className="flex items-center gap-1 text-[12px] text-grid-muted" dir="ltr">
        <Kbd combo={keys.range[0]} />
        <span>–</span>
        <Kbd combo={keys.range[1]} />
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-grid-muted">
      {keys.any.map((combo, i) => (
        <Fragment key={combo}>
          {i > 0 ? <span>{t("settings.sc.or")}</span> : null}
          <span className="flex items-center gap-1" dir="ltr">
            {combo.split(" ").map((step, j) => (
              <Fragment key={j}>
                {j > 0 ? <span className="px-0.5">{t("settings.sc.then")}</span> : null}
                <Kbd combo={step} className="min-w-5 text-[12px]" />
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutSettings() {
  const { t } = useI18n();
  const { config } = useApp();
  const mac = config.platform === "darwin";
  // macOS writes modifiers ⌥⇧⌘; elsewhere Ctrl+Alt+Shift.
  const m = (macCombo: string, other: string) => (mac ? macCombo : other);

  const groups: { title: string; entries: Entry[] }[] = [
    {
      title: t("settings.sc.general"),
      entries: [
        { label: t("settings.sc.palette"), keys: { any: ["mod+k"] } },
        { label: t("settings.sc.search"), keys: { any: ["/"] } },
        { label: t("settings.sc.newIssue"), keys: { any: ["c", "mod+n"] } },
        ...(mac ? [{ label: t("settings.sc.settings"), keys: { any: ["mod+,"] } }] : []),
        { label: t("settings.sc.sidebar"), keys: { any: ["mod+\\"] } },
        { label: t("settings.sc.back"), keys: { any: ["mod+["] } },
        { label: t("settings.sc.forward"), keys: { any: ["mod+]"] } },
        { label: t("settings.sc.close"), keys: { any: ["esc"] } },
      ],
    },
    {
      title: t("settings.sc.navigation"),
      entries: [
        { label: t("settings.sc.goInbox"), keys: { any: ["g i"] } },
        { label: t("settings.sc.goMyIssues"), keys: { any: ["g m"] } },
        { label: t("settings.sc.goProjects"), keys: { any: ["g p"] } },
        { label: t("settings.sc.goTime"), keys: { any: ["g t"] } },
        { label: t("settings.sc.jump"), keys: { range: ["mod+1", "mod+4"] } },
      ],
    },
    {
      title: t("settings.sc.lists"),
      entries: [
        { label: t("settings.sc.down"), keys: { any: ["j", "↓"] } },
        { label: t("settings.sc.up"), keys: { any: ["k", "↑"] } },
        { label: t("settings.sc.open"), keys: { any: ["enter"] } },
        { label: t("settings.sc.markRead"), keys: { any: ["e", "r"] } },
      ],
    },
    {
      title: t("settings.sc.issue"),
      entries: [
        { label: t("settings.sc.status"), keys: { any: ["s"] } },
        { label: t("settings.sc.priority"), keys: { any: ["p"] } },
        { label: t("settings.sc.assign"), keys: { any: ["a"] } },
        { label: t("settings.sc.labels"), keys: { any: ["l"] } },
        { label: t("settings.sc.track"), keys: { any: ["t"] } },
      ],
    },
    {
      title: t("settings.sc.timer"),
      entries: [
        { label: t("settings.sc.timerPalette"), keys: { any: [m("shift+mod+t", "mod+shift+t")] } },
        { label: t("settings.sc.globalTimer"), hint: t("settings.sc.globalHint"), keys: { any: [m("alt+shift+mod+m", "mod+alt+shift+m")] } },
      ],
    },
  ];

  return (
    <Section id="shortcuts" title={t("settings.shortcuts")} description={t("settings.shortcutsHint")}>
      {groups.map((g) => (
        <Group key={g.title} title={g.title}>
          {g.entries.map((e) => (
            <div key={e.label} className="flex h-9 items-center gap-3 px-4" data-shortcut>
              <span className="min-w-0 flex-1 truncate text-[14px] text-grid-fg">
                {e.label}
                {e.hint ? <span className="ms-2 text-[13px] text-grid-muted">{e.hint}</span> : null}
              </span>
              <KeysView keys={e.keys} />
            </div>
          ))}
        </Group>
      ))}
    </Section>
  );
}
