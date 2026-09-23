// Account: the profile (picture, name, email, timezone), security (password and two-factor, both
// managed on the web), the devices signed in to the account with Revoke, and signing out.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRightIcon, CheckIcon, ChevronDownIcon, GlobeIcon, KeyRoundIcon, LaptopIcon, LogOutIcon, PuzzleIcon, ShieldCheckIcon, SmartphoneIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Device, Profile } from "../../../main/api-account";
import { Avatar, LtrText, Spinner } from "@/components/kit";
import { PropertyMenu } from "@/components/pickers";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app";
import { api, desktop } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Badge, Group, Row, Section, SmallButton } from "./parts";

export const accountKeys = {
  profile: ["me", "profile"] as const,
  twoFA: ["me", "2fa"] as const,
  devices: ["me", "devices"] as const,
};

const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function WebButton({ path = "/me" }: { path?: string }) {
  const { t } = useI18n();
  return (
    <SmallButton onClick={() => void desktop.openWeb(path)} data-open-web>
      {t("settings.manageWeb")}
      <ArrowUpRightIcon className="rtl:-scale-x-100" />
    </SmallButton>
  );
}

function NameField({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [value, setValue] = useState(profile.name);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setValue(profile.name);
  }, [profile.name]);
  const save = useMutation({
    mutationFn: (name: string) => api.updateProfile({ name }),
    onSuccess: (p) => {
      qc.setQueryData(accountKeys.profile, p);
      setSaved(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSaved(false), 1800);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : t("common.error"));
      setValue(profile.name);
    },
  });
  const commit = () => {
    const next = value.replace(/\s+/g, " ").trim();
    if (next === profile.name) return setValue(profile.name);
    save.mutate(next);
  };
  return (
    <span className="flex items-center gap-2">
      <span className={cn("flex items-center gap-1 text-[13px] text-grid-ok transition-opacity", saved ? "opacity-100" : "opacity-0")} aria-live="polite">
        <CheckIcon className="size-3.5" />
        {saved ? t("settings.saved") : null}
      </span>
      {save.isPending ? <Spinner /> : null}
      <input
        id="profile-name"
        data-profile-name
        dir="auto"
        value={value}
        maxLength={120}
        placeholder={t("settings.namePlaceholder")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setValue(profile.name);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        className="h-7 w-56 rounded-md border border-line bg-background px-2 text-[14px] text-grid-fg outline-none placeholder:text-grid-muted focus:border-grid-action/60 focus:ring-2 focus:ring-grid-action/20"
      />
    </span>
  );
}

function TimezoneField({ profile }: { profile: Profile }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [deviceTz()];
    }
  }, []);
  const save = useMutation({
    mutationFn: (timezone: string) => api.updateProfile({ timezone }),
    onSuccess: (p) => {
      qc.setQueryData(accountKeys.profile, p);
      toast.success(t("settings.saved"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("common.error")),
  });
  const value = profile.timezone ?? "";
  const options = [
    { value: "", label: `${t("settings.tzDevice")} (${deviceTz()})` },
    ...zones.map((z) => ({ value: z, label: z.replaceAll("_", " ") })),
  ];
  return (
    <PropertyMenu
      label={t("settings.timezone")}
      options={options}
      value={value}
      onChange={(tz) => tz !== value && save.mutate(tz)}
      searchable
      placeholder={t("settings.searchTz")}
      align="end"
      trigger={
        <span className="flex items-center gap-1.5" data-timezone>
          <GlobeIcon className="size-3.5 text-grid-muted" />
          <LtrText className="truncate">{value ? value.replaceAll("_", " ") : `${t("settings.tzDevice")}`}</LtrText>
        </span>
      }
    />
  );
}

const DEVICE_ICON = { desktop: LaptopIcon, mobile: SmartphoneIcon, extension: PuzzleIcon, browser: GlobeIcon, other: KeyRoundIcon };

const DEVICES_SHOWN = 6;

function Devices() {
  const { t, relative, date, number } = useI18n();
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: accountKeys.devices, queryFn: () => api.devices(), staleTime: 0 });
  const [confirm, setConfirm] = useState<Device | null>(null);
  const [all, setAll] = useState(false);
  const list = devices.data ?? [];
  const shown = all ? list : list.slice(0, DEVICES_SHOWN);
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeDevice(id),
    onSuccess: (_v, id) => {
      qc.setQueryData<Device[]>(accountKeys.devices, (list) => list?.filter((d) => d.id !== id));
      toast.success(t("settings.revoked"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("common.error")),
    onSettled: () => setConfirm(null),
  });

  return (
    <Group title={t("settings.devices")} footer={t("settings.devicesHint")}>
      {devices.isPending ? (
        <div className="flex h-12 items-center px-4">
          <Spinner />
        </div>
      ) : devices.isError ? (
        <Row label={t("common.error")} hint={devices.error instanceof Error ? devices.error.message : undefined}>
          <SmallButton onClick={() => void devices.refetch()}>{t("common.retry")}</SmallButton>
        </Row>
      ) : (
        shown.map((d) => {
          const Icon = DEVICE_ICON[d.kind];
          return (
            <Row
              key={d.id}
              data-row="device"
              icon={
                <span className={cn("flex size-8 items-center justify-center rounded-md border border-line", d.current ? "bg-grid-action/10 text-grid-action" : "bg-background")}>
                  <Icon className="size-4" />
                </span>
              }
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <LtrText className="truncate">{d.name}</LtrText>
                  {d.current ? <Badge tone="action">{t("settings.thisDevice")}</Badge> : null}
                </span>
              }
              hint={
                <>
                  {t("settings.added", { when: relative(d.created_at) })}
                  {d.expires_at ? ` · ${t("settings.expires", { date: date(d.expires_at, { day: "numeric", month: "short", year: "numeric" }) })}` : null}
                </>
              }
            >
              {d.current ? null : (
                <SmallButton tone="danger" onClick={() => setConfirm(d)} data-revoke={d.id}>
                  {t("settings.revoke")}
                </SmallButton>
              )}
            </Row>
          );
        })
      )}
      {list.length > DEVICES_SHOWN ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          data-devices-toggle
          className="flex h-9 w-full items-center justify-center gap-1 text-[13.5px] text-grid-muted hover:bg-grid-soft/60 hover:text-grid-fg"
        >
          {all ? t("settings.devicesFewer") : t("settings.devicesAll", { count: number(list.length) })}
          <ChevronDownIcon className={cn("size-3.5 transition-transform", all && "rotate-180")} />
        </button>
      ) : null}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !revoke.isPending && setConfirm(null)}>
        <AlertDialogContent size="sm" data-revoke-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px]">{t("settings.revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-[13.5px]">{t("settings.revokeBody", { name: confirm?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm">{t("common.cancel")}</AlertDialogCancel>
            <Button size="sm" variant="destructive" disabled={revoke.isPending} onClick={() => confirm && revoke.mutate(confirm.id)} data-confirm-revoke>
              {revoke.isPending ? <Spinner /> : null}
              {t("settings.revoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Group>
  );
}

export function AccountSettings() {
  const { t, number } = useI18n();
  const { session, signOut } = useApp();
  const profile = useQuery({ queryKey: accountKeys.profile, queryFn: () => api.profile() });
  const twoFA = useQuery({ queryKey: accountKeys.twoFA, queryFn: () => api.twoFA() });
  const p = profile.data;
  const email = p?.email ?? session?.email ?? "";

  return (
    <Section id="account" title={t("settings.account")} description={t("settings.accountHint")}>
      <Group title={t("settings.profile")}>
        <div className="flex items-center gap-4 px-4 py-4">
          {p?.avatar ? (
            <img src={p.avatar} alt="" className="size-14 shrink-0 rounded-full object-cover ring-1 ring-line" />
          ) : (
            <Avatar id={session?.userId ?? email} email={email} size={56} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold text-grid-fg" data-profile-display>
              {p?.name || email.split("@")[0]}
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-[13.5px] text-grid-muted">
              <LtrText className="truncate">{email}</LtrText>
              {p ? <Badge tone={p.email_verified ? "ok" : "warn"}>{p.email_verified ? t("settings.verified") : t("settings.unverified")}</Badge> : null}
            </p>
          </div>
          <SmallButton onClick={() => void desktop.openWeb("/me")} title={t("settings.pictureHint")}>
            {t("settings.picture")}
            <ArrowUpRightIcon className="rtl:-scale-x-100" />
          </SmallButton>
        </div>
        <Row label={t("settings.name")} htmlFor="profile-name">
          {p ? <NameField profile={p} /> : <Spinner />}
        </Row>
        <Row label={t("settings.timezone")} hint={t("settings.timezoneHint")}>
          {p ? <TimezoneField profile={p} /> : <Spinner />}
        </Row>
      </Group>

      <Group title={t("settings.security")}>
        <Row icon={<KeyRoundIcon className="size-4" />} label={t("settings.password")} hint={t("settings.passwordHint")}>
          <WebButton />
        </Row>
        <Row
          icon={<ShieldCheckIcon className="size-4" />}
          data-row="2fa"
          label={
            <span className="flex items-center gap-2">
              {t("settings.twoFA")}
              {twoFA.data ? <Badge tone={twoFA.data.enabled ? "ok" : "muted"}>{twoFA.data.enabled ? t("settings.on") : t("settings.off")}</Badge> : null}
            </span>
          }
          hint={
            !twoFA.data
              ? undefined
              : twoFA.data.enabled
                ? t("settings.twoFAOn", { count: number(twoFA.data.recovery_codes_left) })
                : twoFA.data.pending
                  ? t("settings.twoFAPending")
                  : t("settings.twoFAOff")
          }
        >
          <WebButton />
        </Row>
      </Group>

      <Devices />

      <Group>
        <Row icon={<LogOutIcon className="size-4" />} label={t("settings.signOut")} hint={t("settings.signOutHint")}>
          <SmallButton tone="danger" onClick={() => void signOut()} data-sign-out>
            {t("settings.signOut")}
          </SmallButton>
        </Row>
      </Group>
    </Section>
  );
}
