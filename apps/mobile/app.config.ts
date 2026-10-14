// One app for everyone (MH-418): staff and customers install the same "Mahaam"; the shell it shows
// follows the role in the selected workspace (src/lib/session.tsx), not a build-time variant.
import type { ConfigContext, ExpoConfig } from "expo/config";

const ID = "com.fadymondy.mahaam";
const asset = (f: string) => `./assets/brand/mahaam-${f}.png`;

// Over-the-air updates: Codemagic Patch on patch.fadymondy.com (plugins/with-app-updates.js,
// src/lib/updates.tsx). expo-updates stays installed for the grid's RTL reload but disabled — with
// an updates URL it would own bundle loading and Patch bundles would never boot.
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
  updates: { enabled: false },
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
      // The app is fully bilingual: declaring both makes the App Store list Arabic as a language
      // and lets iOS use the ar.lproj permission prompts (locales/ar.json, below).
      CFBundleDevelopmentRegion: "en",
      CFBundleLocalizations: ["en", "ar"],
    },
    usesAppleSignIn: true,
    // What the app collects and why (App Store privacy manifest). Everything is linked to the
    // account, used to run the app, and never used for tracking. Keep in step with
    // store/privacy.md and the privacy policy.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
      ],
      NSPrivacyCollectedDataTypes: [
        ["NSPrivacyCollectedDataTypeName", ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]],
        ["NSPrivacyCollectedDataTypeEmailAddress", ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]],
        ["NSPrivacyCollectedDataTypeUserID", ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]],
        ["NSPrivacyCollectedDataTypePhotosorVideos", ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]],
        ["NSPrivacyCollectedDataTypeOtherUserContent", ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]],
        ["NSPrivacyCollectedDataTypeCrashData", ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]],
        ["NSPrivacyCollectedDataTypePerformanceData", ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]],
        // "Report a problem" sends device info and console / network logs with the report.
        ["NSPrivacyCollectedDataTypeOtherDiagnosticData", ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]],
      ].map(([type, purposes]) => ({
        NSPrivacyCollectedDataType: type as string,
        NSPrivacyCollectedDataTypeLinked: true,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: purposes as string[],
      })),
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
    // Pulled in by dependencies but never used: audio (image picker), drawing over other apps (dev
    // tooling) and the fingerprint API that USE_BIOMETRIC replaced. Play flags unused permissions.
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.USE_FINGERPRINT",
      // Play flags legacy storage; the system photo picker needs no permission.
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
  },
  // Localised InfoPlist strings (the app name and every permission prompt) in English and Arabic.
  // Keep them in step with ios.infoPlist above and the plugin permission strings below.
  locales: { en: "./locales/en.json", ar: "./locales/ar.json" },
  web: { output: "single", favicon: asset("favicon") },
  plugins: [
    "expo-router",
    "./plugins/with-scene-lifecycle",
    // Android release builds need more Gradle/Kotlin daemon memory than the template gives.
    "./plugins/with-gradle-memory",
    // OTA through Codemagic Patch; inert until the deployment keys exist.
    "./plugins/with-app-updates",
    "expo-secure-store",
    ["expo-local-authentication", { faceIDPermission: "Unlock Mahaam with Face ID. Your face data never leaves this device." }],
    "expo-localization",
    ["expo-notifications", { color: "#8C3FB5" }],
    // The camera and photos attach images; the app never records audio, so no microphone prompt
    // (a generic, unused permission string is an App Review flag).
    [
      "expo-image-picker",
      {
        photosPermission: "Attach a photo to an issue or request you file.",
        cameraPermission: "Take a photo to attach to an issue or request you file.",
        microphonePermission: false,
      },
    ],
    // Sign in with Apple (App Store 4.8: required once Google/GitHub sign-in are offered).
    "expo-apple-authentication",
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
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
