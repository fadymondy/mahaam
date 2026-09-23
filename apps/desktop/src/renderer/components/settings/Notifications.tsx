// Notifications, after Zekra's and Health Debug's: how this computer shows them (banners, sound, the
// Dock badge, the system's own permission), which kinds reach the inbox in this workspace (a muted
// kind is not stored at all), and email with the daily digest. The device settings are prefs held
// by the main process; the rest are the person's settings on the server, per workspace.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRingIcon, ChevronDownIcon, MailWarningIcon } from "lucide-react";
import { toast } from "sonner";

import type { NotificationSettings, NotificationSettingsInput } from "../../../shared/types";
import { LtrText, Spinner } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { useApp } from "@/lib/app";
import { api, desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { nativeMenu } from "@/lib/native";

import { Group, Row, Section, SmallButton } from "./parts";

const key = (ws: string) => ["w", ws, "notification-settings"] as const;

export function NotificationSettingsSection() {
  const { t } = useI18n();
  return (
    <Section id="notifications" title={t("settings.notifications")} description={t("settings.notificationsHint")}>
      <ThisComputer />
      <Server />
    </Section>
  );
}

function ThisComputer() {
  const { t } = useI18n();
  const { prefs, setPrefs, config } = useApp();
  const mac = config.platform === "darwin";
  return (
    <Group title={t("settings.onThisComputer")}>
      <Row label={t("settings.notify")} hint={t("settings.notifyHint")} htmlFor="pref-notify">
        <Switch id="pref-notify" data-pref="notify" checked={prefs.notify} onCheckedChange={(notify) => void setPrefs({ notify })} />
      </Row>
      <Row label={t("settings.sound")} hint={t("settings.soundHint")} htmlFor="pref-sound">
        <Switch id="pref-sound" data-pref="sound" checked={prefs.sound} disabled={!prefs.notify} onCheckedChange={(sound) => void setPrefs({ sound })} />
      </Row>
      {config.platform !== "win32" ? (
        <Row label={t(mac ? "settings.badge.darwin" : "settings.badge.other")} hint={t("settings.badgeHint")} htmlFor="pref-badge">
          <Switch id="pref-badge" data-pref="badge" checked={prefs.badge} onCheckedChange={(badge) => void setPrefs({ badge })} />
        </Row>
      ) : null}
      {config.platform !== "linux" ? (
        <Row label={t("settings.system")} hint={t(mac ? "settings.system.darwin" : "settings.system.win32")}>
          <SmallButton
            onClick={() =>
              void desktop.testNotification(t("settings.testTitle"), t("settings.testBody")).then((ok) => {
                if (!ok) toast.error(t("settings.testUnsupported"));
              })
            }
            data-test-notification
          >
            <BellRingIcon />
            {t("settings.test")}
          </SmallButton>
          <SmallButton onClick={() => void desktop.openNotificationSettings()} data-system-notifications>
            {t("settings.systemOpen")}
          </SmallButton>
        </Row>
      ) : null}
    </Group>
  );
}

function Server() {
  const { t } = useI18n();
  const { ws, workspace } = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key(ws), queryFn: () => api.notificationSettings(), enabled: !!ws });
  const save = useMutation({
    mutationFn: (patch: NotificationSettingsInput) => api.updateNotificationSettings(patch),
    // Switches move at once; a failure puts them back and says so.
    onMutate: (patch) => {
      const before = qc.getQueryData<NotificationSettings>(key(ws));
      if (before) qc.setQueryData(key(ws), { ...before, ...patch });
      return { before };
    },
    onSuccess: (next) => qc.setQueryData(key(ws), next),
    onError: (_e, _p, ctx) => {
      if (ctx?.before) qc.setQueryData(key(ws), ctx.before);
      toast.error(t("settings.saveFailed"));
    },
  });

  if (!q.data) {
    return (
      <Group title={t("settings.inboxIn", { ws: workspace?.name ?? "" })}>
        <div className="flex h-[52px] items-center px-4">{q.isError ? <span className="text-[13px] text-grid-muted">{t("settings.saveFailed")}</span> : <Spinner />}</div>
      </Group>
    );
  }
  const s = q.data;
  const muted = new Set(s.muted_kinds ?? []);
  const label = (k: string) => {
    const v = t(`settings.kind.${k}`);
    return v === `settings.kind.${k}` ? <LtrText>{k}</LtrText> : v;
  };
  const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <>
      <Group title={t("settings.inboxIn", { ws: workspace?.name ?? "" })} footer={t("settings.kindsHint")}>
        {(s.kinds ?? []).map((k) => (
          <Row key={k} label={label(k)} htmlFor={`kind-${k}`} data-kind={k}>
            <Switch
              id={`kind-${k}`}
              checked={!muted.has(k)}
              onCheckedChange={(on) => {
                const next = new Set(muted);
                if (on) next.delete(k);
                else next.add(k);
                save.mutate({ muted_kinds: [...next] });
              }}
            />
          </Row>
        ))}
      </Group>

      <Group title={t("settings.email")}>
        {s.email.configured ? (
          <>
            <Row label={t("settings.emailEnabled")} hint={t("settings.emailHint", { address: `⁦${s.address}⁩` })} htmlFor="ns-email">
              <Switch id="ns-email" data-email-enabled checked={s.email_enabled} onCheckedChange={(v) => save.mutate({ email_enabled: v })} />
            </Row>
            <Row label={t("settings.digest")} htmlFor="ns-digest">
              <Switch id="ns-digest" data-digest-enabled checked={s.digest_enabled} disabled={!s.email_enabled} onCheckedChange={(v) => save.mutate({ digest_enabled: v })} />
            </Row>
            <Row label={t("settings.digestHour")} hint={t("settings.digestHourHint", { tz: s.timezone })}>
              <button
                type="button"
                aria-haspopup="menu"
                disabled={!s.email_enabled || !s.digest_enabled}
                className="inline-flex h-8 min-w-24 items-center gap-2 rounded-md border border-line bg-background px-2.5 text-[13.5px] text-grid-fg hover:bg-grid-soft disabled:opacity-50"
                onClick={(e) =>
                  void nativeMenu(
                    Array.from({ length: 24 }, (_, h) => ({ id: String(h), label: hour(h), type: "radio" as const, checked: h === s.digest_hour })),
                    e.currentTarget,
                  ).then((id) => id !== null && save.mutate({ digest_hour: Number(id) }))
                }
                data-digest-hour
              >
                <LtrText className="flex-1 text-start tabular-nums">{hour(s.digest_hour)}</LtrText>
                <ChevronDownIcon className="size-3.5 text-grid-muted" />
              </button>
            </Row>
          </>
        ) : (
          <Row
            icon={<MailWarningIcon className="size-4 text-grid-warn" />}
            label={t("settings.emailOff")}
            hint={t("settings.emailOffBody", { driver: s.email.driver })}
            data-email-not-configured
          />
        )}
      </Group>
    </>
  );
}
