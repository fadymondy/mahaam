// One app for everyone (MH-418): staff and customers install the same "Mahaam"; the shell it shows
// follows the role in the selected workspace (src/lib/session.tsx), not a build-time variant.
import type { ConfigContext, ExpoConfig } from "expo/config";

const ID = "com.fadymondy.mahaam";
const asset = (f: string) => `./assets/brand/mahaam-${f}.png`;

// Over-the-air updates (src/lib/updates.tsx). The EAS project id comes from the environment (EAS
// env vars / .env), never from this file; without it the build has no updates URL and the updater
// stays off. Each build profile's channel is in eas.json (development / preview / production).
// The runtime version is the native fingerprint, so an update only reaches binaries whose native
// code it was built against. The app checks for itself on launch and on foreground, so the native
// launch check only runs to recover from a crashing update.
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID;
const UPDATES_URL = EAS_PROJECT_ID ? `https://u.expo.dev/${EAS_PROJECT_ID}` : undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Mahaam",
  slug: "mahaam",
  version: "1.0.0",
  orientation: "portrait",
  icon: asset("icon"),
  // mahaam:// — also the native redirect scheme the API's OAuth accepts (MH-79).
  scheme: "mahaam",
  userInterfaceStyle: "automatic",
  runtimeVersion: { policy: "fingerprint" },
  updates: UPDATES_URL
    ? { url: UPDATES_URL, checkAutomatically: "ON_ERROR_RECOVERY", fallbackToCacheTimeout: 0 }
    : { enabled: false },
  ios: {
    bundleIdentifier: ID,
    // Icon Composer bundle (MH-339): the mark as two glass layers on the grid's grounds — paper in
    // light, ink in dark — so iOS 26+ renders Default / Dark / Tinted / Clear with Liquid Glass.
    // Older iOS gets the flat renders Xcode generates from it. Preview any appearance with:
    //   ictool assets/brand/mahaam.icon --export-image --rendition Dark --output-file x.png …
    icon: "./assets/brand/mahaam.icon",
    // Fady Nasef (individual). Automatic signing registers the bundle id and its capabilities.
    appleTeamId: process.env.APPLE_TEAM_ID ?? "JW9HJH86GC",
    supportsTablet: true,
    infoPlist: {
      NSPhotoLibraryUsageDescription: "Attach a photo to an issue or request you file.",
      NSCameraUsageDescription: "Take a photo to attach to an issue or request you file.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ID,
    adaptiveIcon: {
      backgroundColor: "#F0EBE1",
      foregroundImage: asset("adaptive-fg"),
      backgroundImage: asset("adaptive-bg"),
      monochromeImage: asset("adaptive-mono"),
    },
    predictiveBackGestureEnabled: false,
    permissions: ["POST_NOTIFICATIONS"],
  },
  web: { output: "single", favicon: asset("favicon") },
  plugins: [
    "expo-router",
    "./plugins/with-scene-lifecycle",
    "expo-secure-store",
    ["expo-local-authentication", { faceIDPermission: "Unlock Mahaam with Face ID. Your face data never leaves this device." }],
    "expo-localization",
    ["expo-notifications", { color: "#8C3FB5" }],
    ["expo-image-picker", { photosPermission: "Attach a photo to an issue or request you file." }],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#F0EBE1",
        image: asset("splash"),
        imageWidth: 160,
        dark: { backgroundColor: "#0B1429", image: asset("splash-dark") },
      },
    ],
  ],
  experiments: { typedRoutes: false, reactCompiler: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
    eas: EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined,
  },
});
