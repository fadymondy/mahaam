// Profile: every setting in one place, one page each (MH-435) — the account, security, preferences,
// the workspace, legal and support, and deleting the account. Reached from the header's gear.
import Constants from "expo-constants";
import { Image } from "expo-image";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  ArrowLeftRight,
  Fingerprint,
  FileText,
  KeyRound,
  LifeBuoy,
  MessageSquareWarning,
  Mail,
  Palette,
  ScanFace,
  Shield,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react-native";
import { useState } from "react";
import { Linking, View } from "react-native";

import { DangerButton } from "@/components/kit";
import { HubGroup, HubItem } from "@/components/hub";
import { ReportProblem } from "@/components/report-problem";
import { useProfile, useTwoFA } from "@/features/account";
import { AppText, fonts, Meta, Row, Rows, Screen, StackHeader, useColors, usePrefs } from "@/grid";
import { useI18n } from "@/i18n";
import { useBiometric } from "@/lib/biometric";
import { legalUrl, supportEmail } from "@/lib/links";
import { FEEDBACK_ENABLED } from "@/lib/monitor";
import { useSession } from "@/lib/session";
import { fs } from "@/lib/type-scale";

export default function ProfileHub() {
  const { t, locale } = useI18n();
  const c = useColors();
  const { themeSetting } = usePrefs();
  const { user, workspace, signOut, chooseWorkspace } = useSession();
  const profile = useProfile();
  const twoFA = useTwoFA();
  const bio = useBiometric();
  const p = profile.data;
  const [reporting, setReporting] = useState(false);
  const initials = (p?.name || p?.email || user?.email || "?").slice(0, 1).toUpperCase();

  return (
    <Screen header={<StackHeader title={t("account.title")} />}>
      <Rows>
        <Row style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          {p?.avatar ? (
            <Image source={{ uri: p.avatar }} style={{ width: 56, height: 56, borderRadius: 12, borderWidth: 1, borderColor: c.line }} />
          ) : (
            <View style={{ width: 56, height: 56, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
              <AppText style={{ fontFamily: fonts.medium, fontSize: 22, lineHeight: 28, color: c.brand }}>{initials}</AppText>
            </View>
          )}
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="rowTitle">{p?.name || t("account.noName")}</AppText>
            <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.muted, writingDirection: "ltr" }}>{p?.email ?? user?.email ?? ""}</AppText>
            {p && !p.email_verified ? (
              <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.goldText }} onPress={() => router.push("/verify-email")}>
                {t("account.verify.pending")}
              </AppText>
            ) : null}
          </View>
        </Row>

        <HubGroup title={t("account.group.account")}>
          <HubItem Icon={UserRound} label={t("account.details.title")} value={p?.name} onPress={() => router.push("/account/details")} />
          <HubItem Icon={Mail} label={t("account.email.title")} value={p?.email} onPress={() => router.push("/account/email")} />
          <HubItem Icon={KeyRound} label={t("account.password.title")} onPress={() => router.push("/account/password")} last />
        </HubGroup>

        <HubGroup title={t("account.group.security")}>
          <HubItem
            Icon={twoFA.data?.enabled ? ShieldCheck : Shield}
            label={t("account.twofa.title")}
            value={twoFA.data ? t(twoFA.data.enabled ? "account.on" : "account.off") : undefined}
            onPress={() => router.push("/account/security")}
          />
          <HubItem
            Icon={bio.available === "face" ? ScanFace : Fingerprint}
            label={t(bio.available === "face" ? "account.biometric.face" : "account.biometric.finger")}
            value={bio.available === "none" ? t("account.biometric.unavailable") : t(bio.enabled ? "account.on" : "account.off")}
            onPress={bio.available === "none" ? undefined : () => router.push("/account/security")}
            last
          />
        </HubGroup>

        <HubGroup title={t("account.group.preferences")}>
          <HubItem
            Icon={Palette}
            label={t("account.preferences.title")}
            value={`${t(`lang.${locale}` as "lang.en")} · ${t(`settings.theme.${themeSetting}` as "settings.theme.dark")}`}
            onPress={() => router.push("/account/preferences")}
            last
          />
        </HubGroup>

        <HubGroup title={t("settings.workspace")}>
          <HubItem
            Icon={ArrowLeftRight}
            label={t("ws.switch")}
            value={workspace ? `${workspace.name} · ${t(`ws.role.${workspace.role}` as "ws.role.member")}` : undefined}
            onPress={() => void chooseWorkspace(null).then(() => router.replace("/workspaces"))}
            last
          />
        </HubGroup>

        <HubGroup title={t("account.group.legal")}>
          <HubItem Icon={FileText} label={t("legal.terms")} onPress={() => void WebBrowser.openBrowserAsync(legalUrl("terms", locale))} />
          <HubItem Icon={FileText} label={t("legal.privacy")} onPress={() => void WebBrowser.openBrowserAsync(legalUrl("privacy", locale))} />
          {FEEDBACK_ENABLED ? <HubItem Icon={MessageSquareWarning} label={t("account.report")} onPress={() => setReporting(true)} /> : null}
          <HubItem Icon={LifeBuoy} label={t("account.support")} value={supportEmail} onPress={() => void Linking.openURL(`mailto:${supportEmail}`)} last />
        </HubGroup>

        <HubGroup title={t("account.group.danger")}>
          <HubItem Icon={Trash2} label={t("account.delete.title")} danger onPress={() => router.push("/account/delete")} last />
        </HubGroup>

        <Row>
          <DangerButton label={t("auth.signOut")} onPress={() => void signOut().then(() => router.replace("/sign-in"))} />
          <View style={{ alignItems: "center" }}>
            <Meta items={[t("settings.version", { v: Constants.expoConfig?.version ?? "" })]} />
          </View>
        </Row>
      </Rows>
      {FEEDBACK_ENABLED ? <ReportProblem visible={reporting} onClose={() => setReporting(false)} route="/settings" /> : null}
    </Screen>
  );
}
