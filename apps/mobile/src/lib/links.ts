// Public pages the app links to. The web console serves them (web/app/[locale]/legal/[doc]); the
// origin comes from config (EXPO_PUBLIC_WEB_URL), never hard-coded per build.
const WEB = (process.env.EXPO_PUBLIC_WEB_URL || "https://console.mahaam.app").replace(/\/$/, "");

export const legalUrl = (doc: "terms" | "privacy", locale: string) => `${WEB}/${locale === "ar" ? "ar" : "en"}/legal/${doc}`;
export const supportEmail = "info@3x1.io";
