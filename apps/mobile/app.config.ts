// One codebase, two store apps. APP_VARIANT=team|client picks the name, bundle id, icon, splash and
// (via extra.variant / EXPO_PUBLIC_APP_VARIANT) which navigation tree the app mounts.
import type { ConfigContext, ExpoConfig } from "expo/config";

type Variant = "team" | "client";

const variant: Variant = process.env.APP_VARIANT === "client" ? "client" : "team";
// Inline the variant into the JS bundle too (read by src/config.ts) so web exports and dev clients
// agree with the native config.
process.env.EXPO_PUBLIC_APP_VARIANT ??= variant;

const V = {
  team: { name: "Mahaam Team", slug: "mahaam-team", id: "com.fadymondy.mahaam.team", scheme: "mahaam-team", bg: "#F0EBE1" },
  client: { name: "Mahaam Client", slug: "mahaam-client", id: "com.fadymondy.mahaam.client", scheme: "mahaam-client", bg: "#0B1429" },
}[variant];

const asset = (f: string) => `./assets/brand/${variant}-${f}.png`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: V.name,
  slug: V.slug,
  version: "1.0.0",
  orientation: "portrait",
  icon: asset("icon"),
  scheme: V.scheme,
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: V.id,
    supportsTablet: true,
    infoPlist: {
      NSPhotoLibraryUsageDescription: "Attach a photo to an issue or request you file.",
      NSCameraUsageDescription: "Take a photo to attach to an issue or request you file.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: V.id,
    adaptiveIcon: {
      backgroundColor: V.bg,
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
    variant,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? null,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
