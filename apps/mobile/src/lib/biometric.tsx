// Optional biometric lock (MH-436): Face ID / Touch ID / Android biometrics before any data shows —
// on a cold start and after the app has been in the background for LOCK_AFTER_MS. The session
// token stays in the Keychain / Keystore; this only gates the UI. Nothing biometric leaves the
// device (the OS answers yes/no).
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { Fingerprint, ScanFace } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Platform, View } from "react-native";

import { AppText, CubeMark, fonts, HatchFill, PrimaryButton, useColors, useGridApp } from "@/grid";
import { useT } from "@/i18n";
import { fs } from "@/lib/type-scale";
import { useSession } from "./session";

const KEY = "mahaam.biometricLock";
const LOCK_AFTER_MS = 2 * 60_000;

export type BiometricKind = "face" | "fingerprint" | "none";

async function kind(): Promise<BiometricKind> {
  if (Platform.OS === "web") return "none";
  const [hardware, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  if (!hardware || !enrolled) return "none";
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? "face" : "fingerprint";
}

interface Ctx {
  enabled: boolean;
  available: BiometricKind;
  /** Turning it on asks once, so the switch only flips for a person who can pass it. */
  setEnabled(on: boolean): Promise<boolean>;
}

const BiometricCtx = createContext<Ctx>({ enabled: false, available: "none", setEnabled: async () => false });
export const useBiometric = () => useContext(BiometricCtx);

export function BiometricGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { status } = useSession();
  const [enabled, setEnabledState] = useState(false);
  const [available, setAvailable] = useState<BiometricKind>("none");
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      const [on, k] = await Promise.all([AsyncStorage.getItem(KEY), kind()]);
      const isOn = on === "1" && k !== "none";
      setAvailable(k);
      setEnabledState(isOn);
      setLocked(isOn); // cold start
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "background") backgroundedAt.current = Date.now();
      if (s === "active" && backgroundedAt.current && enabled && Date.now() - backgroundedAt.current > LOCK_AFTER_MS) setLocked(true);
    });
    return () => sub.remove();
  }, [enabled]);

  const unlock = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t("account.biometric.prompt"), cancelLabel: t("common.cancel") });
    if (r.success) setLocked(false);
  }, [t]);

  // Ask as soon as the lock screen shows.
  useEffect(() => {
    if (locked && status === "signedIn") void unlock();
  }, [locked, status, unlock]);

  const setEnabled = useCallback(
    async (on: boolean) => {
      if (on) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: t("account.biometric.confirm"), cancelLabel: t("common.cancel") });
        if (!r.success) return false;
      }
      await AsyncStorage.setItem(KEY, on ? "1" : "0");
      setEnabledState(on);
      return true;
    },
    [t],
  );

  if (!ready) return null;
  return (
    <BiometricCtx.Provider value={{ enabled, available, setEnabled }}>
      {children}
      {locked && status === "signedIn" ? <LockScreen kind={available} onUnlock={() => void unlock()} /> : null}
    </BiometricCtx.Provider>
  );
}

function LockScreen({ kind: k, onUnlock }: { kind: BiometricKind; onUnlock: () => void }) {
  const t = useT();
  const c = useColors();
  const app = useGridApp();
  const Icon = k === "face" ? ScanFace : Fingerprint;
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", gap: 22, padding: 28 }}>
      <HatchFill period={9} opacity={0.7} />
      <View style={{ width: 96, height: 96, borderRadius: 22, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
        <CubeMark size={52} />
      </View>
      <AppText variant="latin">{app.name}</AppText>
      <AppText style={{ fontFamily: fonts.light, fontSize: fs.body, color: c.muted, textAlign: "center" }}>{t("account.biometric.locked")}</AppText>
      <View style={{ alignSelf: "stretch" }}>
        <PrimaryButton label={t(k === "face" ? "account.biometric.unlockFace" : "account.biometric.unlockFinger")} icon={<Icon size={18} color={c.onAction} strokeWidth={1.6} />} onPress={onUnlock} />
      </View>
    </View>
  );
}
