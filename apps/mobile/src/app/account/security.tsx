// Profile → Security: two-factor sign-in (set up with an authenticator app, recovery codes, turn
// off) and the biometric lock. Everything two-factor needs the password first, as on the web.
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, KeyRound, ScanFace, Share2, ShieldCheck, ShieldOff, Smartphone } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Share, Switch, View } from "react-native";

import { ApiError } from "@/api/client";
import { Chip, Micro, useErrorText } from "@/components/kit";
import { EMPTY_REAUTH, ReauthField, reauthBody, reauthReady, type ReauthValue } from "@/components/reauth";
import { useProfile, useTwoFA } from "@/features/account";
import { secondFactor, SecondFactorField, secondFactorReady, type SecondFactor } from "@/components/second-factor";
import { AppText, ErrorLine, fonts, OtpField, PasswordField, PrimaryButton, Row, Rows, Screen, SecondaryButton, SkeletonRow, StackHeader, useColors } from "@/grid";
import { useT } from "@/i18n";
import { useBiometric } from "@/lib/biometric";
import { mahaam, useSession } from "@/lib/session";
import { fs, lh } from "@/lib/type-scale";

type Flow = null | "enroll" | "confirm" | "codes" | "disable" | "regenerate";

function Codes({ codes }: { codes: string[] }) {
  const t = useT();
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.body }}>{t("account.twofa.codesBody")}</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderStartWidth: 1, borderColor: c.soft }}>
        {codes.map((code) => (
          <View key={code} style={{ width: "50%", paddingVertical: 10, alignItems: "center", borderEndWidth: 1, borderBottomWidth: 1, borderColor: c.soft }}>
            <AppText selectable style={{ fontFamily: fonts.mono, fontSize: 14, color: c.fg, writingDirection: "ltr" }}>
              {code}
            </AppText>
          </View>
        ))}
      </View>
      <SecondaryButton label={t("account.twofa.saveCodes")} icon={<Share2 size={16} color={c.muted} strokeWidth={1.6} />} onPress={() => void Share.share({ message: codes.join("\n") })} />
    </View>
  );
}

export default function Security() {
  const t = useT();
  const c = useColors();
  const qc = useQueryClient();
  const errText = useErrorText();
  const { user } = useSession();
  const state = useTwoFA();
  const bio = useBiometric();
  const [flow, setFlow] = useState<Flow>(null);
  const profile = useProfile();
  // Apple/Google/GitHub accounts have no password: they confirm with an emailed code.
  const hasPassword = profile.data?.has_password !== false;
  const [reauth, setReauth] = useState<ReauthValue>(EMPTY_REAUTH);
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState<SecondFactor>({ value: "", recovery: false });
  const [secret, setSecret] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["me", user?.id ?? ""] });
  const start = (f: Flow) => {
    setFlow(f);
    setReauth(EMPTY_REAUTH);
    setCode("");
    setFactor({ value: "", recovery: false });
    setError(null);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e, { password: true, code: true }));
    } finally {
      setBusy(false);
    }
  };

  const on = !!state.data?.enabled;
  const BioIcon = bio.available === "face" ? ScanFace : Fingerprint;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<StackHeader title={t("account.group.security")} />}>
        <Rows>
          <Row>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Micro style={{ flex: 1 }}>{t("account.twofa.title")}</Micro>
              {state.data ? <Chip label={t(on ? "account.on" : "account.off")} tone={on ? "ok" : "neutral"} /> : null}
            </View>
            {state.isPending ? <SkeletonRow /> : null}
            <AppText style={{ fontFamily: fonts.light, fontSize: fs.body, lineHeight: lh(fs.body), color: c.body }}>{t(on ? "account.twofa.onBody" : "account.twofa.offBody")}</AppText>
            {on && state.data ? <AppText variant="meta">{t("account.twofa.left", { n: state.data.recovery_codes_left })}</AppText> : null}

            {flow === null && !on ? (
              <PrimaryButton label={t("account.twofa.setUp")} icon={<ShieldCheck size={17} color={c.onAction} strokeWidth={1.6} />} onPress={() => start("enroll")} />
            ) : null}
            {flow === null && on ? (
              <>
                <SecondaryButton label={t("account.twofa.regenerate")} icon={<KeyRound size={16} color={c.muted} strokeWidth={1.6} />} onPress={() => start("regenerate")} />
                <SecondaryButton label={t("account.twofa.turnOff")} icon={<ShieldOff size={16} color={c.dangerText} strokeWidth={1.6} />} onPress={() => start("disable")} />
              </>
            ) : null}

            {flow === "enroll" || flow === "disable" || flow === "regenerate" ? (
              <ReauthField hasPassword={hasPassword} value={reauth} onChange={setReauth} />
            ) : null}
            {flow === "regenerate" ? <OtpField label={t("auth.mfa.code")} value={code} onChange={setCode} /> : null}
            {/* Turning it off also takes a recovery code: the way out for a lost phone. */}
            {flow === "disable" ? <SecondFactorField value={factor} onChange={setFactor} /> : null}

            {flow === "enroll" ? (
              <PrimaryButton
                label={t("account.twofa.continue")}
                disabled={busy || !reauthReady(reauth, hasPassword)}
                onPress={() => void run(async () => {
                  setSecret(await mahaam.me.twoFAEnroll(reauthBody(reauth, hasPassword)));
                  setFlow("confirm");
                  setCode("");
                })}
              />
            ) : null}

            {flow === "confirm" && secret ? (
              <View style={{ gap: 10 }}>
                <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.body }}>{t("account.twofa.scanBody")}</AppText>
                <SecondaryButton label={t("account.twofa.openApp")} icon={<Smartphone size={16} color={c.muted} strokeWidth={1.6} />} onPress={() => void Linking.openURL(secret.otpauth_url).catch(() => undefined)} />
                <Micro>{t("account.twofa.key")}</Micro>
                <AppText selectable style={{ fontFamily: fonts.mono, fontSize: 14, color: c.fg, writingDirection: "ltr", letterSpacing: 1 }}>
                  {secret.secret}
                </AppText>
                <OtpField label={t("auth.mfa.code")} value={code} onChange={setCode} />
                <PrimaryButton
                  label={t("auth.mfa.verify")}
                  disabled={busy || code.length < 6}
                  onPress={() => void run(async () => {
                    const r = await mahaam.me.twoFAConfirm(code);
                    setCodes(r.recovery_codes ?? []);
                    setFlow("codes");
                    refresh();
                  })}
                />
              </View>
            ) : null}

            {flow === "regenerate" ? (
              <PrimaryButton
                label={t("account.twofa.regenerate")}
                disabled={busy || !reauthReady(reauth, hasPassword) || code.length < 6}
                onPress={() => void run(async () => {
                  const r = await mahaam.me.twoFARecovery(reauthBody(reauth, hasPassword), code);
                  setCodes(r.recovery_codes ?? []);
                  setFlow("codes");
                  refresh();
                })}
              />
            ) : null}

            {flow === "disable" ? (
              <PrimaryButton
                label={t("account.twofa.turnOff")}
                disabled={busy || !reauthReady(reauth, hasPassword) || !secondFactorReady(factor)}
                onPress={() => void run(async () => {
                  await mahaam.me.twoFADisable({ ...reauthBody(reauth, hasPassword), ...secondFactor(factor) });
                  setFlow(null);
                  refresh();
                })}
              />
            ) : null}

            {flow === "codes" ? (
              <>
                <Codes codes={codes} />
                <PrimaryButton label={t("common.done")} onPress={() => setFlow(null)} />
              </>
            ) : null}
            {flow !== null && flow !== "codes" ? <SecondaryButton label={t("common.cancel")} onPress={() => setFlow(null)} /> : null}
            {error ? <ErrorLine text={error} /> : null}
          </Row>

          {bio.available !== "none" ? (
            <Row>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <BioIcon size={20} color={c.muted} strokeWidth={1.6} />
                <AppText style={{ flex: 1, fontFamily: fonts.regular, fontSize: fs.row, color: c.fg }}>
                  {t(bio.available === "face" ? "account.biometric.face" : "account.biometric.finger")}
                </AppText>
                <Switch
                  value={bio.enabled}
                  onValueChange={(v) => void bio.setEnabled(v)}
                  trackColor={{ true: c.gold, false: c.soft }}
                  accessibilityLabel={t(bio.available === "face" ? "account.biometric.face" : "account.biometric.finger")}
                />
              </View>
              <AppText style={{ fontFamily: fonts.light, fontSize: fs.body, lineHeight: lh(fs.body), color: c.muted }}>{t("account.biometric.body")}</AppText>
            </Row>
          ) : null}
        </Rows>
      </Screen>
    </KeyboardAvoidingView>
  );
}
