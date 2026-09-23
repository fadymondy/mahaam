// Profile → Report a problem: the SDK's feedback sheet (@mahaam/react-native/feedback-ui) in the
// grid's colours and the app's language, filing into the Mahaam project with the app's key.
import { arabicStrings, englishStrings, FeedbackReporter } from "@mahaam/react-native/feedback-ui";
import { Dimensions, Platform } from "react-native";

import { apiUrl } from "@/config";
import { usePrefs } from "@/grid";
import { APP_ID, FEEDBACK_KEY } from "@/lib/monitor";

export function ReportProblem({ visible, onClose, route }: { visible: boolean; onClose: () => void; route?: string }) {
  const { colors: c, locale, isRTL } = usePrefs();
  const { width, height } = Dimensions.get("window");
  return (
    <FeedbackReporter
      visible={visible}
      onClose={onClose}
      route={route}
      direction={isRTL ? "rtl" : "ltr"}
      strings={locale === "ar" ? arabicStrings : englishStrings}
      theme={{ background: c.card, text: c.fg, muted: c.muted, border: c.line, accent: c.action, accentText: c.onAction, danger: c.dangerText }}
      config={{
        publicKey: FEEDBACK_KEY,
        baseUrl: apiUrl || "https://console.mahaam.app",
        appId: APP_ID,
        userAgent: `Mahaam/${Platform.OS} ${String(Platform.Version)}`,
        viewport: `${Math.round(width)}x${Math.round(height)}`,
      }}
    />
  );
}
