// Build-time configuration: which app this is (APP_VARIANT → EXPO_PUBLIC_APP_VARIANT, see
// app.config.ts) and where the API lives. Nothing is hard-coded for production: EAS profiles set
// EXPO_PUBLIC_API_URL (eas.json).
import Constants from "expo-constants";
import { Platform } from "react-native";

export type Variant = "team" | "client";

const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: string; apiUrl?: string | null };

export const variant: Variant =
  (process.env.EXPO_PUBLIC_APP_VARIANT ?? extra.variant) === "client" ? "client" : "team";

export const isTeam = variant === "team";

function devApiUrl(): string {
  // In development the API runs next to Metro: reuse the dev server's host so a phone on the LAN
  // (or the Android emulator) reaches it. Port from EXPO_PUBLIC_API_PORT, default 8120.
  const port = process.env.EXPO_PUBLIC_API_PORT ?? "8120";
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host) return `http://${host}:${port}`;
  return Platform.OS === "android" ? `http://10.0.2.2:${port}` : `http://localhost:${port}`;
}

/**
 * The API origin. On web the app is served from the same origin as /api (scripts/serve-web.mjs
 * proxies it) because the API's CORS list only names the Next app — so it is "" there unless
 * EXPO_PUBLIC_WEB_API_URL says otherwise.
 */
export const apiUrl: string =
  Platform.OS === "web"
    ? (process.env.EXPO_PUBLIC_WEB_API_URL ?? "")
    : (process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? devApiUrl());
