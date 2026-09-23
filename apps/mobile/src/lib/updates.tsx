// Over-the-air updates (expo-updates): check on launch and whenever the app returns to the
// foreground, download in the background, then offer to restart.
//
//   downloading → a small pill at the top: "Downloading update… 42%"
//   ready       → a card: "Update ready" · Restart now / Later
//
// "Restart now" reloads into the new bundle. "Later" only hides the card: expo-updates launches a
// downloaded update on the next cold start by itself, so the prompt says so rather than nagging.
// Nothing runs in development (Metro serves the code) or in a build without an updates URL
// (app.config.ts wires it from EAS_PROJECT_ID). Failures stay silent: an offline check is normal,
// and the next foreground tries again.
import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, View } from "react-native";
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
  | { kind: "ready" };

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
}): UpdateView {
  if (s.isRestarting) return { kind: "hidden" };
  if (s.isUpdatePending) return s.pendingId !== null && s.pendingId === s.laterId ? { kind: "hidden" } : { kind: "ready" };
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

/** Runs the checks and returns what to show. */
function useAppUpdates() {
  const u = Updates.useUpdates();
  const [laterId, setLaterId] = useState<string | null>(null);
  const busy = useRef(false);
  const lastCheckAt = useRef<number | null>(null);
  const pending = useRef(u.isUpdatePending);
  useEffect(() => {
    pending.current = u.isUpdatePending;
  }, [u.isUpdatePending]);

  const check = useCallback(async (reason: CheckReason) => {
    const now = Date.now();
    if (!shouldCheck({ reason, dev: __DEV__, enabled: Updates.isEnabled, busy: busy.current, pending: pending.current, lastCheckAt: lastCheckAt.current, now })) return;
    busy.current = true;
    lastCheckAt.current = now;
    try {
      const r = await Updates.checkForUpdateAsync();
      if (r.isAvailable || r.isRollBackToEmbedded) await Updates.fetchUpdateAsync();
    } catch {
      // Offline, server down, or a bad manifest: try again on the next foreground.
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void check("launch");
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void check("foreground");
    });
    return () => sub.remove();
  }, [check]);

  const pendingId = u.isUpdatePending ? (u.downloadedUpdate?.updateId ?? "rollback") : null;
  const view = updateView({
    isDownloading: u.isDownloading,
    downloadProgress: u.downloadProgress,
    isUpdatePending: u.isUpdatePending,
    isRestarting: u.isRestarting,
    pendingId,
    laterId,
  });
  return {
    view,
    restart: () => void Updates.reloadAsync().catch(() => undefined),
    later: () => setLaterId(pendingId),
  };
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
          <AppText variant="meta">{t("updates.readyBody")}</AppText>
        </View>
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <SecondaryButton label={t("updates.later")} onPress={onLater} />
          </View>
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
