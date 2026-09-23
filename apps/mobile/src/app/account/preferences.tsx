// Profile → Language & appearance: the grid's preferences (switching to Arabic flips the whole app to
// RTL). The language is also saved to the profile, so email and push speak it.
import { useEffect, useRef } from "react";

import { PreferencesRow, Rows, Screen, StackHeader, usePrefs } from "@/grid";
import { useT } from "@/i18n";
import { mahaam, useSession } from "@/lib/session";

export default function Preferences() {
  const t = useT();
  const { locale } = usePrefs();
  const { status } = useSession();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (status === "signedIn" && locale) void mahaam.me.update({ locale }).catch(() => undefined);
  }, [locale, status]);
  return (
    <Screen header={<StackHeader title={t("account.preferences.title")} />}>
      <Rows>
        <PreferencesRow />
      </Rows>
    </Screen>
  );
}
