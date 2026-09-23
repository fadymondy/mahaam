// Mahaam reporting on Mahaam: the @mahaam/react-native SDK (fadymondy/mahaam-react-native).
//
// - Monitor (EXPO_PUBLIC_MAHAAM_DSN, `mdsn_…`): uncaught JavaScript errors, render errors (the
//   boundary) and failures we handle ourselves become issues on the Mahaam project's board, with an
//   occurrence count. Durable: AsyncStorage keeps what couldn't be sent for the next start.
// - Feedback (EXPO_PUBLIC_MAHAAM_FEEDBACK_KEY, `pfk_…`): Profile → Report a problem files what a
//   person chose to tell us. The key's allowlist must contain app://com.fadymondy.mahaam.
//
// Both keys come from the build config (eas.json env), never from source; unset = off, which is
// what development wants. Native crashes are not covered here (that is Crashlytics' job).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Monitor, installErrorHandler } from "@mahaam/react-native";
import { MahaamErrorBoundary } from "@mahaam/react-native/boundary";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { useEffect, type ReactNode } from "react";
import { Platform, View } from "react-native";

import { AppText, fonts, PrimaryButton, useColors } from "@/grid";
import { useT } from "@/i18n";

export const APP_ID = "com.fadymondy.mahaam";
export const FEEDBACK_KEY = process.env.EXPO_PUBLIC_MAHAAM_FEEDBACK_KEY ?? "";
export const FEEDBACK_ENABLED = FEEDBACK_KEY.startsWith("pfk_");

const version = Constants.expoConfig?.version ?? "0";

export const monitor = new Monitor({
  dsn: process.env.EXPO_PUBLIC_MAHAAM_DSN,
  environment: __DEV__ ? "development" : "production",
  release: version,
  device: Device.modelId ?? Device.modelName ?? undefined,
  storage: AsyncStorage,
  tags: { os: Platform.OS, os_version: String(Platform.Version), app_version: version },
});

let installed = false;
/** Uncaught JavaScript errors (chains to the red box in development). Once per process. */
export function useMonitor() {
  useEffect(() => {
    if (installed) return;
    installed = true;
    installErrorHandler(monitor);
    // What the last run could not send. Never block start-up on the network.
    void monitor.flush();
  }, []);
}

function Fallback({ reset }: { reset: () => void }) {
  const t = useT();
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 }}>
      <AppText variant="title" style={{ textAlign: "center" }}>
        {t("common.error")}
      </AppText>
      <AppText style={{ fontFamily: fonts.light, fontSize: 13.5, color: c.muted, textAlign: "center" }}>{t("monitor.reported")}</AppText>
      <View style={{ alignSelf: "stretch" }}>
        <PrimaryButton label={t("common.retry")} onPress={reset} />
      </View>
    </View>
  );
}

/** Render errors never reach the global handler — React catches them; this reports and recovers. */
export function MonitorBoundary({ children }: { children: ReactNode }) {
  return (
    <MahaamErrorBoundary monitor={monitor} fallback={(_e, reset) => <Fallback reset={reset} />}>
      {children}
    </MahaamErrorBoundary>
  );
}
