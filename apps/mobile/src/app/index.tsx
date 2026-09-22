// The gate: no language yet → first-run picker; signed out → sign in; no workspace → picker;
// otherwise this variant's tree.
import { Redirect } from "expo-router";

import { isTeam } from "@/config";
import { usePrefs } from "@/grid";
import { useSession } from "@/lib/session";

export default function Gate() {
  const { locale } = usePrefs();
  const { status, workspace } = useSession();
  if (locale === null) return <Redirect href="/welcome" />;
  if (status !== "signedIn") return <Redirect href="/sign-in" />;
  if (!workspace) return <Redirect href="/workspaces" />;
  return <Redirect href={isTeam ? "/today" : "/projects"} />;
}
