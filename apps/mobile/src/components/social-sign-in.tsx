// "Continue with Apple / Google / GitHub" on the sign-in screen (lib/social.ts does the work).
// Apple's own button on iOS (its guidelines want theirs), the server's OAuth providers as outlined
// buttons under it; nothing at all when neither is available (a self-hosted server without OAuth).
import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useErrorText } from "@/components/kit";
import { AppText, fonts, useColors, usePrefs } from "@/grid";
import { useI18n } from "@/i18n";
import { useSession } from "@/lib/session";
import { appleAvailable, providers, signInWithApple, signInWithBrowser, type Provider } from "@/lib/social";
import { fs } from "@/lib/type-scale";

function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <Path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </Svg>
  );
}

function GitHubMark({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path
        fill={color}
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </Svg>
  );
}

export function SocialSignIn({ onMfa, disabled }: { onMfa: (challenge: string) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const c = useColors();
  const { theme } = usePrefs();
  const errText = useErrorText();
  const { signInSocial } = useSession();
  const [apple, setApple] = useState(false);
  const [list, setList] = useState<Provider[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void appleAvailable().then(setApple);
    void providers().then(setList);
  }, []);

  if (!apple && !list.length) return null;

  const run = async (key: string, fn: () => Promise<Awaited<ReturnType<typeof signInWithApple>>>) => {
    if (busy || disabled) return;
    setBusy(key);
    setError(null);
    try {
      const r = await signInSocial(fn);
      if (r.mfa) onMfa(r.mfa);
    } catch (e) {
      setError(e instanceof Error && !("status" in e) ? t("auth.socialFailed") : errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 10 }} testID="social-sign-in">
      <View style={styles.divider}>
        <View style={[styles.rule, { backgroundColor: c.line }]} />
        <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.muted }}>{t("auth.or")}</AppText>
        <View style={[styles.rule, { backgroundColor: c.line }]} />
      </View>
      {apple ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={theme === "dark" ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={10}
          style={{ height: 48, width: "100%", opacity: busy && busy !== "apple" ? 0.5 : 1 }}
          onPress={() => void run("apple", () => signInWithApple(locale))}
        />
      ) : null}
      {list.map((p) => (
        <Pressable
          key={p.name}
          accessibilityRole="button"
          accessibilityLabel={t("auth.continueWith", { provider: p.label })}
          disabled={!!busy || disabled}
          onPress={() => void run(p.name, () => signInWithBrowser(p, locale))}
          style={({ pressed }) => [styles.provider, { borderColor: c.line, backgroundColor: pressed ? c.soft : c.card, opacity: busy && busy !== p.name ? 0.5 : 1 }]}
          testID={`sign-in-${p.name}`}>
          {busy === p.name ? (
            <ActivityIndicator color={c.muted} />
          ) : p.name === "google" ? (
            <GoogleMark />
          ) : p.name === "github" ? (
            <GitHubMark color={c.fg} />
          ) : null}
          <AppText style={{ fontFamily: fonts.medium, fontSize: fs.body, color: c.fg }}>{t("auth.continueWith", { provider: p.label })}</AppText>
        </Pressable>
      ))}
      {error ? <AppText style={{ fontFamily: fonts.regular, fontSize: fs.meta, color: c.dangerText }}>{error}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  provider: { height: 48, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
});
