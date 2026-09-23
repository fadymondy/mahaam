// About: the app mark and version, the server this device talks to, the live connection, and the
// links (website, privacy, terms, the web console).
import { ArrowUpRightIcon } from "lucide-react";

import { LtrText } from "@/components/kit";
import { useApp } from "@/lib/app";
import { desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Mark } from "@/views/SignIn";

import { Group, Row, Section, SmallButton } from "./parts";

export function AboutSettings() {
  const { t, locale } = useI18n();
  const { config, session, live } = useApp();
  const server = session?.apiUrl ?? config.defaultApiUrl;
  const links = [
    { label: t("settings.website"), url: "https://mahaam.app" },
    { label: t("settings.privacy"), url: `${server}/${locale}/legal/privacy` },
    { label: t("settings.terms"), url: `${server}/${locale}/legal/terms` },
  ];

  return (
    <Section id="about" title={t("settings.about")}>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-grid-card px-6 py-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl border border-line bg-background">
          <Mark size={40} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-grid-fg">{t(`settings.for.${config.platform === "win32" || config.platform === "linux" ? config.platform : "darwin"}`)}</p>
          <p className="mt-0.5 text-[12.5px] text-grid-muted">{t("settings.tagline")}</p>
        </div>
      </div>

      <Group>
        <Row label={t("settings.version")}>
          <LtrText className="font-mono text-[12px] text-grid-body" data-version>
            {config.version}
          </LtrText>
        </Row>
        <Row label={t("settings.server")}>
          <LtrText className="font-mono text-[12px] text-grid-body">{server}</LtrText>
        </Row>
        <Row label={t("settings.connection")}>
          <span className="flex items-center gap-2 text-[12.5px] text-grid-body" data-live={live}>
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                live === "open" ? "bg-grid-ok shadow-[0_0_0_3px_color-mix(in_oklab,var(--grid-ok)_20%,transparent)]" : live === "reconnecting" ? "bg-grid-warn" : "bg-grid-muted",
              )}
            />
            {t(`settings.live.${live}`)}
          </span>
        </Row>
      </Group>

      <Group title={t("settings.links")}>
        {links.map((l) => (
          <Row key={l.label} label={l.label}>
            <SmallButton onClick={() => void desktop.openExternal(l.url)}>
              {t("settings.open")}
              <ArrowUpRightIcon className="rtl:-scale-x-100" />
            </SmallButton>
          </Row>
        ))}
        <Row label={t("settings.webConsole")}>
          <SmallButton onClick={() => void desktop.openWeb()}>
            {t("settings.open")}
            <ArrowUpRightIcon className="rtl:-scale-x-100" />
          </SmallButton>
        </Row>
      </Group>
      <p className="text-center text-[11.5px] text-grid-muted">© 2026 Fady Mondy</p>
    </Section>
  );
}
