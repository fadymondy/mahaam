// Social sign-in, as the stores and the owner's rules want it:
//
//   Apple (iOS)      native Sign in with Apple (App Store 4.8 requires it once Google/GitHub are
//                    offered), first and as large as the others. The app hashes a random nonce for
//                    Apple and sends the raw one to POST /api/auth/apple, which checks Apple's
//                    signature, audience and nonce. The authorizationCode goes along so the server
//                    can revoke the grant when the account is deleted.
//   Apple (Android)  the web's Sign in with Apple (Services ID) in the system browser, like Google.
//   Google, GitHub…  never in an embedded web view: the system browser (ASWebAuthenticationSession
//                    / Custom Tabs) runs the provider and returns to the web's /app-signin page,
//                    which hands a one-time code back to mahaam://auth/callback (RFC 8252 + PKCE,
//                    the same handoff the desktop app uses). The code and the verifier become this
//                    device's access token.
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { client, DEVICE_NAME } from "@/lib/session";
import { apiUrl } from "@/config";

export const APP_REDIRECT = "mahaam://auth/callback";

// type "oauth": a browser flow at url (/api/auth/oauth/<name>). "native": Apple on iOS only.
export type Provider = { name: string; label: string; url: string; type: "oauth" | "native" };

// The names on the buttons; the server's labels are whole phrases ("Continue with Google").
const NAMES: Record<string, string> = { apple: "Apple", google: "Google", github: "GitHub" };
const ORDER = ["apple", "google", "github"];

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const base64url = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const origin = () => apiUrl.replace(/\/$/, "");

/** The sign-in providers the server has on (GET /api/auth/methods), Apple first. */
export async function providers(): Promise<Provider[]> {
  try {
    const r = await fetch(`${origin()}/api/auth/methods`, { headers: { Accept: "application/json" } });
    const d = (await r.json()) as { methods?: { name?: string; label?: string; url?: string; type?: string }[] | null };
    return parseProviders(d.methods ?? []);
  } catch {
    return [];
  }
}

export function parseProviders(methods: { name?: string; label?: string; url?: string; type?: string }[]): Provider[] {
  const out: Provider[] = [];
  for (const m of methods) {
    const name = typeof m?.name === "string" ? m.name : "";
    if (!name || out.some((p) => p.name === name)) continue;
    if (m.type === "oauth" && typeof m.url === "string" && /^\/api\/auth\/oauth\/[a-z0-9_-]+$/.test(m.url)) {
      out.push({ name, label: NAMES[name] ?? name, url: m.url, type: "oauth" });
    } else if (m.type === "native" && name === "apple") {
      out.push({ name, label: NAMES.apple, url: m.url ?? "/api/auth/apple", type: "native" });
    }
  }
  const rank = (n: string) => (ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length);
  return out.sort((a, b) => rank(a.name) - rank(b.name));
}

/**
 * What this device shows: on iOS, Apple natively (whenever the server lists Apple at all) and the
 * other providers in the browser; on Android, every browser provider, Apple included.
 */
export function visibleProviders(list: Provider[], os: string, appleNative: boolean): { appleNative: boolean; browser: Provider[] } {
  if (os === "ios") {
    return { appleNative: appleNative && list.some((p) => p.name === "apple"), browser: list.filter((p) => p.name !== "apple" && p.type === "oauth") };
  }
  return { appleNative: false, browser: list.filter((p) => p.type === "oauth") };
}

export async function appleAvailable(): Promise<boolean> {
  return Platform.OS === "ios" && (await AppleAuthentication.isAvailableAsync().catch(() => false));
}

const canceled = (e: unknown) => (e as { code?: string })?.code === "ERR_REQUEST_CANCELED";

/** Sign in with Apple. null when the person cancelled the sheet. MfaRequired passes through. */
export async function signInWithApple(locale: string) {
  const raw = hex(Crypto.getRandomBytes(32));
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  let cred: AppleAuthentication.AppleAuthenticationCredential;
  try {
    cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
  } catch (e) {
    if (canceled(e)) return null;
    throw e;
  }
  if (!cred.identityToken) throw new Error("Apple did not return an identity token");
  const name = cred.fullName ? { given: cred.fullName.givenName ?? undefined, family: cred.fullName.familyName ?? undefined } : undefined;
  return client.appleSignIn({
    identity_token: cred.identityToken,
    nonce: raw,
    name,
    locale: locale === "ar" ? "ar" : "en",
    authorization_code: cred.authorizationCode ?? undefined,
  });
}

/**
 * A provider (a methods url, e.g. /api/auth/oauth/google) in the system browser, back through the
 * web's app-signin handoff. null when the person closed the browser.
 */
export async function signInWithBrowser(provider: Provider, locale: string) {
  const verifier = hex(Crypto.getRandomBytes(32));
  const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const state = hex(Crypto.getRandomBytes(16));
  const q = new URLSearchParams({ redirect_uri: APP_REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state, device: DEVICE_NAME });
  const handoff = `/${locale === "ar" ? "ar" : "en"}/app-signin?${q.toString()}`;
  const res = await WebBrowser.openAuthSessionAsync(`${origin()}${provider.url}?next=${encodeURIComponent(handoff)}`, APP_REDIRECT, {
    preferEphemeralSession: false,
  });
  if (res.type !== "success" || !res.url) return null;
  const back = new URL(res.url);
  const code = back.searchParams.get("code");
  // The state ties this redirect to the sign-in this app started; anything else is ignored.
  if (!code || back.searchParams.get("state") !== state) throw new Error("The sign-in did not come back from the browser as expected. Try again.");
  return client.exchangeAppCode(code, verifier, APP_REDIRECT);
}
