// Build-time configuration: where the API lives. Nothing is hard-coded for production: EAS profiles
// set EXPO_PUBLIC_API_URL (eas.json). Which experience the app shows (staff or customer) is not a
// build setting — it follows the role in the selected workspace (src/lib/session.tsx).
import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string | null };

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
