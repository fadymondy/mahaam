// Which sign-in buttons a device shows, from GET /api/auth/methods (lib/social.ts).
jest.mock("@/lib/session", () => ({ client: {}, DEVICE_NAME: "Test" }));
jest.mock("expo-apple-authentication", () => ({}));
jest.mock("expo-crypto", () => ({}));
jest.mock("expo-web-browser", () => ({}));

// eslint-disable-next-line import/first -- after the mocks, which jest hoists anyway
import { parseProviders, visibleProviders } from "../social";

const methods = (apple: "oauth" | "native" | null) => [
  { name: "password", type: "password", url: "/api/auth/login" },
  { name: "github", type: "oauth", label: "Continue with Github", url: "/api/auth/oauth/github" },
  { name: "google", type: "oauth", label: "Continue with Google", url: "/api/auth/oauth/google" },
  ...(apple ? [{ name: "apple", type: apple, url: apple === "oauth" ? "/api/auth/oauth/apple" : "/api/auth/apple" }] : []),
  { name: "evil", type: "oauth", url: "https://evil.example/x" },
];

describe("social providers", () => {
  it("keeps only usable entries, Apple first, with plain names", () => {
    const list = parseProviders(methods("oauth"));
    expect(list.map((p) => `${p.name}:${p.type}:${p.label}`)).toEqual(["apple:oauth:Apple", "google:oauth:Google", "github:oauth:GitHub"]);
  });

  it("iOS: Apple natively whenever the server lists it, the rest in the browser", () => {
    for (const kind of ["oauth", "native"] as const) {
      const v = visibleProviders(parseProviders(methods(kind)), "ios", true);
      expect(v.appleNative).toBe(true);
      expect(v.browser.map((p) => p.name)).toEqual(["google", "github"]);
    }
    // No Apple listed, or the device can't do it: no Apple button.
    expect(visibleProviders(parseProviders(methods(null)), "ios", true).appleNative).toBe(false);
    expect(visibleProviders(parseProviders(methods("native")), "ios", false).appleNative).toBe(false);
  });

  it("iOS (App Store 4.8): no Google or GitHub unless Sign in with Apple is shown too", () => {
    expect(visibleProviders(parseProviders(methods(null)), "ios", true)).toEqual({ appleNative: false, browser: [] });
    expect(visibleProviders(parseProviders(methods("oauth")), "ios", false)).toEqual({ appleNative: false, browser: [] });
    // The same server config on Android still offers the browser providers.
    expect(visibleProviders(parseProviders(methods(null)), "android", false).browser.map((p) => p.name)).toEqual(["google", "github"]);
  });

  it("Android: Apple through the browser only when the web flow is configured", () => {
    expect(visibleProviders(parseProviders(methods("oauth")), "android", false).browser.map((p) => p.name)).toEqual(["apple", "google", "github"]);
    const v = visibleProviders(parseProviders(methods("native")), "android", false);
    expect(v.appleNative).toBe(false);
    expect(v.browser.map((p) => p.name)).toEqual(["google", "github"]);
  });

  it("shows nothing when the server lists nothing", () => {
    expect(visibleProviders(parseProviders([]), "android", false)).toEqual({ appleNative: false, browser: [] });
  });
});
