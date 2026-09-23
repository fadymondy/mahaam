// Over-the-air updates through Codemagic Patch, our self-hosted server (patch.fadymondy.com; the
// build-time half is plugins/with-app-updates.js). Check on launch and whenever the app returns to
// the foreground, download in the background, then offer to restart.
//
//   downloading → a small pill at the top: "Downloading update… 42%"
//   ready       → a card: "Update ready" · Restart now / Later
//
// The step APIs, not sync(): check → download (with progress) → install ON_NEXT_RESTART, so "Later"
// and a crash both still end on the new bundle at the next cold start → then the prompt. A mandatory
// release offers no Later and restarts itself after a short countdown. On start the running bundle
// is confirmed (notifyAppReady), so a release that fails to boot is rolled back by Patch.
// Nothing runs in development (Metro serves the code) or when this build has no Patch deployment
// compiled in (extra.appUpdates.ota). Failures stay silent: offline is normal; the next foreground
// tries again.
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, fonts, metrics, PrimaryButton, SecondaryButton, useColors } from "@/grid";
import { useT } from "@/i18n";
import { fs } from "@/lib/type-scale";

/** A foreground check is skipped if the last one was more recent than this. Launch always checks. */
export const CHECK_INTERVAL_MS = 10 * 60 * 1000;

export type CheckReason = "launch" | "foreground";

/** Whether to ask the update server now. Pure, so the rules are unit-tested. */
export function shouldCheck(s: {
  reason: CheckReason;
  dev: boolean;
  enabled: boolean;
  /** A check or download is already in flight. */
  busy: boolean;
  /** An update is downloaded and waiting for a restart: nothing more to fetch this run. */
  pending: boolean;
  lastCheckAt: number | null;
  now: number;
}): boolean {
  if (s.dev || !s.enabled || s.busy || s.pending) return false;
  if (s.reason === "launch" || s.lastCheckAt === null) return true;
  return s.now - s.lastCheckAt >= CHECK_INTERVAL_MS;
}

export type UpdateView =
  | { kind: "hidden" }
  /** progress is 0–100, or null while the size is unknown (spinner only). */
  | { kind: "downloading"; progress: number | null }
  /** mandatory: no Later, and the app restarts itself after a short countdown. */
  | { kind: "ready"; mandatory?: true };

/** Which UI to show for the updater's state. Pure, so the states are unit-tested. */
export function updateView(s: {
  isDownloading: boolean;
  downloadProgress?: number;
  isUpdatePending: boolean;
  isRestarting?: boolean;
  /** The downloaded update's id ("rollback" for a roll back to the embedded bundle). */
  pendingId: string | null;
  /** The update the person chose "Later" for. A newer download asks again. */
  laterId: string | null;
  mandatory?: boolean;
}): UpdateView {
  if (s.isRestarting) return { kind: "hidden" };
  if (s.isUpdatePending) {
    if (s.mandatory) return { kind: "ready", mandatory: true };
    return s.pendingId !== null && s.pendingId === s.laterId ? { kind: "hidden" } : { kind: "ready" };
  }
  if (s.isDownloading) {
    const p = s.downloadProgress;
    return { kind: "downloading", progress: typeof p === "number" && p > 0 ? Math.min(100, Math.round(p * 100)) : null };
  }
  return { kind: "hidden" };
}

// Development only: EXPO_PUBLIC_UPDATE_PREVIEW=downloading[:0.42] | ready shows that state, so the
// UI can be checked on a simulator where no real update can be fetched.
export function previewView(v: string | undefined): UpdateView | null {
  if (!v) return null;
  const [kind, p] = v.split(":");
  if (kind === "ready") return { kind: "ready" };
  if (kind === "downloading") {
    const n = Number(p);
    return { kind: "downloading", progress: p && Number.isFinite(n) ? Math.round(n * 100) : null };
  }
  return null;
}

type Patch = typeof import("@codemagic/react-native-patch");

/** A Patch deployment is compiled into this build for this platform (plugins/with-app-updates.js). */
const ota = ((Constants.expoConfig?.extra ?? {}) as { appUpdates?: { ota?: { ios?: boolean; android?: boolean } } }).appUpdates?.ota ?? {};
export const otaEnabled = Platform.OS === "ios" ? !!ota.ios : Platform.OS === "android" ? !!ota.android : false;

let loaded: Patch | null | undefined;
let injected = false;
/** Tests only: stand in for the native module (jest runs with __DEV__ on, which keeps it off). */
export function __setPatchForTests(p: Patch | null): void {
  loaded = p;
  injected = p !== null;
}
/** Required lazily and only when a deployment is compiled in: the TurboModule throws where it is absent. */
function patch(): Patch | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (!otaEnabled || __DEV__) return loaded;
  try {
    loaded = require("@codemagic/react-native-patch") as Patch;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Seconds a mandatory update waits before restarting itself. */
export const MANDATORY_COUNTDOWN_S = 10;

type Phase = { phase: "idle" } | { phase: "downloading"; progress: number | undefined } | { phase: "ready"; id: string; mandatory: boolean } | { phase: "restarting" };

/** Runs the checks and returns what to show. */
function useAppUpdates() {
  const [state, setState] = useState<Phase>({ phase: "idle" });
  const [laterId, setLaterId] = useState<string | null>(null);
  const busy = useRef(false);
  const lastCheckAt = useRef<number | null>(null);
  const pending = useRef(false);

  const check = useCallback(async (reason: CheckReason) => {
    const now = Date.now();
    const p = patch();
    if (!shouldCheck({ reason, dev: __DEV__ && !injected, enabled: !!p, busy: busy.current, pending: pending.current, lastCheckAt: lastCheckAt.current, now }) || !p) return;
    busy.current = true;
    lastCheckAt.current = now;
    try {
      const result = await p.checkForUpdate();
      if (result.action === "embedded-revert") {
        // The server rolled the deployment back to the binary's own bundle: quietly, next cold start.
        await p.installUpdate(result, { installMode: "ON_NEXT_RESTART" });
        return;
      }
      if (result.action !== "ota-update" || result.remotePackage.previouslyFailed) return;
      const pkg = result.remotePackage;
      setState({ phase: "downloading", progress: undefined });
      const local = await p.downloadUpdate(pkg, (d) => {
        const total = (d as { totalBytes?: number }).totalBytes ?? 0;
        const got = (d as { receivedBytes?: number }).receivedBytes ?? 0;
        setState({ phase: "downloading", progress: total > 0 ? got / total : undefined });
      });
      await p.installUpdate(local, { installMode: "ON_NEXT_RESTART" });
      pending.current = true;
      setState({ phase: "ready", id: String((pkg as { packageHash?: string }).packageHash ?? Date.now()), mandatory: !!pkg.isMandatory });
    } catch {
      // Offline, server down, or a refused release: try again on the next foreground.
      setState((s) => (s.phase === "downloading" ? { phase: "idle" } : s));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    // The running bundle started: tell Patch, so a release that crashes on start is rolled back.
    void patch()
      ?.notifyAppReady()
      .catch(() => undefined);
    void check("launch");
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void check("foreground");
    });
    return () => sub.remove();
  }, [check]);

  const restart = useCallback(() => {
    setState({ phase: "restarting" });
    void patch()
      ?.restartApp()
      .catch(() => undefined);
  }, []);

  // A mandatory release does not wait for a tap.
  useEffect(() => {
    if (state.phase !== "ready" || !state.mandatory) return;
    const id = setTimeout(restart, MANDATORY_COUNTDOWN_S * 1000);
    return () => clearTimeout(id);
  }, [state, restart]);

  const view = updateView({
    isDownloading: state.phase === "downloading",
    downloadProgress: state.phase === "downloading" ? state.progress : undefined,
    isUpdatePending: state.phase === "ready",
    isRestarting: state.phase === "restarting",
    pendingId: state.phase === "ready" ? state.id : null,
    laterId,
    mandatory: state.phase === "ready" && state.mandatory,
  });
  return { view, restart, later: () => setLaterId(state.phase === "ready" ? state.id : null) };
}

/** The pill and the prompt, for a given state. Exported for tests and the dev preview. */
export function UpdateBanner({ view, onRestart, onLater }: { view: UpdateView; onRestart: () => void; onLater: () => void }) {
  const c = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  if (view.kind === "hidden") return null;
  const top = insets.top + 8;
  if (view.kind === "downloading") {
    return (
      <View pointerEvents="none" style={[styles.anchor, { top }]}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t("updates.downloading")}
          accessibilityValue={view.progress === null ? undefined : { min: 0, max: 100, now: view.progress }}
          style={[styles.pill, { backgroundColor: c.card, borderColor: c.line }]}>
          <ActivityIndicator size="small" color={c.goldText} />
          <AppText variant="meta" style={{ color: c.fg }}>
            {t("updates.downloading")}
          </AppText>
          {view.progress !== null ? (
            <AppText style={{ fontFamily: fonts.mono, fontSize: fs.mono, color: c.goldText, writingDirection: "ltr" }}>{`${view.progress}%`}</AppText>
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.anchor, { top, paddingHorizontal: metrics.rail - 8 }]}>
      <View accessibilityLiveRegion="polite" style={[styles.card, { backgroundColor: c.card, borderColor: c.line }]}>
        <View style={{ gap: 4 }}>
          <AppText variant="rowTitle">{t("updates.ready")}</AppText>
          <AppText variant="meta">{t(view.mandatory ? "updates.mandatoryBody" : "updates.readyBody", { s: MANDATORY_COUNTDOWN_S })}</AppText>
        </View>
        <View style={styles.actions}>
          {view.mandatory ? null : (
            <View style={{ flex: 1 }}>
              <SecondaryButton label={t("updates.later")} onPress={onLater} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <PrimaryButton label={t("updates.restart")} onPress={onRestart} />
          </View>
        </View>
      </View>
    </View>
  );
}

/** Mounted once, above the navigator. */
export function UpdateLoader() {
  const { view, restart, later } = useAppUpdates();
  const preview = __DEV__ ? previewView(process.env.EXPO_PUBLIC_UPDATE_PREVIEW) : null;
  const [previewHidden, setPreviewHidden] = useState(false);
  if (preview) {
    return <UpdateBanner view={previewHidden ? { kind: "hidden" } : preview} onRestart={() => setPreviewHidden(true)} onLater={() => setPreviewHidden(true)} />;
  }
  return <UpdateBanner view={view} onRestart={restart} onLater={later} />;
}

const styles = StyleSheet.create({
  anchor: { position: "absolute", start: 0, end: 0, alignItems: "center", zIndex: 100, elevation: 100 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 36,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 18,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  card: {
    alignSelf: "stretch",
    gap: 14,
    padding: 16,
    borderWidth: 1,
    borderRadius: metrics.radius.sheet,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  actions: { flexDirection: "row", gap: 10 },
});
